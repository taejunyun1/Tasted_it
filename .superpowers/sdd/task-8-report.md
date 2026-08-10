# Task 8 구현 보고서: 모바일·데스크톱 사용자 흐름 검증

## 구현 범위

- `tests/e2e/taste-onboarding.spec.ts`에 데스크톱과 Pixel 7이 같은 시나리오를 실행하는 7개 독립 사용자 흐름을 추가했다.
- 완료와 추천 미리보기, 건너뛰기 후 재진입, FOOD 5개/STYLE 3개 상한, 중간 이탈 복원, 키보드 선택과 단계 제목 포커스, 위치 권한 거부 후 기본값, 로그인 `returnTo`와 비회원 취향 단일 병합을 고정했다.
- E2E는 로컬 D1과 로컬 시드만 사용한다. 로그인 병합은 프로젝트별 합성 회원과 로컬 전용 비밀번호 hash를 만들고 테스트 종료 시 회원·세션·취향·제품 이벤트·비회원 세션을 삭제한다. 실제 계정, 개인정보, 원본 위치 좌표, 외부 인증 제공자를 사용하지 않는다.
- 기존 Playwright의 `Desktop Chrome`과 `Pixel 7` 프로젝트가 요구 viewport를 모두 제공하므로 `playwright.config.ts`는 변경하지 않았다.
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

## 검증 결과

- 변경 전 전체 E2E 기준선: 88개 통과, 8개 의도적 건너뜀, 4개 실패.
  - `browse.spec.ts`: desktop/mobile에서 신규 온보딩이 `/places.data`를 return path로 받아 기존 URL 기대가 실패했다.
  - `map-zoom.spec.ts`: desktop/mobile에서 선택 후 기대 zoom 16 대신 12를 유지했다.
  - 두 실패 묶음은 Task 8 변경 전 재현됐으며 집중 spec 회귀와 분리했다.
- 관련 unit: 4개 파일, 29개 테스트 통과.
- 관련 Workers integration: 3개 파일, 64개 테스트 통과. AI binding 경고는 표시됐지만 테스트가 AI API를 호출하지 않았다.
- desktop Task 8 E2E: 7개 통과.
- mobile Task 8 E2E: 7개 통과.
- 최종 결합 E2E: desktop/mobile 합계 14개 통과.
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
- `.superpowers/sdd/task-8-report.md` (SDD 인수인계 기록, gitignore 대상)

## 운영 영향과 남은 확인

- migration, 의존성, lockfile, 환경 변수, Playwright 설정 변경은 없다.
- 원격 D1, 외부 인증 제공자, 이메일 발송, Workers AI, 유료 API, push, PR, merge, deploy를 실행하지 않았다.
- 변경 전 전체 E2E의 기존 4개 실패는 Task 9 전체 회귀 또는 해당 소유 작업에서 별도로 조정해야 한다.
