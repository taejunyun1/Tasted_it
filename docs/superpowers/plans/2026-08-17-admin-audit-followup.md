# 2026-08-17 관리자 오딧 후속 실행 계획

> **상태:** `GO` — TJ 채팅 승인 완료(2026-08-17). 문서 채택과 로컬 코드 후속(#164 #167 #170 #171)을 시작한다. 승인 리뷰만으로는 착수하지 않으며, 원격 D1 apply, NAVER 실호출, 배포는 각 전용 PR이 병합되기 전까지 실행하지 않는다.

**Goal:** 관리자 HOLD를 풀기 위해, 오딧이 비워 둔 증거부터 소실 UI 복구, 운영 정합, 잔여 이슈 정리까지 이슈 단위로 진행한다.

**부모 이슈:** [#160](https://github.com/taejunyun1/Tasted_it/issues/160)  
**오딧:** [`docs/audits/2026-08-17-admin-audit.md`](../../audits/2026-08-17-admin-audit.md)  
**코드 기준선:** `origin/main` `92ad073`  
**담당:** Jay · **컨펌:** TJ · **위임 사유:** TJ 토큰 소진

## 오딧이 하지 않았던 항목 — 이 플랜에 포함

| 미실시 항목 | 이슈 | 단계 |
|---|---|---|
| 관리자 로그인 후 라이브 클릭 재현 | [#161](https://github.com/taejunyun1/Tasted_it/issues/161) | 0 |
| 원격 D1 행 수·migration 목록 | [#162](https://github.com/taejunyun1/Tasted_it/issues/162) | 0 |
| NAVER 실호출 | [#163](https://github.com/taejunyun1/Tasted_it/issues/163) | 0 |
| 코드/테스트 수정, 커밋 | [#164](https://github.com/taejunyun1/Tasted_it/issues/164) [#165](https://github.com/taejunyun1/Tasted_it/issues/165) [#167](https://github.com/taejunyun1/Tasted_it/issues/167) [#170](https://github.com/taejunyun1/Tasted_it/issues/170) [#171](https://github.com/taejunyun1/Tasted_it/issues/171) | 1–3 |
| 배포 | [#166](https://github.com/taejunyun1/Tasted_it/issues/166) | 2 |
| TJ 잔여 이슈 정리 | [#168](https://github.com/taejunyun1/Tasted_it/issues/168) | 4 |

## Global Constraints

- 모든 신규 브랜치는 최신 `origin/main`에서 `jay_<scope>`로 만든다. Codex/TJ 브랜치와 worktree를 재사용하지 않는다.
- 원격 D1은 읽기 전용 SELECT만. apply·시드·대량 UPDATE는 전용 PR이 병합된 뒤에만 지정 담당자가 실행한다.
- NAVER 실호출은 [#163](https://github.com/taejunyun1/Tasted_it/issues/163) 실행 PR에 적힌 한도(기본 1–3곳) 안에서만 한다.
- 이 워크스테이션 wrangler(비운영 개인 계정)로 운영 계정에 쓰지 않는다.
- 상호명·주소·이메일·비밀값을 이슈/PR/증거에 붙이지 않는다.
- 열린 Codex 이슈 #113·#115·#118·#124·#128·#144는 [#168](https://github.com/taejunyun1/Tasted_it/issues/168)에서만 정리한다. 이 플랜 PR에서 닫지 않는다.

## 이슈 지도

| 단계 | 이슈 | 오딧 ID | TJ 컨펌 없이 시작? |
|---|---|---|---|
| 0 | [#161](https://github.com/taejunyun1/Tasted_it/issues/161) 라이브 로그인 재현 | 섹션 8 | 아니오. 운영 ADMIN 세션 필요 |
| 0 | [#162](https://github.com/taejunyun1/Tasted_it/issues/162) 원격 D1 인벤토리 | ADM-OPS-01, 섹션 8 | 아니오. 운영 CF 계정 필요 |
| 0 | [#163](https://github.com/taejunyun1/Tasted_it/issues/163) NAVER 실호출 표본 | 섹션 8 | 아니오. 한도 승인 필요 |
| 1 | [#164](https://github.com/taejunyun1/Tasted_it/issues/164) 제안 승인 UI 복구 | ADM-IA-01 | GO 후 착수 |
| 1 | [#165](https://github.com/taejunyun1/Tasted_it/issues/165) 재검증·병합 탭 복구(A) | ADM-IA-02 | GO. 기본안 A, 자동 병합 없음 |
| 1 | [#170](https://github.com/taejunyun1/Tasted_it/issues/170) 단계별 송수신·예외 규칙 | 신규 | GO 후 즉시 |
| 2 | [#166](https://github.com/taejunyun1/Tasted_it/issues/166) Worker 플랜·배포·0034 | ADM-OPS-01–03, 섹션 8 | 전용 PR 후 |
| 3 | [#167](https://github.com/taejunyun1/Tasted_it/issues/167) E2E·returnTo·오류 화면 | ADM-TEST-01, AUTH-01, ERR-01/02 | GO 후 코드 PR |
| 3 | [#171](https://github.com/taejunyun1/Tasted_it/issues/171) 검수 파이프라인 운영 지표 | ADM-OBS-01 | GO 후 코드 PR |
| 4 | [#168](https://github.com/taejunyun1/Tasted_it/issues/168) Codex 잔여 이슈 6개 | 섹션 8 | 아니오. 닫기 전 TJ 컨펌 |

## 단계 0 — 오딧이 비운 증거

코드 수정 전에 P0 가설을 확인하거나 기각한다.

### Task 0.1 라이브 클릭 재현 — #161

- [ ] 운영 ADMIN으로 `/admin/place-operations` 1–5단계와 나머지 admin 경로를 연다.
- [ ] 500 / 1102 / 빈 큐 / 제안 승인 진입점 부재를 경로별로 기록한다. 개인정보는 남기지 않는다.
- [ ] ADM-IA-01·ADM-OPS-01·ADM-OPS-02를 확인 또는 기각한다.

### Task 0.2 원격 D1 읽기 — #162

- [ ] 운영 계정으로 `wrangler d1 migrations list retaste-production --remote`만 실행한다.
- [ ] `0029`–`0034` 적용 여부와 work item / SUBMITTED 제안 / PENDING 면허 건수만 남긴다.
- [ ] apply는 이 태스크에서 하지 않는다.

### Task 0.3 NAVER 표본 — #163

- [ ] 실행 PR에 대상 환경, 1–3곳, 일일 상한, rollback을 적는다.
- [ ] 그 PR이 병합된 뒤에만 호출한다.
- [ ] 호출 수와 1102 여부만 기록한다.

**단계 0 통과 조건:** 0034 적용 여부, 검수 화면 실제 오류, Paid/Free가 이슈 댓글에 적힌다.

## 단계 1 — 소실된 관리자 작업 복구

### Task 1.1 제안 승인 UI — #164

**Files:** `app/routes/admin-place-operations.tsx`, `app/components/admin/**`, `app/features/places/place-suggestion.server.ts`, 관련 테스트

- [ ] SUBMITTED 제안을 검수 1단계 또는 전용 탭에서 목록한다.
- [ ] 기존 `approvePlaceSuggestion`을 라우트 action에 연결한다. 지도 확인·사유 입력을 유지한다.
- [ ] 승인 결과는 DRAFT + `PLACE_SUGGESTION` work item으로 5단계 큐에 합류한다.
- [ ] 단위·통합·데스크톱/모바일 E2E 증거를 남긴다.

### Task 1.2 재검증·병합 — #165

- [ ] TJ가 (A) 탭 복구 또는 (B) 당분간 미제공을 고른다.
- [ ] A면 기존 서버 함수를 라우트에만 다시 연결한다. 자동 병합은 넣지 않는다.
- [ ] B면 런북에 진입점 없음을 적는다.

### Task 1.3 단계별 송수신·예외 규칙 — #170

**Files:** `app/features/places/place-review-io.ts`, `app/features/places/place-review-errors.ts`, `app/routes/admin-place-operations.tsx`, 관련 테스트

- [ ] 검수 1–5단계와 각 intent의 요청/응답 계약을 순수 모듈로 고정한다.
- [ ] 오류 코드별 사용자 문구와 재시도/보류/제외/유지 disposition을 한 목록으로 둔다.
- [ ] 관리자 action은 알려진 코드에서 전역 500을 내지 않는다.

## 단계 2 — 운영 배포 정합

### Task 2.1 Worker·migration·배포 — #166

- [ ] 운영 계정으로 Worker SHA, Free/Paid, 원격 migration을 확인한다.
- [ ] 미적용 `0034` 등이 있으면 전용 실행 PR에 대상·검증·rollback을 적고 병합 뒤에만 apply/deploy 한다.
- [ ] Free면 Paid 전환 또는 검수 loader 분할을 같은 이슈에서 결정한다. 코드만으로 10ms를 약속하지 않는다.

## 단계 3 — 품질 게이트

### Task 3.1 테스트와 오류 계약 — #167

**Files:** `tests/e2e/place-operations.spec.ts`, `tests/e2e/admin-place-liveness.spec.ts`, `app/features/auth/login.ts`, `app/routes/login.tsx`, `app/routes/auth-google.tsx`, `app/routes/auth-naver.tsx`, `app/routes/auth-google-callback.tsx`, `app/routes/auth-naver-callback.tsx`, `app/routes/admin-place-operations.tsx`

- [ ] 삭제된 “장소 운영” 탭 E2E를 현재 파이프라인에 맞춘다.
- [ ] 검수 happy path E2E 1개를 추가한다.
- [ ] ADMIN 세션에 한해 `safeReturnTo`가 `/admin/*`를 허용한다. 비밀번호 로그인과 Google/Naver OAuth 시작·콜백이 안전한 로컬 대상을 유지하고, 확인된 역할에만 ADMIN 경로를 적용한다.
- [ ] 검수 action 예외를 화면 오류로 반환한다.
- [ ] typecheck·해당 테스트·`git diff --check`를 CI에서 통과시킨다.
- [ ] 이 이슈 PR은 커밋까지. 배포는 #166.

### Task 3.2 검수 파이프라인 운영 지표 — #171

**Files:** `app/features/admin/dashboard.server.ts`, `app/routes/admin-operations.tsx`, 관련 테스트

- [ ] 운영 대시보드가 레거시 `APPROVE_CANDIDATE`/`REJECT_CANDIDATE` 대신 `PLACE_REVIEW_*` 파이프라인 지표를 집계한다.
- [ ] 공개/보류/제외 등 관리자가 실제로 쓰는 상태를 보여 준다.

## 단계 4 — 잔여 이슈

### Task 4.1 Codex 열린 이슈 — #168

| 이슈 | 병합된 대응 | 정리 방향 |
|---|---|---|
| #144 | PR #145 `Closes #144` | 컨펌 후 닫기 또는 재현 시 새 이슈 |
| #118 | PR #119 이후 파이프라인으로 흡수 | 남은 운영 범위만 남기고 닫기 |
| #128 | PR #129, `Closes` 없음 | 컨펌 후 닫기 |
| #124 | PR #134, `Closes` 없음 | 컨펌 후 닫기 |
| #115 | PR #116 `Closes #115` | 컨펌 후 닫기 |
| #113 | PR #114 `Closes #113` | 컨펌 후 닫기 |

- [ ] 6개 각각에 닫힘 근거 또는 후속 이슈를 단다.
- [ ] TJ 컨펌 없이 닫지 않는다.

## 승인·롤백

| 행동 | 이 플랜 PR 병합만으로 승인? | 실제 승인 |
|---|---|---|
| 오딧·플랜 문서 채택 | 예. 상태가 `GO`로 기록된 뒤 병합 | 이 PR |
| 라이브 로그인 QA | 아니오 | #161 + 운영 ADMIN 접근 |
| 원격 D1 SELECT | 아니오 | #162 + 운영 CF 계정 |
| 원격 D1 apply / deploy | 아니오 | #166 전용 PR 병합 후 지정 담당자 |
| NAVER 실호출 | 아니오 | #163 전용 PR 병합 후 한도 내 |
| 코드 수정 | 아니오 | #164 #165 #167 #170 #171 각 PR |
| 잔여 이슈 닫기 | 아니오 | #168 + TJ 컨펌 |

Rollback: 이 PR은 문서만 되돌리면 된다. 후속 PR은 각자 revert. migration은 forward-fix.

## 중단 조건

- 운영 계정 접근이 없으면 단계 0의 #162·#163과 단계 2를 멈춘다. #164 설계는 코드 기준으로만 초안 가능.
- 라이브에서 0034 미적용이 확인되면 #164 UI보다 #166 apply를 먼저 한다.
- 1102가 재현되고 Free가 확인되면 Paid 결정 없이 검수 화면 최적화를 약속하지 않는다.

---

# 2026-08-17 Admin Audit Follow-up Plan

> **Status:** `GO` — TJ chat approval recorded (2026-08-17). Adopt this document and start local code follow-ups (#164 #167 #170 #171). An approving review alone is not authorization. Do not run remote D1 apply, live NAVER calls, or deploys until each dedicated PR is merged.

**Goal:** Clear the admin HOLD by covering the audit gaps, restoring missing operator UI, aligning production, and triaging leftover Codex issues.

**Parent:** [#160](https://github.com/taejunyun1/Tasted_it/issues/160)  
**Audit:** [`docs/audits/2026-08-17-admin-audit.md`](../../audits/2026-08-17-admin-audit.md)  
**Baseline:** `origin/main` `92ad073`  
**Owner:** Jay · **Confirm:** TJ · **Delegation:** TJ token exhaustion

## Audit gaps now included

| Previously skipped | Issue | Phase |
|---|---|---|
| Logged-in live click-through | [#161](https://github.com/taejunyun1/Tasted_it/issues/161) | 0 |
| Remote D1 migration list and counts | [#162](https://github.com/taejunyun1/Tasted_it/issues/162) | 0 |
| Live NAVER calls | [#163](https://github.com/taejunyun1/Tasted_it/issues/163) | 0 |
| Code/test changes and commits | [#164](https://github.com/taejunyun1/Tasted_it/issues/164) [#165](https://github.com/taejunyun1/Tasted_it/issues/165) [#167](https://github.com/taejunyun1/Tasted_it/issues/167) [#170](https://github.com/taejunyun1/Tasted_it/issues/170) [#171](https://github.com/taejunyun1/Tasted_it/issues/171) | 1–3 |
| Deploy | [#166](https://github.com/taejunyun1/Tasted_it/issues/166) | 2 |
| TJ leftover issue cleanup | [#168](https://github.com/taejunyun1/Tasted_it/issues/168) | 4 |

## Global Constraints

- Create every new branch from the latest `origin/main` as `jay_<scope>`. Do not reuse Codex/TJ branches or worktrees.
- Remote D1 is read-only SELECT. Apply, seed, and bulk UPDATE run only after a dedicated PR merges, and only by the named operator.
- Live NAVER calls stay inside the limit written in the [#163](https://github.com/taejunyun1/Tasted_it/issues/163) execution PR (default 1–3 places).
- Do not use this workstation's wrangler (a non-production personal account) to write to the production account.
- Do not attach trade names, addresses, emails, or secrets to issues, PRs, or evidence.
- Open Codex issues #113, #115, #118, #124, #128, and #144 are cleaned up only in [#168](https://github.com/taejunyun1/Tasted_it/issues/168). Do not close them from this plan PR.

## Issue map

| Phase | Issue | Audit ID | Start without further TJ confirm? |
|---|---|---|---|
| 0 | [#161](https://github.com/taejunyun1/Tasted_it/issues/161) live login reproduction | Section 8 | No. Needs a production ADMIN session |
| 0 | [#162](https://github.com/taejunyun1/Tasted_it/issues/162) remote D1 inventory | ADM-OPS-01, Section 8 | No. Needs the production CF account |
| 0 | [#163](https://github.com/taejunyun1/Tasted_it/issues/163) live NAVER sample | Section 8 | No. Needs a written call limit |
| 1 | [#164](https://github.com/taejunyun1/Tasted_it/issues/164) restore suggestion approval UI | ADM-IA-01 | After `GO` |
| 1 | [#165](https://github.com/taejunyun1/Tasted_it/issues/165) restore reverify/merge tabs (A) | ADM-IA-02 | `GO`. Default A, no auto-merge |
| 1 | [#170](https://github.com/taejunyun1/Tasted_it/issues/170) per-stage I/O and exception rules | New | Immediately after `GO` |
| 2 | [#166](https://github.com/taejunyun1/Tasted_it/issues/166) Worker plan, deploy, 0034 | ADM-OPS-01–03, Section 8 | After a dedicated PR |
| 3 | [#167](https://github.com/taejunyun1/Tasted_it/issues/167) E2E, returnTo, error screens | ADM-TEST-01, AUTH-01, ERR-01/02 | After `GO`, in a code PR |
| 3 | [#171](https://github.com/taejunyun1/Tasted_it/issues/171) pipeline ops metrics | ADM-OBS-01 | After `GO`, in a code PR |
| 4 | [#168](https://github.com/taejunyun1/Tasted_it/issues/168) six leftover Codex issues | Section 8 | No. Confirm with TJ before closing |

## Phase 0 — Evidence the audit left empty

Confirm or reject P0 hypotheses before code changes.

### Task 0.1 Live click-through — #161

- [ ] Open `/admin/place-operations` stages 1–5 and the remaining admin paths as a production ADMIN.
- [ ] Record 500 / 1102 / empty queues / missing suggestion-approval entry points per path. Do not keep personal data.
- [ ] Confirm or reject ADM-IA-01, ADM-OPS-01, and ADM-OPS-02.

### Task 0.2 Remote D1 read — #162

- [ ] From the production account, run only `wrangler d1 migrations list retaste-production --remote`.
- [ ] Record whether `0029`–`0034` are applied, plus work-item / SUBMITTED suggestion / PENDING license counts only.
- [ ] Do not apply migrations in this task.

### Task 0.3 NAVER sample — #163

- [ ] Write target environment, 1–3 places, daily cap, and rollback in the execution PR.
- [ ] Call only after that PR merges.
- [ ] Record call count and whether 1102 occurred.

**Phase 0 exit:** 0034 apply status, the actual review-screen error, and Paid/Free are written on the issue comments.

## Phase 1 — Restore missing admin work

### Task 1.1 Suggestion approval UI — #164

**Files:** `app/routes/admin-place-operations.tsx`, `app/components/admin/**`, `app/features/places/place-suggestion.server.ts`, related tests

- [ ] List SUBMITTED suggestions in review stage 1 or a dedicated tab.
- [ ] Wire existing `approvePlaceSuggestion` to the route action. Keep map confirmation and reason input.
- [ ] Approved results join the 5-stage queue as DRAFT + `PLACE_SUGGESTION` work items.
- [ ] Leave unit, integration, and desktop/mobile E2E evidence.

### Task 1.2 Reverify and merge — #165

- [ ] TJ chooses (A) restore the tabs or (B) leave them unavailable for now.
- [ ] If A, reconnect existing server functions to the route only. Do not add auto-merge.
- [ ] If B, record the missing entry points in the runbook.

### Task 1.3 Per-stage I/O and exception rules — #170

**Files:** `app/features/places/place-review-io.ts`, `app/features/places/place-review-errors.ts`, `app/routes/admin-place-operations.tsx`, related tests

- [ ] Fix request/response contracts for review stages 1–5 and each intent in a pure module.
- [ ] Keep one list of user-facing copy and retry/hold/exclude/keep dispositions per error code.
- [ ] Known admin action codes must not become a global 500.

## Phase 2 — Production deploy alignment

### Task 2.1 Worker, migration, deploy — #166

- [ ] From the production account, confirm Worker SHA, Free/Paid, and remote migrations.
- [ ] If `0034` or others are missing, write target, verification, and rollback in a dedicated execution PR and apply/deploy only after merge.
- [ ] If Free, decide Paid conversion or review-loader splits in the same issue. Do not promise 10ms from code changes alone.

## Phase 3 — Quality gates

### Task 3.1 Tests and error contract — #167

**Files:** `tests/e2e/place-operations.spec.ts`, `tests/e2e/admin-place-liveness.spec.ts`, `app/features/auth/login.ts`, `app/routes/login.tsx`, `app/routes/auth-google.tsx`, `app/routes/auth-naver.tsx`, `app/routes/auth-google-callback.tsx`, `app/routes/auth-naver-callback.tsx`, `app/routes/admin-place-operations.tsx`

- [ ] Align the deleted “place operations” tab E2E with the current pipeline.
- [ ] Add one review happy-path E2E.
- [ ] Allow `/admin/*` in `safeReturnTo` for ADMIN sessions only. Password login and Google/Naver OAuth start/callback flows must keep a safe local target and apply the admin path only after the resolved user's role is known.
- [ ] Return review action exceptions as on-screen errors.
- [ ] Pass typecheck, the scoped tests, and `git diff --check` in CI.
- [ ] This issue PR stops at commit. Deploy is #166.

### Task 3.2 Pipeline ops metrics — #171

**Files:** `app/features/admin/dashboard.server.ts`, `app/routes/admin-operations.tsx`, related tests

- [ ] Have the ops dashboard aggregate `PLACE_REVIEW_*` pipeline metrics instead of legacy `APPROVE_CANDIDATE`/`REJECT_CANDIDATE`.
- [ ] Show the states operators actually use, such as publish / hold / exclude.

## Phase 4 — Leftover issues

### Task 4.1 Open Codex issues — #168

| Issue | Merged counterpart | Cleanup direction |
|---|---|---|
| #144 | PR #145 `Closes #144` | Close after confirm, or open a new issue if reproduced |
| #118 | Absorbed into the pipeline after PR #119 | Close after leaving only remaining ops scope |
| #128 | PR #129, no `Closes` | Close after confirm |
| #124 | PR #134, no `Closes` | Close after confirm |
| #115 | PR #116 `Closes #115` | Close after confirm |
| #113 | PR #114 `Closes #113` | Close after confirm |

- [ ] Attach a close reason or a follow-up issue to each of the six.
- [ ] Do not close them without TJ confirmation.

## Approval and rollback

| Action | Approved by merging this plan PR alone? | Actual approval |
|---|---|---|
| Adopt the audit and plan docs | Yes, after the recorded status is `GO` | This PR |
| Live login QA | No | #161 + production ADMIN access |
| Remote D1 SELECT | No | #162 + production CF account |
| Remote D1 apply / deploy | No | Named operator after the dedicated #166 PR merges |
| Live NAVER calls | No | After the dedicated #163 PR merges, within the written limit |
| Code changes | No | Separate PRs for #164 #165 #167 #170 #171 |
| Close leftover issues | No | #168 + TJ confirmation |

Rollback: revert this documentation PR. Follow-up PRs revert on their own. Migrations are forward-fix only.

## Stopping conditions

- If production-account access is missing, stop phase 0 #162/#163 and phase 2. #164 design can still be drafted from code.
- If live evidence shows `0034` is not applied, do #166 apply before #164 UI.
- If 1102 reproduces and Free is confirmed, do not promise review-screen optimization without a Paid decision.
