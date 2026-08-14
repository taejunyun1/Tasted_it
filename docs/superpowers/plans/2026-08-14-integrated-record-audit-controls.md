# 통합 기록 감사 상시 통제 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기준선 감사에서 확인된 안정적 규칙을 감사 원장, 일일 정합성 검사, 관리자 운영 화면으로 승격해 같은 오류가 다시 생길 때 감지 가능하게 만든다.

**Architecture:** 기준선의 순수 규칙을 재사용하되, 상시 실행 결과는 별도 run/finding 테이블에 요약만 저장한다. 중요 상태 변경은 중앙 helper를 통해 현재 `admin_audit_logs`의 기존 레코드와 호환되는 확장 envelope로 기록한다. 예약 작업 추가는 현재 단일 `Promise.all` cron 제약 때문에 별도 운영 승인과 분리된 Worker 실행 설계가 확정된 뒤에만 수행한다.

**Tech Stack:** TypeScript strict, React Router 8, Cloudflare Workers, D1, Drizzle ORM, Zod, Vitest, Cloudflare Workers Vitest pool, Playwright.

## Global Constraints

- 이 계획은 기준선 PR이 병합되고 Critical/High 이슈가 분류된 뒤에만 시작한다.
- 새 D1 테이블·인덱스와 예약 작업은 기술 스택 거버넌스의 Data/Operations 승인 내용을 PR 본문에 기록하고 병합으로 승인받는다.
- 기존 `admin_audit_logs` 행은 수정하지 않는다. 새 nullable 열 또는 신규 테이블로만 확장한다.
- 감사 결과에는 개인식별정보·세션·사진 object key·전체 주소를 저장하지 않는다.
- 자동 검사는 발견·알림만 한다. 장소 숨김, 추천 제외, 리뷰 철회, 계정 삭제를 자동 실행하지 않는다.
- 실패한 감사 run은 결과를 성공으로 덮어쓰지 않으며, 다음 실행에서 재시도 가능해야 한다.

---

## 파일 구조

| 파일 | 책임 |
| --- | --- |
| `drizzle/0030_record_audit_controls.sql` | audit run/finding 테이블과 기존 로그의 nullable context 열 |
| `app/db/schema.ts` | Drizzle 테이블 정의 |
| `app/features/audit/audit-log.server.ts` | 중요 상태 변경용 구조화된 감사 원장 helper |
| `app/features/audit/record-audit-run.server.ts` | 일일 검사 claim, run 저장, finding upsert, 실패 처리 |
| `app/features/audit/scheduled-record-audit.server.ts` | 실행 경계와 결과 요약 |
| `workers/audit-worker.ts` | 기존 maintenance `Promise.all`과 분리된 audit cron Worker |
| `wrangler.audit.jsonc` | audit Worker의 별도 cron·D1 binding 구성 |
| `app/features/operations/dashboard.server.ts` | 열린 감사 이슈와 최근 run 요약 |
| `app/routes/admin-operations.tsx` | 감사 상태 요약·상세 링크 |
| `tests/integration/record-audit-run.server.test.ts` | D1 claim·멱등성·finding 상태·실패 회귀 |
| `tests/integration/audit-log.server.test.ts` | audit envelope 저장·redaction 회귀 |
| `tests/e2e/admin-record-audit.spec.ts` | ADMIN 화면의 run·finding·권한 QA |
| `docs/operations/record-audit-runbook.md` | runbook에 상시 실행·rollback·장애 절차 추가 |

## 데이터 계약

```ts
export type RecordAuditRunStatus = "RUNNING" | "COMPLETED" | "FAILED";
export type RecordAuditFindingStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED";

export type WriteAuditEventInput = {
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  beforeState: unknown;
  afterState: unknown;
  reason: string | null;
  requestId: string | null;
  policyVersion: string | null;
  now: string;
};
```

`reason`, `requestId`, `policyVersion`은 새 행에서만 채우며 기존 감사로그를 backfill하지 않는다. 상태 변경 서비스는 raw email, phone, session, address, R2 key를 before/after에 전달하면 `sanitizeAuditState`가 해당 key를 제거한다.

### Task 1: 감사 run·finding 스키마와 migration

**Files:**
- Create: `drizzle/0030_record_audit_controls.sql`
- Modify: `app/db/schema.ts`
- Test: `tests/unit/schema-contract.test.ts`
- Test: `tests/integration/record-audit-run.server.test.ts`

**Interfaces:**
- Produces: `recordAuditRuns`, `recordAuditFindings`; `adminAuditLogs.reason`, `adminAuditLogs.requestId`, `adminAuditLogs.policyVersion` nullable columns.

- [ ] **Step 1: 실패하는 schema 계약을 작성한다.**

```ts
it("exposes audit run and finding tables with the lifecycle indexes", () => {
  expect(Object.keys(schema)).toContain("recordAuditRuns");
  expect(Object.keys(schema)).toContain("recordAuditFindings");
  expect(recordAuditRuns.status.enumValues).toEqual(["RUNNING", "COMPLETED", "FAILED"]);
  expect(recordAuditFindings.status.enumValues).toEqual(["OPEN", "ACKNOWLEDGED", "RESOLVED"]);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다.**

Run: `pnpm test -- tests/unit/schema-contract.test.ts`

Expected: FAIL because the audit tables do not exist.

- [ ] **Step 3: forward-only migration과 schema를 추가한다.**

```sql
CREATE TABLE record_audit_runs (
  id TEXT PRIMARY KEY NOT NULL,
  audit_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('RUNNING','COMPLETED','FAILED')),
  lease_token TEXT,
  lease_expires_at TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  source_commit TEXT NOT NULL,
  summary_json TEXT NOT NULL DEFAULT '{}',
  error_summary TEXT
);
CREATE INDEX record_audit_runs_status_started_idx ON record_audit_runs(status, started_at);

CREATE TABLE record_audit_findings (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES record_audit_runs(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  area TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('CRITICAL','HIGH','MEDIUM','LOW','INFO')),
  rule_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('OPEN','ACKNOWLEDGED','RESOLVED')) DEFAULT 'OPEN',
  count INTEGER NOT NULL,
  sample_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(run_id, fingerprint)
);
CREATE INDEX record_audit_findings_status_severity_idx ON record_audit_findings(status, severity, updated_at);

ALTER TABLE admin_audit_logs ADD COLUMN reason TEXT;
ALTER TABLE admin_audit_logs ADD COLUMN request_id TEXT;
ALTER TABLE admin_audit_logs ADD COLUMN policy_version TEXT;
```

Add matching Drizzle declarations with enum fields and indexes. If `operational_alerts.alert_type` has the current SQLite `CHECK` constraint, recreate only that table in this same forward migration with the existing columns/data plus `RECORD_AUDIT`; prove the data copy in an isolated migration test. Never edit migrations `0000`–`0029`.

- [ ] **Step 4: migration isolation·schema tests를 통과시킨다.**

Run: `pnpm run test:integration -- tests/integration/record-audit-run.server.test.ts && pnpm test -- tests/unit/schema-contract.test.ts`

Expected: PASS after applying migrations through `0030` in isolated D1.

- [ ] **Step 5: 커밋한다.**

```bash
git add drizzle/0030_record_audit_controls.sql app/db/schema.ts tests/unit/schema-contract.test.ts tests/integration/record-audit-run.server.test.ts
git commit -m "2026-08-14 상시 기록 감사 스키마 추가"
```

### Task 2: 구조화된 관리자 감사 원장 helper

**Files:**
- Create: `app/features/audit/audit-log.server.ts`
- Modify: `app/features/reviewers/reviewer.server.ts`
- Modify: `app/features/places/place-revalidation.server.ts`
- Modify: `app/features/places/place-suggestion.server.ts`
- Modify: `app/features/places/place-correction.server.ts`
- Modify: `app/features/places/place-merge.server.ts`
- Test: `tests/integration/audit-log.server.test.ts`

**Interfaces:**
- Produces: `writeAuditEvent(db, input): Promise<void>` and `sanitizeAuditState(value): Record<string, unknown> | null`.

- [ ] **Step 1: 원문 민감값 제거 테스트를 작성한다.**

```ts
it("writes one audit row with context and removes sensitive keys", async () => {
  await writeAuditEvent(db, {
    actorUserId: adminId, action: "APPROVE_PLACE_SUGGESTION", targetType: "PLACE_SUGGESTION", targetId: suggestionId,
    beforeState: { status: "SUBMITTED", email: "private@example.com" },
    afterState: { status: "APPROVED", objectKey: "reviews/private.jpg" },
    reason: "주소·상호 확인", requestId: "request-12345678", policyVersion: "place-policy-v3", now,
  });
  const row = (await db.select().from(adminAuditLogs)).at(-1)!;
  expect(row.reason).toBe("주소·상호 확인");
  expect(row.requestId).toBe("request-12345678");
  expect(`${row.beforeState}${row.afterState}`).not.toContain("private@example.com");
  expect(`${row.beforeState}${row.afterState}`).not.toContain("reviews/private.jpg");
});
```

- [ ] **Step 2: 실패를 확인한다.**

Run: `pnpm run test:integration -- tests/integration/audit-log.server.test.ts`

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: helper와 우선 서비스 교체를 구현한다.**

```ts
const SENSITIVE_KEYS = new Set(["email", "phone", "session", "token", "objectKey", "address", "metadataJson"]);

export function sanitizeAuditState(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !SENSITIVE_KEYS.has(key))
    .map(([key, item]) => [key, typeof item === "object" && item ? sanitizeAuditState(item) : item]));
}

export async function writeAuditEvent(db: AppDb, input: WriteAuditEventInput) {
  await db.insert(adminAuditLogs).values({
    id: crypto.randomUUID(), actorUserId: input.actorUserId, action: input.action,
    targetType: input.targetType, targetId: input.targetId,
    beforeState: JSON.stringify(sanitizeAuditState(input.beforeState)),
    afterState: JSON.stringify(sanitizeAuditState(input.afterState)),
    reason: input.reason?.trim() || null, requestId: input.requestId, policyVersion: input.policyVersion,
    createdAt: input.now,
  });
}
```

Replace only the six listed services in this task. Preserve their current transaction/batch boundaries by replacing the existing `db.insert(adminAuditLogs)` statement inside the same batch where possible. Do not mass-refactor unrelated audit writes.

- [ ] **Step 4: regression suite를 통과시킨다.**

Run: `pnpm run test:integration -- tests/integration/audit-log.server.test.ts tests/integration/place-revalidation.server.test.ts tests/integration/place-merge.server.test.ts`

Expected: PASS.

- [ ] **Step 5: 커밋한다.**

```bash
git add app/features/audit/audit-log.server.ts app/features/reviewers/reviewer.server.ts app/features/places/place-revalidation.server.ts app/features/places/place-suggestion.server.ts app/features/places/place-correction.server.ts app/features/places/place-merge.server.ts tests/integration/audit-log.server.test.ts
git commit -m "2026-08-14 구조화된 관리자 감사 원장 추가"
```

### Task 3: 일일 감사 run의 claim·저장·실패 경계

**Files:**
- Create: `app/features/audit/record-audit-run.server.ts`
- Create: `app/features/audit/scheduled-record-audit.server.ts`
- Modify: `app/features/operations/alerts.server.ts`
- Test: `tests/integration/record-audit-run.server.test.ts`

**Interfaces:**
- Consumes: baseline `runRecordAudit`, Task 1 tables, `recordOperationalAlert`.
- Produces: `runScheduledRecordAudit(env, { now?, sourceCommit? }): Promise<{ status: "RAN" | "SKIPPED_RUNNING" | "FAILED"; runId?: string }>`.

- [ ] **Step 1: concurrent claim과 failure regression을 작성한다.**

```ts
it("allows one run claim, persists sanitized findings, and records failure without overwriting a completed run", async () => {
  const first = await claimRecordAuditRun(db, { now, sourceCommit: "sha-a" });
  const second = await claimRecordAuditRun(db, { now, sourceCommit: "sha-b" });
  expect(first).not.toBeNull();
  expect(second).toBeNull();
  await completeRecordAuditRun(db, { runId: first!.id, report: fakeReport });
  await expect(failRecordAuditRun(db, { runId: first!.id, error: new Error("late error"), now })).rejects.toThrow("AUDIT_RUN_NOT_RUNNING");
});
```

- [ ] **Step 2: 실패를 확인한다.**

Run: `pnpm run test:integration -- tests/integration/record-audit-run.server.test.ts`

Expected: FAIL because claim and completion functions do not exist.

- [ ] **Step 3: idempotent run lifecycle을 구현한다.**

```ts
export async function claimRecordAuditRun(db: AppDb, input: { now: string; sourceCommit: string }) {
  const id = crypto.randomUUID();
  const leaseToken = crypto.randomUUID();
  const leaseExpiresAt = new Date(new Date(input.now).getTime() + 20 * 60_000).toISOString();
  // Do not implement this as find-then-insert. Use one conditional INSERT … SELECT
  // (or the repository's equivalent raw D1 statement) that returns a row only when
  // no unexpired RUNNING lease exists.
  const claimed = await claimWithConditionalInsert(db, { id, leaseToken, leaseExpiresAt, ...input });
  return claimed ? { id, leaseToken } : null;
}

export async function completeRecordAuditRun(db: AppDb, input: { runId: string; leaseToken: string; report: RecordAuditReport }) {
  // Build all finding INSERTs plus a conditional RUNNING→COMPLETED update in one
  // D1 batch. The completion statement must match id + status + leaseToken and
  // return one row; a zero-row CAS is an AUDIT_RUN_NOT_RUNNING failure and must
  // leave no finding rows. Reuse the repository's existing conditional-batch
  // assertion pattern rather than a read-then-update sequence.
  await completeWithConditionalBatch(db, input);
}
```

Use a single D1 batch for run completion and finding inserts. If the batch fails, mark the same `RUNNING` row `FAILED` only when `id + leaseToken + status=RUNNING` still match, with a bounded error code; do not create partial finding rows. Tests must cover two concurrent claims, lease expiry recovery, a stale lease completing after a newer claim, a forced finding-insert failure rollback, and a failed-run retry.

- [ ] **Step 4: alert type extension and integration tests를 통과시킨다.**

Add `"RECORD_AUDIT"` to the `operationalAlerts.alertType` schema/migration only in this task’s PR if the table CHECK constraint requires it. On a failed run, call `recordOperationalAlert` with `{ alertType: "RECORD_AUDIT", sourceId: runId, details: { auditVersion: AUDIT_VERSION } }`.

Run: `pnpm run test:integration -- tests/integration/record-audit-run.server.test.ts tests/integration/operations-dashboard.server.test.ts`

Expected: PASS.

- [ ] **Step 5: 커밋한다.**

```bash
git add app/features/audit/record-audit-run.server.ts app/features/audit/scheduled-record-audit.server.ts app/features/operations/alerts.server.ts tests/integration/record-audit-run.server.test.ts
git commit -m "2026-08-14 일일 기록 감사 실행 경계 추가"
```

### Task 4: 분리된 audit Worker와 운영 승인 게이트

**Files:**
- Create: `workers/audit-worker.ts`
- Create: `wrangler.audit.jsonc`
- Modify: `docs/operations/record-audit-runbook.md`
- Test: `tests/integration/record-audit-run.server.test.ts`

**Interfaces:**
- Consumes: `runScheduledRecordAudit`.
- Produces: independent Cloudflare Worker scheduled handler; existing `workers/app.ts` is unchanged.

- [ ] **Step 1: existing Worker에 audit 작업을 넣지 않는 계약 테스트를 작성한다.**

```ts
it("runs the audit scheduler only through its dedicated Worker handler", async () => {
  const runScheduledRecordAudit = vi.fn().mockResolvedValue({ status: "RAN" });
  const handler = createAuditWorker({ runScheduledRecordAudit });
  const waitUntil = vi.fn();
  await handler.scheduled({} as ScheduledController, env, { waitUntil } as ExecutionContext);
  expect(waitUntil).toHaveBeenCalledOnce();
  expect(runScheduledRecordAudit).toHaveBeenCalledWith(env);
});
```

- [ ] **Step 2: 실패를 확인한다.**

Run: `pnpm test -- tests/unit/record-audit-worker-contract.test.ts`

Expected: FAIL because the independent worker is absent.

- [ ] **Step 3: 독립 Worker와 구성 파일을 추가한다.**

```ts
export function createAuditWorker(deps = { runScheduledRecordAudit }) {
  return {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(deps.runScheduledRecordAudit(env));
  },
  } satisfies Pick<ExportedHandler<Env>, "scheduled">;
}

export default createAuditWorker();
```

`wrangler.audit.jsonc` must contain a distinct worker name such as `retaste-audit`, only the `DB` binding needed for this task, and a daily cron not equal to the main worker cron. It must not bind R2, AI, email, or external API secrets.

- [ ] **Step 4: governance evidence and local Worker verification을 실행한다.**

Run: `pnpm exec wrangler deploy --config wrangler.audit.jsonc --dry-run && pnpm run typecheck`

Expected: dry-run lists only the audit Worker and DB binding; typecheck passes.

The PR body must include owner, daily D1 query cap, no external calls, no PII payload, failure alert path, rollback (`wrangler deploy --config wrangler.audit.jsonc --version-id <previous>` or delete trigger), and removal condition (replace when a measured job queue requirement exists).

- [ ] **Step 5: 커밋한다.**

```bash
git add workers/audit-worker.ts wrangler.audit.jsonc tests/unit/record-audit-worker-contract.test.ts docs/operations/record-audit-runbook.md
git commit -m "2026-08-14 분리된 기록 감사 Worker 추가"
```

### Task 5: 관리자 운영 화면에 감사 상태 연결

**Files:**
- Modify: `app/features/operations/dashboard.server.ts`
- Modify: `app/routes/admin-operations.tsx`
- Modify: `app/routes/admin-audit.tsx`
- Modify: `app/app.css`
- Test: `tests/integration/operations-dashboard.server.test.ts`
- Test: `tests/e2e/admin-record-audit.spec.ts`

**Interfaces:**
- Consumes: completed `recordAuditRuns`, open `recordAuditFindings`, existing `operationalAlerts`.
- Produces: 운영 대시보드의 최근 감사 run 시각, Critical/High 열린 건수, 감사 화면의 ACKNOWLEDGED/RESOLVED 상태 전환.

- [ ] **Step 1: 서버·브라우저 회귀 테스트를 작성한다.**

```ts
it("exposes the latest completed audit and only unresolved high-severity finding count", async () => {
  const dashboard = await getOperationalDashboard(db, { now });
  expect(dashboard.audit).toEqual({ latestStatus: "COMPLETED", criticalOpen: 1, highOpen: 2 });
});
```

```ts
test("ADMIN can acknowledge but not erase an audit finding", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto("/admin/audit");
  await page.getByRole("button", { name: "확인 처리" }).click();
  await expect(page.getByText("ACKNOWLEDGED")).toBeVisible();
  await expect(page.getByText("RETENTION_PRODUCT_EVENT_EXPIRED")).toBeVisible();
});
```

- [ ] **Step 2: 실패를 확인한다.**

Run: `pnpm run test:integration -- tests/integration/operations-dashboard.server.test.ts && pnpm run test:e2e -- tests/e2e/admin-record-audit.spec.ts`

Expected: FAIL because dashboard has no `audit` summary and no acknowledgement action.

- [ ] **Step 3: bounded ADMIN UX를 구현한다.**

`getOperationalDashboard` must return only `{ latestStatus, latestFinishedAt, criticalOpen, highOpen }`. The page must link to `/admin/audit`; it must not inline sample IDs or `summaryJson` in the operations dashboard. The audit action may transition only `OPEN → ACKNOWLEDGED → RESOLVED`, requires a non-empty note for `RESOLVED`, and uses `writeAuditEvent` with action `TRANSITION_RECORD_AUDIT_FINDING`.

- [ ] **Step 4: 전체 검증을 통과시킨다.**

Run: `pnpm test && pnpm run test:integration && pnpm run test:e2e -- tests/e2e/admin-record-audit.spec.ts && pnpm run typecheck && pnpm run build`

Expected: all commands exit 0.

- [ ] **Step 5: 커밋한다.**

```bash
git add app/features/operations/dashboard.server.ts app/routes/admin-operations.tsx app/routes/admin-audit.tsx app/app.css tests/integration/operations-dashboard.server.test.ts tests/e2e/admin-record-audit.spec.ts
git commit -m "2026-08-14 운영 화면에 기록 감사 상태 연결"
```

### Task 6: rollout·rollback·운영 재검증

**Files:**
- Modify: `docs/operations/record-audit-runbook.md`
- Create: `docs/audits/YYYY-MM-DD-record-audit-followup.md` after the first seven completed runs

**Interfaces:**
- Consumes: Tasks 1–5 deployed to preview, then production after PR merge.
- Produces: 7일 관찰 결과 and an explicit keep/disable decision for the audit Worker.

- [ ] **Step 1: preview에서 run lifecycle을 확인한다.**

Run: `pnpm exec wrangler deploy --config wrangler.audit.jsonc --env preview && pnpm exec wrangler tail retaste-audit --format json`

Expected: one `COMPLETED` run, no raw PII, and no write outside `record_audit_runs`, `record_audit_findings`, `operational_alerts`, `admin_audit_logs`.

- [ ] **Step 2: production 배포 전 PR evidence를 검토한다.**

The PR must state target account, D1 database, daily schedule, expected daily query count, no new external data processor, retention of audit results, rollback command, and 7-day monitoring owner.

- [ ] **Step 3: production deploy와 smoke를 수행한다.**

Run: `pnpm exec wrangler deploy --config wrangler.audit.jsonc && curl -fsS https://<worker-domain>/admin/audit`

Expected: Worker deploy succeeds; unauthenticated admin route does not disclose report data.

- [ ] **Step 4: 7회 완료 run 뒤 follow-up 보고서를 작성한다.**

The report must record completed/failed counts, average duration, maximum query cap hit, open Critical/High counts, false-positive rate from resolved findings, and whether the cron remains enabled.

- [ ] **Step 5: 커밋한다.**

```bash
git add docs/operations/record-audit-runbook.md docs/audits/YYYY-MM-DD-record-audit-followup.md
git commit -m "2026-08-14 기록 감사 상시 운영 결과 기록"
```
