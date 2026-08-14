# 음식점 판별 및 전체 카테고리 재분류 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 음식점이 아닌 후보를 정확히 제외하고, 원천 업태와 상호 근거를 사용해 대기 후보와 연결된 공개 장소를 안전하게 새 카테고리로 일괄 재분류한다.

**Architecture:** 순수 정책 함수가 먼저 음식점 적합성을 판별하고, 허용된 데이터만 등급형 카테고리 근거로 계산한다. 후보 수집·공개 조회·일괄 재분류 서비스는 이 정책을 공유하며, 공개 장소의 변경은 미리보기 후 작은 원자적 batch로 적용한다.

**Tech Stack:** TypeScript, React Router, Drizzle ORM, Cloudflare D1, Vitest Workers pool, Playwright.

## Global Constraints

- 새 패키지·외부 API·Cloudflare binding·cron을 추가하지 않는다.
- 적용된 migration은 수정하지 않고 새 `drizzle/0029_*.sql`만 추가한다.
- 자동 제외는 `OVERRIDDEN` 상태를 덮어쓰지 않는다.
- 공개 장소는 이 작업으로 삭제하거나 `HIDDEN`으로 바꾸지 않는다.
- 원격 D1 일괄 적용은 병합 PR에 범위·한도·rollback을 기록한 뒤에만 관리자 경로로 실행한다.
- 모든 변경은 `codex/tj-category-reclassification-v3`에서 커밋·PR로 `main`에 병합한다.

---

## 파일 구조

| 파일 | 책임 |
| --- | --- |
| `app/features/candidates/category-taxonomy.ts` | 근거 등급과 식육·숯불구이 세부 업태 규칙 |
| `app/features/candidates/category-suggestion.ts` | 등급 우선 분류·신뢰도·사람용 근거 생성 |
| `app/features/places/food-venue-policy.ts` | 편의점·PC방·공예 시설의 고정밀 음식점 적합성 판별 |
| `app/features/candidates/exclusion-policy.ts` | 유흥/체인/비음식 자동 제외 레코드 변환 |
| `app/features/candidates/candidate.server.ts` | 수집 시 자동 제외와 감사 로그 |
| `app/features/places/place.server.ts` | 공개 목록·지도·추천의 비음식/override 존중 필터 |
| `app/features/candidates/category-reclassification.server.ts` | source-backed 공개 장소의 미리보기·100개 단위 적용 |
| `app/routes/admin-candidates.tsx` | 제외 라벨과 일괄 재분류 미리보기·실행 UI |
| `drizzle/0029_auto_not_restaurant_exclusion.sql` | `NOT_RESTAURANT` 자동 사유를 보존하는 exclusion 테이블 전진 migration |
| `tests/unit/category-suggestion.test.ts` | 근거 등급과 충돌 회귀 |
| `tests/unit/food-venue-policy.test.ts` | 고정밀 비음식·음식 공방 경계 |
| `tests/integration/candidate.server.test.ts` | 자동 제외·override·migration 보존 |
| `tests/integration/place-category-reclassification.server.test.ts` | 미리보기·적용·idempotency·공개 필터 |
| `tests/e2e/admin-candidates.spec.ts` | 관리자 미리보기·적용 결과·모바일 QA |

### Task 1: 등급형 카테고리 근거

**Files:**
- Modify: `app/features/candidates/category-taxonomy.ts`
- Modify: `app/features/candidates/category-suggestion.ts`
- Test: `tests/unit/category-suggestion.test.ts`

**Consumes:** `PublicDataSource`, 기존 `CategoryRule`, `ClassificationConfidence`.

**Produces:** `classifyCandidate()`가 `evidenceTier`를 기준으로 정렬한 `CandidateClassification`과 등급이 포함된 `reasons`를 반환한다.

- [ ] **Step 1: 실패하는 세부 업태 테스트를 작성한다.**

```ts
it("routes 식육(숯불구이) to grill before the general restaurant default", () => {
  expect(classifyCandidate({
    sourceType: "GENERAL_RESTAURANT",
    businessSubtype: "식육(숯불구이)",
    businessName: "신 돼지세끼",
  })).toMatchObject({ categorySlug: "grill", confidence: "HIGH" });
});

it("keeps a specific seafood name over the grill subtype", () => {
  expect(classifyCandidate({
    sourceType: "GENERAL_RESTAURANT",
    businessSubtype: "식육(숯불구이)",
    businessName: "풍천장어구이",
  })).toMatchObject({ categorySlug: "seafood-dish", confidence: "HIGH" });
});
```

- [ ] **Step 2: 테스트가 기존 기본값 `home-meal` 실패를 보이는지 확인한다.**

Run: `pnpm test -- tests/unit/category-suggestion.test.ts`  
Expected: 첫 케이스가 `grill` 대신 `home-meal`로 실패한다.

- [ ] **Step 3: 규칙에 근거 등급을 추가하고 식육 업태를 등록한다.**

```ts
export type EvidenceTier = 1 | 2 | 3 | 4 | 5;

export type CategoryRule = {
  // existing fields
  evidenceTier?: EvidenceTier;
};

{ pattern: /식육\s*\(?\s*숯불구이\s*\)?|숯불구이|석쇠구이|고기구이|불고기|갈비|정육식당/,
  slug: "grill", group: "korean", label: "원천 업태의 식육·숯불구이 표현",
  kind: "FOOD", evidenceTier: 2, priority: 20 },
```

`category-suggestion.ts`에서 상호의 구체 음식 식별 규칙은 tier 1, 위 세부 업태는 tier 2, 넓은 업태는 tier 4, source default는 tier 5로 만들고 `tier ASC → score DESC`로 정렬한다. tier 5만 있는 결과의 confidence는 반드시 `LOW`로 유지한다.

- [ ] **Step 4: 단위 테스트를 통과시키고 기존 장어·해산물·경양식 회귀를 확인한다.**

Run: `pnpm test -- tests/unit/category-suggestion.test.ts tests/unit/candidate-auto-classification.test.ts`  
Expected: PASS.

- [ ] **Step 5: 커밋한다.**

```bash
git add app/features/candidates/category-taxonomy.ts app/features/candidates/category-suggestion.ts tests/unit/category-suggestion.test.ts
git commit -m "2026-08-14 업태 우선 카테고리 분류"
```

### Task 2: 비음식 자동 제외와 forward migration

**Files:**
- Create: `drizzle/0029_auto_not_restaurant_exclusion.sql`
- Modify: `app/db/schema.ts`
- Modify: `app/features/places/food-venue-policy.ts`
- Modify: `app/features/candidates/exclusion-policy.ts`
- Modify: `app/features/candidates/candidate.server.ts`
- Test: `tests/unit/food-venue-policy.test.ts`
- Test: `tests/integration/candidate.server.test.ts`

**Consumes:** Task 1의 음식 신호 판별과 기존 active/overridden exclusion 상태.

**Produces:** `AutomaticExclusion.reason`이 `NOT_RESTAURANT`를 표현하며, 수집 단계에서 고정밀 비음식 후보가 자동 제외된다.

- [ ] **Step 1: 실패하는 음식점 적합성 테스트를 작성한다.**

```ts
it.each(["GS25 충장로점", "CU 광주상무점", "세븐일레븐 금남점", "동명 PC방", "도예공방 물레"])(
  "excludes non-food venue %s", (businessName) => {
    expect(classifyFoodVenue({ businessName, businessSubtype: "일반음식점" }))
      .toMatchObject({ decision: "EXCLUDE", category: "NOT_RESTAURANT" });
  },
);

it("allows food-named workshop", () => {
  expect(classifyFoodVenue({ businessName: "마라공방", businessSubtype: "일반음식점" }))
    .toMatchObject({ decision: "ALLOW" });
});
```

- [ ] **Step 2: 테스트가 새 정책 함수 부재로 실패하는지 확인한다.**

Run: `pnpm test -- tests/unit/food-venue-policy.test.ts`  
Expected: FAIL with import or policy mismatch.

- [ ] **Step 3: 고정밀 정책과 schema migration을 구현한다.**

`food-venue-policy.ts`는 아래 형태의 결과를 반환한다.

```ts
export type FoodVenueDecision =
  | { decision: "ALLOW" }
  | { decision: "MANUAL_REVIEW"; matchedRule: string }
  | { decision: "EXCLUDE"; category: "ADULT_ENTERTAINMENT" | "NOT_RESTAURANT"; matchedRule: string; matchMethod: string; confidence: number };
```

편의점은 정규화된 상호 접두사로만, PC방은 `pc방|피시방|피씨방|pccafe`로, 공예 시설은 `도예|목공|가죽|캔들|꽃|미술|공예`와 `공방|작업실`의 조합으로 판정한다. 음식 tier 1 또는 tier 2 신호가 있으면 공방 단독·공예 표현은 `ALLOW`로 둔다.

`0029_auto_not_restaurant_exclusion.sql`은 기존 테이블을 legacy 이름으로 교체한 뒤 `reason CHECK`에 `NOT_RESTAURANT`를 더한 동일 스키마를 만들고 모든 열을 그대로 복사한다. 새 migration은 절대 기존 0013을 수정하지 않는다.

`candidate.server.ts`의 audit action은 다음과 같이 분기한다.

```ts
const actionByReason = {
  CHAIN_STORE: "AUTO_EXCLUDE_CHAIN_STORE",
  ADULT_ENTERTAINMENT: "AUTO_EXCLUDE_ADULT_ENTERTAINMENT",
  NOT_RESTAURANT: "AUTO_EXCLUDE_NOT_RESTAURANT",
} as const;
```

- [ ] **Step 4: migration 보존, 후보 제외, `OVERRIDDEN` 무보호 회귀를 확인한다.**

Run: `pnpm run test:integration -- tests/integration/candidate.server.test.ts`  
Expected: PASS; CU/PC방은 pending 목록에 없고 `마라공방`은 남으며, 복원 후보는 재동기화해도 제외되지 않는다.

- [ ] **Step 5: 커밋한다.**

```bash
git add drizzle/0029_auto_not_restaurant_exclusion.sql app/db/schema.ts app/features/places/food-venue-policy.ts app/features/candidates/exclusion-policy.ts app/features/candidates/candidate.server.ts tests/unit/food-venue-policy.test.ts tests/integration/candidate.server.test.ts
git commit -m "2026-08-14 비음식 시설 자동 제외"
```

### Task 3: 공개 조회 필터와 재분류 서비스

**Files:**
- Create: `app/features/candidates/category-reclassification.server.ts`
- Modify: `app/features/places/place.server.ts`
- Test: `tests/integration/place-category-reclassification.server.test.ts`
- Test: `tests/integration/place.server.test.ts`

**Consumes:** Task 1 `classifyCandidate`, Task 2 `classifyFoodVenue`, `places`, `placeCategories`, `placeSourceLinks`, `businessLicenseExclusions`.

**Produces:** `previewCategoryReclassification`과 `applyCategoryReclassification`이 100개 이하 cursor batch에서 같은 결정 목록을 사용한다.

- [ ] **Step 1: 공개 장소 재분류와 public filter의 실패 테스트를 작성한다.**

```ts
const preview = await previewCategoryReclassification(db, { afterPlaceId: null, limit: 100 });
expect(preview.changes).toEqual(expect.arrayContaining([
  expect.objectContaining({ placeId: grillPlaceId, fromSlug: "home-meal", toSlug: "grill", decision: "CHANGE" }),
]));

await applyCategoryReclassification(db, { actorUserId: adminId, afterPlaceId: null, limit: 100, now });
expect(await primarySlug(db, grillPlaceId)).toBe("grill");
expect((await listPlaces(db)).map((place) => place.id)).not.toContain(pcBangPlaceId);
```

- [ ] **Step 2: 테스트가 새 service 부재와 기존 공개 노출로 실패하는지 확인한다.**

Run: `pnpm run test:integration -- tests/integration/place-category-reclassification.server.test.ts tests/integration/place.server.test.ts`  
Expected: FAIL with missing service and PC방/편의점 public visibility.

- [ ] **Step 3: 100개 cursor batch를 구현한다.**

```ts
export type ReclassificationPage = {
  scanned: number;
  changed: number;
  excluded: number;
  conflicts: number;
  nextAfterPlaceId: string | null;
  changes: Array<{ placeId: string; fromSlug: string; toSlug: string; decision: "CHANGE" | "KEEP" | "EXCLUDE" | "CONFLICT"; reason: string }>;
};

export async function previewCategoryReclassification(db: AppDb, input: { afterPlaceId: string | null; limit: number }): Promise<ReclassificationPage>;
export async function applyCategoryReclassification(db: AppDb, input: { actorUserId: string; afterPlaceId: string | null; limit: number; now: string }): Promise<ReclassificationPage>;
```

`limit`은 `1..100`만 허용한다. 적용 시 새 terminal category 행이 이미 있으면 해당 행을 primary로 올리고 이전 primary를 내린다. 없으면 이전 primary 행의 category id를 변경한다. 변경이 없으면 write/audit를 만들지 않는다. 각 변경은 `admin_audit_logs`에 `RECLASSIFY_PLACE_CATEGORY`와 `oldSlug→newSlug`를 남긴다.

`place.server.ts`의 public predicate는 원천의 `EXCLUDE`를 찾되 active `OVERRIDDEN` exclusion이 있으면 제외하지 않는다. 이 predicate는 list, detail, redirect, recommendation candidate와 category count에서 공통으로 쓴다.

- [ ] **Step 4: 적용 idempotency, override 복원, 101개 cursor 경계를 검증한다.**

Run: `pnpm run test:integration -- tests/integration/place-category-reclassification.server.test.ts tests/integration/place.server.test.ts`  
Expected: PASS; 두 번째 apply는 `changed: 0`, override 장소는 public 결과에 존재, 101개는 두 페이지로 정확히 처리된다.

- [ ] **Step 5: 커밋한다.**

```bash
git add app/features/candidates/category-reclassification.server.ts app/features/places/place.server.ts tests/integration/place-category-reclassification.server.test.ts tests/integration/place.server.test.ts
git commit -m "2026-08-14 전체 장소 카테고리 재분류"
```

### Task 4: 관리자 실행 경험과 품질 게이트

**Files:**
- Modify: `app/routes/admin-candidates.tsx`
- Modify: `app/app.css`
- Test: `tests/e2e/admin-candidates.spec.ts`
- Test: `tests/unit/category-audit.test.ts`

**Consumes:** Task 2 automatic exclusion labels and Task 3 preview/apply page result.

**Produces:** 관리자가 미리보기 후 100개 단위로 적용하고 결과/다음 처리 상태를 확인할 수 있다.

- [ ] **Step 1: 관리자 UI 실패 E2E를 작성한다.**

```ts
await page.getByRole("button", { name: "새 규칙 미리보기" }).click();
await expect(page.getByText("고기·구이로 변경 예정")).toBeVisible();
await expect(page.getByText("편의점 자동 제외")).toBeVisible();
await page.getByRole("button", { name: "100곳 적용" }).click();
await expect(page.getByText(/처리됨 .* 변경됨/)).toBeVisible();
```

- [ ] **Step 2: E2E가 필요한 버튼과 결과 영역 부재로 실패하는지 확인한다.**

Run: `pnpm run test:e2e -- tests/e2e/admin-candidates.spec.ts`  
Expected: FAIL with missing preview/apply controls.

- [ ] **Step 3: 관리자 화면을 구현한다.**

`admin-candidates.tsx` action에 `intent=reclassify-preview|reclassify-apply`를 추가한다. `reclassify-apply`는 서버가 반환한 `nextAfterPlaceId`를 hidden input으로 이어 받아 반복 처리한다. `NOT_RESTAURANT` 행의 상태는 `비음식 시설 자동 제외`로, `ADULT_ENTERTAINMENT`는 `유흥업종 자동 제외`로 구분한다. 버튼은 pending 동안 disabled와 `처리 중` 문구를 노출한다.

- [ ] **Step 4: 데스크톱/모바일 E2E와 전체 핵심 회귀를 실행한다.**

Run: `pnpm test -- tests/unit/category-suggestion.test.ts tests/unit/food-venue-policy.test.ts tests/unit/category-audit.test.ts`  
Expected: PASS.

Run: `pnpm run test:integration -- tests/integration/candidate.server.test.ts tests/integration/place-category-reclassification.server.test.ts tests/integration/place.server.test.ts`  
Expected: PASS.

Run: `pnpm run test:e2e -- tests/e2e/admin-candidates.spec.ts`  
Expected: desktop and mobile PASS.

Run: `pnpm run typecheck && pnpm run build && git diff --check`  
Expected: all exit 0.

- [ ] **Step 5: 커밋한다.**

```bash
git add app/routes/admin-candidates.tsx app/app.css tests/e2e/admin-candidates.spec.ts tests/unit/category-audit.test.ts
git commit -m "2026-08-14 관리자 재분류 실행 화면"
```

### Task 5: PR·운영 적용

**Files:**
- Modify: `docs/operations/place-operations-runbook.md`

**Consumes:** Tasks 1–4 and `drizzle/0029_auto_not_restaurant_exclusion.sql`.

**Produces:** 병합 PR에 migration·일괄 적용·rollback이 명시되고 운영자가 안전하게 전체 처리를 시작할 수 있다.

- [ ] **Step 1: runbook에 실제 적용 순서를 작성한다.**

```md
1. 새 Worker와 migration 0029를 배포한다.
2. 관리자 후보 화면에서 미리보기 수치(변경/제외/충돌)를 기록한다.
3. `100곳 적용`을 next cursor가 없어질 때까지 실행한다.
4. 변경 수와 제외 수를 감사 로그에서 대조한다.
5. 거짓 양성은 후보 제외 복원 또는 category audit의 이전 slug로 forward-fix 한다.
```

- [ ] **Step 2: PR 설명에 운영 범위와 rollback을 기록한다.**

PR에는 `0029` migration, 대상이 `OPEN PENDING` 후보와 source-backed `PUBLISHED` 장소임, 100개 batch, 공개 장소 삭제 없음, 외부 호출 없음, manual forward-fix 절차를 명시한다.

- [ ] **Step 3: 변경 파일을 모두 검토하고 PR용 커밋을 만든다.**

```bash
git diff --check
git status --short
git add docs/operations/place-operations-runbook.md
git commit -m "2026-08-14 재분류 운영 절차"
git push -u origin codex/tj-category-reclassification-v3
```

## Self-Review

1. 스펙의 식육·숯불구이, 구체 메뉴 우선, 편의점·PC방·공예 시설, 공방 거짓 양성 방지, candidate/public 일괄 범위, override, 감사·rollback 요구는 Tasks 1–5에 각각 연결했다.
2. 이 문서에는 구현을 미루거나 세부 내용을 비워 둔 표기가 없다.
3. Task 1의 `classifyCandidate`, Task 2의 `classifyFoodVenue`, Task 3의 preview/apply 반환 계약을 뒤 Task들이 같은 이름과 타입으로 사용한다.

## Execution Handoff

사용자 요청에 따라 이 계획은 현재 세션에서 inline으로 실행한다. 각 task는 RED → GREEN → 검증 → 커밋 순서로 진행하며, 모든 변경은 feature branch PR을 통해서만 `main`에 병합한다.
