import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { data, Link } from "react-router";

import type { Route } from "./+types/admin-place-operations";
import { PlaceReviewPipeline } from "../components/admin/PlaceReviewPipeline";
import { createDb } from "../db/client.server";
import { categories } from "../db/schema";
import { requireAdmin } from "../features/auth/session.server";
import { getTerminalCategoryIds } from "../features/candidates/category-selection";
import { assertNaverLocalSearchEnabled, createNaverLocalSearchAdapter, NaverLocalSearchError } from "../features/candidates/naver-local-search.server";
import { isSameOriginMutation } from "../features/http/same-origin";
import { confirmReviewItemCategories } from "../features/places/place-review-category.server";
import { listReviewDuplicateCandidates, resolveReviewDuplicates } from "../features/places/place-review-duplicates.server";
import { verifyReviewItemsWithNaver } from "../features/places/place-review-naver.server";
import { parsePlaceReviewQuery } from "../features/places/place-review-pagination";
import { reviewStages, type ReviewStage } from "../features/places/place-review-pipeline";
import { publishReviewedPlaces } from "../features/places/place-review-publication.server";
import { getPlaceReviewStageCounts, listPlaceReviewWorkItems } from "../features/places/place-review-query.server";
import { advancePlaceReviewWorkItems, autoExcludeNonFoodReviewItems, excludePlaceReviewItems, holdPlaceReviewItems } from "../features/places/place-review-work-items.server";
import { getNaverLocalSearchApiCallsToday } from "../features/places/naver-place-liveness.server";

function selectedWorkItems(form: FormData) {
  const versions: Record<string, number> = {};
  const workItemIds = form.getAll("workItem").flatMap((value) => {
    const [id, version] = String(value).split("|");
    const parsedVersion = Number(version);
    if (!id || !Number.isInteger(parsedVersion) || parsedVersion < 0) return [];
    versions[id] = parsedVersion;
    return [id];
  });
  return { workItemIds, versions };
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const db = createDb(env.DB);
  const url = new URL(request.url);
  const query = parsePlaceReviewQuery(url);
  const now = new Date().toISOString();
  const [page, counts, naverDailyUsage, categoryRows] = await Promise.all([
    listPlaceReviewWorkItems(db, query),
    getPlaceReviewStageCounts(db),
    getNaverLocalSearchApiCallsToday(db, now),
    db.select({ id: categories.id, name: categories.name, parentId: categories.parentId }).from(categories).where(eq(categories.isActive, true)),
  ]);
  const terminalCategoryIds = getTerminalCategoryIds(categoryRows);
  const duplicateCandidates = query.step === 4
    ? await listReviewDuplicateCandidates(db, page.rows.map((row) => row.workItemId))
    : [];
  return {
    query, page, counts, categories: categoryRows.filter((category) => terminalCategoryIds.has(category.id)), duplicateCandidates,
    naverDailyUsage, naverDailyLimit: Number(env.NAVER_LOCAL_SEARCH_DAILY_LIMIT ?? 20_000),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request);
  if (!isSameOriginMutation(request)) return data({ ok: false, error: "이 요청은 현재 서비스에서 다시 실행해 주세요." }, { status: 403 });
  const form = await request.formData();
  const db = createDb(env.DB);
  const now = new Date().toISOString();
  const intent = String(form.get("intent") ?? "");
  const { workItemIds, versions } = selectedWorkItems(form);
  const automaticWorkItemIds = [...new Set(form.getAll("autoWorkItem").map(String).filter(Boolean))];
  const expectedStage = String(form.get("expectedStage") ?? "");

  if (intent === "auto-exclude-non-food-review-items") {
    if (expectedStage !== "SOURCE_REVIEW") return data({ ok: false, error: "원천 검수 단계에서만 자동 제외할 수 있습니다." }, { status: 400 });
    if (!automaticWorkItemIds.length) return data({ ok: false, error: "자동 제외할 장소가 없습니다." }, { status: 400 });
    const result = await autoExcludeNonFoodReviewItems(db, { workItemIds: automaticWorkItemIds, actorUserId: admin.id, now });
    return { ok: true, message: `비음식점 자동 제외 ${result.changed.length}곳 · 유지 ${result.skipped.length}곳`, skipped: result.skipped };
  }

  if (intent === "verify-review-items-with-naver") {
    if (!workItemIds.length) return data({ ok: false, error: "NAVER 근거를 확인할 장소를 선택해 주세요." }, { status: 400 });
    try {
      assertNaverLocalSearchEnabled(env);
      const result = await verifyReviewItemsWithNaver(db, { workItemIds, actorUserId: admin.id, now, dailyLimit: Number(env.NAVER_LOCAL_SEARCH_DAILY_LIMIT ?? 20_000), adapter: createNaverLocalSearchAdapter(env) });
      return { ok: true, message: `확인 ${result.scanned} · 통과 ${result.passed} · 확인 필요 ${result.attention} · 실패 ${result.failed}`, skipped: result.skipped, nextStep: 3 as const };
    } catch (error) {
      const code = error instanceof NaverLocalSearchError ? error.code : error instanceof Error ? error.message : "UNKNOWN";
      return data({ ok: false, error: code === "NAVER_LOCAL_SEARCH_QUOTA" ? "NAVER 일일 확인 한도에 도달했습니다." : `NAVER 근거 확인을 완료하지 못했습니다: ${code}` }, { status: 400 });
    }
  }
  if (intent === "confirm-review-categories") {
    const selections = workItemIds.map((workItemId) => ({ workItemId, categoryId: String(form.get(`category:${workItemId}`) ?? ""), reason: String(form.get("reason") ?? "") }));
    const result = await confirmReviewItemCategories(db, { selections, actorUserId: admin.id, now });
    return { ok: true, message: `카테고리 확정 ${result.confirmed.length}곳 · 건너뜀 ${result.skipped.length}곳`, skipped: result.skipped };
  }
  if (intent === "resolve-review-duplicates") {
    const resolutions = form.getAll("duplicateCandidate").map(String).flatMap((value) => {
      const [workItemId, candidatePlaceId] = value.split("|");
      const decision = String(form.get(`duplicateDecision:${value}`) ?? "");
      const reason = String(form.get(`duplicateReason:${value}`) ?? "");
      return workItemId && candidatePlaceId && ["LINK_EXISTING", "MERGE", "DISTINCT"].includes(decision)
        ? [{ workItemId, candidatePlaceId, decision: decision as "LINK_EXISTING" | "MERGE" | "DISTINCT", reason }]
        : [];
    });
    const result = await resolveReviewDuplicates(db, { resolutions, actorUserId: admin.id, now });
    return { ok: true, message: `중복 판정 ${result.accepted.length}건 저장 · 건너뜀 ${result.skipped.length}건`, skipped: result.skipped };
  }
  if (intent === "publish-review-items") {
    if (String(form.get("confirmPublish") ?? "") !== "on") return data({ ok: false, error: "선택한 장소를 공개한다는 확인이 필요합니다." }, { status: 400 });
    const result = await publishReviewedPlaces(db, { workItemIds, expectedVersions: versions, actorUserId: admin.id, now });
    return { ok: true, message: `선택 공개 ${result.published.length}곳 완료 · 건너뜀 ${result.skipped.length}곳`, skipped: result.skipped };
  }
  if (!workItemIds.length) return data({ ok: false, error: "처리할 장소를 선택해 주세요." }, { status: 400 });
  if (!reviewStages.includes(expectedStage as ReviewStage)) return data({ ok: false, error: "검수 단계를 다시 확인해 주세요." }, { status: 400 });
  const reason = String(form.get("reason") ?? "").trim();
  if (intent === "advance-review-items") {
    const result = await advancePlaceReviewWorkItems(db, { workItemIds, expectedStage: expectedStage as ReviewStage, expectedVersions: versions, actorUserId: admin.id, now });
    return { ok: true, message: `다음 단계 이동 ${result.advanced.length}곳 · 건너뜀 ${result.skipped.length}곳`, skipped: result.skipped };
  }
  if (intent === "hold-review-items" || intent === "exclude-review-items") {
    if (!reason) return data({ ok: false, error: "보류 또는 제외 사유를 입력해 주세요." }, { status: 400 });
    const result = intent === "hold-review-items"
      ? await holdPlaceReviewItems(db, { workItemIds, actorUserId: admin.id, code: "ADMIN_REVIEW_HOLD", note: reason, now })
      : await excludePlaceReviewItems(db, { workItemIds, actorUserId: admin.id, code: "ADMIN_REVIEW_EXCLUDE", note: reason, now });
    return { ok: true, message: `${intent === "hold-review-items" ? "보류" : "제외"} ${result.changed.length}곳 · 건너뜀 ${result.skipped.length}곳`, skipped: result.skipped };
  }
  throw new Response("Invalid intent", { status: 400 });
}

export function meta() { return [{ title: "장소 검수 — Re:Taste Admin" }]; }

export default function AdminPlaceOperations({ loaderData, actionData }: Route.ComponentProps) {
  const message = actionData && "message" in actionData ? actionData.message : undefined;
  const error = actionData && "error" in actionData ? actionData.error : undefined;
  const nextStep = actionData && "nextStep" in actionData && actionData.nextStep === 3 ? 3 : undefined;
  return <main id="main" className="place-ops shell place-review-shell">
    <header className="place-ops-head">
      <div><p className="eyebrow">ADMIN / PLACE REVIEW</p><h1>장소 검수</h1><p>원천부터 NAVER 근거, 카테고리, 중복 검토를 순서대로 확인한 뒤 선택 공개합니다.</p></div>
      <nav><Link to="/admin/data-sync">공공데이터 수집</Link><Link to="/admin/ratings">평가 운영</Link></nav>
    </header>
    <PlaceReviewPipeline query={loaderData.query} page={loaderData.page} counts={loaderData.counts} categories={loaderData.categories} duplicateCandidates={loaderData.duplicateCandidates} naverDailyUsage={loaderData.naverDailyUsage} naverDailyLimit={loaderData.naverDailyLimit} message={message} error={error} nextStep={nextStep} />
  </main>;
}
