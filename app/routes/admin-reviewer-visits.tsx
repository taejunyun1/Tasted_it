import { env } from "cloudflare:workers";
import { Link } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/admin-reviewer-visits";
import { createDb } from "../db/client.server";
import { requireAdmin } from "../features/auth/session.server";
import { isSameOriginMutation } from "../features/http/same-origin";
import { listReviewerModerationQueue, moderateReviewerVisit } from "../features/ratings/reviewer-moderation.server";
import { ReviewerModerationCard } from "../components/reviewer-moderation-card";
import { reviewerVisitStatusLabels } from "../components/reviewer-visit-moderation";
import "../styles/reviewer-moderation.css";

const statusSchema = z.enum(["LEGACY_UNREVIEWED", "PENDING", "APPROVED", "CHANGES_REQUESTED", "REJECTED", "WITHDRAWN"]);
const mutationSchema = z.object({
  reviewId: z.string().trim().min(1).max(128),
  expectedVersion: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  status: z.enum(["APPROVED", "CHANGES_REQUESTED", "REJECTED", "WITHDRAWN"]),
  reason: z.string().trim().min(1).max(500),
});

export const headers: Route.HeadersFunction = () => ({ "Cache-Control": "private, no-store", Vary: "Cookie" });

export async function loader({ request }: Route.LoaderArgs) {
  const admin = await requireAdmin(request);
  const search = new URL(request.url).searchParams;
  const requested = search.get("status");
  const before = search.has("beforeUpdatedAt") || search.has("beforeId") ? z.object({
    updatedAt: z.string().datetime({ offset: true }).max(40), id: z.string().min(1).max(128),
  }).safeParse({ updatedAt: search.get("beforeUpdatedAt"), id: search.get("beforeId") }) : null;
  if (before && !before.success) throw new Response("기록 페이지 주소를 다시 확인해 주세요.", { status: 400 });
  const cursor = before?.success ? before.data : undefined;
  const status = requested === "ALL" ? undefined : statusSchema.safeParse(requested ?? "PENDING").data ?? "PENDING";
  const reviews = await listReviewerModerationQueue(createDb(env.DB), { actorUserId: admin.id, status, limit: 50, before: cursor });
  const lastReview = reviews.at(-1);
  const nextHref = reviews.length === 50 && lastReview ? `?${new URLSearchParams({ status: status ?? "ALL", beforeUpdatedAt: lastReview.updatedAt, beforeId: lastReview.id })}` : null;
  return { reviews, status: status ?? "ALL", hasCursor: Boolean(cursor), nextHref };
}

async function readModerationForm(request: Request): Promise<URLSearchParams | Response> {
  const error = (status: number) => Response.json({ ok: false, error: "REVIEW_SUBMISSION_INVALID" }, { status });
  if (!request.headers.get("Content-Type")?.startsWith("application/x-www-form-urlencoded")) return error(415);
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  if (reader) while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 16_384) { await reader.cancel(); return error(413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const form = new URLSearchParams(new TextDecoder().decode(bytes));
  const allowed = new Set(["reviewId", "expectedVersion", "status", "reason", "visitVerified", "rightsVerified", "privacyVerified", "placeVerified"]);
  const seen = new Set<string>();
  for (const [name] of form) {
    if (!allowed.has(name) || seen.has(name)) return error(400);
    seen.add(name);
  }
  return form;
}

export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request);
  if (!isSameOriginMutation(request)) return Response.json({ ok: false, error: "REVIEW_ORIGIN_INVALID" }, { status: 403 });
  const form = await readModerationForm(request);
  if (form instanceof Response) return form;
  const parsed = mutationSchema.safeParse(Object.fromEntries(["reviewId", "expectedVersion", "status", "reason"].map((name) => [name, form.get(name)])));
  if (!parsed.success) return Response.json({ ok: false, error: "REVIEW_SUBMISSION_INVALID" }, { status: 400 });
  try {
    await moderateReviewerVisit(createDb(env.DB), {
      ...parsed.data, actorUserId: admin.id,
      checks: {
        visitVerified: form.get("visitVerified") === "on", rightsVerified: form.get("rightsVerified") === "on",
        privacyVerified: form.get("privacyVerified") === "on", placeVerified: form.get("placeVerified") === "on",
      }, now: new Date().toISOString(),
    });
    return { ok: true };
  } catch (error) {
    const codes = new Set(["REVIEW_VERSION_CONFLICT", "REVIEW_NOT_FOUND", "REVIEW_TRANSITION_INVALID", "REVIEW_REASON_REQUIRED", "REVIEW_VISIT_INVALID", "REVIEW_PHOTO_RIGHTS_INVALID", "REVIEW_APPROVAL_CHECKS_REQUIRED", "REVIEW_DISCLOSURE_REQUIRED", "REVIEW_CHECKS_REQUIRED", "REVIEW_DISCLOSURE_UNRESOLVED", "ACTIVE_REVIEWER_REQUIRED", "PUBLISHED_PLACE_REQUIRED"]);
    const code = error instanceof Error && codes.has(error.message) ? error.message : "REVIEW_MODERATION_FAILED";
    return Response.json({ ok: false, error: code }, { status: code === "REVIEW_VERSION_CONFLICT" ? 409 : code === "REVIEW_MODERATION_FAILED" ? 503 : 400 });
  }
}

export function meta() { return [{ title: "방문 리뷰 검수 — Re:Taste Admin" }]; }

export default function AdminReviewerVisits({ loaderData }: Route.ComponentProps) {
  return <main id="main" className="reviewer-moderation-shell">
    <p className="eyebrow">관리자 / 방문 검수</p><h1>방문 리뷰 검수</h1>
    <p className="reviewer-moderation-notice">방문 근거·사진 권리·개인정보·장소 일치를 확인한 현재 버전만 승인하세요. 승인 전 자료와 공개 회수 자료는 공개 평가·사진에 반영되지 않습니다.</p>
    <Link to="/admin/ratings">평가 운영으로</Link>
    <nav className="reviewer-moderation-filters" aria-label="방문 검수 상태">
      {Object.entries(reviewerVisitStatusLabels).map(([status, label]) => <Link key={status} to={`?status=${status}`} aria-current={loaderData.status === status ? "page" : undefined}>{label}</Link>)}
      <Link to="?status=ALL" aria-current={loaderData.status === "ALL" ? "page" : undefined}>전체</Link>
    </nav>
    <p>최대 50건씩 최근 변경순으로 표시해요. 대상 상태를 선택해 확인하세요.</p>
    <nav className="reviewer-moderation-filters" aria-label="방문 검수 페이지">
      {loaderData.hasCursor && <Link to={`?status=${loaderData.status}`}>최근 기록으로</Link>}
      {loaderData.nextHref && <Link to={loaderData.nextHref}>이전 검수 기록</Link>}
    </nav>
    {loaderData.reviews.length ? loaderData.reviews.map((review) => <ReviewerModerationCard key={`${review.id}-${review.version}`} review={review} />) : <p role="status">이 상태의 방문 리뷰가 없어요.</p>}
  </main>;
}
