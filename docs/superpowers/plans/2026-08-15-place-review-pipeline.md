# 장소 검수 5단계 파이프라인 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 공공데이터·비공개 장소를 원천 검수 → NAVER 검증 → 카테고리 확정 → 중복 검토 → 선택 승인·공개 순서로만 처리할 수 있는 관리자 파이프라인을 구축한다.

**Architecture:** D1의 `place_review_work_items`가 현재 단계와 운영 상태를 소유하고, 기존 공공데이터·NAVER·장소·중복 테이블은 근거의 기준 원본으로 유지한다. React Router loader/action은 인증·입력 변환만 담당하고, 단계 전환·목록 조회·최종 공개는 `app/features/places`의 서비스가 서버에서 불변식을 다시 확인한다. 구현은 기반, 관리자 UX, 최종 공개·환류의 세 PR로 나누며 각 PR은 최신 `origin/main`에서 시작한다.

**Tech Stack:** TypeScript 7, React 19, React Router 8, Drizzle ORM, Cloudflare D1/Workers, Vitest, Cloudflare Workers test pool, Playwright, 기존 디자인 토큰과 전역 CSS

## Global Constraints

- 모든 공개 대상은 서버 기준으로 1→2→3→4→5 순서를 통과한다.
- NAVER 검증은 필수 2단계이며 기존 quota, cache, failure, kill switch 동작을 유지한다.
- NAVER 검증만으로 `DRAFT` 또는 `HIDDEN`을 공개하지 않는다.
- 관리자가 5단계에서 선택한 최대 25개만 공개한다.
- 목록은 DB `count + limit + offset` 기반 서버 페이지네이션을 사용하며 페이지 크기는 25/50/100이다.
- 프랜차이즈 지점은 동일 상호 자동 병합 대상에서 제외한다.
- 새 AI, 외부 공급자, Queue, 데이터베이스, UI kit, CSS framework 또는 런타임 의존성을 추가하지 않는다.
- 외부 NAVER API와 운영 D1은 테스트에서 호출하지 않는다.
- 적용된 migration을 수정하지 않고 `drizzle/0034_*.sql`부터 새 순차 migration을 추가한다.
- 원격 D1 migration, backfill, 배포 대상·검증·forward-fix는 해당 구현 PR 본문에 기록하고 병합 후 승인된 범위에서만 실행한다.
- UI PR에는 데스크톱과 모바일 Playwright 스크린샷을 첨부한다.

## 구현 파일 구조

| 파일 | 책임 |
|---|---|
| `drizzle/0034_place_review_pipeline.sql` | 작업 항목·중복 결정 테이블, 인덱스와 초기 backfill |
| `app/db/schema.ts` | 두 테이블의 Drizzle schema |
| `app/features/places/place-review-pipeline.ts` | 단계·상태·차단 코드와 순수 게이트 판정 |
| `app/features/places/place-review-pagination.ts` | URL 단계·필터·페이지 파싱과 href 생성 |
| `app/features/places/place-review-query.server.ts` | 단계별 count/페이지 조회와 공통 행 hydrate |
| `app/features/places/place-review-work-items.server.ts` | 작업 생성·보류·제외·단계 이동·감사 로그 |
| `app/features/places/place-review-naver.server.ts` | 작업 유형별 기존 NAVER 검증 서비스 조정 |
| `app/features/places/place-review-category.server.ts` | 최종 카테고리 확정과 override 검증 |
| `app/features/places/place-review-duplicates.server.ts` | 중복 후보 계산과 연결·병합·서로 다름 결정 |
| `app/features/places/place-review-publication.server.ts` | 조건 재검증과 선택 일괄 공개 |
| `app/components/admin/PlaceReviewStepNav.tsx` | 01~05 단계, count, 잠금 상태 |
| `app/components/admin/PlaceReviewToolbar.tsx` | 검색·필터·페이지 크기·페이지 이동 |
| `app/components/admin/PlaceReviewCard.tsx` | 단계별 근거와 선택 UI |
| `app/components/admin/AdminBlockingOverlay.tsx` | API·일괄 처리 중 전체 화면 입력 차단 |
| `app/routes/admin-place-operations.tsx` | 파이프라인과 공개 후 운영을 조합하는 route |
| `app/routes/admin-candidates.tsx` | 완전 전환 후 1단계 URL로 redirect |

---

## PR 1 — 파이프라인 기반과 서버 불변식

### Task 1: D1 작업 상태와 중복 결정 스키마

**Files:**
- Create: `drizzle/0034_place_review_pipeline.sql`
- Modify: `app/db/schema.ts`
- Create: `tests/integration/place-review-pipeline-migration.test.ts`
- Modify: `tests/unit/schema-contract.test.ts`

**Interfaces:**
- Consumes: 기존 `business_licenses`, `places`, `categories`, `users`, `admin_audit_logs`.
- Produces: `placeReviewWorkItems`, `placeReviewDuplicateResolutions` Drizzle exports.

- [ ] **Step 1: migration 계약 테스트를 먼저 작성한다**

```ts
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("place review pipeline migration", () => {
  it("stores one subject and bounded workflow values", async () => {
    const table = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='place_review_work_items'",
    ).first<{ sql: string }>();
    expect(table?.sql).toContain("business_license_id IS NOT NULL AND place_id IS NULL");
    expect(table?.sql).toContain("CHECK(stage IN ('SOURCE_REVIEW','NAVER_VERIFICATION','CATEGORY_CONFIRMATION','DUPLICATE_REVIEW','FINAL_APPROVAL'))");
    expect(table?.sql).toContain("CHECK(status IN ('ACTIVE','ON_HOLD','COMPLETED','EXCLUDED'))");
  });

  it("prevents two active cycles for the same subject", async () => {
    const indexes = await env.DB.prepare(
      "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='place_review_work_items'",
    ).all<{ name: string; sql: string }>();
    expect(indexes.results.map((row) => row.name)).toContain("place_review_active_business_idx");
    expect(indexes.results.map((row) => row.name)).toContain("place_review_active_place_idx");
  });
});
```

- [ ] **Step 2: 새 테스트가 실패하는지 확인한다**

Run: `pnpm test:integration -- tests/integration/place-review-pipeline-migration.test.ts`

Expected: FAIL — `place_review_work_items` 테이블이 존재하지 않는다.

- [ ] **Step 3: migration을 작성한다**

```sql
CREATE TABLE place_review_work_items (
  id TEXT PRIMARY KEY NOT NULL,
  business_license_id TEXT REFERENCES business_licenses(id) ON DELETE CASCADE,
  place_id TEXT REFERENCES places(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('PUBLIC_DATA','PLACE_SUGGESTION','CATEGORY_RECALL','LIVENESS_RECHECK')),
  stage TEXT NOT NULL CHECK(stage IN ('SOURCE_REVIEW','NAVER_VERIFICATION','CATEGORY_CONFIRMATION','DUPLICATE_REVIEW','FINAL_APPROVAL')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ON_HOLD','COMPLETED','EXCLUDED')),
  selected_category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  category_override_reason TEXT,
  manual_evidence_reason TEXT,
  stage_version INTEGER NOT NULL DEFAULT 0 CHECK(stage_version >= 0),
  claim_token TEXT,
  claimed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  claimed_at TEXT,
  last_transition_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  last_transition_at TEXT,
  hold_code TEXT,
  hold_note TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(
    (business_license_id IS NOT NULL AND place_id IS NULL)
    OR (business_license_id IS NULL AND place_id IS NOT NULL)
  )
);

CREATE INDEX place_review_stage_status_updated_idx
  ON place_review_work_items(stage, status, updated_at, id);
CREATE UNIQUE INDEX place_review_active_business_idx
  ON place_review_work_items(business_license_id)
  WHERE business_license_id IS NOT NULL AND status IN ('ACTIVE','ON_HOLD');
CREATE UNIQUE INDEX place_review_active_place_idx
  ON place_review_work_items(place_id)
  WHERE place_id IS NOT NULL AND status IN ('ACTIVE','ON_HOLD');

CREATE TABLE place_review_duplicate_resolutions (
  id TEXT PRIMARY KEY NOT NULL,
  work_item_id TEXT NOT NULL REFERENCES place_review_work_items(id) ON DELETE CASCADE,
  candidate_place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK(decision IN ('LINK_EXISTING','MERGE','DISTINCT')),
  reason TEXT NOT NULL,
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(work_item_id, candidate_place_id)
);

CREATE INDEX place_review_duplicate_work_idx
  ON place_review_duplicate_resolutions(work_item_id, decision);

INSERT INTO place_review_work_items (
  id, business_license_id, place_id, source_kind, stage, status, stage_version, created_at, updated_at
)
SELECT 'public-data:' || id, id, NULL, 'PUBLIC_DATA', 'SOURCE_REVIEW', 'ACTIVE', 0, updated_at, updated_at
FROM business_licenses
WHERE review_status = 'PENDING' AND normalized_status = 'OPEN';

INSERT INTO place_review_work_items (
  id, business_license_id, place_id, source_kind, stage, status, stage_version, created_at, updated_at
)
SELECT 'category-recall:' || p.id, NULL, p.id, 'CATEGORY_RECALL', 'SOURCE_REVIEW', 'ACTIVE', 0, p.updated_at, p.updated_at
FROM places p
WHERE p.status = 'HIDDEN'
  AND EXISTS (
    SELECT 1 FROM admin_audit_logs a
    WHERE a.target_type = 'PLACE'
      AND a.target_id = p.id
      AND a.action = 'RECALL_PUBLISHED_PLACES_FOR_CATEGORY_AUDIT'
  );

INSERT INTO place_review_work_items (
  id, business_license_id, place_id, source_kind, stage, status, stage_version, created_at, updated_at
)
SELECT 'place-suggestion:' || p.id, NULL, p.id, 'PLACE_SUGGESTION', 'SOURCE_REVIEW', 'ACTIVE', 0, p.updated_at, p.updated_at
FROM places p
WHERE p.status = 'DRAFT'
  AND EXISTS (
    SELECT 1 FROM place_revisions r
    WHERE r.place_id = p.id AND r.action = 'CREATE_FROM_SUGGESTION'
  );
```

- [ ] **Step 4: Drizzle schema에 같은 제약과 인덱스를 선언한다**

`app/db/schema.ts`에 `placeReviewWorkItems`와 `placeReviewDuplicateResolutions`를 추가한다. enum 문자열, FK `onDelete`, `check`, `uniqueIndex` 이름은 migration과 정확히 일치시킨다. `tests/unit/schema-contract.test.ts`의 운영 테이블 계약에도 두 export를 추가한다.

- [ ] **Step 5: migration·schema 테스트를 실행한다**

Run: `pnpm test:integration -- tests/integration/place-review-pipeline-migration.test.ts && pnpm test -- tests/unit/schema-contract.test.ts`

Expected: 두 파일 PASS.

- [ ] **Step 6: 타입과 migration 전체를 확인한다**

Run: `pnpm run typecheck && pnpm test:integration`

Expected: exit 0, 기존 migration 테스트 포함 전체 PASS.

- [ ] **Step 7: 커밋한다**

```bash
git add drizzle/0034_place_review_pipeline.sql app/db/schema.ts tests/integration/place-review-pipeline-migration.test.ts tests/unit/schema-contract.test.ts
git commit -m "2026-08-15 장소 검수 파이프라인 스키마 추가"
```

### Task 2: 순수 단계 게이트

**Files:**
- Create: `app/features/places/place-review-pipeline.ts`
- Create: `tests/unit/place-review-pipeline.test.ts`

**Interfaces:**
- Consumes: 없음. DB나 React를 import하지 않는다.
- Produces: `ReviewStage`, `ReviewStatus`, `ReviewGateEvidence`, `ReviewBlockCode`, `evaluateReviewAdvance()`.

- [ ] **Step 1: 단계 건너뛰기와 통과 조건 테스트를 작성한다**

```ts
import { describe, expect, it } from "vitest";
import { evaluateReviewAdvance } from "../../app/features/places/place-review-pipeline";

const ready = {
  sourceReady: true,
  naverDecision: "VERIFIED" as const,
  selectedCategoryId: "cat-local",
  categoryActive: true,
  openDuplicateCount: 0,
  activeExclusion: false,
};

describe("place review stage gates", () => {
  it("moves exactly one stage", () => {
    expect(evaluateReviewAdvance("SOURCE_REVIEW", ready)).toEqual({ ok: true, nextStage: "NAVER_VERIFICATION" });
    expect(evaluateReviewAdvance("NAVER_VERIFICATION", ready)).toEqual({ ok: true, nextStage: "CATEGORY_CONFIRMATION" });
  });

  it("blocks NAVER failures and permits a recorded manual evidence approval", () => {
    expect(evaluateReviewAdvance("NAVER_VERIFICATION", { ...ready, naverDecision: "FAILED" }))
      .toEqual({ ok: false, code: "NAVER_RETRY_REQUIRED" });
    expect(evaluateReviewAdvance("NAVER_VERIFICATION", { ...ready, naverDecision: "MANUAL_OVERRIDE" }))
      .toEqual({ ok: true, nextStage: "CATEGORY_CONFIRMATION" });
  });

  it("blocks unresolved duplicates and exclusions", () => {
    expect(evaluateReviewAdvance("DUPLICATE_REVIEW", { ...ready, openDuplicateCount: 1 }))
      .toEqual({ ok: false, code: "DUPLICATE_REVIEW_REQUIRED" });
    expect(evaluateReviewAdvance("DUPLICATE_REVIEW", { ...ready, activeExclusion: true }))
      .toEqual({ ok: false, code: "ACTIVE_EXCLUSION" });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm test -- tests/unit/place-review-pipeline.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: 타입과 순수 판정 함수를 구현한다**

```ts
export const reviewStages = [
  "SOURCE_REVIEW",
  "NAVER_VERIFICATION",
  "CATEGORY_CONFIRMATION",
  "DUPLICATE_REVIEW",
  "FINAL_APPROVAL",
] as const;

export type ReviewStage = (typeof reviewStages)[number];
export type ReviewStatus = "ACTIVE" | "ON_HOLD" | "COMPLETED" | "EXCLUDED";
export type NaverReviewDecision = "VERIFIED" | "MATCHED" | "MANUAL_OVERRIDE" | "AMBIGUOUS" | "NOT_FOUND" | "FAILED";
export type ReviewBlockCode =
  | "SOURCE_NOT_READY"
  | "NAVER_REVIEW_REQUIRED"
  | "NAVER_RETRY_REQUIRED"
  | "CATEGORY_REQUIRED"
  | "CATEGORY_INACTIVE"
  | "DUPLICATE_REVIEW_REQUIRED"
  | "ACTIVE_EXCLUSION"
  | "ALREADY_FINAL";

export type ReviewGateEvidence = {
  sourceReady: boolean;
  naverDecision: NaverReviewDecision;
  selectedCategoryId: string | null;
  categoryActive: boolean;
  openDuplicateCount: number;
  activeExclusion: boolean;
};

export type ReviewAdvanceResult =
  | { ok: true; nextStage: ReviewStage }
  | { ok: false; code: ReviewBlockCode };

export function evaluateReviewAdvance(stage: ReviewStage, evidence: ReviewGateEvidence): ReviewAdvanceResult {
  if (stage === "SOURCE_REVIEW") {
    return evidence.sourceReady ? { ok: true, nextStage: "NAVER_VERIFICATION" } : { ok: false, code: "SOURCE_NOT_READY" };
  }
  if (stage === "NAVER_VERIFICATION") {
    if (evidence.naverDecision === "FAILED") return { ok: false, code: "NAVER_RETRY_REQUIRED" };
    if (!["VERIFIED", "MATCHED", "MANUAL_OVERRIDE"].includes(evidence.naverDecision)) return { ok: false, code: "NAVER_REVIEW_REQUIRED" };
    return { ok: true, nextStage: "CATEGORY_CONFIRMATION" };
  }
  if (stage === "CATEGORY_CONFIRMATION") {
    if (!evidence.selectedCategoryId) return { ok: false, code: "CATEGORY_REQUIRED" };
    return evidence.categoryActive ? { ok: true, nextStage: "DUPLICATE_REVIEW" } : { ok: false, code: "CATEGORY_INACTIVE" };
  }
  if (stage === "DUPLICATE_REVIEW") {
    if (evidence.activeExclusion) return { ok: false, code: "ACTIVE_EXCLUSION" };
    return evidence.openDuplicateCount === 0
      ? { ok: true, nextStage: "FINAL_APPROVAL" }
      : { ok: false, code: "DUPLICATE_REVIEW_REQUIRED" };
  }
  return { ok: false, code: "ALREADY_FINAL" };
}
```

- [ ] **Step 4: 테스트와 타입을 확인한다**

Run: `pnpm test -- tests/unit/place-review-pipeline.test.ts && pnpm run typecheck`

Expected: PASS, exit 0.

- [ ] **Step 5: 커밋한다**

```bash
git add app/features/places/place-review-pipeline.ts tests/unit/place-review-pipeline.test.ts
git commit -m "2026-08-15 장소 검수 단계 게이트 추가"
```

### Task 3: 페이지 쿼리와 URL 계약

**Files:**
- Create: `app/features/places/place-review-pagination.ts`
- Create: `app/features/places/place-review-query.server.ts`
- Create: `tests/unit/place-review-pagination.test.ts`
- Create: `tests/integration/place-review-query.server.test.ts`

**Interfaces:**
- Consumes: `placeReviewWorkItems`, `businessLicenses`, `places`, `placeLivenessStates`, `naverLocalCategoryVerifications`, `categories`.
- Produces: `parsePlaceReviewQuery(url)`, `buildPlaceReviewPageHref(params, page)`, `listPlaceReviewWorkItems(db, query)`, `getPlaceReviewStageCounts(db)`.

- [ ] **Step 1: URL 파싱 테스트를 작성한다**

```ts
import { describe, expect, it } from "vitest";
import { parsePlaceReviewQuery } from "../../app/features/places/place-review-pagination";

describe("place review pagination", () => {
  it("bounds page and page size", () => {
    expect(parsePlaceReviewQuery(new URL("https://example.test/?step=2&page=-3&pageSize=500"))).toMatchObject({
      step: 2, page: 1, pageSize: 25,
    });
  });

  it("keeps supported filters only", () => {
    expect(parsePlaceReviewQuery(new URL("https://example.test/?step=4&status=hold&region=GWANGJU&q=국밥"))).toMatchObject({
      step: 4, status: "hold", region: "GWANGJU", query: "국밥",
    });
  });
});
```

- [ ] **Step 2: DB 페이지 테스트를 작성한다**

Fixture 60개를 같은 단계로 넣고 `pageSize: 25, page: 2` 조회 결과가 25개이며 `total: 60`, `totalPages: 3`인지 검증한다. 검색어와 지역 필터가 `count`와 rows에 동일하게 적용되는지도 검증한다.

- [ ] **Step 3: 실패를 확인한다**

Run: `pnpm test -- tests/unit/place-review-pagination.test.ts && pnpm test:integration -- tests/integration/place-review-query.server.test.ts`

Expected: 두 모듈이 없어 FAIL.

- [ ] **Step 4: URL 파서를 구현한다**

```ts
export type ReviewStepNumber = 1 | 2 | 3 | 4 | 5;
export type PlaceReviewQuery = {
  step: ReviewStepNumber;
  page: number;
  pageSize: 25 | 50 | 100;
  status: "pending" | "attention" | "hold" | null;
  region: "GWANGJU" | "JEONNAM" | null;
  query: string;
};

export function parsePlaceReviewQuery(url: URL): PlaceReviewQuery {
  const requestedStep = Number(url.searchParams.get("step"));
  const requestedSize = Number(url.searchParams.get("pageSize"));
  const rawStatus = url.searchParams.get("status");
  const rawRegion = url.searchParams.get("region");
  return {
    step: [1, 2, 3, 4, 5].includes(requestedStep) ? requestedStep as ReviewStepNumber : 1,
    page: Math.max(1, Number(url.searchParams.get("page")) || 1),
    pageSize: [25, 50, 100].includes(requestedSize) ? requestedSize as 25 | 50 | 100 : 25,
    status: rawStatus === "pending" || rawStatus === "attention" || rawStatus === "hold" ? rawStatus : null,
    region: rawRegion === "GWANGJU" || rawRegion === "JEONNAM" ? rawRegion : null,
    query: (url.searchParams.get("q") ?? "").trim().slice(0, 80),
  };
}
```

- [ ] **Step 5: DB에서 먼저 page id를 자르고 대상 정보를 hydrate한다**

`listPlaceReviewWorkItems()`는 단계·상태·검색·지역 조건을 공통 `where`에 만든 뒤 별도의 `count(*)`와 `limit(pageSize).offset((page - 1) * pageSize)`를 실행한다. page에 포함된 최대 100개의 `business_license_id`와 `place_id`만 각각 `inArray`로 읽어 `PlaceReviewQueueRow`로 조합한다. 전체 648개를 메모리에 적재한 뒤 `slice`하지 않는다.

```ts
export type PlaceReviewQueueRow = {
  workItemId: string;
  stageVersion: number;
  subjectType: "BUSINESS_LICENSE" | "PLACE";
  subjectId: string;
  sourceKind: "PUBLIC_DATA" | "PLACE_SUGGESTION" | "CATEGORY_RECALL" | "LIVENESS_RECHECK";
  name: string;
  address: string;
  region: "GWANGJU" | "JEONNAM" | null;
  placeStatus: "DRAFT" | "PUBLISHED" | "HIDDEN" | null;
  naverStatus: string | null;
  naverScore: number | null;
  selectedCategoryId: string | null;
  selectedCategoryName: string | null;
  blockCodes: string[];
};

export type PlaceReviewPage = {
  rows: PlaceReviewQueueRow[];
  pagination: { page: number; pageSize: 25 | 50 | 100; total: number; totalPages: number };
};
```

- [ ] **Step 6: 단위·통합·타입 테스트를 실행한다**

Run: `pnpm test -- tests/unit/place-review-pagination.test.ts && pnpm test:integration -- tests/integration/place-review-query.server.test.ts && pnpm run typecheck`

Expected: PASS, exit 0.

- [ ] **Step 7: 커밋한다**

```bash
git add app/features/places/place-review-pagination.ts app/features/places/place-review-query.server.ts tests/unit/place-review-pagination.test.ts tests/integration/place-review-query.server.test.ts
git commit -m "2026-08-15 장소 검수 서버 페이지 조회 추가"
```

### Task 4: 작업 생성과 비교 후 단계 이동

**Files:**
- Create: `app/features/places/place-review-work-items.server.ts`
- Create: `tests/integration/place-review-work-items.server.test.ts`
- Modify: `app/features/candidates/candidate.server.ts`
- Modify: `app/features/places/place-suggestion.server.ts`
- Modify: `app/features/places/place-publication-recall.server.ts`
- Modify: `tests/integration/candidate.server.test.ts`
- Modify: `tests/integration/place-suggestion.server.test.ts`
- Modify: `tests/integration/place-publication-recall.server.test.ts`

**Interfaces:**
- Consumes: `evaluateReviewAdvance()`, 새 schema exports, 기존 candidate/suggestion/recall 서비스.
- Produces: `newReviewWorkItemValues()`, `advancePlaceReviewWorkItems()`, `holdPlaceReviewItems()`, `excludePlaceReviewItems()`.

- [ ] **Step 1: 단계 이동의 서버 재검증과 동시성 테스트를 작성한다**

```ts
it("advances one stage and rejects a stale stage version", async () => {
  const first = await advancePlaceReviewWorkItems(db, {
    workItemIds: [workItemId], expectedStage: "SOURCE_REVIEW", expectedVersions: { [workItemId]: 0 },
    actorUserId: adminId, now,
  });
  expect(first).toEqual({ advanced: [workItemId], skipped: [] });

  const stale = await advancePlaceReviewWorkItems(db, {
    workItemIds: [workItemId], expectedStage: "NAVER_VERIFICATION", expectedVersions: { [workItemId]: 0 },
    actorUserId: adminId, now: later,
  });
  expect(stale.skipped).toEqual([{ workItemId, code: "STALE_WORK_ITEM" }]);
});
```

같은 파일에서 다음을 추가한다.

- 원천 주소·좌표가 빠진 항목은 `SOURCE_NOT_READY`로 건너뜀
- NAVER `FAILED`는 `NAVER_RETRY_REQUIRED`
- 보류 시 현재 stage 유지와 `status=ON_HOLD`
- 제외 시 `status=EXCLUDED`
- 모든 변경에 `PLACE_REVIEW_STAGE_CHANGE`, `PLACE_REVIEW_HOLD`, `PLACE_REVIEW_EXCLUDE` 감사 로그 생성

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm test:integration -- tests/integration/place-review-work-items.server.test.ts`

Expected: FAIL — service module not found.

- [ ] **Step 3: 작업 값 생성기와 단계 이동 API를 구현한다**

```ts
export type NewReviewSubject =
  | { businessLicenseId: string; placeId?: never }
  | { placeId: string; businessLicenseId?: never };

export function newReviewWorkItemValues(input: NewReviewSubject & {
  sourceKind: "PUBLIC_DATA" | "PLACE_SUGGESTION" | "CATEGORY_RECALL" | "LIVENESS_RECHECK";
  now: string;
}) {
  const subjectId = input.businessLicenseId ?? input.placeId;
  return {
    id: `review:${input.sourceKind.toLowerCase()}:${subjectId}:${input.now}`,
    businessLicenseId: input.businessLicenseId ?? null,
    placeId: input.placeId ?? null,
    sourceKind: input.sourceKind,
    stage: "SOURCE_REVIEW" as const,
    status: "ACTIVE" as const,
    stageVersion: 0,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export async function advancePlaceReviewWorkItems(db: AppDb, input: {
  workItemIds: string[];
  expectedStage: ReviewStage;
  expectedVersions: Record<string, number>;
  actorUserId: string;
  now: string;
  manualEvidenceReason?: string;
}): Promise<{ advanced: string[]; skipped: Array<{ workItemId: string; code: ReviewBlockCode | "STALE_WORK_ITEM" | "NOT_ACTIVE" }> }>;
```

서비스는 입력 ID를 중복 제거하고 최대 25개로 제한한다. 각 항목마다 현재 레코드와 원천·NAVER·카테고리·중복·제외 근거를 DB에서 다시 읽어 `evaluateReviewAdvance()`에 전달한다. 성공 업데이트에는 다음 조건을 모두 건다.

```ts
and(
  eq(placeReviewWorkItems.id, workItem.id),
  eq(placeReviewWorkItems.stage, input.expectedStage),
  eq(placeReviewWorkItems.stageVersion, input.expectedVersions[workItem.id]!),
  eq(placeReviewWorkItems.status, "ACTIVE"),
)
```

변경 row count가 0이면 `STALE_WORK_ITEM`으로 반환하고, 성공 시 `stage_version + 1`과 감사 로그를 같은 `db.batch()`에 넣는다.

- [ ] **Step 4: 신규 대상이 같은 배치에서 1단계 작업을 얻도록 연결한다**

- `candidate.server.ts`: 새 `OPEN/PENDING` 공공데이터 후보 insert 시 `PUBLIC_DATA` 작업 insert를 같은 batch에 추가한다.
- `place-suggestion.server.ts`: 위치 승인으로 `DRAFT` 장소를 만들 때 `PLACE_SUGGESTION` 작업 insert를 같은 batch에 추가한다.
- `place-publication-recall.server.ts`: `PUBLISHED → HIDDEN` 회수와 `CATEGORY_RECALL` 작업 insert를 같은 batch에 추가한다.
- 모든 작업 insert는 활성 부분 고유 인덱스 충돌 시 기존 활성 작업을 유지하도록 `onConflictDoNothing()`을 사용한다.

- [ ] **Step 5: 서비스·연결 통합 테스트를 실행한다**

Run: `pnpm test:integration -- tests/integration/place-review-work-items.server.test.ts tests/integration/candidate.server.test.ts tests/integration/place-suggestion.server.test.ts tests/integration/place-publication-recall.server.test.ts`

Expected: PASS. 기존 기능 결과와 새 작업 항목이 함께 저장된다.

- [ ] **Step 6: PR 1 전체 검증을 실행한다**

Run: `pnpm test && pnpm test:integration && pnpm run typecheck && pnpm run build`

Expected: unit 757개 이상 PASS, integration 전체 PASS, typecheck/build exit 0.

- [ ] **Step 7: 커밋한다**

```bash
git add app/features/places/place-review-work-items.server.ts app/features/candidates/candidate.server.ts app/features/places/place-suggestion.server.ts app/features/places/place-publication-recall.server.ts tests/integration/place-review-work-items.server.test.ts tests/integration/candidate.server.test.ts tests/integration/place-suggestion.server.test.ts tests/integration/place-publication-recall.server.test.ts
git commit -m "2026-08-15 장소 검수 단계 전환 강제"
```

### PR 1 완료 게이트

- 최신 `origin/main`을 반영하고 위 전체 검증을 다시 실행한다.
- PR 본문에 `0034` migration 대상, backfill 대상별 예상/실제 count 쿼리와 forward-fix를 기록한다.
- migration 전 검증:

```sql
SELECT count(*) FROM business_licenses WHERE review_status='PENDING' AND normalized_status='OPEN';
SELECT count(DISTINCT p.id) FROM places p JOIN admin_audit_logs a ON a.target_id=p.id
WHERE p.status='HIDDEN' AND a.action='RECALL_PUBLISHED_PLACES_FOR_CATEGORY_AUDIT';
```

- migration 후 검증:

```sql
SELECT source_kind, stage, status, count(*)
FROM place_review_work_items
GROUP BY source_kind, stage, status;
```

- push → PR → CI/review → squash merge → 원격 브랜치 삭제 → 로컬 `Archive/` 보존 순서를 따른다.

---

## PR 2 — 관리자 5단계 UX와 NAVER·카테고리·중복 작업

### Task 5: 5단계 route shell과 공개 후 운영 분리

**Files:**
- Create: `app/components/admin/PlaceReviewStepNav.tsx`
- Create: `app/components/admin/PlaceReviewToolbar.tsx`
- Create: `app/components/admin/PlaceReviewCard.tsx`
- Modify: `app/routes/admin-place-operations.tsx`
- Modify: `app/features/places/place-operations-tabs.ts`
- Modify: `app/app.css`
- Modify: `tests/e2e/place-operations.spec.ts`

**Interfaces:**
- Consumes: `parsePlaceReviewQuery()`, `listPlaceReviewWorkItems()`, `getPlaceReviewStageCounts()`.
- Produces: URL 기반 01~05 단계 화면과 별도 공개 후 운영 화면.

- [ ] **Step 1: 단계 UI 브라우저 테스트를 먼저 변경한다**

```ts
test("admin follows the numbered place review pipeline", async ({ page }) => {
  await page.context().addCookies([{ name: "retaste_session", value: "qa-admin-session", domain: "127.0.0.1", path: "/" }]);
  await page.goto("/admin/place-operations?flow=review&step=1");
  await expect(page.getByRole("navigation", { name: "장소 검수 단계" })).toBeVisible();
  await expect(page.getByRole("link", { name: /01 원천 검수/ })).toHaveAttribute("aria-current", "step");

  await page.getByRole("link", { name: /02 NAVER 검증/ }).click();
  await expect(page).toHaveURL(/flow=review.*step=2/);
  await expect(page.getByRole("heading", { name: "NAVER 근거 확인" })).toBeVisible();

  await page.getByRole("link", { name: "공개 후 운영" }).click();
  await expect(page.getByRole("tab", { name: /영업 재검증/ })).toBeVisible();
});
```

- [ ] **Step 2: 새 테스트 실패를 확인한다**

Run: `pnpm test:e2e -- tests/e2e/place-operations.spec.ts --project=chromium`

Expected: FAIL — `장소 검수 단계` navigation 없음.

- [ ] **Step 3: loader를 파이프라인과 공개 후 운영으로 분기한다**

```ts
const url = new URL(request.url);
const flow = url.searchParams.get("flow") === "operations" ? "operations" as const : "review" as const;
if (flow === "review") {
  const reviewQuery = parsePlaceReviewQuery(url);
  const [reviewPage, stageCounts] = await Promise.all([
    listPlaceReviewWorkItems(db, reviewQuery),
    getPlaceReviewStageCounts(db),
  ]);
  return { flow, reviewQuery, reviewPage, stageCounts, naverDailyUsage, naverDailyLimit };
}
return { flow, ...await loadPostPublicationOperations(db, url) };
```

기존 loader의 영업 재검증·정보 정정·이력 쿼리는 같은 route 파일의 `loadPostPublicationOperations()`로 옮겨 파이프라인 로드 시 실행하지 않는다.

- [ ] **Step 4: 단계 navigation을 구현한다**

`PlaceReviewStepNav`는 각 링크에 `01`~`05`, 단계명, `대기/확인 필요` count를 표시한다. 현재 링크는 `aria-current="step"`, 잠긴 항목은 링크 자체를 막지 않고 화면에서 부족한 선행 조건을 설명한다. 모바일에서는 `overflow-x:auto`, 각 단계 최소 너비 144px를 사용한다.

- [ ] **Step 5: toolbar와 공통 카드를 구현한다**

- GET form: `q`, `region`, `status`, `pageSize`, hidden `flow=review`, `step`.
- 상·하단 pagination: `총 N곳 · X/Y 페이지`, 이전/다음.
- 카드: checkbox, 상호, 주소, 원천, 현재 상태, 단계별 근거 slot.
- page/step/filter 변경 시 React 선택 Set을 초기화한다.
- `현재 페이지 선택`은 화면에 100개가 있어도 앞의 25개만 선택하고 `한 번에 최대 25곳` 문구를 표시한다.
- 1단계의 `선택 항목 NAVER 검증으로 이동`은 `intent=advance-review-items`, 현재 stage와 각 `stageVersion`을 제출하고 서버의 `advancePlaceReviewWorkItems()` 결과만 표시한다.
- 모든 단계에서 `보류`와 `제외`는 각각 필수 사유를 받고 `holdPlaceReviewItems()`와 `excludePlaceReviewItems()`를 호출한다.

- [ ] **Step 6: CSS와 접근성을 확인한다**

기존 `--text`, `--border`, 짙은 녹색, 연두 강조 토큰을 재사용한다. 단계 bar 이외에 새로운 장식 요소를 추가하지 않는다. 키보드 focus, 44px 터치 영역, `prefers-reduced-motion`, 760px 모바일 1열을 적용한다.

- [ ] **Step 7: E2E·타입·빌드를 실행한다**

Run: `pnpm test:e2e -- tests/e2e/place-operations.spec.ts --project=chromium --project=mobile-chromium && pnpm run typecheck && pnpm run build`

Expected: desktop/mobile PASS, exit 0.

- [ ] **Step 8: 커밋한다**

```bash
git add app/components/admin/PlaceReviewStepNav.tsx app/components/admin/PlaceReviewToolbar.tsx app/components/admin/PlaceReviewCard.tsx app/routes/admin-place-operations.tsx app/features/places/place-operations-tabs.ts app/app.css tests/e2e/place-operations.spec.ts
git commit -m "2026-08-15 장소 검수 5단계 화면 구성"
```

### Task 6: NAVER 단계와 전체 화면 처리 오버레이

**Files:**
- Create: `app/components/admin/AdminBlockingOverlay.tsx`
- Create: `app/features/places/place-review-naver.server.ts`
- Create: `tests/integration/place-review-naver.server.test.ts`
- Modify: `app/routes/admin-place-operations.tsx`
- Modify: `tests/e2e/place-operations.spec.ts`

**Interfaces:**
- Consumes: `verifyPendingCandidatesWithNaver()`, `verifyPlacesLivenessWithNaver()`, `advancePlaceReviewWorkItems()`.
- Produces: `verifyReviewItemsWithNaver()`, `approveManualReviewEvidence()`와 입력 차단 오버레이.

- [ ] **Step 1: 혼합 subject 검증 테스트를 작성한다**

```ts
it("verifies business and place subjects without publishing either", async () => {
  const result = await verifyReviewItemsWithNaver(db, {
    workItemIds: [businessWorkId, placeWorkId], actorUserId: adminId, now,
    dailyLimit: 20_000, adapter: fakeNaverAdapter,
  });
  expect(result.scanned).toBe(2);
  expect((await db.query.places.findFirst({ where: eq(places.id, hiddenPlaceId) }))?.status).toBe("HIDDEN");
  expect((await db.query.placeReviewWorkItems.findFirst({ where: eq(placeReviewWorkItems.id, placeWorkId) }))?.stage)
    .toBe("CATEGORY_CONFIRMATION");
});
```

AMBIGUOUS/NOT_FOUND는 2단계 유지, FAILED는 기존 근거를 지우지 않음, 26개 입력은 거부됨을 추가한다.

수동 근거 승인은 20자 이상의 사유가 있어야 하고 `AMBIGUOUS`, `LIKELY`, `NOT_FOUND`, `NO_MATCH`만 허용한다. `ERROR`, `FAILED`는 재검증 전까지 승인할 수 없음을 검증한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm test:integration -- tests/integration/place-review-naver.server.test.ts`

Expected: FAIL — service module not found.

- [ ] **Step 3: 작업 유형별 검증 조정 서비스를 구현한다**

```ts
export async function verifyReviewItemsWithNaver(db: AppDb, input: {
  workItemIds: string[];
  actorUserId: string;
  now: string;
  dailyLimit: number;
  adapter: NaverLocalSearchAdapter;
}): Promise<{
  scanned: number;
  matched: number;
  attention: number;
  failed: number;
  advanced: string[];
}>;

export async function approveManualReviewEvidence(db: AppDb, input: {
  workItemId: string;
  expectedStageVersion: number;
  actorUserId: string;
  reason: string;
  now: string;
}): Promise<{ workItemId: string; nextStage: "CATEGORY_CONFIRMATION" }>;
```

서비스는 stage가 `NAVER_VERIFICATION`인 활성 항목만 최대 25개 조회한다. `BUSINESS_LICENSE` ID는 `verifyPendingCandidatesWithNaver`, `PLACE` ID는 `verifyPlacesLivenessWithNaver`로 나누되 같은 adapter와 quota를 전달한다. 완료 후 저장된 근거를 다시 읽고 `VERIFIED/MATCHED`만 비교 후 변경으로 3단계 이동시킨다. 수동 근거 승인은 허용 상태와 사유를 서버에서 확인하고 `manual_evidence_reason`과 감사 로그를 저장한 뒤 3단계로 이동한다.

- [ ] **Step 4: route action과 오버레이를 연결한다**

`intent=verify-review-items-with-naver`는 work item ID만 받고 subject ID나 점수를 클라이언트에서 받지 않는다. `AdminBlockingOverlay`는 fetcher가 submitting/loading인 동안 `role="dialog"`, `aria-modal="true"`, 진행 문구를 표시하고 body scroll과 배경 pointer event를 차단한다.

- [ ] **Step 5: 브라우저 테스트를 추가한다**

NAVER 버튼 클릭 직후 오버레이가 보이고 배경 checkbox가 클릭되지 않는지, 완료 토스트가 `확인 N · 통과 N · 확인 필요 N · 실패 N` 형식을 사용하는지 검증한다.

- [ ] **Step 6: 테스트와 타입을 실행한다**

Run: `pnpm test:integration -- tests/integration/place-review-naver.server.test.ts && pnpm test:e2e -- tests/e2e/place-operations.spec.ts --project=chromium --project=mobile-chromium && pnpm run typecheck`

Expected: PASS, exit 0.

- [ ] **Step 7: 커밋한다**

```bash
git add app/components/admin/AdminBlockingOverlay.tsx app/features/places/place-review-naver.server.ts app/routes/admin-place-operations.tsx tests/integration/place-review-naver.server.test.ts tests/e2e/place-operations.spec.ts
git commit -m "2026-08-15 NAVER 검수 단계 연결"
```

### Task 7: 카테고리 확정과 중복 결정

**Files:**
- Create: `app/features/places/place-review-category.server.ts`
- Create: `app/features/places/place-review-duplicates.server.ts`
- Create: `tests/integration/place-review-category.server.test.ts`
- Create: `tests/integration/place-review-duplicates.server.test.ts`
- Modify: `app/routes/admin-place-operations.tsx`
- Modify: `app/components/admin/PlaceReviewCard.tsx`
- Modify: `app/app.css`
- Modify: `tests/e2e/place-operations.spec.ts`

**Interfaces:**
- Consumes: 말단 category 판정, `classifyChainStore()`, 거리 판정, `advancePlaceReviewWorkItems()`.
- Produces: `confirmReviewItemCategories()`, `listReviewDuplicateCandidates()`, `resolveReviewDuplicate()`.

- [ ] **Step 1: 카테고리 확정 테스트를 작성한다**

```ts
it("requires a reason when the final category differs from NAVER", async () => {
  await expect(confirmReviewItemCategories(db, {
    selections: [{ workItemId, categoryId: otherCategoryId, reason: "" }], actorUserId: adminId, now,
  })).resolves.toEqual({ confirmed: [], skipped: [{ workItemId, code: "CATEGORY_OVERRIDE_REASON_REQUIRED" }] });
});
```

말단이 아닌 category, 비활성 category, 26개 요청, 성공 시 4단계 이동과 감사 로그도 검증한다.

- [ ] **Step 2: 중복 결정 테스트를 작성한다**

- 프랜차이즈 동일 상호는 후보를 만들지 않는다.
- 비프랜차이즈 같은 주소 또는 100m 이내는 후보가 된다.
- `BUSINESS_LICENSE`는 `LINK_EXISTING` 또는 `DISTINCT`만 허용한다.
- `PLACE`는 `MERGE` 또는 `DISTINCT`만 허용한다.
- 근거 없는 결정과 해결되지 않은 후보가 있는 5단계 이동을 차단한다.

- [ ] **Step 3: 실패를 확인한다**

Run: `pnpm test:integration -- tests/integration/place-review-category.server.test.ts tests/integration/place-review-duplicates.server.test.ts`

Expected: FAIL — 두 service module not found.

- [ ] **Step 4: 카테고리 확정 서비스를 구현한다**

```ts
export async function confirmReviewItemCategories(db: AppDb, input: {
  selections: Array<{ workItemId: string; categoryId: string; reason: string }>;
  actorUserId: string;
  now: string;
}): Promise<{ confirmed: string[]; skipped: Array<{ workItemId: string; code: string }> }>;
```

선택은 최대 25개다. active terminal category인지 검증하고 NAVER mapped category와 다르면 trim된 reason을 요구한다. `selected_category_id`, `category_override_reason`, stage/version과 `PLACE_REVIEW_CATEGORY_CONFIRMED` 감사 로그를 항목별 batch로 갱신한다.

- [ ] **Step 5: 중복 후보와 결정 서비스를 구현한다**

```ts
export type ReviewDuplicateCandidate = {
  workItemId: string;
  candidatePlaceId: string;
  candidateName: string;
  candidateAddress: string;
  distanceMeters: number | null;
  sameAddress: boolean;
  allowedDecisions: Array<"LINK_EXISTING" | "MERGE" | "DISTINCT">;
};

export async function resolveReviewDuplicate(db: AppDb, input: {
  workItemId: string;
  candidatePlaceId: string;
  decision: "LINK_EXISTING" | "MERGE" | "DISTINCT";
  reason: string;
  actorUserId: string;
  now: string;
}): Promise<void>;
```

후보 계산은 정규화 이름이 같고 동일 주소 또는 100m 이내인 장소만 반환한다. `classifyChainStore()`가 체인으로 판단하면 반환하지 않는다. 모든 현재 후보에 resolution이 있거나 후보가 0개일 때만 5단계로 이동한다.

- [ ] **Step 6: UI를 연결한다**

3단계 카드는 추천·NAVER·최종 카테고리를 태그로 비교하고 기존 전체 화면 category picker를 재사용한다. 4단계 카드는 후보 장소와 거리, `기존 장소에 연결/병합/서로 다름/보류`를 subject 유형에 맞게 표시한다. 결정 버튼은 reason 입력 전 비활성화한다.

- [ ] **Step 7: 통합·E2E·타입 테스트를 실행한다**

Run: `pnpm test:integration -- tests/integration/place-review-category.server.test.ts tests/integration/place-review-duplicates.server.test.ts && pnpm test:e2e -- tests/e2e/place-operations.spec.ts --project=chromium --project=mobile-chromium && pnpm run typecheck && pnpm run build`

Expected: PASS, exit 0.

- [ ] **Step 8: 커밋한다**

```bash
git add app/features/places/place-review-category.server.ts app/features/places/place-review-duplicates.server.ts app/routes/admin-place-operations.tsx app/components/admin/PlaceReviewCard.tsx app/app.css tests/integration/place-review-category.server.test.ts tests/integration/place-review-duplicates.server.test.ts tests/e2e/place-operations.spec.ts
git commit -m "2026-08-15 카테고리와 중복 검수 단계 추가"
```

### PR 2 완료 게이트

- 648개 fixture에서 26페이지가 모두 접근되고 count가 현재 page length가 아닌 648인지 확인한다.
- 데스크톱 1440px, 모바일 390px 스크린샷을 PR에 첨부한다.
- `pnpm test && pnpm test:integration && pnpm test:e2e -- tests/e2e/place-operations.spec.ts --project=chromium --project=mobile-chromium && pnpm run typecheck && pnpm run build`를 통과한다.
- NAVER fake만 호출됐고 운영 API 사용량이 증가하지 않았음을 PR에 기록한다.
- push → PR → CI/review → squash merge → 브랜치 정리를 수행한다.

---

## PR 3 — 선택 공개, 기존 화면 전환과 공개 후 환류

### Task 8: 조건 재검증과 선택 일괄 공개

**Files:**
- Create: `app/features/places/place-review-publication.server.ts`
- Create: `tests/integration/place-review-publication.server.test.ts`
- Modify: `app/features/candidates/candidate.server.ts`
- Modify: `app/features/places/place-merge.server.ts`
- Modify: `tests/integration/place-merge.server.test.ts`
- Modify: `app/routes/admin-place-operations.tsx`
- Modify: `app/components/admin/PlaceReviewCard.tsx`
- Modify: `tests/e2e/place-operations.spec.ts`

**Interfaces:**
- Consumes: `placeReviewWorkItems`, `placeReviewDuplicateResolutions`, 기존 candidate approval·place merge·감사 서비스.
- Produces: `publishSelectedReviewItems()`.

- [ ] **Step 1: 최종 공개 통합 테스트를 먼저 작성한다**

```ts
it("publishes only selected final-stage items", async () => {
  const result = await publishSelectedReviewItems(db, {
    workItemIds: [readyBusinessWorkId, readyHiddenPlaceWorkId],
    actorUserId: adminId,
    reason: "NAVER·카테고리·중복 검수 완료",
    now,
  });
  expect(result.published).toHaveLength(2);
  expect(result.skipped).toEqual([]);
  expect((await db.query.places.findFirst({ where: eq(places.id, untouchedHiddenPlaceId) }))?.status).toBe("HIDDEN");
});
```

같은 파일에 다음 계약을 추가한다.

- 4단계 항목 직접 POST는 `WRONG_STAGE`로 건너뜀
- 만료된 NAVER fingerprint는 `NAVER_REVERIFY_REQUIRED`
- 비활성 category는 `CATEGORY_INACTIVE`
- 새로 생긴 중복 후보는 `DUPLICATE_REVIEW_REQUIRED`
- active exclusion은 `ACTIVE_EXCLUSION`
- `LINK_EXISTING` 후보는 새 place를 만들지 않고 source link만 추가
- `PLACE/MERGE`는 기존 redirect와 revision을 남기고 생존 장소를 공개
- 같은 work item을 동시에 공개하면 하나의 claim만 성공하고 중복 장소·revision을 만들지 않음
- 10분이 지나지 않은 `PUBLISHING` claim은 재실행할 수 없고, 만료 claim은 근거 재검증 후 회수 가능
- 26개 요청과 빈 reason은 400 수준 도메인 오류

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm test:integration -- tests/integration/place-review-publication.server.test.ts`

Expected: FAIL — publication service 없음.

- [ ] **Step 3: candidate 승인과 장소 병합의 원자적 진입점을 분리한다**

`candidate.server.ts`의 기존 검증·slug 계산을 private helper로 옮기고, 단일 항목의 장소·카테고리·원천 링크·business license·workflow 완료·감사 로그를 한 번에 batch하는 진입점을 추가한다.

```ts
export async function approveCandidateFromReviewWorkItem(db: AppDb, input: {
  workItemId: string;
  claimToken: string;
  candidateId: string;
  actorUserId: string;
  categoryId: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  reason: string;
  now: string;
}): Promise<{ placeId: string }>;
```

기존 `approveCandidate()`는 같은 private 검증·statement builder를 사용하고 기존 반환 계약을 유지한다. `place-merge.server.ts`도 기존 `mergePlaces()`와 새 `mergePlaceFromReviewWorkItem()`이 같은 private statement builder를 사용하도록 정리한다.

```ts
export async function mergePlaceFromReviewWorkItem(db: AppDb, input: {
  workItemId: string;
  claimToken: string;
  targetPlaceId: string;
  sourcePlaceId: string;
  actorUserId: string;
  reason: string;
  now: string;
}): Promise<{ targetPlaceId: string }>;
```

공개 서비스는 먼저 `status=ACTIVE`, `stage=FINAL_APPROVAL`, `stage_version`이 일치하는 row를 조건부 update하여 `status=ON_HOLD`, `hold_code=PUBLISHING`, 임의 `claim_token`, `claimed_by`, `claimed_at`을 기록하고 `returning()`으로 소유권을 얻는다. claim에 실패한 항목은 `STALE_WORK_ITEM`으로 건너뛴다. 두 공개 진입점은 전달받은 `claim_token`이 일치하는 row만 workflow 완료하도록 같은 batch에 조건을 포함한다. 10분 이상 지난 `PUBLISHING` claim은 공개 조건을 다시 검증한 후 같은 관리자 action으로 회수할 수 있게 한다. 새 ORM이나 transaction helper는 추가하지 않는다.

- [ ] **Step 4: 공개 서비스를 구현한다**

```ts
export async function publishSelectedReviewItems(db: AppDb, input: {
  workItemIds: string[];
  actorUserId: string;
  reason: string;
  now: string;
}): Promise<{
  published: Array<{ workItemId: string; placeId: string }>;
  linked: Array<{ workItemId: string; placeId: string }>;
  skipped: Array<{ workItemId: string; code: string }>;
}>;
```

각 항목은 공개 직전에 1~4단계 근거를 다시 조회하고 조건부 claim을 획득한다. claim을 얻은 항목별로 다음 변경을 하나의 `db.batch()`에 넣어 부분 성공을 허용한다.

- `BUSINESS_LICENSE + DISTINCT/후보 없음`: 새 장소 생성, 카테고리·source link 생성, license 승인, workflow 완료, 감사 로그.
- `BUSINESS_LICENSE + LINK_EXISTING`: 기존 place에 source link 생성, license 승인, workflow 완료, 감사 로그. 기존 place가 HIDDEN이면 별도 place workflow가 완료되기 전까지 자동 공개하지 않는다.
- `PLACE + 후보 없음/DISTINCT`: primary category 교체, `PUBLISHED`, workflow 완료, `place_revisions`와 감사 로그.
- `PLACE + MERGE`: 저장된 target으로 `mergePlaces()`의 statement builder를 실행하고 생존 target이 모든 공개 조건을 만족할 때만 `PUBLISHED`; 아니면 target용 workflow를 3단계에서 생성한다.

- [ ] **Step 5: route action과 5단계 확인 UI를 연결한다**

`intent=publish-review-items`는 `workItemId[]`와 1~300자 reason만 받는다. 버튼은 `선택 장소 승인·공개`, 확인 modal은 선택 건수와 `공개 후 지도·목록에 표시됩니다`를 보여 준다. 완료 토스트는 `공개 N · 기존 장소 연결 N · 건너뜀 N`으로 표시하고 건너뜀 사유를 펼쳐 볼 수 있게 한다.

NAVER, 단계 이동, 카테고리 확정, 중복 결정, 최종 공개의 모든 submitting/loading 상태에서 Task 6의 `AdminBlockingOverlay`를 사용하고 중복 제출을 막는다.

- [ ] **Step 6: 통합·E2E 테스트를 실행한다**

Run: `pnpm test:integration -- tests/integration/place-review-publication.server.test.ts && pnpm test:e2e -- tests/e2e/place-operations.spec.ts --project=chromium --project=mobile-chromium && pnpm run typecheck`

Expected: 선택된 항목만 공개되고 미선택 HIDDEN fixture는 유지되며 전체 PASS.

- [ ] **Step 7: 커밋한다**

```bash
git add app/features/places/place-review-publication.server.ts app/features/candidates/candidate.server.ts app/features/places/place-merge.server.ts app/routes/admin-place-operations.tsx app/components/admin/PlaceReviewCard.tsx tests/integration/place-review-publication.server.test.ts tests/integration/place-merge.server.test.ts tests/e2e/place-operations.spec.ts
git commit -m "2026-08-15 검수 완료 장소 선택 공개"
```

### Task 9: 영업·정정 환류와 기존 후보 화면 전환

**Files:**
- Modify: `app/features/places/place-liveness.server.ts`
- Modify: `app/features/places/place-correction.server.ts`
- Modify: `app/routes/admin-candidates.tsx`
- Modify: `tests/integration/place-liveness.server.test.ts`
- Modify: `tests/integration/place-correction.server.test.ts`
- Modify: `tests/e2e/admin-candidate-review.spec.ts`
- Modify: `tests/e2e/place-operations.spec.ts`

**Interfaces:**
- Consumes: `newReviewWorkItemValues()`, 5단계 route URL.
- Produces: 공개 후 운영에서 파이프라인으로 안전하게 돌아오는 경로와 구 후보 URL redirect.

- [ ] **Step 1: 환류 통합 테스트를 작성한다**

```ts
it("enqueues a hidden liveness result for review", async () => {
  await applyPlaceLivenessDecision(db, hiddenDecisionInput);
  await expect(db.query.placeReviewWorkItems.findFirst({
    where: and(eq(placeReviewWorkItems.placeId, placeId), eq(placeReviewWorkItems.status, "ACTIVE")),
  })).resolves.toEqual(expect.objectContaining({ sourceKind: "LIVENESS_RECHECK", stage: "SOURCE_REVIEW" }));
});
```

정정 테스트에는 상호·주소·좌표·카테고리 변경 시 active workflow가 `NAVER_VERIFICATION`으로 재설정되고 `stage_version`이 증가하는지, 전화번호만 변경하면 workflow를 만들지 않는지 추가한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm test:integration -- tests/integration/place-liveness.server.test.ts tests/integration/place-correction.server.test.ts`

Expected: 환류 assertion FAIL.

- [ ] **Step 3: 공개 후 상태 변경 batch에 workflow를 추가한다**

- 영업 검수로 `HIDDEN`이 된 장소: `LIVENESS_RECHECK/SOURCE_REVIEW` active 작업을 같은 batch에서 생성.
- 상호·주소·좌표·primary category 변경: 기존 active 작업이 있으면 `NAVER_VERIFICATION`, 없으면 새 `LIVENESS_RECHECK/NAVER_VERIFICATION` 작업 생성.
- 전화번호·설명만 변경: 기존 공개 상태와 pipeline을 유지.
- 모든 재등록에 `PLACE_REVIEW_REOPENED` 감사 로그 저장.

- [ ] **Step 4: `/admin/candidates`를 1단계로 전환한다**

기존 후보 화면의 필터 파라미터 중 `q`, `region`, `page`, `pageSize`를 보존하여 다음 URL로 302 redirect한다.

```ts
export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const source = new URL(request.url);
  const target = new URLSearchParams({ flow: "review", step: "1" });
  for (const key of ["q", "region", "page", "pageSize"]) {
    const value = source.searchParams.get(key);
    if (value) target.set(key, value);
  }
  return redirect(`/admin/place-operations?${target}`);
}
```

기존 POST는 제거하지 않고 405 또는 새 route 안내를 반환하는 짧은 호환 기간을 한 PR 동안 유지한다. 코드 검색에서 더 이상 `/admin/candidates` POST를 호출하는 UI가 없음을 확인한 뒤 다음 cleanup PR 후보로 기록한다.

- [ ] **Step 5: redirect와 공개 후 운영 E2E를 추가한다**

`/admin/candidates?page=2&pageSize=50`이 새 1단계 URL로 이동하는지, 영업 재검증 후 해당 장소가 1단계 count에 증가하는지 검증한다.

- [ ] **Step 6: 테스트·타입·빌드를 실행한다**

Run: `pnpm test:integration -- tests/integration/place-liveness.server.test.ts tests/integration/place-correction.server.test.ts && pnpm test:e2e -- tests/e2e/admin-candidate-review.spec.ts tests/e2e/place-operations.spec.ts --project=chromium && pnpm run typecheck && pnpm run build`

Expected: PASS, exit 0.

- [ ] **Step 7: 커밋한다**

```bash
git add app/features/places/place-liveness.server.ts app/features/places/place-correction.server.ts app/routes/admin-candidates.tsx tests/integration/place-liveness.server.test.ts tests/integration/place-correction.server.test.ts tests/e2e/admin-candidate-review.spec.ts tests/e2e/place-operations.spec.ts
git commit -m "2026-08-15 장소 재검수 환류 경로 통합"
```

### Task 10: 전체 회귀, 운영 runbook과 배포 검증

**Files:**
- Create: `docs/operations/place-review-pipeline-rollout.md`
- Modify: `tests/e2e/place-operations.spec.ts`
- Modify: `docs/superpowers/specs/2026-08-15-place-review-pipeline-design.md`

**Interfaces:**
- Consumes: Tasks 1~9 전체.
- Produces: 재현 가능한 local 검증, 운영 migration/배포/forward-fix 절차와 최종 수용 증거.

- [ ] **Step 1: 648건 브라우저 fixture와 최종 여정 테스트를 완성한다**

다음 하나의 E2E 시나리오가 fake NAVER와 local D1만 사용하도록 seed를 추가한다.

1. 648개가 25개 기준 26페이지로 표시된다.
2. 1단계 항목을 2단계로 이동한다.
3. NAVER fake `MATCHED`가 3단계로 이동시키되 place는 HIDDEN이다.
4. 카테고리를 확정한다.
5. 중복 없음 또는 DISTINCT를 기록한다.
6. 5단계에서 두 개 중 하나만 선택해 공개한다.
7. 선택 항목만 지도·목록에 나타나고 미선택은 HIDDEN이다.

- [ ] **Step 2: 운영 runbook을 작성한다**

문서에는 아래 명령과 예상 결과를 그대로 기록한다.

```bash
pnpm exec wrangler d1 migrations list DB --remote
pnpm exec wrangler d1 migrations apply DB --remote
pnpm run deploy
```

운영 확인 SQL:

```sql
SELECT source_kind, stage, status, count(*)
FROM place_review_work_items
GROUP BY source_kind, stage, status
ORDER BY source_kind, stage, status;

SELECT count(*) AS invalid_subjects
FROM place_review_work_items
WHERE (business_license_id IS NULL) = (place_id IS NULL);

SELECT count(*) AS duplicate_active_business
FROM (
  SELECT business_license_id
  FROM place_review_work_items
  WHERE business_license_id IS NOT NULL AND status IN ('ACTIVE','ON_HOLD')
  GROUP BY business_license_id HAVING count(*) > 1
);
```

forward-fix는 `0034`를 수정하지 않고 `0035_place_review_pipeline_forward_fix.sql`을 새로 추가하는 원칙을 명시한다. Worker rollback만으로 migration을 되돌리지 않으며, 문제가 있으면 UI를 기존 공개 후 운영 화면으로 제한하고 신규 stage action을 중단한다.

- [ ] **Step 3: 전체 자동 검증을 실행한다**

Run:

```bash
pnpm test
pnpm test:integration
pnpm test:e2e -- tests/e2e/place-operations.spec.ts tests/e2e/admin-candidate-review.spec.ts --project=chromium --project=mobile-chromium
pnpm run typecheck
pnpm run build
pnpm exec wrangler deploy --dry-run
git diff --check
```

Expected: 모든 명령 exit 0. 외부 API·운영 D1 호출 없음.

- [ ] **Step 4: 데스크톱·모바일 시각 증거를 캡처한다**

- 데스크톱 1440×1000: 01~05 단계 bar, count, 필터, 2열 카드, pagination.
- 모바일 390×844: 가로 단계 bar, 1열 카드, sticky action, blocking overlay.
- 스크린샷 경로와 Playwright 명령을 PR 본문에 기록한다.

- [ ] **Step 5: 설계 문서 상태와 runbook 링크를 갱신한다**

설계 문서 상태를 `구현 완료 — PR 1/2/3 링크`로 바꾸고 테스트 수, migration 번호, 남은 위험을 추가한다. 실제 PR 번호가 생긴 뒤 정확한 링크만 기록하며 임의 번호를 쓰지 않는다.

- [ ] **Step 6: 커밋한다**

```bash
git add docs/operations/place-review-pipeline-rollout.md docs/superpowers/specs/2026-08-15-place-review-pipeline-design.md tests/e2e/place-operations.spec.ts
git commit -m "2026-08-15 장소 검수 파이프라인 운영 검증"
```

### PR 3 완료·배포 게이트

- 최신 `origin/main` 반영 후 Task 10 전체 검증을 다시 실행한다.
- PR 본문에 운영 D1 migration, backfill 범위, NAVER 비용 영향, 개인정보 영향 없음, forward-fix와 Worker rollback을 기록한다.
- CI와 diff review가 통과한 뒤 squash merge한다.
- 병합된 `main`에서 원격 D1 migration을 적용하고 운영 집계 SQL로 불변식을 확인한다.
- migration 확인 후 `pnpm run deploy`를 실행한다.
- 배포된 `/admin/place-operations?flow=review&step=1`은 인증 redirect와 관리자 로그인 후 01~05 단계·count·pagination을 smoke test한다.
- 배포 후 원격 feature branch를 삭제하고 로컬 branch는 `Archive/<원래-브랜치명>`으로 보존한다.

## 계획 자체 검토 체크리스트

- [x] 설계의 1~5단계가 Tasks 4, 6, 7, 8에 각각 대응한다.
- [x] 648건 서버 페이지네이션이 Task 3과 Task 10에 포함된다.
- [x] NAVER 검증 후 자동 공개 금지가 Task 6 통합 테스트에 포함된다.
- [x] 프랜차이즈 제외와 중복 결정 저장이 Task 1과 Task 7에 포함된다.
- [x] 선택 일괄 공개와 미선택 HIDDEN 유지가 Task 8에 포함된다.
- [x] 영업·정정 환류가 Task 9에 포함된다.
- [x] 원격 migration·배포·forward-fix가 Task 10에 포함된다.
