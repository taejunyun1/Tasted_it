# 2026-08-17 관리자 오딧 후속 실행 계획

> **상태:** `PROPOSED` — TJ 컨펌 전 착수하지 않는다. 이 문서를 포함한 Pull Request가 상태를 `GO`로 바꾸거나 TJ가 승인 리뷰를 남기기 전에는 구현·원격 D1·NAVER 실호출·배포를 승인하지 않는다.

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
| 코드/테스트 수정, 커밋 | [#164](https://github.com/taejunyun1/Tasted_it/issues/164) [#165](https://github.com/taejunyun1/Tasted_it/issues/165) [#167](https://github.com/taejunyun1/Tasted_it/issues/167) | 1–3 |
| 배포 | [#166](https://github.com/taejunyun1/Tasted_it/issues/166) | 2 |
| TJ 잔여 이슈 정리 | [#168](https://github.com/taejunyun1/Tasted_it/issues/168) | 4 |

## Global Constraints

- 모든 신규 브랜치는 최신 `origin/main`에서 `jay_<scope>`로 만든다. Codex/TJ 브랜치와 worktree를 재사용하지 않는다.
- 원격 D1은 읽기 전용 SELECT만. apply·시드·대량 UPDATE는 전용 PR이 병합된 뒤에만 지정 담당자가 실행한다.
- NAVER 실호출은 [#163](https://github.com/taejunyun1/Tasted_it/issues/163) 실행 PR에 적힌 한도(기본 1–3곳) 안에서만 한다.
- 이 워크스테이션 wrangler(`deximple@gmail.com`)로 운영 계정에 쓰지 않는다.
- 상호명·주소·이메일·비밀값을 이슈/PR/증거에 붙이지 않는다.
- 열린 Codex 이슈 #113·#115·#118·#124·#128·#144는 [#168](https://github.com/taejunyun1/Tasted_it/issues/168)에서만 정리한다. 이 플랜 PR에서 닫지 않는다.

## 이슈 지도

| 단계 | 이슈 | 오딧 ID | TJ 컨펌 없이 시작? |
|---|---|---|---|
| 0 | [#161](https://github.com/taejunyun1/Tasted_it/issues/161) 라이브 로그인 재현 | 섹션 8 | 아니오. 운영 ADMIN 세션 필요 |
| 0 | [#162](https://github.com/taejunyun1/Tasted_it/issues/162) 원격 D1 인벤토리 | ADM-OPS-01, 섹션 8 | 아니오. 운영 CF 계정 필요 |
| 0 | [#163](https://github.com/taejunyun1/Tasted_it/issues/163) NAVER 실호출 표본 | 섹션 8 | 아니오. 한도 승인 필요 |
| 1 | [#164](https://github.com/taejunyun1/Tasted_it/issues/164) 제안 승인 UI 복구 | ADM-IA-01 | 아니오. 플랜 GO 후 |
| 1 | [#165](https://github.com/taejunyun1/Tasted_it/issues/165) 재검증·병합 복구 또는 제외 | ADM-IA-02 | 아니오. A/B 결정 필요 |
| 2 | [#166](https://github.com/taejunyun1/Tasted_it/issues/166) Worker 플랜·배포·0034 | ADM-OPS-01–03, 섹션 8 | 아니오 |
| 3 | [#167](https://github.com/taejunyun1/Tasted_it/issues/167) E2E·returnTo·오류 화면 | ADM-TEST-01, AUTH-01, ERR-01/02 | 아니오. 플랜 GO 후 코드 PR |
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

## 단계 2 — 운영 배포 정합

### Task 2.1 Worker·migration·배포 — #166

- [ ] 운영 계정으로 Worker SHA, Free/Paid, 원격 migration을 확인한다.
- [ ] 미적용 `0034` 등이 있으면 전용 실행 PR에 대상·검증·rollback을 적고 병합 뒤에만 apply/deploy 한다.
- [ ] Free면 Paid 전환 또는 검수 loader 분할을 같은 이슈에서 결정한다. 코드만으로 10ms를 약속하지 않는다.

## 단계 3 — 품질 게이트

### Task 3.1 테스트와 오류 계약 — #167

**Files:** `tests/e2e/place-operations.spec.ts`, `tests/e2e/admin-place-liveness.spec.ts`, `app/features/auth/login.ts`, `app/routes/admin-place-operations.tsx`

- [ ] 삭제된 “장소 운영” 탭 E2E를 현재 파이프라인에 맞춘다.
- [ ] 검수 happy path E2E 1개를 추가한다.
- [ ] ADMIN 세션에 한해 `safeReturnTo`가 `/admin/*`를 허용한다.
- [ ] 검수 action 예외를 화면 오류로 반환한다.
- [ ] typecheck·해당 테스트·`git diff --check`를 CI에서 통과시킨다.
- [ ] 이 이슈 PR은 커밋까지. 배포는 #166.

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
| 오딧·플랜 문서 채택 | 예. TJ가 `GO`로 바꾼 뒤 병합 | 이 PR |
| 라이브 로그인 QA | 아니오 | #161 + 운영 ADMIN 접근 |
| 원격 D1 SELECT | 아니오 | #162 + 운영 CF 계정 |
| 원격 D1 apply / deploy | 아니오 | #166 전용 PR 병합 후 지정 담당자 |
| NAVER 실호출 | 아니오 | #163 전용 PR 병합 후 한도 내 |
| 코드 수정 | 아니오 | #164 #165 #167 각 PR |
| 잔여 이슈 닫기 | 아니오 | #168 + TJ 컨펌 |

Rollback: 이 PR은 문서만 되돌리면 된다. 후속 PR은 각자 revert. migration은 forward-fix.

## 중단 조건

- 운영 계정 접근이 없으면 단계 0의 #162·#163과 단계 2를 멈춘다. #164 설계는 코드 기준으로만 초안 가능.
- 라이브에서 0034 미적용이 확인되면 #164 UI보다 #166 apply를 먼저 한다.
- 1102가 재현되고 Free가 확인되면 Paid 결정 없이 검수 화면 최적화를 약속하지 않는다.

---

# 2026-08-17 Admin Audit Follow-up Plan

> **Status:** `PROPOSED` — Do not start implementation, remote D1 writes, live NAVER calls, or deploys until TJ marks this plan `GO` or leaves an approving review.

**Goal:** Clear the admin HOLD by covering the audit gaps, restoring missing operator UI, aligning production, and triaging leftover Codex issues.

**Parent:** [#160](https://github.com/taejunyun1/Tasted_it/issues/160)  
**Audit:** [`docs/audits/2026-08-17-admin-audit.md`](../../audits/2026-08-17-admin-audit.md)  
**Baseline:** `origin/main` `92ad073`  
**Owner:** Jay · **Confirm:** TJ

## Audit gaps now included

| Previously skipped | Issue | Phase |
|---|---|---|
| Logged-in live click-through | [#161](https://github.com/taejunyun1/Tasted_it/issues/161) | 0 |
| Remote D1 migration list and counts | [#162](https://github.com/taejunyun1/Tasted_it/issues/162) | 0 |
| Live NAVER calls | [#163](https://github.com/taejunyun1/Tasted_it/issues/163) | 0 |
| Code/test changes and commits | [#164](https://github.com/taejunyun1/Tasted_it/issues/164) [#165](https://github.com/taejunyun1/Tasted_it/issues/165) [#167](https://github.com/taejunyun1/Tasted_it/issues/167) | 1–3 |
| Deploy | [#166](https://github.com/taejunyun1/Tasted_it/issues/166) | 2 |
| TJ leftover issue cleanup | [#168](https://github.com/taejunyun1/Tasted_it/issues/168) | 4 |

Merging this documentation PR adopts the plan only after TJ sets `GO`. It does not approve remote D1 apply, NAVER calls, or production deploy. Each follow-up issue owns its own approval scope.
