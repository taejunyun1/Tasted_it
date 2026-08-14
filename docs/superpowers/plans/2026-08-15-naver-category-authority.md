# NAVER 지역검색 우선 카테고리 검증 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** NAVER 지역검색(Local Search)에서 상호와 위치가 검증된 결과만 기존 공공데이터·상호명·AI 분류에 합쳐, 공개 장소와 검수 후보의 대표 음식 카테고리를 더 정확하고 설명 가능하게 결정한다.

**Architecture:** 외부 응답은 서버 전용 `NaverLocalSearchAdapter`에서 엄격하게 검증하고, 순수 매칭·카테고리 중재 모듈이 `VERIFIED / LIKELY / AMBIGUOUS / NO_MATCH / OUT_OF_SCOPE / FAILED` 결과를 만든다. 재검증 서비스는 `business_licenses`를 기준으로 최소 메타데이터만 D1에 저장하고, 현재의 후보 검수와 공개 장소 일괄 재분류 흐름에 제안·감사 로그를 연결한다. 사용자 지도·목록 요청은 외부 API를 호출하지 않으며, 기능 플래그가 꺼지거나 외부 API가 실패하면 기존 규칙 분류를 유지한다.

**Tech Stack:** React Router 8, TypeScript strict, Cloudflare Workers, D1/Drizzle, Zod, Vitest Workers pool, Playwright, NAVER Local Search API(서버 전용 adapter)

## Global Constraints

- 구현 시작 전 이 계획을 포함한 PR 본문에 NAVER API Hub 지역검색의 제공 상태·약관상 보관 가능 기간·일일/월간 quota·비용 상한·담당자·rollback을 `GO` 또는 `CONDITIONAL GO`로 명시하고 병합한다.
- `NAVER_LOCAL_SEARCH_CLIENT_ID`와 `NAVER_LOCAL_SEARCH_CLIENT_SECRET`은 Workers secret으로만 읽고, 코드·테스트 fixture·로그·PR·브라우저 bundle에 값이나 요청 헤더를 기록하지 않는다.
- `NAVER_LOCAL_SEARCH_ENABLED`의 기본값은 `false`, `NAVER_LOCAL_SEARCH_DAILY_LIMIT`의 초기값은 `200`이다. 미설정·`false`·quota 초과·429·5xx·timeout은 기존 규칙 분류를 유지한다.
- 외부 호출은 신규/상호·주소 변경 후보, 관리자의 명시 재검증, 100곳 이하의 관리자 배치에만 허용한다. 공개 페이지와 클라이언트는 NAVER 지역검색을 호출하지 않는다.
- NAVER 원문 response, 이미지, 리뷰, 소개 문구, provider place ID, 업체 링크를 저장하지 않는다. 내부 카테고리 ID, 상태, 숫자 점수, 규칙 버전, 입력 fingerprint, 제한된 evidence code, 시간만 D1에 저장한다.
- `VERIFIED`는 정규화 상호가 정확 또는 지점 표기만 다른 일치이고 정규화 주소가 같거나 D1 WGS84 좌표와 100m 이내인 경우만 된다. 동점, 주소 불일치, 광주·전남 밖 결과는 자동 변경하지 않는다.
- 비음식·유흥 제외 정책이 가장 먼저 적용된다. 구체 NAVER 카테고리는 구체 원천 업태와 충돌하면 `CONFLICT`, 넓은 NAVER 카테고리는 구체 원천 업태·메뉴 신호를 덮어쓰지 못한다.
- `VERIFIED + HIGH(85점 이상)`만 자동 적용 후보이며, `MEDIUM(65~84)`, `LOW(40~64)`, `CONFLICT`는 관리자 명시 선택 없이는 바꾸지 않는다. AI의 점수는 관리자 카테고리 선택을 잠그지 않는다.
- 새 cron, Queue, Durable Object, 패키지, 별도 DB는 추가하지 않는다. local/unit/integration은 fake adapter만 쓰며, 실제 NAVER contract 호출은 병합된 운영 PR에 명시된 제한된 수동 점검에서만 한다.
- 적용된 migration을 수정하지 않고 `drizzle/0030_naver_local_category_verification.sql`을 새로 추가한다. 원격 D1 일괄 적용은 preview 결과·대상·최대 100곳·감사 수·rollback을 PR에 적은 범위에서만 실행한다.

---

## 파일 구조와 책임

| 경로 | 책임 |
| --- | --- |
| `drizzle/0030_naver_local_category_verification.sql` | 검증 결과와 제한된 재검증 실행 이력을 위한 D1 테이블·제약·인덱스 |
| `app/db/schema.ts` | 위 테이블의 Drizzle SSOT |
| `app/cloudflare-env.d.ts`, `wrangler.jsonc` | 서버 secret 타입과 안전 기본값 feature flag/quota 변수 |
| `app/features/candidates/naver-local-search.server.ts` | NAVER HTTP 호출, Zod boundary, timeout·한도·안전 오류 코드 |
| `app/features/candidates/naver-local-category.ts` | 이름/주소/거리 매칭, provider 카테고리의 내부 slug 매핑, 근거 우선순위와 신뢰도 계산 |
| `app/features/candidates/naver-category-reverification.server.ts` | 신규·변경·명시 배치 대상 선택, verification 저장, preview/apply, audit과 idempotency |
| `app/features/candidates/bulk-review.server.ts` | NAVER 검증 결과를 후보 행의 최종 제안·근거·상태에 합성 |
| `app/features/candidates/category-reclassification.server.ts` | 공개 원천 연동 장소를 100곳 단위로 NAVER 근거까지 포함해 preview/apply |
| `app/features/candidates/ai-classification.server.ts`, `app/features/candidates/ai-classification-policy.ts` | NAVER의 확정 근거를 AI 검증 후보와 신뢰도 설명에 반영하되 AI가 뒤집지 못하게 함 |
| `app/routes/admin-candidates.tsx` | NAVER 검증 상태 탭·재검증 컨트롤·근거 표시와 항상 활성인 직접 카테고리 선택 UI |
| `README.md`, `docs/operations/naver-local-category-runbook.md` | secret 등록, quota, 개인정보, preview/apply, 알림, kill/forward-fix 절차 |
| `tests/unit/naver-local-search.test.ts`, `tests/unit/naver-local-category.test.ts` | 외부 응답 경계와 결정 규칙의 fake 기반 회귀 |
| `tests/integration/naver-local-category-migration.test.ts`, `tests/integration/naver-category-reverification.server.test.ts`, `tests/integration/bulk-review.server.test.ts` | D1 migration·저장·preview/apply·AI/규칙 합성 계약 |
| `tests/e2e/admin-candidate-review.spec.ts` | 데스크톱/모바일에서 상태 탭, 근거, 직접 수정, preview/apply의 사용자 흐름 |

## 공통 타입과 결정 계약

후속 작업은 아래 이름과 필드를 그대로 사용한다. provider 원문 `category`는 adapter와 순수 매처의 메모리 안에서만 존재하고 D1 반환 타입에는 포함하지 않는다.

```ts
export type NaverVerificationStatus =
  | "VERIFIED"
  | "LIKELY"
  | "AMBIGUOUS"
  | "NO_MATCH"
  | "OUT_OF_SCOPE"
  | "FAILED"
  | "SKIPPED";

export type NaverEvidenceCode =
  | "NAVER_EXACT_NAME"
  | "NAVER_BRANCH_NORMALIZED_NAME"
  | "NAVER_EXACT_ADDRESS"
  | "NAVER_COORDINATES_WITHIN_100M"
  | "NAVER_SPECIFIC_CATEGORY"
  | "NAVER_BROAD_CATEGORY"
  | "SOURCE_SUBTYPE_MATCH"
  | "SOURCE_SUBTYPE_CONFLICT"
  | "NAME_FOOD_MATCH"
  | "AI_AGREES"
  | "AI_DISAGREES";

export type NaverCategoryVerification = {
  businessLicenseId: string;
  status: NaverVerificationStatus;
  mappedCategoryId: string | null;
  matchScore: number;
  specificityScore: number;
  confidenceScore: number;
  evidenceCodes: NaverEvidenceCode[];
  ruleVersion: "naver-category-v1";
  inputFingerprint: string;
  queriedAt: string;
  expiresAt: string | null;
  failureCode: string | null;
};

export type CategoryAuthorityDecision = {
  categorySlug: string;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "CONFLICT";
  confidenceScore: number;
  automatic: boolean;
  reasons: string[];
  naver: Pick<NaverCategoryVerification, "status" | "mappedCategoryId" | "evidenceCodes" | "confidenceScore"> | null;
};
```

### Task 1: 데이터 모델·환경 경계와 migration을 먼저 고정한다

**Files:**
- Create: `drizzle/0030_naver_local_category_verification.sql`
- Modify: `app/db/schema.ts:351-385`, `app/cloudflare-env.d.ts:1-18`, `wrangler.jsonc:8-17`, `README.md:25-65`
- Test: `tests/integration/naver-local-category-migration.test.ts`

**Consumes:** 현재 `business_licenses`, `categories`, `admin_audit_logs`, `places`, `place_source_links` 테이블과 `createDb`.

**Produces:** `naverLocalCategoryVerifications`, `naverLocalCategoryRuns`, `Env`의 서버 전용 검색 secret 및 안전 기본 feature flag/quota. Task 2~5는 이 이름을 그대로 사용한다.

- [ ] **Step 1: migration 계약 테스트를 먼저 작성한다.**

```ts
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("NAVER 지역검색 카테고리 migration", () => {
  it("stores only an internal category decision and its minimal verification metadata", async () => {
    const columns = await env.DB.prepare("PRAGMA table_info(naver_local_category_verifications)").all<{ name: string }>();
    expect(columns.results.map((column) => column.name)).toEqual(expect.arrayContaining([
      "business_license_id", "status", "mapped_category_id", "match_score", "specificity_score",
      "confidence_score", "evidence_codes_json", "rule_version", "input_fingerprint", "queried_at", "expires_at", "failure_code",
    ]));
    expect(columns.results.map((column) => column.name)).not.toEqual(expect.arrayContaining([
      "provider_place_id", "raw_response", "image_url", "review_text", "description", "provider_link",
    ]));
  });
});
```

- [ ] **Step 2: Workers migration test를 실행해 현재 실패를 확인한다.**

Run: `pnpm run test:integration -- tests/integration/naver-local-category-migration.test.ts`

Expected: `no such table: naver_local_category_verifications`.

- [ ] **Step 3: 새 migration과 Drizzle schema를 작성한다.**

```sql
-- drizzle/0030_naver_local_category_verification.sql
CREATE TABLE naver_local_category_verifications (
  business_license_id TEXT PRIMARY KEY NOT NULL REFERENCES business_licenses(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('VERIFIED','LIKELY','AMBIGUOUS','NO_MATCH','OUT_OF_SCOPE','FAILED','SKIPPED')),
  mapped_category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  match_score INTEGER NOT NULL CHECK(match_score BETWEEN 0 AND 100),
  specificity_score INTEGER NOT NULL CHECK(specificity_score BETWEEN 0 AND 20),
  confidence_score INTEGER NOT NULL CHECK(confidence_score BETWEEN 0 AND 100),
  evidence_codes_json TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  queried_at TEXT NOT NULL,
  expires_at TEXT,
  failure_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX naver_local_category_verifications_status_queried_idx
  ON naver_local_category_verifications(status, queried_at);
CREATE INDEX naver_local_category_verifications_expiry_idx
  ON naver_local_category_verifications(expires_at);

CREATE TABLE naver_local_category_runs (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK(mode IN ('PREVIEW','APPLY')),
  scope TEXT NOT NULL CHECK(scope IN ('PENDING','PUBLISHED')),
  status TEXT NOT NULL CHECK(status IN ('RUNNING','COMPLETED','FAILED','SKIPPED')),
  after_business_license_id TEXT,
  requested_limit INTEGER NOT NULL CHECK(requested_limit BETWEEN 1 AND 100),
  scanned_count INTEGER NOT NULL DEFAULT 0,
  verified_count INTEGER NOT NULL DEFAULT 0,
  change_count INTEGER NOT NULL DEFAULT 0,
  conflict_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  api_call_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error_code TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX naver_local_category_runs_status_started_idx
  ON naver_local_category_runs(status, started_at);
```

```ts
// app/cloudflare-env.d.ts
interface Env {
  NAVER_LOCAL_SEARCH_CLIENT_ID: string;
  NAVER_LOCAL_SEARCH_CLIENT_SECRET: string;
  NAVER_LOCAL_SEARCH_ENABLED: string;
  NAVER_LOCAL_SEARCH_DAILY_LIMIT: string;
}
```

```jsonc
// wrangler.jsonc — vars 블록에 추가한다. secret 값은 절대 넣지 않는다.
"NAVER_LOCAL_SEARCH_ENABLED": "false",
"NAVER_LOCAL_SEARCH_DAILY_LIMIT": "200"
```

- [ ] **Step 4: README에 secret 이름·허용 데이터·kill switch만 기록한다.**

```md
| `NAVER_LOCAL_SEARCH_CLIENT_ID` | NAVER 지역검색 서버 요청 식별자 | secret |
| `NAVER_LOCAL_SEARCH_CLIENT_SECRET` | NAVER 지역검색 서버 요청 비밀값 | secret |
| `NAVER_LOCAL_SEARCH_ENABLED` | 지역검색 카테고리 검증 kill switch | 환경별 변수 (`false` 안전 기본값) |
| `NAVER_LOCAL_SEARCH_DAILY_LIMIT` | 하루 최대 지역검색 호출 수 | 환경별 변수 (`200` 초기 상한) |

지역검색은 후보 수집·관리자 재검증에서만 서버가 호출한다. 사용자 공개 페이지는 호출하지 않으며, NAVER 원문 응답·사진·리뷰·소개·장소 ID를 D1 또는 로그에 저장하지 않는다.
```

- [ ] **Step 5: migration과 타입을 검증한다.**

Run: `pnpm run test:integration -- tests/integration/naver-local-category-migration.test.ts && pnpm run typecheck`

Expected: migration test PASS, TypeScript exit code `0`.

- [ ] **Step 6: 첫 독립 변경을 커밋한다.**

```bash
git add drizzle/0030_naver_local_category_verification.sql app/db/schema.ts app/cloudflare-env.d.ts wrangler.jsonc README.md tests/integration/naver-local-category-migration.test.ts
git commit -m "2026-08-15 NAVER 지역검색 분류 데이터 경계"
```

### Task 2: 외부 API를 strict adapter와 fake로 격리한다

**Files:**
- Create: `app/features/candidates/naver-local-search.server.ts`, `tests/unit/naver-local-search.test.ts`
- Modify: `app/cloudflare-env.d.ts:1-22`

**Consumes:** Task 1의 `Env` keys, `RegionCode`, Workers `fetch`, Zod.

**Produces:** `createNaverLocalSearchAdapter`와 `NaverLocalSearchAdapter`. Task 4는 이 adapter interface만 받고 `fetch`나 secret을 직접 읽지 않는다.

- [ ] **Step 1: fake response와 실패 경계를 잠그는 unit test를 작성한다.**

```ts
import { describe, expect, it, vi } from "vitest";
import { createNaverLocalSearchAdapter } from "../../app/features/candidates/naver-local-search.server";

const enabledEnv = {
  NAVER_LOCAL_SEARCH_ENABLED: "true",
  NAVER_LOCAL_SEARCH_DAILY_LIMIT: "200",
  NAVER_LOCAL_SEARCH_CLIENT_ID: "test-id",
  NAVER_LOCAL_SEARCH_CLIENT_SECRET: "test-secret",
} as Env;

it("sends one bounded server request and returns only fields used by the matcher", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    total: 1,
    items: [{ title: "<b>인생역전</b>", category: "음식점>술집>포장마차", address: "광주광역시 광산구 쌍암동 1", roadAddress: "광주광역시 광산구 임방울대로 825", mapx: "126849890", mapy: "35220910" }],
  })));
  const adapter = createNaverLocalSearchAdapter(enabledEnv, fetcher);
  await expect(adapter.search({ businessName: "인생역전", address: "광주광역시 광산구 임방울대로 825", regionCode: "GWANGJU" }))
    .resolves.toEqual([{ name: "인생역전", category: "음식점>술집>포장마차", address: "광주광역시 광산구 임방울대로 825", latitude: 35.22091, longitude: 126.84989 }]);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each([401, 403, 422])("does not retry non-retryable HTTP %i", async (status) => {
  const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status }));
  const adapter = createNaverLocalSearchAdapter(enabledEnv, fetcher);
  await expect(adapter.search({ businessName: "테스트", address: "광주광역시 동구 예술길 1", regionCode: "GWANGJU" })).rejects.toMatchObject({ code: "NAVER_LOCAL_SEARCH_REJECTED" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: test를 실행해 module-not-found 실패를 확인한다.**

Run: `pnpm test -- tests/unit/naver-local-search.test.ts`

Expected: FAIL with `Failed to resolve import`.

- [ ] **Step 3: adapter contract와 제한된 오류 코드를 구현한다.**

```ts
// app/features/candidates/naver-local-search.server.ts
import { z } from "zod";
import type { RegionCode } from "./public-data";

const responseSchema = z.object({
  total: z.number().int().nonnegative(),
  items: z.array(z.object({
    title: z.string(), category: z.string(), address: z.string(), roadAddress: z.string(),
    mapx: z.string(), mapy: z.string(),
  }).strict()).max(5),
}).strict();

export type NaverLocalSearchResult = {
  name: string; category: string; address: string; latitude: number; longitude: number;
};
export type NaverLocalSearchAdapter = {
  search(input: { businessName: string; address: string; regionCode: RegionCode }): Promise<NaverLocalSearchResult[]>;
};
export class NaverLocalSearchError extends Error {
  constructor(readonly code: "NAVER_LOCAL_SEARCH_DISABLED" | "NAVER_LOCAL_SEARCH_QUOTA" | "NAVER_LOCAL_SEARCH_TIMEOUT" | "NAVER_LOCAL_SEARCH_REJECTED" | "NAVER_LOCAL_SEARCH_UNAVAILABLE" | "NAVER_LOCAL_SEARCH_RESPONSE_INVALID") {
    super(code);
  }
}

export function createNaverLocalSearchAdapter(env: Pick<Env, "NAVER_LOCAL_SEARCH_ENABLED" | "NAVER_LOCAL_SEARCH_CLIENT_ID" | "NAVER_LOCAL_SEARCH_CLIENT_SECRET">, fetcher: typeof fetch = fetch): NaverLocalSearchAdapter {
  return { async search(input) {
    if (env.NAVER_LOCAL_SEARCH_ENABLED !== "true") throw new NaverLocalSearchError("NAVER_LOCAL_SEARCH_DISABLED");
    const query = `${input.businessName} ${input.address.split(/\s+/).slice(0, 4).join(" ")}`.trim();
    const url = new URL("https://openapi.naver.com/v1/search/local.json");
    url.searchParams.set("query", query); url.searchParams.set("display", "5");
    let response: Response;
    try {
      response = await fetcher(url, { headers: { "X-Naver-Client-Id": env.NAVER_LOCAL_SEARCH_CLIENT_ID, "X-Naver-Client-Secret": env.NAVER_LOCAL_SEARCH_CLIENT_SECRET }, signal: AbortSignal.timeout(4_000) });
    } catch { throw new NaverLocalSearchError("NAVER_LOCAL_SEARCH_TIMEOUT"); }
    if (response.status === 429) throw new NaverLocalSearchError("NAVER_LOCAL_SEARCH_QUOTA");
    if (response.status >= 400 && response.status < 500) throw new NaverLocalSearchError("NAVER_LOCAL_SEARCH_REJECTED");
    if (!response.ok) throw new NaverLocalSearchError("NAVER_LOCAL_SEARCH_UNAVAILABLE");
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) throw new NaverLocalSearchError("NAVER_LOCAL_SEARCH_RESPONSE_INVALID");
    return parsed.data.items.map((item) => ({ name: item.title.replace(/<[^>]+>/g, ""), category: item.category, address: item.roadAddress || item.address, latitude: Number(item.mapy) / 10_000_000, longitude: Number(item.mapx) / 10_000_000 }));
  }};
}
```

- [ ] **Step 4: daily quota is not hidden inside the adapter; prove disabled, malformed, timeout, 429, 5xx and valid five-result handling.**

```ts
it("rejects malformed provider data without exposing the original payload", async () => {
  const adapter = createNaverLocalSearchAdapter(enabledEnv, vi.fn().mockResolvedValue(new Response(JSON.stringify({ total: 1, items: [{ title: "x" }] }))));
  await expect(adapter.search({ businessName: "테스트", address: "광주광역시 동구 예술길 1", regionCode: "GWANGJU" }))
    .rejects.toMatchObject({ code: "NAVER_LOCAL_SEARCH_RESPONSE_INVALID" });
});
```

- [ ] **Step 5: test와 typecheck를 통과시킨 뒤 커밋한다.**

Run: `pnpm test -- tests/unit/naver-local-search.test.ts && pnpm run typecheck`

Expected: PASS, exit code `0`.

```bash
git add app/features/candidates/naver-local-search.server.ts app/cloudflare-env.d.ts tests/unit/naver-local-search.test.ts
git commit -m "2026-08-15 NAVER 지역검색 서버 어댑터 추가"
```

### Task 3: 이름·주소 검증과 근거 우선순위를 순수 결정 함수로 만든다

**Files:**
- Create: `app/features/candidates/naver-local-category.ts`, `tests/unit/naver-local-category.test.ts`
- Modify: `app/features/candidates/category-suggestion.ts:1-176`, `app/features/candidates/ai-classification-policy.ts:1-98`

**Consumes:** Task 2의 `NaverLocalSearchResult`, 현재 `classifyCandidate`, `getAuthoritativeSubtypeCategorySlug`, 활성 terminal category slug set.

**Produces:** `matchNaverLocalCategory`와 `decideCategoryAuthority`. Task 4는 이 두 pure function이 낸 결과만 저장·apply한다.

- [ ] **Step 1: 식육·소주방·넓은 NAVER 카테고리·동명이인 사례를 먼저 RED로 작성한다.**

```ts
import { describe, expect, it } from "vitest";
import { decideCategoryAuthority, matchNaverLocalCategory } from "../../app/features/candidates/naver-local-category";

const terminals = new Set(["grill", "pocha", "home-meal", "gukbap-detail"]);

it("uses a verified specific NAVER meat category when source subtype and AI agree", () => {
  const match = matchNaverLocalCategory({ businessName: "신 돼지세끼", address: "광주광역시 서구 군분로159번길 15-25", latitude: 35.14484, longitude: 126.88617, regionCode: "GWANGJU", results: [{ name: "신돼지세끼", category: "음식점>한식>육류,고기요리", address: "광주광역시 서구 군분로159번길 15-25", latitude: 35.14484, longitude: 126.88617 }], terminalSlugs: terminals });
  expect(decideCategoryAuthority({ rule: { categorySlug: "grill", confidence: "HIGH", confidenceScore: 75, reasons: ["원천 업태의 식육·숯불구이 표현"] }, subtypeSlug: "grill", nameSlug: null, ai: { categorySlug: "grill", confidence: 0.95, reasons: [] }, naver: match })).toMatchObject({ categorySlug: "grill", confidence: "HIGH", confidenceScore: 90, automatic: true });
});

it("keeps 정종/대포집/소주방 as pocha when NAVER only says broad 음식점", () => {
  const match = matchNaverLocalCategory({ businessName: "인생역전", address: "광주광역시 광산구 임방울대로 825", latitude: 35.22091, longitude: 126.84989, regionCode: "GWANGJU", results: [{ name: "인생역전", category: "음식점>한식", address: "광주광역시 광산구 임방울대로 825", latitude: 35.22091, longitude: 126.84989 }], terminalSlugs: terminals });
  expect(decideCategoryAuthority({ rule: { categorySlug: "pocha", confidence: "HIGH", confidenceScore: 70, reasons: [] }, subtypeSlug: "pocha", nameSlug: null, ai: null, naver: match }).categorySlug).toBe("pocha");
});

it("returns AMBIGUOUS and never enables automatic apply for equal-name addresses", () => {
  const match = matchNaverLocalCategory({ businessName: "동명식당", address: "광주광역시 동구 예술길 1", latitude: null, longitude: null, regionCode: "GWANGJU", results: [
    { name: "동명식당", category: "음식점>한식>백반,가정식", address: "광주광역시 동구 예술길 1", latitude: 35.15, longitude: 126.92 },
    { name: "동명식당", category: "음식점>한식>육류,고기요리", address: "광주광역시 북구 동문대로 1", latitude: 35.18, longitude: 126.93 },
  ], terminalSlugs: terminals });
  expect(match.status).toBe("AMBIGUOUS");
});
```

- [ ] **Step 2: test를 실행해 module-not-found 실패를 확인한다.**

Run: `pnpm test -- tests/unit/naver-local-category.test.ts`

Expected: FAIL with `Failed to resolve import`.

- [ ] **Step 3: 정규화, 100m Haversine, NAVER category mapping과 중재 함수를 구현한다.**

```ts
// app/features/candidates/naver-local-category.ts
import type { AiClassification } from "./ai-classification-policy";
import type { CandidateClassification } from "./category-suggestion";
import type { NaverLocalSearchResult } from "./naver-local-search.server";

export const NAVER_CATEGORY_RULE_VERSION = "naver-category-v1" as const;
type NaverMatchInput = {
  businessName: string; address: string; latitude: number | null; longitude: number | null;
  regionCode: "GWANGJU" | "JEONNAM"; results: NaverLocalSearchResult[]; terminalSlugs: Set<string>;
};
type NaverMatch = {
  status: NaverVerificationStatus; mappedCategorySlug: string | null; matchScore: number;
  specificityScore: number; confidenceScore: number; evidenceCodes: NaverEvidenceCode[];
};
const specificCategoryRules = [
  [/육류|고기요리|숯불구이|갈비구이|불고기/, "grill"],
  [/국밥|해장국|순대국/, "gukbap-detail"],
  [/포장마차|대포집|소주방/, "pocha"],
  [/호프|펍|맥주|주점/, "pub"],
  [/베이커리|제과|제빵|빵/, "bakery-detail"],
  [/라멘/, "ramen-detail"],
  [/횟집|해산물|수산/, "seafood-dish"],
] as const;
const broadCategoryPattern = /(?:^|>)\s*(음식점|한식|양식|일식|중식|카페|주점)\s*(?:>|$)/;

function normalizedName(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/<[^>]+>/g, "").replace(/(?:[0-9]+호)?점$|본점$/g, "").replace(/[^0-9a-z가-힣]/g, "");
}
function normalizedAddress(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/(?:광주광역시|전라남도|전남|광주)/g, "").replace(/[^0-9a-z가-힣]/g, "");
}
function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number) {
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(bLat - aLat); const dLng = radians(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(aLat)) * Math.cos(radians(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}
function mapNaverCategory(category: string, terminalSlugs: Set<string>) {
  const hit = specificCategoryRules.find(([pattern, slug]) => pattern.test(category) && terminalSlugs.has(slug));
  return hit ? { slug: hit[1], specificity: 20 } : { slug: null, specificity: broadCategoryPattern.test(category) ? 0 : 0 };
}
function isInRequestedRegion(address: string, regionCode: "GWANGJU" | "JEONNAM") {
  return regionCode === "GWANGJU" ? /광주광역시|광주/.test(address) : /전라남도|전남/.test(address);
}
export function matchNaverLocalCategory(input: NaverMatchInput): NaverMatch {
  const inRegion = input.results.filter((result) => isInRequestedRegion(result.address, input.regionCode));
  if (input.results.length > 0 && inRegion.length === 0) return { status: "OUT_OF_SCOPE", mappedCategorySlug: null, matchScore: 0, specificityScore: 0, confidenceScore: 0, evidenceCodes: [] };
  const candidates = inRegion.map((result) => {
    const exactName = normalizedName(result.name) === normalizedName(input.businessName);
    const exactAddress = normalizedAddress(result.address) === normalizedAddress(input.address);
    const nearby = input.latitude != null && input.longitude != null && distanceMeters(input.latitude, input.longitude, result.latitude, result.longitude) <= 100;
    return { result, exactName, exactAddress, nearby, mapped: mapNaverCategory(result.category, input.terminalSlugs) };
  });
  const verified = candidates.filter((candidate) => candidate.exactName && (candidate.exactAddress || candidate.nearby));
  if (verified.length > 1) return { status: "AMBIGUOUS", mappedCategorySlug: null, matchScore: 0, specificityScore: 0, confidenceScore: 0, evidenceCodes: [] };
  if (verified.length === 1) {
    const hit = verified[0]; const evidenceCodes: NaverEvidenceCode[] = ["NAVER_EXACT_NAME", hit.exactAddress ? "NAVER_EXACT_ADDRESS" : "NAVER_COORDINATES_WITHIN_100M"];
    if (hit.mapped.slug) evidenceCodes.push("NAVER_SPECIFIC_CATEGORY"); else evidenceCodes.push("NAVER_BROAD_CATEGORY");
    return { status: "VERIFIED", mappedCategorySlug: hit.mapped.slug, matchScore: 40, specificityScore: hit.mapped.specificity, confidenceScore: 0, evidenceCodes };
  }
  if (candidates.some((candidate) => candidate.exactName)) return { status: "LIKELY", mappedCategorySlug: null, matchScore: 0, specificityScore: 0, confidenceScore: 0, evidenceCodes: [] };
  return { status: "NO_MATCH", mappedCategorySlug: null, matchScore: 0, specificityScore: 0, confidenceScore: 0, evidenceCodes: [] };
}
export function decideCategoryAuthority(input: {
  rule: CandidateClassification; subtypeSlug: string | null; nameSlug: string | null; ai: AiClassification | null; naver: NaverMatch | null;
}): CategoryAuthorityDecision {
  const fallback: CategoryAuthorityDecision = { categorySlug: input.rule.categorySlug, confidence: input.rule.confidence, confidenceScore: input.rule.confidenceScore, automatic: false, reasons: input.rule.reasons, naver: null };
  if (!input.naver || input.naver.status !== "VERIFIED" || !input.naver.mappedCategorySlug) return fallback;
  const naver = input.naver;
  const evidenceCodes = [...naver.evidenceCodes];
  if (input.subtypeSlug && input.subtypeSlug !== naver.mappedCategorySlug) return { ...fallback, confidence: "CONFLICT", automatic: false, reasons: ["NAVER 구체 카테고리와 원천 업태가 다름", ...fallback.reasons], naver: { ...naver, confidenceScore: input.rule.confidenceScore, evidenceCodes: [...evidenceCodes, "SOURCE_SUBTYPE_CONFLICT"] } };
  if (input.nameSlug && input.nameSlug !== naver.mappedCategorySlug && input.rule.categorySlug === input.nameSlug) return fallback;
  const subtypePoints = input.subtypeSlug === naver.mappedCategorySlug ? 20 : 0;
  const namePoints = input.nameSlug === naver.mappedCategorySlug ? 10 : 0;
  const aiPoints = input.ai?.categorySlug === naver.mappedCategorySlug ? 10 : 0;
  const confidenceScore = Math.min(100, naver.matchScore + naver.specificityScore + subtypePoints + namePoints + aiPoints);
  if (subtypePoints) evidenceCodes.push("SOURCE_SUBTYPE_MATCH"); if (namePoints) evidenceCodes.push("NAME_FOOD_MATCH"); if (aiPoints) evidenceCodes.push("AI_AGREES"); else if (input.ai) evidenceCodes.push("AI_DISAGREES");
  const confidence = confidenceScore >= 85 ? "HIGH" as const : confidenceScore >= 65 ? "MEDIUM" as const : confidenceScore >= 40 ? "LOW" as const : "LOW" as const;
  return { categorySlug: naver.mappedCategorySlug, confidence, confidenceScore, automatic: confidence === "HIGH", reasons: ["NAVER 상호·위치 검증", ...evidenceCodes], naver: { ...naver, confidenceScore, evidenceCodes } };
}
```

The complete implementation must make the following invariants explicit instead of inferring them from score alone:

```ts
if (naver.status === "VERIFIED" && naver.mappedCategorySlug && subtypeSlug && naver.mappedCategorySlug !== subtypeSlug) {
  return { categorySlug: rule.categorySlug, confidence: "CONFLICT", confidenceScore, automatic: false, reasons: ["NAVER 구체 카테고리와 원천 업태가 다름"], naver };
}
if (naver.status !== "VERIFIED" || !naver.mappedCategorySlug) return existingRuleDecision;
if (nameSlug && nameSlug !== naver.mappedCategorySlug && rule.categorySlug === nameSlug) return existingRuleDecision;
```

- [ ] **Step 4: AI policy only adds agreement points and cannot invalidate direct manual choice.**

```ts
export function reconcileAiClassification(input: {
  ruleSlug: string;
  ruleConfidence: ClassificationConfidence;
  ruleScore: number;
  ai: AiClassification | null;
  authoritativeCategorySlug?: string | null;
}) {
  if (!input.authoritativeCategorySlug) {
    return {
      categorySlug: input.ruleSlug,
      confidence: input.ruleConfidence,
      confidenceScore: input.ruleScore,
      eligible: input.ruleConfidence !== "CONFLICT",
      reasons: ["원천 업태·상호 규칙으로 분류"],
    };
  }
  if (input.ai && input.ai.categorySlug !== input.authoritativeCategorySlug) {
    return {
      categorySlug: input.authoritativeCategorySlug,
      confidence: "CONFLICT" as const,
      confidenceScore: input.ruleScore,
      eligible: false,
      reasons: ["확정 외부·원천 근거와 AI 분류 불일치"],
    };
  }
  return {
    categorySlug: input.authoritativeCategorySlug,
    confidence: input.ruleConfidence,
    confidenceScore: input.ruleScore,
    eligible: input.ruleConfidence !== "CONFLICT",
    reasons: ["확정 외부·원천 근거와 일치"],
  };
}
```

- [ ] **Step 5: 규칙 matrix를 실행한다.**

Run: `pnpm test -- tests/unit/naver-local-category.test.ts tests/unit/category-suggestion.test.ts tests/unit/ai-classification-policy.test.ts`

Expected: all cases PASS: exact address, coordinate within 100m, branch normalization, same-name collision, out-of-region, broad category, concrete conflict, AI agreement/disagreement.

- [ ] **Step 6: pure policy 변경을 커밋한다.**

```bash
git add app/features/candidates/naver-local-category.ts app/features/candidates/category-suggestion.ts app/features/candidates/ai-classification-policy.ts tests/unit/naver-local-category.test.ts
git commit -m "2026-08-15 NAVER 카테고리 근거 중재 규칙"
```

### Task 4: 재검증 서비스가 안전하게 preview·저장·apply하도록 만든다

**Files:**
- Create: `app/features/candidates/naver-category-reverification.server.ts`, `tests/integration/naver-category-reverification.server.test.ts`
- Modify: `app/features/candidates/category-reclassification.server.ts:1-250`, `app/features/candidates/bulk-review.server.ts:1-180`, `app/features/candidates/ai-classification.server.ts:1-180`

**Consumes:** Task 1 tables, Task 2 adapter, Task 3 pure decision. `places`와 `place_source_links`는 공개 장소의 원천 `business_license_id`를 찾는 용도로만 사용한다.

**Produces:** `previewNaverCategoryReverification`, `applyNaverCategoryReverification`, `listLatestNaverCategoryVerifications`. Task 5 route는 이 서비스만 호출한다.

- [ ] **Step 1: D1 integration test로 idempotency·degraded state·100개 상한을 먼저 작성한다.**

```ts
it("persists VERIFIED + HIGH preview metadata but changes no primary category", async () => {
  const fake = { search: vi.fn().mockResolvedValue([verifiedGrillResult]) };
  const preview = await previewNaverCategoryReverification(db, fake, { scope: "PUBLISHED", afterBusinessLicenseId: null, limit: 100, actorUserId: "admin", now });
  expect(preview).toMatchObject({ scanned: 1, verified: 1, changed: 1, applied: 0 });
  await expect(primarySlug("published-place")).resolves.toBe("home-meal");
  await expect(verificationFor(licenseId)).resolves.toMatchObject({ status: "VERIFIED", mappedCategoryId: "cat-grill", confidenceScore: 100 });
});

it("applies only VERIFIED + HIGH and records one forward-fix audit record", async () => {
  const result = await applyNaverCategoryReverification(db, fake, { scope: "PUBLISHED", afterBusinessLicenseId: null, limit: 100, actorUserId: "admin", now });
  expect(result).toMatchObject({ applied: 1, conflicts: 0 });
  await expect(primarySlug("published-place")).resolves.toBe("grill");
  await expect(auditActions("published-place")).resolves.toContain("APPLY_NAVER_CATEGORY_REVERIFICATION");
});

it("keeps the existing category and stores FAILED when quota is exhausted", async () => {
  const quotaFake = { search: vi.fn().mockRejectedValue(new NaverLocalSearchError("NAVER_LOCAL_SEARCH_QUOTA")) };
  const result = await previewNaverCategoryReverification(db, quotaFake, { scope: "PENDING", afterBusinessLicenseId: null, limit: 100, actorUserId: "admin", now });
  expect(result).toMatchObject({ failed: 1, changed: 0, applied: 0 });
  await expect(verificationFor(licenseId)).resolves.toMatchObject({ status: "FAILED", failureCode: "NAVER_LOCAL_SEARCH_QUOTA" });
});
```

- [ ] **Step 2: integration test를 실행해 service import 실패를 확인한다.**

Run: `pnpm run test:integration -- tests/integration/naver-category-reverification.server.test.ts`

Expected: FAIL with `Failed to resolve import`.

- [ ] **Step 3: service input/output과 candidate selection을 구현한다.**

```ts
export type NaverReverificationScope = "PENDING" | "PUBLISHED";
export type NaverReverificationResult = {
  scanned: number; verified: number; changed: number; conflicts: number; failed: number; applied: number;
  nextAfterBusinessLicenseId: string | null; runId: string;
};

export async function previewNaverCategoryReverification(
  db: AppDb, adapter: NaverLocalSearchAdapter,
  input: { scope: NaverReverificationScope; afterBusinessLicenseId: string | null; limit: number; actorUserId: string; now: string },
): Promise<NaverReverificationResult>;

export async function applyNaverCategoryReverification(
  db: AppDb, adapter: NaverLocalSearchAdapter,
  input: { scope: NaverReverificationScope; afterBusinessLicenseId: string | null; limit: number; actorUserId: string; now: string },
): Promise<NaverReverificationResult>;
```

Use one query whose scope is explicit:

```ts
const candidateWhere = input.scope === "PENDING"
  ? and(eq(businessLicenses.normalizedStatus, "OPEN"), eq(businessLicenses.reviewStatus, "PENDING"))
  : and(eq(places.status, "PUBLISHED"), eq(placeSourceLinks.isPrimary, true));
```

For every selected license, compute a SHA-256 fingerprint of normalized `businessName`, `roadAddress ?? lotAddress`, `latitude`, and `longitude`. If an existing `VERIFIED` row has the same fingerprint and `expiresAt > now`, reuse its stored minimal decision without calling NAVER. Never include the address or name in error strings, alert `detailsJson`, run `errorCode`, or audit fields.

- [ ] **Step 4: apply is a conditional batch and audit is a forward-fix record.**

```ts
await db.batch([
  db.update(placeCategories).set({ categoryId: decisionCategoryId }).where(and(
    eq(placeCategories.placeId, work.placeId), eq(placeCategories.categoryId, work.fromCategoryId), eq(placeCategories.isPrimary, true),
  )),
  db.insert(adminAuditLogs).values({
    id: crypto.randomUUID(), actorUserId: input.actorUserId, action: "APPLY_NAVER_CATEGORY_REVERIFICATION",
    targetType: "PLACE", targetId: work.placeId,
    beforeState: JSON.stringify({ categoryId: work.fromCategoryId, ruleVersion: work.ruleVersion }),
    afterState: JSON.stringify({ categoryId: decisionCategoryId, confidenceScore: work.confidenceScore, evidenceCodes: work.evidenceCodes }),
    createdAt: input.now,
  }),
]);
```

`MEDIUM`, `LOW`, `CONFLICT`, `FAILED`, `SKIPPED`, unlinked source, inactive category, no coordinate/address, and a conditional update that affected zero rows must increase review/skip counts rather than modify a category. A run writes status `COMPLETED`, `FAILED`, or `SKIPPED` only after its per-row work and counters are durable.

- [ ] **Step 5: consume stored verification in candidate review and AI classification without extra provider calls.**

```ts
const naver = latestNaverVerification.get(candidate.id) ?? null;
const combined = decideCategoryAuthority({
  rule: classification,
  subtypeSlug: getAuthoritativeSubtypeCategorySlug(ruleInput, classification),
  nameSlug: strongestNameFoodSlug(ruleInput),
  ai,
  naver: naver && verificationToAuthorityInput(naver, categoryById),
});
```

The candidate row must expose `naverStatus`, `naverConfidenceScore`, and safe `naverEvidenceCodes` only. It must not expose provider response data, query, raw category, or provider URL.

- [ ] **Step 6: run the focused D1 checks and commit.**

Run: `pnpm run test:integration -- tests/integration/naver-category-reverification.server.test.ts tests/integration/bulk-review.server.test.ts tests/integration/place-category-reclassification.server.test.ts && pnpm run typecheck`

Expected: all PASS and TypeScript exit code `0`.

```bash
git add app/features/candidates/naver-category-reverification.server.ts app/features/candidates/category-reclassification.server.ts app/features/candidates/bulk-review.server.ts app/features/candidates/ai-classification.server.ts tests/integration/naver-category-reverification.server.test.ts tests/integration/bulk-review.server.test.ts
git commit -m "2026-08-15 NAVER 분류 재검증 저장과 일괄 적용"
```

### Task 5: 관리자에게 상태·근거·항상 가능한 직접 수정을 제공한다

**Files:**
- Modify: `app/routes/admin-candidates.tsx:1-430`, `tests/e2e/admin-candidate-review.spec.ts`
- Test: `tests/integration/bulk-review.server.test.ts`, `tests/e2e/admin-candidate-review.spec.ts`

**Consumes:** Task 4의 `NaverReverificationResult`와 row fields `naverStatus`, `naverConfidenceScore`, `naverEvidenceCodes`.

**Produces:** 재검증 `PENDING/PUBLISHED` preview/apply control, `자동 적용 가능/관리자 확인/충돌/검색 실패/원천 없음` view, 모든 비차단 행의 직접 카테고리 select.

- [ ] **Step 1: user-visible contracts as browser tests를 추가한다.**

```ts
test("admin sees safe NAVER evidence and can override a high-confidence suggestion", async ({ page }) => {
  await page.goto("/admin/candidates?naver=auto");
  await expect(page.getByText("NAVER 상호·주소 일치", { exact: true })).toBeVisible();
  await expect(page.getByText("자동 적용 가능", { exact: true })).toBeVisible();
  const select = page.getByLabel("QA 신 돼지세끼 대표 카테고리");
  await expect(select).toBeEnabled();
  await select.selectOption("cat-home-meal");
  await page.getByRole("button", { name: "선택 장소 승인·공개" }).click();
  await expect(page.getByText("1곳 승인·공개 · 0곳 확인 필요")).toBeVisible();
  await expect(page.getByText(/openapi\.naver|X-Naver-Client|test-secret/i)).toHaveCount(0);
});

test("admin previews a published batch and cannot apply conflict rows by default", async ({ page }) => {
  await page.goto("/admin/candidates");
  await page.getByRole("button", { name: "공개 장소 100곳 NAVER 미리보기" }).click();
  await expect(page.getByText(/확인 1곳 · 카테고리 변경 1곳 · 충돌 1곳/)).toBeVisible();
  await expect(page.getByRole("button", { name: "NAVER 확정 변경 적용" })).toBeEnabled();
  await expect(page.getByText("충돌 · 관리자 확인 필요")).toBeVisible();
});
```

- [ ] **Step 2: red test를 실행한다.**

Run: `pnpm exec playwright test tests/e2e/admin-candidate-review.spec.ts --project=chromium --project=mobile-chromium`

Expected: FAIL because NAVER tabs, preview labels, and result fields are absent.

- [ ] **Step 3: loader/action intents and narrow tab parameters를 구현한다.**

```ts
const naverStates = ["AUTO", "REVIEW", "CONFLICT", "FAILED", "SOURCE_MISSING"] as const;
const naverView = naverStates.includes(url.searchParams.get("naver") as (typeof naverStates)[number])
  ? url.searchParams.get("naver") as (typeof naverStates)[number] : "";

if (intent === "naverPreview" || intent === "naverApply") {
  const scope = formData.get("scope") === "PENDING" ? "PENDING" : "PUBLISHED";
  const result = intent === "naverPreview"
    ? await previewNaverCategoryReverification(db, adapter, { scope, afterBusinessLicenseId, limit: 100, actorUserId: user.id, now })
    : await applyNaverCategoryReverification(db, adapter, { scope, afterBusinessLicenseId, limit: 100, actorUserId: user.id, now });
  return { intent, result };
}
```

Reject malformed `scope`, cursor, and `limit` with the existing generic safe admin error response. The UI must not claim that a preview changed data. It must say `NAVER 미리보기` or `NAVER 확정 변경 적용` based on the actual action result.

- [ ] **Step 4: render evidence without provider raw data and retain select accessibility.**

```tsx
<details className="mt-2 text-xs text-neutral-600">
  <summary className="cursor-pointer font-medium">분류 근거</summary>
  <ul className="mt-1 list-disc space-y-1 pl-4">
    {row.naverEvidenceCodes.map((code) => <li key={code}>{naverEvidenceLabel[code]}</li>)}
    {[...row.reasons, ...row.reviewReasons].map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}
  </ul>
</details>
<select aria-label={`${row.businessName} 대표 카테고리`} value={chosenCategories[row.id] ?? ""} onChange={onCategoryChange}>
  <option value="">직접 선택</option>
  {selectableCategoryOptions}
</select>
```

The `<select>` condition must remain `!blocked`; it must never test `row.confidence === "HIGH"`, `row.naverStatus === "VERIFIED"`, or `row.aiConfidence` to disable editing.

- [ ] **Step 5: desktop/mobile E2E and focused integration을 녹색으로 만든다.**

Run: `pnpm run test:integration -- tests/integration/bulk-review.server.test.ts && pnpm exec playwright test tests/e2e/admin-candidate-review.spec.ts --project=chromium --project=mobile-chromium`

Expected: all PASS. Capture one desktop and one mobile screenshot only if UI layout changes, then include them in the PR evidence rather than in application data.

- [ ] **Step 6: 관리자 UX 변경을 커밋한다.**

```bash
git add app/routes/admin-candidates.tsx tests/e2e/admin-candidate-review.spec.ts tests/integration/bulk-review.server.test.ts
git commit -m "2026-08-15 NAVER 분류 검수 UI와 직접 수정"
```

### Task 6: 운영 게이트·read-only rollout·forward-fix 절차를 문서와 검증으로 닫는다

**Files:**
- Create: `docs/operations/naver-local-category-runbook.md`
- Modify: `README.md:25-65`, `docs/superpowers/specs/2026-08-15-naver-category-authority-design.md:1-200`, `docs/superpowers/plans/2026-08-15-naver-category-authority.md`
- Test: `tests/integration/naver-category-reverification.server.test.ts`, `tests/e2e/admin-candidate-review.spec.ts`

**Consumes:** Tasks 1–5; COWORK PR-merge approval SSOT; Tech-stack governance external API gate.

**Produces:** an executable runbook, PR evidence checklist, rollout/rollback procedure. No automatic cron is added.

- [ ] **Step 1: runbook assertions를 test description과 manual checklist에 먼저 작성한다.**

```md
## 배포 전 차단 조건

- [ ] NAVER API Hub의 지역검색 API 이용 가능 상태와 약관상 `category` 응답의 단기 처리/보관 조건을 PR 링크로 기록했다.
- [ ] `NAVER_LOCAL_SEARCH_ENABLED=false` 상태에서 후보 검수·공개 장소 조회가 기존 규칙만으로 통과했다.
- [ ] `NAVER_LOCAL_SEARCH_DAILY_LIMIT=200`과 운영 콘솔의 일·월 quota/cost ceiling을 PR에 적었다.
- [ ] local fake unit/integration/E2E가 실제 NAVER 요청 없이 통과했다.
- [ ] production은 최초 100곳 `PREVIEW`만 실행하며, `APPLY`는 `VERIFIED + HIGH` 수와 audit 수가 일치할 때만 실행한다.
```

- [ ] **Step 2: runbook의 exact command sequence를 작성한다.**

```bash
# 1. 배포 전: secrets은 존재 여부만 확인하고 값은 출력하지 않는다.
pnpm exec wrangler secret list | rg 'NAVER_LOCAL_SEARCH_(CLIENT_ID|CLIENT_SECRET)'

# 2. 안전 기본값으로 배포한다.
pnpm exec wrangler deploy

# 3. 관리자에서 PUBLISHED 100곳 NAVER 미리보기를 한 번 실행한다.
# /admin/candidates → “공개 장소 100곳 NAVER 미리보기”

# 4. audit count와 화면 result count를 D1 read-only query로 대조한다.
pnpm exec wrangler d1 execute retaste-db --remote --command \
  "SELECT action, count(*) AS count FROM admin_audit_logs WHERE action='APPLY_NAVER_CATEGORY_REVERIFICATION' GROUP BY action"
```

The runbook must state that command 4 is read-only; no general remote SQL, unbounded reclassification, or secret value display is allowed. Replace `retaste-db` with the actual configured D1 binding name only after checking `wrangler.jsonc` in the implementation PR.

- [ ] **Step 3: document failure and rollback as a forward fix.**

```md
## 즉시 중단과 복구

1. 429, 5xx, timeout, category conflict, 또는 quota 이상 징후가 있으면 `NAVER_LOCAL_SEARCH_ENABLED=false`로 배포한다.
2. 기존 공공데이터·상호 규칙 기반 검수와 공개 목록은 계속 동작한다.
3. 잘못 적용된 카테고리는 해당 `APPLY_NAVER_CATEGORY_REVERIFICATION` audit의 `beforeState.categoryId`로만 관리자 forward-fix 한다. 적용 migration을 되돌리거나 공개 장소를 삭제하지 않는다.
4. 확인 대상·전후 category·actor·timestamp·근거 code를 새 audit 로그로 남긴다.
5. provider raw response나 검색어를 장애 티켓, Workers log, audit JSON에 복사하지 않는다.
```

- [ ] **Step 4: final verification matrix를 실행한다.**

Run: `pnpm test -- tests/unit/naver-local-search.test.ts tests/unit/naver-local-category.test.ts tests/unit/category-suggestion.test.ts tests/unit/ai-classification-policy.test.ts && pnpm run test:integration -- tests/integration/naver-local-category-migration.test.ts tests/integration/naver-category-reverification.server.test.ts tests/integration/bulk-review.server.test.ts tests/integration/place-category-reclassification.server.test.ts && pnpm exec playwright test tests/e2e/admin-candidate-review.spec.ts --project=chromium --project=mobile-chromium && pnpm run typecheck && pnpm run build && git diff --check`

Expected: all commands exit `0`; no test calls NAVER; desktop and mobile evidence is attached to the PR.

- [ ] **Step 5: PR body를 governance gate 형식으로 갱신한 뒤 최종 커밋한다.**

```md
## NAVER 지역검색 외부 API gate

- Decision: CONDITIONAL GO
- Owner: taejun-yun
- Data sent: 상호명·주소 일부·서비스 지역 코드, 서버에서만 전송
- Data retained: internal category decision·score·evidence code·timestamp only
- Quota/cost: 1회 100곳 이하, 일일 최대 200회, 운영 콘솔 상한 확인
- Failure: feature flag off → existing rule classifier only
- Rollback: audit `beforeState`로 관리자 forward-fix, migration rollback 없음
- Validation: fake unit/integration/E2E; production 100-place preview then verified-high apply only
```

```bash
git add README.md docs/operations/naver-local-category-runbook.md docs/superpowers/specs/2026-08-15-naver-category-authority-design.md docs/superpowers/plans/2026-08-15-naver-category-authority.md
git commit -m "2026-08-15 NAVER 지역검색 분류 운영 절차"
git push -u origin codex/naver-category-authority
```

## 구현 후 PR·배포 순서

1. 최신 `origin/main`을 feature branch에 반영하고 `git diff origin/main...HEAD`로 변경 범위를 리뷰한다.
2. PR #117을 draft에서 ready-for-review로 전환하고, 위 Task 6의 `CONDITIONAL GO` 증거·검증 출력·desktop/mobile screenshot·migration 0030·secret/flag/rollout/rollback을 명시한다.
3. CI와 사람 리뷰가 통과한 뒤 repository owner가 squash merge한다. PR merge가 이 범위의 구현·migration·제한된 preview/apply·배포에 대한 SSOT 승인이다.
4. merge 후 `origin/main`을 새 local main에 fast-forward하고, 지정된 운영자가 `NAVER_LOCAL_SEARCH_ENABLED=false`인 상태로 migration 포함 deploy를 수행한다.
5. 운영자가 quota 확인 후 `NAVER_LOCAL_SEARCH_ENABLED=true`로 배포하고, 관리자 PUBLISHED preview 100곳을 한 번 실행한다. 이때에는 적용하지 않는다.
6. preview의 `VERIFIED + HIGH` 변경 수와 audit preview/결과 수, `FAILED`/quota 수, `CONFLICT` 수를 대조하고, 확인된 최대 100곳만 apply한다.
7. 오류 또는 이상 분류가 보이면 kill switch를 끄고 audit 기반 forward-fix를 먼저 수행한다. 원격 migration rollback이나 공개 장소 삭제는 하지 않는다.

## 계획 자체 점검 기록

- **설계 범위 대조:** 검증 매칭, 우선순위, 점수, 관리자 직접 수정, 기존 장소·대기 후보 배치, 외부 API 실패, quota, privacy, kill switch, audit, preview/apply, 운영/rollback, desktop/mobile QA를 Task 1~6에 각각 배치했다.
- **의도적으로 제외한 범위:** 새 cron, 실시간 사용자 API 호출, raw NAVER 콘텐츠 저장, 별도 데이터베이스·cache·패키지, 자동 숨김/삭제는 어느 task에도 포함하지 않았다.
- **타입 일관성:** `NaverVerificationStatus`, `NaverCategoryVerification`, `CategoryAuthorityDecision`, `NaverLocalSearchAdapter`, `previewNaverCategoryReverification`, `applyNaverCategoryReverification`은 Task 1~5에서 같은 이름으로 사용한다.
- **운영 안전성:** 실제 secret값 확인/출력, 실제 NAVER 호출, remote D1 write, 배포는 이 계획 작성 범위에 포함하지 않는다.

## Execution record

- 2026-08-15: Tasks 1–6 were implemented on `codex/naver-category-authority` and PR #117 was used as the approval record.
- Public-place reclassification is limited to a 100-place admin preview/apply flow; there is no scheduled or user-request-time NAVER search.
- The default deployment keeps `NAVER_LOCAL_SEARCH_ENABLED=false`; operations enable it only for the reviewed preview/apply sequence in the runbook.
