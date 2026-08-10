# Task 8 구현 보고서: 모바일·데스크톱 사용자 흐름 검증

## 구현 범위

- `tests/e2e/taste-onboarding.spec.ts`에 데스크톱과 Pixel 7이 같은 시나리오를 실행하는 7개 독립 사용자 흐름을 추가했다.
- 완료와 추천 미리보기, 건너뛰기 후 재진입, FOOD 5개/STYLE 3개 상한, 중간 이탈 복원, 키보드 선택과 단계 제목 포커스, 위치 권한 거부 후 기본값, 로그인 `returnTo`와 비회원 취향 단일 병합을 고정했다.
- E2E는 로컬 D1과 로컬 시드만 사용한다. 로그인 병합용 프로젝트별 합성 회원은 테스트 서버 시작 전에 기존 QA seed로 초기화한다. 브라우저 실행 중에는 같은 서버의 loader/action/UI만 사용하며 test-side `wrangler d1` subprocess는 없다. 실제 계정, 개인정보, 원본 위치 좌표, 외부 인증 제공자를 사용하지 않는다.
- 기존 Playwright의 `Desktop Chrome`과 `Pixel 7` 프로젝트가 요구 viewport를 모두 제공한다. `reuseExistingServer: false`로 다른 worktree의 5173 서버를 잘못 재사용하지 않도록 했다.
- `design-qa.md`에 검증 시각, 두 viewport, 흐름별 증거, 개인정보 경계, 전체 E2E 기준선 실패 분리를 추가했다.

## 발견한 실제 사용자 흐름 결함과 최소 수정

- E2E RED에서 장소 상세 로그인 링크의 주소창에는 정확한 `returnTo`가 있었지만 로그인 loader가 hidden input 값을 `/`로 바꾸는 것을 재현했다.
- 원인은 `app/features/auth/login.ts`의 `safeReturnTo`가 입력과 무관하게 항상 `/`를 반환하는 기존 계약이었다. 인증이나 병합 뒤가 아니라 로그인 입력 경계에서 목적지가 유실됐다.
- ownership을 `app/features/auth/login.ts`, 기존 unit 2개, 기존 `tests/integration/guest-merge.server.test.ts`의 목적지 기대값으로만 확장했다.
- 수정된 helper는 canonical same-origin `/places`와 `/places/...`만 보존한다. 외부 URL, protocol-relative URL, 역슬래시/중첩 인코딩 우회, `/admin`, `/auth`, 그 밖의 경로는 계속 `/`로 제한한다.
- 이메일, Google, Naver 로그인에서 세션 쿠키 조합과 비회원 취향 병합 구현은 변경하지 않았다. 기존 integration은 이메일의 제출 목적지만 `/places`로 기대하도록 갱신했고 OAuth 목적지 계약은 그대로다.

## TDD와 디버깅 기록

- RED 1: 최초 desktop E2E 7개 중 로그인 복귀·병합 1개만 실패했다. 기대 hidden `returnTo`는 장소 상세였고 실제는 `/`였다. 나머지 6개는 통과했다.
- RED 2: unit 계약을 먼저 바꾼 뒤 14개 중 3개가 예상대로 실패해 helper가 `/places`를 보존하지 않음을 고정했다.
- GREEN 1: 최소 allowlist validator 구현 뒤 unit 회귀가 통과했고 desktop E2E 7개가 통과했다. 자체 리뷰에서 double-encoded 경로 정규화 우회를 RED로 추가한 뒤 원본·반복 디코딩 pathname을 모두 allowlist로 검증했다.
- GREEN 2: mobile E2E 동일 7개가 통과했다.
- 관련 Workers integration 첫 실행은 64개 중 62개 통과, 이메일 로그인 목적지의 오래된 `/` 기대 2개만 실패했다. 기대값을 제출된 `/places`로 맞춘 뒤 64개 모두 통과했다.
- 추천 실패 retry를 plain JSON route interception으로 시도했지만 React Router의 `.data` 직렬화 프로토콜을 우회해 root error boundary를 만든 harness 실패였다. 실제 사용자 실패를 나타내지 않으므로 해당 가짜 E2E는 제거했다. 성공 preview 렌더는 E2E로, 오류 상태와 `다시 불러오기` 렌더 계약은 기존 `taste-onboarding-contract.test.ts`로 유지했다.

## 독립 리뷰 수정

- 올바른 집중 명령은 `pnpm run test:e2e tests/e2e/taste-onboarding.spec.ts`다. 잘못된 `--` 구문을 Task 8 brief와 구현 plan의 세 위치에서 제거했다.
- 리뷰 RED: 전체 병렬 E2E에서 test-side `wrangler d1 execute`가 dev server와 경쟁해 mobile 선택 제한에 `SQLITE_BUSY`를 추가했다. 모든 test-side D1 읽기·쓰기를 제거하고 startup seed + 브라우저 UI assertion으로 바꿨다.
- 리뷰 RED: STYLE에서 제출 전 선택한 `노포파`가 재진입 직후 `aria-pressed=false`로 desktop/mobile 모두 실패했다. dirty selection을 `visibilitychange/pagehide`에서 `sendBeacon` 한 번으로 저장하고, `SAVE_SELECTION` action이 현재 단계에 저장하되 단계 완료 이벤트를 만들지 않도록 했다.
- 리뷰 GREEN: 재진입 직후 `노포파`, 이전 단계의 `국밥러`, 제목 focus가 두 viewport에서 모두 복원됐다. unit route 계약과 실제 D1 integration이 현재 단계 저장·무이벤트를 고정한다.
- 위치 거부는 init script가 geolocation error callback을 호출하고 `getCurrentPosition` 호출 횟수가 정확히 1인지 확인한 뒤 fallback을 assert하도록 바꿨다.
- 로그인 fixture는 server-start seed에 둔 두 합성 회원을 사용한다. 로그인·returnTo 후 같은 브라우저의 `/me`에서 병합된 `국밥러`를 확인하므로 브라우저와 assertion이 같은 worktree 서버·DB를 사용한다.

## 독립 재리뷰 수정

- 재리뷰 RED는 실제 D1 action 순서로 네 건을 고정했다. 최신 SAVE_STEP 뒤 늦은 선택은 step/배지를 되돌렸고, COMPLETE와 SKIP 뒤 늦은 선택은 최신 STYLE 배지를 지웠으며, merge 뒤 stale cookie는 새 30일 guest session을 만들었다.
- `guest_taste_sessions.selection_revision`을 forward migration으로 추가했다. loader revision을 기준으로 client가 정상 submit과 beacon 모두 단조 증가시키며, server batch의 badge delete/insert와 session update는 같은 `현재 server step + 더 큰 revision + 미완료 + 미건너뜀 + 미병합 + 미만료` CAS 조건을 공유한다.
- COMPLETE/SKIP timestamp는 선택·step·revision과 같은 D1 batch에서 기록된다. 이전 revision뿐 아니라 이미 지난 server step에서 온 더 큰 revision도 no-op이므로 오래된 snapshot이 최신 상태를 덮지 못한다.
- `SAVE_SELECTION` action은 기존 writable cookie session만 조회한다. cookie가 없거나 세션이 완료·건너뜀·병합·만료됐으면 `getOrCreateGuestSession`에 진입하지 않고 no-op하므로 orphan guest data를 만들지 않는다. 기존 30일 TTL과 개인정보 최소화 경계는 유지했다.
- 재리뷰 TDD GREEN은 old selection → newer step/COMPLETE/SKIP/merge → delayed selection 순서를 실제 D1로 검증하며 step, revision, terminal timestamp, badge, session 개수와 Set-Cookie 무생성을 확인한다.
- 하나의 local D1을 공유하는 전체 E2E는 Playwright worker를 항상 `1`로 고정했다. 정확한 전체 명령 2회 모두 기존 4개 실패 외 추가 D1 오류 없이 같은 결과를 냈다.

## 최종 독립 리뷰 수정

- 최종 리뷰 RED는 서로 다른 document가 server revision `N`을 함께 읽고 local revision `N+1`을 재사용할 수 있음을 지적했다. Beacon enqueue와 commit 사이에 재진입하거나 복수 탭을 열면 실제 최신 payload가 네트워크 도착 순서에 따라 거절될 수 있었다.
- `guest_taste_sessions.selection_epoch` forward migration을 추가했다. 각 loader는 writable session에서 epoch를 원자적으로 `+1` claim하고 revision을 `0`으로 초기화하며, claim statement가 반환한 고유 epoch를 해당 document에 발급한다.
- 정상 submit과 beacon은 hidden `selectionEpoch`와 document-local `selectionRevision`을 함께 보낸다. Server batch는 현재 epoch가 정확히 일치하고 revision이 더 큰 경우만 badge/step/lifecycle을 갱신한다. 새 loader가 epoch를 claim한 시점부터 이전 document의 action은 local revision 값이나 도착 순서와 관계없이 거절된다.
- 실제 D1 TDD는 E rev1 old payload와 E+1 rev1 new payload를 `old→new`, `new→old` 순서로 각각 전달해 두 경우 모두 E+1 payload만 최종 상태가 됨을 확인한다. 동시에 실행한 loader claim 두 건도 서로 다른 증가 epoch `1`, `2`를 반환했다.
- 기존 SAVE_SELECTION 무생성, terminal/merge/expiry dominance, 30일 TTL, 합성 fixture·좌표 비수집 개인정보 경계는 그대로 유지했다.

## 검증 결과

- 변경 전 전체 E2E 기준선: 88개 통과, 8개 의도적 건너뜀, 4개 실패.
  - `browse.spec.ts`: desktop/mobile에서 신규 온보딩이 `/places.data`를 return path로 받아 기존 URL 기대가 실패했다.
  - `map-zoom.spec.ts`: desktop/mobile에서 선택 후 기대 zoom 16 대신 12를 유지했다.
  - 두 실패 묶음은 Task 8 변경 전 재현됐으며 집중 spec 회귀와 분리했다.
- 관련 unit: `pnpm vitest run tests/unit/onboarding.test.ts tests/unit/taste-onboarding-contract.test.ts tests/unit/auth-login.test.ts tests/unit/login-return-to.test.ts` — 4개 파일, 31개 테스트 통과.
- 관련 Workers integration: `pnpm vitest run tests/integration/guest-onboarding.server.test.ts tests/integration/guest-merge.server.test.ts tests/integration/onboarding-events.server.test.ts --config vitest.workers.config.ts` — 3개 파일, 73개 테스트 통과. AI binding 경고는 표시됐지만 테스트가 AI API를 호출하지 않았다.
- desktop Task 8 E2E: 7개 통과.
- mobile Task 8 E2E: 7개 통과.
- 집중 E2E: `pnpm run test:e2e tests/e2e/taste-onboarding.spec.ts` — desktop 7개 + mobile 7개, 합계 14개 통과 (`26.4s`, 1 worker).
- 전체 E2E 1회차: 정확한 `pnpm run test:e2e` — 114개 중 102개 통과, 8개 의도적 건너뜀, 기존 4개 실패 (`2.2m`).
- 전체 E2E 2회차: 정확한 `pnpm run test:e2e` — 114개 중 102개 통과, 8개 의도적 건너뜀, 동일한 기존 4개 실패 (`2.1m`). 두 실행 모두 `browse.spec.ts` desktop/mobile과 `map-zoom.spec.ts` desktop/mobile의 기존 서명뿐이며 D1 internal error, timeout, `SQLITE_BUSY`, Task 8 신규 실패는 없다.
- epoch 수정 후 전체 E2E: 정확한 `pnpm run test:e2e` — 114개 중 102개 통과, 8개 의도적 건너뜀, 동일한 기존 4개 실패 (`2.2m`). Task 8 신규 실패나 추가 D1 오류는 없다.
- `pnpm run typecheck`: Wrangler types, React Router typegen, `tsc -b` 통과.
- `git diff --check`: 통과.
- Workers integration은 종료 코드 0 이후 저장소의 기존 Vite 종료 지연 경고를 출력했지만 이어진 Playwright까지 정상 실행됐다.

## 변경 파일

- `tests/e2e/taste-onboarding.spec.ts`
- `design-qa.md`
- `app/features/auth/login.ts`
- `tests/unit/auth-login.test.ts`
- `tests/unit/login-return-to.test.ts`
- `tests/integration/guest-merge.server.test.ts`
- `app/components/onboarding/TasteOnboarding.tsx`
- `app/routes/taste-onboarding.tsx`
- `app/features/onboarding/guest-session.server.ts`
- `app/db/schema.ts`
- `drizzle/0021_guest_onboarding_selection_revision.sql`
- `drizzle/0022_guest_onboarding_selection_epoch.sql`
- `tests/unit/taste-onboarding-contract.test.ts`
- `tests/integration/guest-onboarding.server.test.ts`
- `tests/integration/onboarding-events.server.test.ts`
- `scripts/seed-admin-qa.sql`
- `playwright.config.ts`
- `docs/superpowers/plans/2026-08-10-app-first-taste-onboarding.md`
- `.superpowers/sdd/task-8-report.md` (SDD 인수인계 기록, gitignore 대상)

## 운영 영향과 남은 확인

- forward migration 2개가 `selection_revision INTEGER NOT NULL DEFAULT 0`과 `selection_epoch INTEGER NOT NULL DEFAULT 0`을 추가한다. 기존 TTL, 의존성, lockfile, 환경 변수는 바뀌지 않았다. Playwright는 server 재사용을 비활성화하고 shared-D1 worker를 1로 제한했으며 QA seed에는 합성 test-only 회원 두 행만 둔다.
- 원격 D1, 외부 인증 제공자, 이메일 발송, Workers AI, 유료 API, push, PR, merge, deploy를 실행하지 않았다.
- 변경 전 전체 E2E의 기존 4개 실패는 Task 9 전체 회귀 또는 해당 소유 작업에서 별도로 조정해야 한다.
