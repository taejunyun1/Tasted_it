import { env } from "cloudflare:workers";
import { asc, eq } from "drizzle-orm";
import { useMemo, useState } from "react";
import { Form, Link, redirect, useSearchParams } from "react-router";
import type { Route } from "./+types/admin-candidates";
import { CandidateMap } from "../components/map/CandidateMap";
import { createDb } from "../db/client.server";
import { categories } from "../db/schema";
import {
  approveCandidate,
  listCandidateSubtypes,
  listPendingCandidates,
  rejectCandidate,
} from "../features/candidates/candidate.server";
import { classifyCandidate } from "../features/candidates/category-suggestion";
import { slugifyPlaceName } from "../features/places/place-slug";
import type {
  PublicDataSource,
  RegionCode,
} from "../features/candidates/public-data";
import { requireAdmin } from "../features/auth/session.server";

const sources: Array<[PublicDataSource, string]> = [
  ["GENERAL_RESTAURANT", "일반음식점"],
  ["REST_CAFE", "휴게음식점"],
  ["BAKERY", "제과점"],
  ["ENTERTAINMENT_BAR", "유흥주점"],
];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireAdmin(request);
  const url = new URL(request.url);
  const db = createDb(env.DB);
  const sort = url.searchParams.get("sort");
  const coordinates = url.searchParams.get("coordinates");
  const [candidateRows, categoryRows, subtypes] = await Promise.all([
    listPendingCandidates(db, {
      query: url.searchParams.get("q") ?? undefined,
      sourceType: (url.searchParams.get("source") || undefined) as
        PublicDataSource | undefined,
      regionCode: (url.searchParams.get("region") || undefined) as
        RegionCode | undefined,
      businessSubtype: url.searchParams.get("subtype") || undefined,
      coordinates:
        coordinates === "present" || coordinates === "missing"
          ? coordinates
          : undefined,
      sort:
        sort === "updated" || sort === "source" || sort === "region"
          ? sort
          : "name",
    }),
    db
      .select()
      .from(categories)
      .where(eq(categories.isActive, true))
      .orderBy(asc(categories.sortOrder)),
    listCandidateSubtypes(db),
  ]);
  return {
    user,
    candidates: candidateRows,
    categories: categoryRows,
    subtypes,
    filters: Object.fromEntries(url.searchParams),
    clientId: env.NAVER_MAPS_CLIENT_ID ?? "",
  };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireAdmin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const candidateId = String(form.get("candidateId") ?? "");
  const now = new Date().toISOString();
  const db = createDb(env.DB);
  if (intent === "reject")
    await rejectCandidate(db, {
      candidateId,
      actorUserId: user.id,
      reason: String(form.get("reason") ?? ""),
      now,
    });
  if (intent === "approve")
    await approveCandidate(db, {
      candidateId,
      actorUserId: user.id,
      categoryId: String(form.get("categoryId") ?? ""),
      name: String(form.get("name") ?? "").trim(),
      address: String(form.get("address") ?? "").trim(),
      neighborhood: String(form.get("neighborhood") ?? "").trim(),
      latitude: Number(form.get("latitude")),
      longitude: Number(form.get("longitude")),
      now,
    });
  return redirect("/admin/candidates");
}

function PlaceIdentityFields({ initialName }: { initialName: string }) {
  const [name, setName] = useState(initialName);
  return (
    <>
      <label>
        <span>공개 상호명</span>
        <input
          name="name"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          required
        />
      </label>
      <label>
        <span>URL slug · 자동 생성</span>
        <output className="flex min-h-10 items-center border border-neutral-300 bg-neutral-100 px-3 py-2 font-mono text-xs text-emerald-800 break-all">/{slugifyPlaceName(name)}</output>
      </label>
    </>
  );
}

export default function AdminCandidates({ loaderData }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(
    loaderData.candidates[0]?.id ?? null,
  );
  const selected =
    loaderData.candidates.find((candidate) => candidate.id === selectedId) ??
    loaderData.candidates[0] ??
    null;
  const parents = loaderData.categories.filter(
    (category) => !category.parentId,
  );
  const children = loaderData.categories.filter(
    (category) => category.parentId,
  );
  const classification = useMemo(
    () =>
      selected
        ? classifyCandidate({ sourceType: selected.sourceType, businessSubtype: selected.businessSubtype, businessName: selected.businessName, address: selected.roadAddress ?? selected.lotAddress })
        : null,
    [selected],
  );
  const suggestedCategory = children.find((item) => item.slug === classification?.categorySlug);
  const sourceName = (value: string) =>
    sources.find(([id]) => id === value)?.[1] ?? value;

  return (
    <main className="review-page">
      <header className="review-top shell">
        <div>
          <p className="eyebrow">ADMIN / PLACE INTAKE</p>
          <h1>후보 검수 데스크</h1>
          <p>공공데이터 원천과 공개 카테고리를 분리해 확인합니다.</p>
        </div>
        <nav>
          <Link to="/admin/candidates/bulk">카테고리 일괄 검수</Link>
          <Link to="/admin/places">공개 장소</Link>
          <Link to="/admin/data-sync">데이터 동기화</Link>
        </nav>
      </header>
      <Form className="review-filters shell">
        <label>
          <span>검색</span>
          <input
            name="q"
            defaultValue={params.get("q") ?? ""}
            placeholder="상호명 또는 주소"
          />
        </label>
        <label>
          <span>지역</span>
          <select name="region" defaultValue={params.get("region") ?? ""}>
            <option value="">광주·전남 전체</option>
            <option value="GWANGJU">광주</option>
            <option value="JEONNAM">전남</option>
          </select>
        </label>
        <label>
          <span>공공데이터 분류</span>
          <select name="source" defaultValue={params.get("source") ?? ""}>
            <option value="">전체</option>
            {sources.map(([id, name]) => (
              <option value={id} key={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>원천 세부업태</span>
          <select name="subtype" defaultValue={params.get("subtype") ?? ""}>
            <option value="">전체</option>
            {loaderData.subtypes.map((value) => (
              <option value={value} key={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>좌표</span>
          <select
            name="coordinates"
            defaultValue={params.get("coordinates") ?? ""}
          >
            <option value="">전체</option>
            <option value="present">지도 표시 가능</option>
            <option value="missing">좌표 확인 필요</option>
          </select>
        </label>
        <label>
          <span>정렬</span>
          <select name="sort" defaultValue={params.get("sort") ?? "name"}>
            <option value="updated">최근 갱신순</option>
            <option value="name">상호순</option>
            <option value="source">공공데이터 분류순</option>
            <option value="region">지역순</option>
          </select>
        </label>
        <button>필터 적용</button>
        <Link className="filter-reset" to="/admin/candidates">
          초기화
        </Link>
      </Form>
      <div className="review-workspace">
        <section className="candidate-rail" aria-label="검수 후보 목록">
          <div className="rail-head">
            <strong>{loaderData.candidates.length}</strong>
            <span>대기 후보</span>
          </div>
          {loaderData.candidates.map((candidate) => (
            <button
              type="button"
              id={`candidate-${candidate.id}`}
              className="candidate-card"
              data-selected={candidate.id === selected?.id || undefined}
              onClick={() => setSelectedId(candidate.id)}
              key={candidate.id}
            >
              <span className="source-badge">
                {sourceName(candidate.sourceType)}
              </span>
              <h2>{candidate.businessName}</h2>
              <p>{candidate.businessSubtype ?? "세부업태 미상"}</p>
              <small>
                {candidate.regionCode === "GWANGJU" ? "광주" : "전남"} ·{" "}
                {candidate.roadAddress ?? candidate.lotAddress}
              </small>
              {candidate.latitude == null && <em>좌표 확인 필요</em>}
            </button>
          ))}
          {!loaderData.candidates.length && (
            <p className="empty">현재 조건에 맞는 영업 중 후보가 없습니다.</p>
          )}
        </section>
        <section className="candidate-map-panel" aria-label="후보 네이버 지도">
          <CandidateMap
            candidates={loaderData.candidates}
            clientId={loaderData.clientId}
            selected={selected?.id}
            onSelect={setSelectedId}
          />
        </section>
        <aside className="review-inspector">
          {selected ? (
            <>
              <div className="inspector-head">
                <span>
                  {sourceName(selected.sourceType)} /{" "}
                  {selected.businessSubtype ?? "미분류"}
                </span>
                <h2>{selected.businessName}</h2>
                <p>{selected.roadAddress ?? selected.lotAddress}</p>
              </div>
              <Form method="post" className="inspector-form" key={selected.id}>
                <input type="hidden" name="candidateId" value={selected.id} />
                <PlaceIdentityFields
                  key={selected.id}
                  initialName={selected.businessName}
                />
                <label>
                  <span>주소</span>
                  <input
                    name="address"
                    defaultValue={
                      selected.roadAddress ?? selected.lotAddress ?? ""
                    }
                    required
                  />
                </label>
                <label>
                  <span>동네</span>
                  <input
                    name="neighborhood"
                    placeholder="예: 동명동"
                    defaultValue={classification?.neighborhood ?? ""}
                    required
                  />
                </label>
                <div className="coordinate-inputs">
                  <label>
                    <span>위도</span>
                    <input
                      name="latitude"
                      defaultValue={selected.latitude ?? ""}
                      required
                    />
                  </label>
                  <label>
                    <span>경도</span>
                    <input
                      name="longitude"
                      defaultValue={selected.longitude ?? ""}
                      required
                    />
                  </label>
                </div>
                <fieldset>
                  <legend>대표 카테고리</legend>
                  {classification && <div className={`mb-3 border px-3 py-3 text-xs font-normal ${classification.confidence === "HIGH" ? "border-emerald-600 bg-emerald-50 text-emerald-900" : classification.confidence === "CONFLICT" ? "border-red-500 bg-red-50 text-red-800" : "border-amber-500 bg-amber-50 text-amber-900"}`}><strong className="font-semibold">자동 분류 신뢰도 · {{ HIGH: "높음", MEDIUM: "보통", LOW: "낮음", CONFLICT: "충돌" }[classification.confidence]}</strong><p className="mt-1">{classification.reasons.join(" · ")}</p></div>}
                  <select name="categoryId" required defaultValue={suggestedCategory?.id ?? ""}>
                    <option value="" disabled>
                      대표 소분류 선택
                    </option>
                    {parents.map((parent) => (
                      <optgroup
                        label={`${parent.emoji} ${parent.name}`}
                        key={parent.id}
                      >
                        {children
                          .filter((child) => child.parentId === parent.id)
                          .map((child) => (
                            <option value={child.id} key={child.id}>
                              {child.id === suggestedCategory?.id ? "★ " : ""}
                              {child.name}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                </fieldset>
                <button
                  className="approve-button"
                  name="intent"
                  value="approve"
                >
                  승인하고 공개
                </button>
                <div className="reject-box">
                  <input name="reason" placeholder="반려 사유" />
                  <button name="intent" value="reject" formNoValidate>
                    반려
                  </button>
                </div>
              </Form>
            </>
          ) : (
            <div className="inspector-empty">
              <p>
                후보를 선택하면
                <br />
                검수 항목이 열립니다.
              </p>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
