# NAVER 근거 워크벤치 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Workers AI와 그 이력을 제거하고, NAVER API HUB 근거로 자동·수동 후보 검증과 근거 중심 관리자 검수를 제공한다.

**Architecture:** NAVER 지역검색은 서버 전용 adapter 하나로 API HUB 계약을 캡슐화한다. 후보·공개 장소는 공통 검증 규칙을 사용하지만, 후보 검수 화면은 `PENDING` 범위의 최대 25건만 자동 또는 수동으로 요청한다. route는 action/loader를 조합하고, 응답 원문·장소 ID는 D1과 브라우저에 보내지 않는다.

**Tech Stack:** React Router 8 Framework Mode, React 19, TypeScript 7, Cloudflare Workers/D1, Drizzle ORM, NAVER API HUB 지역검색, Vitest, Playwright, Tailwind 4와 기존 디자인 토큰.

## Global Constraints

- 새 패키지, Queue, Durable Object, 외부 DB, UI kit, CSS framework를 추가하지 않는다.
- 실제 NAVER 호출은 local/CI에서 금지하고 fake adapter만 사용한다.
- API URL은 `https://naverapihub.apigw.ntruss.com/search/v1/local`, 인증 헤더는 `X-NCP-APIGW-API-KEY-ID`와 `X-NCP-APIGW-API-KEY`다.
- 자동/수동 검증은 1회 최대 25개 외부 요청으로 제한한다.
- 4xx와 429는 batch를 즉시 중단하고, timeout·5xx·network는 해당 행만 실패로 저장한다.
- `ai_classification_runs`의 과거 이력은 새 D1 migration으로 삭제한다. 적용된 migration은 수정하지 않는다.
- UI는 `app/styles/design-system.css` 토큰, 760px 모바일 기준, 44px 모바일 조작 영역을 따른다.

---

## File structure

| 파일 | 책임 |
| --- | --- |
| `drizzle/0031_remove_workers_ai.sql` | AI 이력 drop 및 AI alert enum을 제거한 `operational_alerts` rebuild |
| `app/features/candidates/naver-local-search.server.ts` | NAVER API HUB request/response/error contract |
| `app/features/candidates/naver-candidate-verification.server.ts` | PENDING 후보 25건의 cached/forced NAVER 검증 |
| `app/features/candidates/bulk-review.server.ts` | AI 없이 rule + stored NAVER evidence로 검수 행 생성 |
| `app/routes/admin-candidates.tsx` | 근거 워크벤치 loader/action 조합 |
| `app/features/candidates/candidate-evidence-ui.tsx` | 근거 체인·상태 레일·필터·선택 작업대 UI |

### Task 1: D1과 schema에서 Workers AI 이력 제거

**Files:**

- Create: `drizzle/0031_remove_workers_ai.sql`
- Modify: `app/db/schema.ts:785-797`
- Modify: `tests/integration/naver-local-category-migration.test.ts`
- Modify: `tests/unit/schema-contract.test.ts`

**Consumes:** `0007_ai_operations.sql`, `0008_ai_usage_quota.sql`.

**Produces:** `aiClassificationRuns` export가 없고 `operationalAlerts.alertType`이 `PUBLIC_DATA_SYNC | RATING_RECOMPUTE | NAVER_LOCAL_SEARCH`만 허용한다.

- [ ] **Step 1: failing migration contract test를 작성한다.**

```ts
it("removes Workers AI history and alert type", async () => {
  await expect(env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_classification_runs'").first())
    .resolves.toBeNull();
  await expect(env.DB.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='operational_alerts'").first<{ sql: string }>())
    .resolves.toMatchObject({ sql: expect.not.stringContaining("AI_CLASSIFICATION") });
});
```

- [ ] **Step 2: RED를 확인한다.**

Run: `pnpm run test:integration -- tests/integration/naver-local-category-migration.test.ts`

Expected: FAIL — AI table와 alert type이 아직 존재한다.

- [ ] **Step 3: forward-only migration과 Drizzle schema 제거를 구현한다.**

```sql
DROP TABLE ai_classification_runs;
CREATE TABLE operational_alerts_next (
  id TEXT PRIMARY KEY NOT NULL,
  alert_type TEXT NOT NULL CHECK(alert_type IN ('PUBLIC_DATA_SYNC','RATING_RECOMPUTE','NAVER_LOCAL_SEARCH')),
  severity TEXT NOT NULL CHECK(severity IN ('WARNING','ERROR')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','RESOLVED')),
  source_id TEXT, message TEXT NOT NULL, details_json TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  first_occurred_at TEXT NOT NULL, last_occurred_at TEXT NOT NULL,
  resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TEXT, resolution_note TEXT
);
INSERT INTO operational_alerts_next SELECT * FROM operational_alerts WHERE alert_type <> 'AI_CLASSIFICATION';
DROP TABLE operational_alerts;
ALTER TABLE operational_alerts_next RENAME TO operational_alerts;
CREATE INDEX operational_alerts_status_last_idx ON operational_alerts(status, last_occurred_at);
```

Remove the `aiClassificationRuns` declaration and narrow the `alertType` union in `schema.ts`.

- [ ] **Step 4: GREEN을 확인한다.**

Run: `pnpm run test:integration -- tests/integration/naver-local-category-migration.test.ts && pnpm test -- tests/unit/schema-contract.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit한다.**

```bash
git add drizzle/0031_remove_workers_ai.sql app/db/schema.ts tests/integration/naver-local-category-migration.test.ts tests/unit/schema-contract.test.ts
git commit -m "2026-08-15 Workers AI 이력 제거"
```

### Task 2: Workers AI runtime·binding·지표를 제거한다

**Files:**

- Delete: `app/features/candidates/ai-classification.server.ts`
- Delete: `app/features/candidates/ai-classification-policy.ts`
- Delete: `app/features/candidates/ai-usage-policy.ts`
- Delete: `app/features/candidates/scheduled-ai.server.ts`
- Delete: `tests/integration/ai-classification.server.test.ts`
- Delete: `tests/unit/ai-classification-policy.test.ts`
- Delete: `tests/unit/ai-usage-policy.test.ts`
- Modify: `workers/app.ts`, `wrangler.jsonc`, `app/cloudflare-env.d.ts`
- Modify: `app/features/candidates/naver-local-category.ts`, `app/features/candidates/bulk-review.server.ts`, `app/routes/admin-candidates.tsx`
- Delete: `app/features/candidates/auto-classification-trigger.ts` and `tests/unit/auto-classification-trigger.test.ts`
- Modify: `app/features/operations/alerts.server.ts`, `app/features/operations/dashboard.server.ts`, `app/routes/admin-operations.tsx`
- Modify: AI imports/fixtures returned by `rg`

**Consumes:** Task 1 schema.

**Produces:** no `AI: Ai` binding, no scheduled AI subrequest, no AI dashboard field, and no AI type/import remains in the candidate authority path.

- [ ] **Step 1: Worker/config source-contract의 failing assertion을 추가한다.**

```ts
it("does not retain a Workers AI binding or schedule", () => {
  expect(readFileSync("workers/app.ts", "utf8")).not.toContain("runScheduledAiClassification");
  expect(readFileSync("wrangler.jsonc", "utf8")).not.toMatch(/"ai"\s*:/);
  expect(readFileSync("app/cloudflare-env.d.ts", "utf8")).not.toContain("AI: Ai");
});
```

- [ ] **Step 2: RED를 확인한다.**

Run: `pnpm test -- tests/unit/schema-contract.test.ts`

Expected: FAIL — current Worker imports the scheduled AI service and config declares `ai`.

- [ ] **Step 3: AI files와 consumers를 제거한다.**

```ts
// workers/app.ts
ctx.waitUntil(Promise.all([
  runScheduledCandidateSync(env),
  runScheduledRatingMaintenance(env),
  runScheduledPlaceMaintenance(env),
  runScheduledParkingSync(env),
  runScheduledOnboardingDataLifecycle(env),
]));

// alerts.server parameter
alertType: "PUBLIC_DATA_SYNC" | "RATING_RECOMPUTE" | "NAVER_LOCAL_SEARCH";
```

Operation dashboard copy must no longer claim to show AI metrics. Task 4 will add NAVER verification counts.

- [ ] **Step 4: scan and tests pass.**

Run: `rg -n 'aiClassificationRuns|AI_CLASSIFICATION|env\\.AI|runScheduledAiClassification|Workers AI' app workers tests wrangler.jsonc`

Expected: no runtime/test/config results.

Run: `pnpm test -- tests/unit/schema-contract.test.ts tests/unit/onboarding-lifecycle-contract.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit한다.**

```bash
git add -A app/features/candidates app/features/operations app/routes/admin-operations.tsx workers/app.ts wrangler.jsonc app/cloudflare-env.d.ts tests
git commit -m "2026-08-15 Workers AI 실행 경로 제거"
```

Before deleting the modules, remove `AiClassification` from `decideCategoryAuthority`, remove the `AI_AGREES`/`AI_DISAGREES` branches and evidence codes, and remove `aiClassificationRuns` lookup/reconciliation from `bulk-review.server.ts`. In `admin-candidates.tsx`, remove `runAi`, `aiQuota`, the AI `useEffect`, auto-classify URL handling, and `getAiClassificationBadge`; preserve the existing non-AI list layout until Task 6 replaces it.

### Task 3: NAVER API HUB adapter와 오류 코드를 구현한다

**Files:**

- Modify: `app/features/candidates/naver-local-search.server.ts`
- Modify: `tests/unit/naver-local-search.test.ts`
- Modify: `app/features/operations/alerts.server.ts`

**Consumes:** existing `NaverLocalSearchAdapter` interface.

**Produces:** `NAVER_LOCAL_SEARCH_AUTH | QUOTA | REQUEST | UNAVAILABLE | TIMEOUT | RESPONSE_INVALID` safe errors.

- [ ] **Step 1: API HUB URL/headers를 기대하는 failing test를 추가한다.**

```ts
expect(url.origin + url.pathname).toBe("https://naverapihub.apigw.ntruss.com/search/v1/local");
expect(headers.get("X-NCP-APIGW-API-KEY-ID")).toBe("test-client-id");
expect(headers.get("X-NCP-APIGW-API-KEY")).toBe("test-client-secret");
expect(headers.get("X-Naver-Client-Id")).toBeNull();
```

- [ ] **Step 2: RED를 확인한다.**

Run: `pnpm test -- tests/unit/naver-local-search.test.ts`

Expected: FAIL — adapter targets `openapi.naver.com` with legacy headers.

- [ ] **Step 3: minimal API HUB adapter를 구현한다.**

```ts
const NAVER_LOCAL_SEARCH_URL = "https://naverapihub.apigw.ntruss.com/search/v1/local";
headers: {
  "X-NCP-APIGW-API-KEY-ID": env.NAVER_LOCAL_SEARCH_CLIENT_ID,
  "X-NCP-APIGW-API-KEY": env.NAVER_LOCAL_SEARCH_CLIENT_SECRET,
}
function httpError(status: number) {
  if (status === 401 || status === 403) return new NaverLocalSearchError("NAVER_LOCAL_SEARCH_AUTH");
  if (status === 429) return new NaverLocalSearchError("NAVER_LOCAL_SEARCH_QUOTA");
  if (status >= 500 && status <= 599) return new NaverLocalSearchError("NAVER_LOCAL_SEARCH_UNAVAILABLE", true);
  return new NaverLocalSearchError("NAVER_LOCAL_SEARCH_REQUEST");
}
```

Retain only name/category/address/map coordinates; retain the existing WGS84 `mapx/mapy / 10_000_000` conversion.

- [ ] **Step 4: mapping test cases pass.**

Run: `pnpm test -- tests/unit/naver-local-search.test.ts`

Expected: PASS for 401/403, 429, 5xx, malformed response, timeout, and coordinate projection.

- [ ] **Step 5: Commit한다.**

```bash
git add app/features/candidates/naver-local-search.server.ts tests/unit/naver-local-search.test.ts app/features/operations/alerts.server.ts
git commit -m "2026-08-15 NAVER API HUB 지역검색 전환"
```

### Task 4: PENDING 후보의 자동·수동 NAVER 검증 service를 만든다

**Files:**

- Create: `app/features/candidates/naver-candidate-verification.server.ts`
- Modify: `app/features/candidates/naver-category-reverification.server.ts`
- Modify: `app/features/candidates/scheduled-sync.server.ts`
- Modify: `app/features/candidates/naver-local-category.ts`
- Create: `tests/integration/naver-candidate-verification.server.test.ts`
- Modify: `tests/unit/naver-local-category.test.ts`

**Consumes:** Task 3 adapter and existing safe verification cache.

**Produces:**

```ts
export const NAVER_CANDIDATE_BATCH_LIMIT = 25;
export type NaverCandidateVerificationResult = {
  processed: number; verified: number; needsReview: number; failed: number; apiCalls: number;
  stoppedCode: "NAVER_LOCAL_SEARCH_AUTH" | "NAVER_LOCAL_SEARCH_QUOTA" | "NAVER_LOCAL_SEARCH_REQUEST" | null;
};
export async function verifyPendingCandidatesWithNaver(
  db: AppDb,
  input: { candidateIds?: string[]; now: string; adapter: NaverLocalSearchAdapter; force?: boolean },
): Promise<NaverCandidateVerificationResult>;
```

- [ ] **Step 1: three failing integration cases를 작성한다.**

```ts
it("verifies at most 25 newly synced pending candidates", async () => {
  const result = await verifyPendingCandidatesWithNaver(db, { now, adapter });
  expect(result.processed).toBe(25);
  expect(adapter.search).toHaveBeenCalledTimes(25);
});
it("stops after an auth rejection", async () => {
  adapter.search.mockRejectedValueOnce(new NaverLocalSearchError("NAVER_LOCAL_SEARCH_AUTH"));
  await expect(verifyPendingCandidatesWithNaver(db, { now, adapter })).resolves.toMatchObject({ apiCalls: 1, stoppedCode: "NAVER_LOCAL_SEARCH_AUTH" });
});
it("refreshes forced selected candidate but reuses the 90-day verified cache", async () => {
  await verifyPendingCandidatesWithNaver(db, { now, adapter });
  await verifyPendingCandidatesWithNaver(db, { now: later, adapter, candidateIds: [candidateId], force: true });
  expect(adapter.search).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: RED를 확인한다.**

Run: `pnpm run test:integration -- tests/integration/naver-candidate-verification.server.test.ts`

Expected: FAIL — module/export does not exist.

- [ ] **Step 3: shared safe persistence를 추출하고 PENDING service를 구현한다.**

```ts
const stopCodes = new Set(["NAVER_LOCAL_SEARCH_AUTH", "NAVER_LOCAL_SEARCH_QUOTA", "NAVER_LOCAL_SEARCH_REQUEST"]);
for (const candidate of candidates.slice(0, NAVER_CANDIDATE_BATCH_LIMIT)) {
  try {
    const results = await input.adapter.search({ businessName: candidate.businessName, address: candidate.address, regionCode: candidate.regionCode });
    // matchNaverLocalCategory and persist only internal evidence summary
  } catch (error) {
    const code = failureCode(error);
    if (stopCodes.has(code)) return { ...result, stoppedCode: code };
    // persist FAILED for this candidate and continue
  }
}
```

Filter candidates by `OPEN`, `PENDING`, and no active exclusion. Invoke this service after `syncPublicDataBatch` resolves; catch at scheduler boundary so NAVER failure cannot alter sync completion.

- [ ] **Step 4: evidence/score regressions pass.**

Run: `pnpm test -- tests/unit/naver-local-category.test.ts && pnpm run test:integration -- tests/integration/naver-candidate-verification.server.test.ts tests/integration/naver-category-reverification.server.test.ts`

Expected: PASS; exact name + address/100m + specific category + source subtype is eligible while broad category and conflict remain manual.

- [ ] **Step 5: Commit한다.**

```bash
git add app/features/candidates/naver-candidate-verification.server.ts app/features/candidates/naver-category-reverification.server.ts app/features/candidates/scheduled-sync.server.ts app/features/candidates/naver-local-category.ts tests/integration/naver-candidate-verification.server.test.ts tests/integration/naver-category-reverification.server.test.ts tests/unit/naver-local-category.test.ts
git commit -m "2026-08-15 NAVER 후보 근거 검증 추가"
```

### Task 5: 후보 상태 model을 NAVER 근거 중심으로 바꾼다

**Files:**

- Modify: `app/features/candidates/bulk-review.server.ts`
- Modify: `app/features/candidates/review-classification.ts`
- Modify: `tests/integration/bulk-review.server.test.ts`
- Modify: `tests/unit/candidate-review-state.test.ts`

**Consumes:** Task 4 verification records.

**Produces:** `classificationSource` values `NAVER_RULE | RULE_ONLY | NAVER_FAILED`, plus safe `naverEvidence`; no `aiConfidence`.

- [ ] **Step 1: failing row-state tests를 작성한다.**

```ts
expect(row).toMatchObject({
  classificationSource: "NAVER_RULE",
  naverEvidence: { status: "VERIFIED", evidenceCodes: expect.arrayContaining(["NAVER_EXACT_NAME"]) },
  confidence: "HIGH",
});
expect(failedRow).toMatchObject({ classificationSource: "NAVER_FAILED", reviewState: "MANUAL" });
```

- [ ] **Step 2: RED를 확인한다.**

Run: `pnpm test -- tests/unit/candidate-review-state.test.ts && pnpm run test:integration -- tests/integration/bulk-review.server.test.ts`

Expected: FAIL — rows query `ai_classification_runs` and expose `aiConfidence`.

- [ ] **Step 3: AI lookup/reconciliation을 삭제하고 safe evidence model을 추가한다.**

```ts
type CandidateNaverEvidence = {
  status: "VERIFIED" | "LIKELY" | "AMBIGUOUS" | "NO_MATCH" | "OUT_OF_SCOPE" | "FAILED" | "SKIPPED" | null;
  evidenceCodes: NaverEvidenceCode[];
  confidenceScore: number | null;
  failureCode: NaverLocalSearchFailureCode | null;
};
```

Provider response string/ID/link/image/review fields must not become a row property.

- [ ] **Step 4: GREEN을 확인한다.**

Run: `pnpm test -- tests/unit/candidate-review-state.test.ts && pnpm run test:integration -- tests/integration/bulk-review.server.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit한다.**

```bash
git add app/features/candidates/bulk-review.server.ts app/features/candidates/review-classification.ts tests/integration/bulk-review.server.test.ts tests/unit/candidate-review-state.test.ts
git commit -m "2026-08-15 NAVER 근거 중심 후보 상태 정리"
```

### Task 6: 관리자 action과 근거 워크벤치 UI를 구현한다

**Files:**

- Create: `app/features/candidates/candidate-evidence-ui.tsx`
- Modify: `app/routes/admin-candidates.tsx`
- Modify: `app/styles/design-system.css`
- Modify: `tests/e2e/admin-candidate-review.spec.ts`

**Consumes:** Task 4 service and Task 5 `CandidateNaverEvidence`.

**Produces:** `intent="verifyNaverSelected"`, `EvidenceStatusRail`, `EvidenceChain`, `CandidateFilterPanel`, `CandidateSelectionWorkbench`.

- [ ] **Step 1: visible contract의 failing E2E tests를 작성한다.**

```ts
await expect(page.getByRole("heading", { name: "장소 검수" })).toBeVisible();
await expect(page.getByLabel("NAVER 근거 상태")).toContainText("검증됨");
await expect(page.getByText("상호 일치")).toBeVisible();
await expect(page.getByText("상세 필터")).toBeVisible();
await expect(page.getByRole("button", { name: "NAVER 근거 확인" })).toBeVisible();
await expect(page.getByText("Workers AI 오늘 사용량")).toHaveCount(0);
await expect(page.getByText("규칙 기반 공개 장소 보조 재분류")).toHaveCount(0);
```

- [ ] **Step 2: RED를 확인한다.**

Run: `pnpm exec playwright test tests/e2e/admin-candidate-review.spec.ts --project=chromium --project=mobile-chromium`

Expected: FAIL — old quota panel and stacked reclassification cards are rendered.

- [ ] **Step 3: action and route data를 연결한다.**

```ts
if (intent === "verifyNaverSelected") {
  const result = await verifyPendingCandidatesWithNaver(db, {
    candidateIds, now, force: true, adapter: createNaverLocalSearchAdapter(env),
  });
  return { naverVerification: result, approved: [], skipped: [], rejected: 0, error: null };
}
```

Keep `candidateIds.length <= 25`. Map stop codes to exactly: “NAVER API 인증 또는 호출 주소를 확인하세요.”, “NAVER 일일 호출 한도에 도달했습니다.”, and “NAVER 요청 형식을 확인하세요.” Remove `runAi`, `aiQuota`, AI `useEffect`, and both reclassification feature panels.

- [ ] **Step 4: presentational UI and CSS를 구현한다.**

```tsx
export function EvidenceChain({ evidence }: { evidence: CandidateNaverEvidence }) {
  const tokens = evidence.status === "VERIFIED"
    ? ["상호 일치", evidence.evidenceCodes.includes("NAVER_EXACT_ADDRESS") ? "주소 일치" : "100m 이내", "NAVER 구체 카테고리"]
    : [evidence.failureCode ? failureLabel(evidence.failureCode) : "NAVER 근거 확인 필요"];
  return <ol className="candidate-evidence-chain">{tokens.map((token) => <li key={token}>{token}</li>)}</ol>;
}
```

Render a single header, `aria-label="NAVER 근거 상태"` rail, `details` secondary filters, a desktop evidence row / mobile card switch, and a sticky selection workbench. Only use existing `--space-*`, `--radius-*`, and `--color-*` tokens.

- [ ] **Step 5: GREEN and visual evidence를 확인한다.**

Run: `pnpm exec playwright test tests/e2e/admin-candidate-review.spec.ts --project=chromium --project=mobile-chromium`

Expected: PASS. Capture `docs/evidence/2026-08-15-naver-workbench-desktop.png` and `docs/evidence/2026-08-15-naver-workbench-mobile.png`.

- [ ] **Step 6: Commit한다.**

```bash
git add app/features/candidates/candidate-evidence-ui.tsx app/routes/admin-candidates.tsx app/styles/design-system.css tests/e2e/admin-candidate-review.spec.ts docs/evidence/2026-08-15-naver-workbench-desktop.png docs/evidence/2026-08-15-naver-workbench-mobile.png
git commit -m "2026-08-15 NAVER 근거 검수 UI 개편"
```

### Task 7: 운영 문서·검증·PR handoff를 완료한다

**Files:**

- Modify: `docs/operations/naver-local-category-runbook.md`
- Modify: `README.md` if Workers AI is advertised
- Delete: `docs/operations/ai-operations-runbook.md` if it is AI-only
- Modify: `docs/superpowers/specs/2026-08-15-naver-evidence-workbench-design.md` only for factual implementation corrections

**Consumes:** completed Tasks 1–6.

**Produces:** API HUB keys, 25-item cap, D1 export, kill switch, forward-fix, mobile/desktop evidence captured in the PR.

- [ ] **Step 1: obsolete-content scan을 실행한다.**

Run: `rg -n 'Workers AI|ai_classification_runs|AI_CLASSIFICATION|NAVER 100곳|100 PLACES' README.md docs/operations app workers wrangler.jsonc`

Expected: only historical decision/spec documents remain; runtime guides and source expose no obsolete contract.

- [ ] **Step 2: NAVER runbook을 exact rollout으로 바꾼다.**

```md
1. 원격 D1 export를 보관한 뒤 0031 migration을 적용한다.
2. API HUB Client ID/Secret을 기존 NAVER_LOCAL_SEARCH secret 이름으로 등록한다.
3. NAVER_LOCAL_SEARCH_ENABLED=true 배포 뒤 관리자에서 1개 선택 검증을 실행한다.
4. 인증/주소 오류면 NAVER_LOCAL_SEARCH_ENABLED=false로 즉시 배포한다.
5. 25개 자동·수동 batch와 근거 체인 화면을 확인한 뒤 운영한다.
```

- [ ] **Step 3: full verification을 실행한다.**

Run: `pnpm test && pnpm run test:integration && pnpm exec playwright test tests/e2e/admin-candidate-review.spec.ts --project=chromium --project=mobile-chromium && pnpm run typecheck && pnpm run build && git diff --check`

Expected: all commands exit 0 with no test, type, build, or whitespace errors.

- [ ] **Step 4: documentation commit과 PR을 만든다.**

```bash
git add docs README.md
git commit -m "2026-08-15 NAVER 검수 운영 절차 정리"
git push -u origin codex/tj_naver_evidence_workbench
gh pr create --base main --head codex/tj_naver_evidence_workbench --title "2026-08-15 NAVER 근거 검수 워크벤치" --body-file /private/tmp/naver-evidence-workbench-pr.md
```

PR body must link #123 and explicitly record: production D1 export + destructive AI history deletion, API HUB key/header contract, 25-call cap, fake-only tests, desktop/mobile evidence paths, `NAVER_LOCAL_SEARCH_ENABLED=false` rollback, and no deployment from this branch.

## Plan self-review

- Spec coverage: Tasks 1–2 remove AI data/runtime/config; Tasks 3–5 implement API HUB and evidence scoring; Task 4 provides automatic verification; Task 6 provides manual verification and the approved UI; Task 7 covers operations and PR evidence.
- Completeness scan: every behavior includes its test, expected RED result, implementation boundary, GREEN command, and commit step.
- Type consistency: Task 4 defines `NaverCandidateVerificationResult`; Task 5 defines `CandidateNaverEvidence`; Task 6 consumes those exact types.
