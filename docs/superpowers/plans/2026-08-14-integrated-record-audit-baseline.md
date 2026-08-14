# 통합 기록 감사 기준선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영 데이터를 변경하지 않고 Re:Taste의 장소·리뷰·추천·관리자 행위·개인정보 보존 기록을 검사해, 재현 가능한 비공개 기준선 감사 보고서를 만든다.

**Architecture:** 감사 규칙은 순수 TypeScript 모듈에 두고, D1 조회는 읽기 전용 snapshot builder에 한정한다. 관리자 전용 route는 마스킹된 결과만 보여 주며, 원격 감사 실행은 별도 runbook의 allowlist SELECT 명령으로만 허용한다. 이 단계에서는 테이블, migration, cron, 외부 서비스, 기존 데이터 상태를 변경하지 않는다.

**Tech Stack:** TypeScript strict, React Router 8, Cloudflare Workers, D1, Drizzle ORM, Zod, Vitest, Cloudflare Workers Vitest pool, Playwright.

## Global Constraints

- 운영 D1에는 SELECT만 수행한다. INSERT, UPDATE, DELETE, DDL, remote migration, R2 LIST/GET 원본 다운로드를 수행하지 않는다.
- 새 dependency, Cloudflare binding, cron, migration, 외부 API를 추가하지 않는다.
- 감사 화면과 로그에는 이메일, 전화번호, 세션 ID, 원본 주소, R2 object key, 원문 JSON을 출력하지 않는다.
- 관리자만 `/admin/audit` 결과에 접근할 수 있다. Reviewer와 일반 회원에게 감사 결과를 노출하지 않는다.
- 조회는 감사 시각 기준 최근 기간과 각 테이블 최대 500행으로 제한한다. 행 상한에 닿으면 결과를 `INCOMPLETE`로 표시한다.
- 중요 발견은 자동 수정하지 않는다. Critical/High는 별도 이슈와 별도 수정 PR로 분리한다.
- 모든 검사 결과는 KST 표시 시각, UTC 원본 시각, 코드 커밋 SHA, 검사 버전을 포함한다.

---

## 파일 구조

| 파일 | 책임 |
| --- | --- |
| `app/features/audit/record-audit.types.ts` | 감사 영역·심각도·발견·마스킹된 보고서 타입 |
| `app/features/audit/record-audit.ts` | D1과 무관한 순수 정합성 규칙 |
| `app/features/audit/record-audit.server.ts` | bounded D1 snapshot 조회와 규칙 실행 |
| `app/routes/admin-audit.tsx` | ADMIN 전용 기준선 감사 화면 |
| `app/routes.ts` | `/admin/audit` route 등록 |
| `docs/operations/record-audit-runbook.md` | 원격 읽기 전용 실행·보고·이슈 전환 절차 |
| `tests/unit/record-audit.test.ts` | 모든 순수 규칙의 fixture 회귀 |
| `tests/integration/record-audit.server.test.ts` | 실제 D1 fixture에서 snapshot 경계·마스킹 검증 |
| `tests/e2e/admin-record-audit.spec.ts` | ADMIN 접근·비공개 출력·Critical 노출 QA |

## 감사 데이터 계약

```ts
export const AUDIT_VERSION = "record-audit-v1" as const;

export type AuditSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
export type AuditArea =
  | "PLACE"
  | "RECOMMENDATION"
  | "RATING"
  | "REVIEWER"
  | "ADMIN_ACTION"
  | "RETENTION"
  | "OPERATIONS";

export type AuditFinding = {
  id: string;
  area: AuditArea;
  severity: AuditSeverity;
  ruleId: string;
  title: string;
  impact: string;
  sampleIds: string[];
  count: number;
  isIncomplete: boolean;
};

export type RecordAuditReport = {
  version: typeof AUDIT_VERSION;
  generatedAt: string;
  dataWindow: { from: string; to: string };
  sourceCommit: string;
  queryCapsReached: string[];
  findings: AuditFinding[];
  summary: Record<AuditSeverity, number>;
};
```

`sampleIds`는 UUID 전체가 아니라 `maskAuditId(id)`의 결과만 가진다. 함수는 `id.length <= 8`이면 `"[redacted]"`, 그 외에는 `${id.slice(0, 4)}…${id.slice(-4)}`를 반환한다.

### Task 1: 감사 타입·마스킹·판정 순수 함수

**Files:**
- Create: `app/features/audit/record-audit.types.ts`
- Create: `app/features/audit/record-audit.ts`
- Test: `tests/unit/record-audit.test.ts`

**Interfaces:**
- Produces: `maskAuditId`, `buildFinding`, `summarizeFindings`, `checkVoteLedger`, `checkGoldenPickLedger`, `checkPhotoMetadata`, `checkRetention`, `checkRecommendationEligibility`.
- Consumes: raw snapshot rows only; `AppDb`, `Env`, React component를 import하지 않는다.

- [ ] **Step 1: 실패하는 단위 테스트를 작성한다.**

```ts
import { describe, expect, it } from "vitest";
import {
  checkGoldenPickLedger,
  checkPhotoMetadata,
  checkVoteLedger,
  maskAuditId,
} from "../../app/features/audit/record-audit";

describe("record audit rules", () => {
  it("masks sample identifiers and never returns raw short identifiers", () => {
    expect(maskAuditId("12345678-abcdef")).toBe("1234…cdef");
    expect(maskAuditId("short")).toBe("[redacted]");
  });

  it("finds a current vote whose last event disagrees", () => {
    const findings = checkVoteLedger({
      events: [{ id: "event-12345678", placeId: "place-12345678", userId: "user-12345678", value: 1, createdAt: "2026-08-14T00:00:00.000Z" }],
      currentVotes: [{ eventId: "event-12345678", placeId: "place-12345678", userId: "user-12345678", value: -1 }],
      invalidatedEventIds: new Set<string>(),
    });
    expect(findings).toMatchObject([{ ruleId: "RATING_CURRENT_VOTE_VALUE_MISMATCH", severity: "HIGH", count: 1 }]);
  });

  it("finds photo metadata count and position gaps without exposing object keys", () => {
    const findings = checkPhotoMetadata({
      reviews: [{ id: "review-12345678", photoCount: 2 }],
      photos: [{ id: "photo-12345678", reviewId: "review-12345678", position: 2, byteSize: 100 }],
    });
    expect(findings.map((finding) => finding.ruleId)).toContain("REVIEW_PHOTO_COUNT_MISMATCH");
    expect(JSON.stringify(findings)).not.toContain("objectKey");
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다.**

Run: `pnpm test -- tests/unit/record-audit.test.ts`

Expected: FAIL with module-not-found errors for `record-audit`.

- [ ] **Step 3: 최소 구현을 작성한다.**

```ts
export function buildFinding(input: Omit<AuditFinding, "id">): AuditFinding {
  return { ...input, id: `${input.ruleId}:${input.sampleIds.join(",") || "none"}` };
}

export function checkPhotoMetadata(input: {
  reviews: Array<{ id: string; photoCount: number }>;
  photos: Array<{ id: string; reviewId: string; position: number; byteSize: number }>;
}): AuditFinding[] {
  const byReview = new Map<string, typeof input.photos>();
  for (const photo of input.photos) byReview.set(photo.reviewId, [...(byReview.get(photo.reviewId) ?? []), photo]);
  return input.reviews.flatMap((review) => {
    const photos = byReview.get(review.id) ?? [];
    const positions = new Set(photos.map((photo) => photo.position));
    const findings: AuditFinding[] = [];
    if (photos.length !== review.photoCount) findings.push(buildFinding({
      area: "REVIEWER", severity: "HIGH", ruleId: "REVIEW_PHOTO_COUNT_MISMATCH",
      title: "리뷰 사진 개수가 메타데이터와 다릅니다.", impact: "공개 사진 표시가 깨질 수 있습니다.",
      sampleIds: [maskAuditId(review.id)], count: 1, isIncomplete: false,
    }));
    if ([...Array(review.photoCount)].some((_, index) => !positions.has(index))) findings.push(buildFinding({
      area: "REVIEWER", severity: "HIGH", ruleId: "REVIEW_PHOTO_POSITION_GAP",
      title: "리뷰 사진 순번이 연속되지 않습니다.", impact: "사진 정렬과 공개 경로가 불안정해질 수 있습니다.",
      sampleIds: [maskAuditId(review.id)], count: 1, isIncomplete: false,
    }));
    return findings;
  });
}
```

`checkVoteLedger`는 현재 투표의 `eventId`, `value`, `userId`, `placeId`가 마지막 유효 이벤트와 일치하는지 확인한다. `checkGoldenPickLedger`는 종료 이벤트가 없는 만료 grant와 존재하지 않는 grant를 참조하는 종료 이벤트를 확인한다. `checkRetention`은 `expiresAt <= now`인 guest session과 `occurredAt <= now - 30일`인 product event를 각각 HIGH로 반환한다.

- [ ] **Step 4: 단위 테스트를 통과시킨다.**

Run: `pnpm test -- tests/unit/record-audit.test.ts`

Expected: PASS.

- [ ] **Step 5: 커밋한다.**

```bash
git add app/features/audit/record-audit.types.ts app/features/audit/record-audit.ts tests/unit/record-audit.test.ts
git commit -m "2026-08-14 기록 감사 순수 규칙 추가"
```

### Task 2: bounded 읽기 전용 D1 snapshot builder

**Files:**
- Create: `app/features/audit/record-audit.server.ts`
- Test: `tests/integration/record-audit.server.test.ts`

**Interfaces:**
- Consumes: Task 1의 rule 함수와 `AppDb`.
- Produces: `runRecordAudit(db, { now, sourceCommit, maxRows? }): Promise<RecordAuditReport>`.

- [ ] **Step 1: D1 통합 테스트를 먼저 작성한다.**

```ts
it("uses bounded snapshots, detects expired product data, and redacts the report", async () => {
  const db = createDb(env.DB);
  const now = "2026-08-14T00:00:00.000Z";
  await db.insert(productEvents).values({
    id: "event-12345678", userId: null, guestSessionId: null,
    eventName: "ONBOARDING_STARTED", metadataJson: JSON.stringify({ email: "must-not-appear@example.com" }),
    occurredAt: "2026-07-01T00:00:00.000Z",
  });
  const report = await runRecordAudit(db, { now, sourceCommit: "test-sha", maxRows: 1 });
  expect(report.findings).toContainEqual(expect.objectContaining({ ruleId: "RETENTION_PRODUCT_EVENT_EXPIRED" }));
  expect(report.queryCapsReached).toContain("productEvents");
  expect(JSON.stringify(report)).not.toContain("must-not-appear@example.com");
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다.**

Run: `pnpm run test:integration -- tests/integration/record-audit.server.test.ts`

Expected: FAIL with `runRecordAudit is not a function`.

- [ ] **Step 3: snapshot builder를 구현한다.**

```ts
const DEFAULT_MAX_ROWS = 500;

async function readCapped<T>(label: string, query: Promise<T[]>, maxRows: number, caps: string[]) {
  const rows = await query;
  if (rows.length > maxRows) caps.push(label);
  return rows.slice(0, maxRows);
}

export async function runRecordAudit(
  db: AppDb,
  input: { now: string; sourceCommit: string; maxRows?: number },
): Promise<RecordAuditReport> {
  const maxRows = input.maxRows ?? DEFAULT_MAX_ROWS;
  const caps: string[] = [];
  const retentionCutoff = new Date(new Date(input.now).getTime() - 30 * 86_400_000).toISOString();
  const [votes, events, invalidations, reviews, photos, grants, guestSessions, productEvents] = await Promise.all([
    readCapped("currentVotes", db.select().from(currentVotes).limit(maxRows + 1), maxRows, caps),
    readCapped("voteEvents", db.select().from(voteEvents).where(gte(voteEvents.createdAt, retentionCutoff)).orderBy(desc(voteEvents.createdAt)).limit(maxRows + 1), maxRows, caps),
    readCapped("invalidatedVoteEvents", db.select().from(invalidatedVoteEvents).limit(maxRows + 1), maxRows, caps),
    readCapped("reviewerVisitReviews", db.select().from(reviewerVisitReviews).orderBy(desc(reviewerVisitReviews.publishedAt)).limit(maxRows + 1), maxRows, caps),
    readCapped("reviewerVisitPhotos", db.select().from(reviewerVisitPhotos).limit(maxRows + 1), maxRows, caps),
    readCapped("goldenPickEvents", db.select().from(goldenPickEvents).where(gte(goldenPickEvents.createdAt, retentionCutoff)).limit(maxRows + 1), maxRows, caps),
    readCapped("guestTasteSessions", db.select().from(guestTasteSessions).where(lte(guestTasteSessions.expiresAt, input.now)).limit(maxRows + 1), maxRows, caps),
    readCapped("productEvents", db.select().from(productEvents).where(lte(productEvents.occurredAt, retentionCutoff)).limit(maxRows + 1), maxRows, caps),
  ]);
  return buildRecordAuditReport({ now: input.now, sourceCommit: input.sourceCommit, queryCapsReached: caps, votes, events, invalidations, reviews, photos, grants, guestSessions, productEvents });
}
```

Do not select user email, phone, session token, full address, `objectKey`, or `metadataJson` into the report DTO. Query columns explicitly when a table contains those fields.

- [ ] **Step 4: D1 통합 테스트와 타입 검사를 통과시킨다.**

Run: `pnpm run test:integration -- tests/integration/record-audit.server.test.ts && pnpm run typecheck`

Expected: PASS.

- [ ] **Step 5: 커밋한다.**

```bash
git add app/features/audit/record-audit.server.ts tests/integration/record-audit.server.test.ts
git commit -m "2026-08-14 읽기 전용 기록 감사 snapshot 추가"
```

### Task 3: ADMIN 전용 감사 결과 화면

**Files:**
- Create: `app/routes/admin-audit.tsx`
- Modify: `app/routes.ts`
- Modify: `app/app.css`
- Test: `tests/e2e/admin-record-audit.spec.ts`

**Interfaces:**
- Consumes: `requireAdmin`, `runRecordAudit`, `RecordAuditReport`.
- Produces: `GET /admin/audit`, ADMIN에게만 마스킹된 report를 반환하는 화면.

- [ ] **Step 1: 접근제어와 마스킹을 검증하는 E2E를 작성한다.**

```ts
test("ADMIN만 감사 화면을 보고 민감 원문은 보지 못한다", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto("/admin/audit");
  await expect(page.getByRole("heading", { name: "통합 기록 감사" })).toBeVisible();
  await expect(page.getByText("RETENTION_PRODUCT_EVENT_EXPIRED")).toBeVisible();
  await expect(page.getByText(/must-not-appear@example\.com/)).toHaveCount(0);
  await loginAs(page, "member");
  await page.goto("/admin/audit");
  await expect(page).toHaveURL(/\/login|\/$/);
});
```

- [ ] **Step 2: E2E가 실패하는지 확인한다.**

Run: `pnpm run test:e2e -- tests/e2e/admin-record-audit.spec.ts`

Expected: FAIL because the route is not registered.

- [ ] **Step 3: route와 화면을 구현한다.**

```tsx
export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  return runRecordAudit(createDb(env.DB), {
    now: new Date().toISOString(),
    // 이 baseline은 새 Cloudflare version-metadata binding을 추가하지 않는다.
    // 원격 실행의 정확한 Git SHA는 runbook의 `git rev-parse HEAD`로 보고서에 남긴다.
    sourceCommit: "runtime-unversioned",
  });
}

export default function AdminAudit({ loaderData }: Route.ComponentProps) {
  return <main id="main" className="admin-rating-shell audit-shell">
    <header><p className="eyebrow">ADMIN / AUDIT</p><h1>통합 기록 감사</h1><p>읽기 전용 기준선입니다. 결과는 자동으로 수정되지 않습니다.</p></header>
    <section aria-label="감사 요약">{Object.entries(loaderData.summary).map(([severity, count]) => <p key={severity}>{severity} <strong>{count}</strong></p>)}</section>
    <section aria-label="감사 발견">{loaderData.findings.map((finding) => <article key={finding.id}><strong>{finding.severity} · {finding.ruleId}</strong><h2>{finding.title}</h2><p>{finding.impact}</p><small>표본 {finding.sampleIds.join(", ")} · {finding.count}건</small></article>)}</section>
  </main>;
}
```

Add `route("admin/audit", "routes/admin-audit.tsx")` after the other ADMIN routes. CSS must reuse existing admin colors and provide no raw JSON `<code>` block.

- [ ] **Step 4: E2E·단위·통합·빌드를 통과시킨다.**

Run: `pnpm test && pnpm run test:integration -- tests/integration/record-audit.server.test.ts && pnpm run test:e2e -- tests/e2e/admin-record-audit.spec.ts && pnpm run typecheck && pnpm run build`

Expected: all commands exit 0.

- [ ] **Step 5: 커밋한다.**

```bash
git add app/routes/admin-audit.tsx app/routes.ts app/app.css tests/e2e/admin-record-audit.spec.ts
git commit -m "2026-08-14 관리자 통합 감사 기준선 화면 추가"
```

### Task 4: 읽기 전용 운영 실행 절차와 기준선 보고서

**Files:**
- Create: `docs/operations/record-audit-runbook.md`
- Create: `docs/audits/YYYY-MM-DD-record-audit-baseline.md` during an approved audit run only
- Modify: `README.md`

**Interfaces:**
- Consumes: `/admin/audit` report and `wrangler d1 execute DB --remote --command`.
- Produces: 마스킹된 기준선 보고서와 Critical/High 이슈 목록.

- [ ] **Step 1: runbook 검증 체크리스트를 작성한다.**

```markdown
## 실행 전 확인

- [ ] `git rev-parse HEAD` 값을 보고서에 기록했다.
- [ ] 실행 계정은 production D1 읽기 권한만 사용한다.
- [ ] 명령에 `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `PRAGMA writable_schema`가 없다.
- [ ] 결과 파일은 암호화된 로컬 경로에만 저장하고 Git에 추가하지 않는다.
```

- [ ] **Step 2: runbook의 SELECT allowlist를 작성한다.**

```sql
SELECT COUNT(*) AS expired_product_events
FROM product_events
WHERE occurred_at <= datetime('now', '-30 days');

SELECT COUNT(*) AS expired_guest_sessions
FROM guest_taste_sessions
WHERE expires_at <= datetime('now');

SELECT COUNT(*) AS photo_count_mismatch
FROM reviewer_visit_reviews r
LEFT JOIN reviewer_visit_photos p ON p.review_id = r.id
GROUP BY r.id, r.photo_count
HAVING COUNT(p.id) <> r.photo_count;
```

The runbook must require parameter-free, aggregate-only remote queries. It must state that sample inspection uses masked IDs in the ADMIN UI, never raw user data in terminal output.

- [ ] **Step 3: 보고서 템플릿을 작성한다.**

```markdown
## 실행 메타데이터

- 기준 커밋:
- 감사 시각(KST / UTC):
- 데이터 창:
- 검사 버전:
- 행 상한 도달 테이블:

## 발견 사항

| 심각도 | 규칙 | 건수 | 영향 | 다음 조치 |
| --- | --- | ---: | --- | --- |
```

- [ ] **Step 4: 문서 링크와 형식을 검증한다.**

Run: `rg -n "INSERT|UPDATE|DELETE|DROP|ALTER" docs/operations/record-audit-runbook.md`

Expected: only a prohibition sentence appears; no executable mutation command appears.

- [ ] **Step 5: 커밋한다.**

```bash
git add docs/operations/record-audit-runbook.md README.md
git commit -m "2026-08-14 통합 기록 감사 운영 절차 추가"
```

### Task 5: 기준선 PR 검토와 운영 실행 게이트

**Files:**
- Modify: `docs/superpowers/specs/2026-08-14-integrated-record-audit-design.md` only if the final runbook changes a policy decision
- Create: `.github/pull_request_template.md` is out of scope; put the required evidence in the PR body instead

**Interfaces:**
- Consumes: Tasks 1–4 commits and test outputs.
- Produces: feature PR with no remote mutation, a separately approved baseline run, and an issue per Critical/High finding.

- [ ] **Step 1: PR body에 범위와 금지 작업을 명시한다.**

```markdown
## 운영 영향

- 원격 D1 migration: 없음
- 원격 D1 변경: 없음
- R2 변경: 없음
- 신규 binding / cron / dependency: 없음
- 운영 실행: 승인된 runbook의 aggregate SELECT만 수행
```

- [ ] **Step 2: 변경 검증을 실행한다.**

Run: `pnpm test && pnpm run test:integration && pnpm run typecheck && pnpm run build`

Expected: all commands exit 0.

- [ ] **Step 3: PR을 생성하고 CI·diff를 검토한다.**

Run: `gh pr create --base main --head codex/integrated-record-audit-baseline --title "통합 기록 감사 기준선"`

Expected: PR URL is returned; PR body contains privacy and rollback boundaries.

- [ ] **Step 4: 병합 후에만 운영 기준선 감사를 실행한다.**

Run: `pnpm exec wrangler d1 execute DB --remote --command "SELECT COUNT(*) AS expired_product_events FROM product_events WHERE occurred_at <= datetime('now', '-30 days')"`

Expected: aggregate count only. Do not run if the approved PR does not explicitly authorize the target account and report path.

- [ ] **Step 5: 발견 사항을 분류한다.**

Critical/High는 영향 범위, 안전한 완화책, 수정 소유자를 가진 별도 Issue로 등록한다. Medium/Low는 기준선 보고서에만 기록하고, 자동 수정 PR에 섞지 않는다.
