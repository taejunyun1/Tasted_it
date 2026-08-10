# Task 3 구현 보고서

## 결과

- `/onboarding/taste` React Router Framework Mode 경로와 loader/action을 추가했다.
- 로그인 사용자는 검증된 내부 `returnTo`로 이동하고, 비회원은 D1 세션을 생성하거나 복원한다.
- `SAVE_STEP`, `SKIP`, `COMPLETE` 요청을 Zod 스키마로 검증하고 반복 배지 필드는 `FormData.getAll()`로 조립한다.
- `SKIP`은 `skippedAt`, `COMPLETE`는 `completedAt`을 기록한 뒤 `returnTo`로 이동한다.
- 위치 원본 좌표는 `sessionStorage`에만 저장하고 서버 세션에는 `locationMode`만 저장한다. 기기 위치를 사용한 완료 이동은 해당 `/places` 요청의 `bbox`에만 좌표를 전달한다.
- 모바일 44px 터치 영역, 100dvh 프레임, 데스크톱 720px 카드, 키보드 포커스와 선택 아이콘을 포함한 반응형 스타일을 추가했다.
- `ONBOARDING_ENABLED=true` 기본 바인딩과 Env 타입을 추가했다.

## TDD 및 검증

- RED: `pnpm vitest run tests/unit/taste-onboarding-contract.test.ts` — 경로 등록 계약 부재로 1개 실패 확인.
- GREEN: 같은 계약 테스트 — 1개 통과.
- 전체 단위 테스트: `pnpm vitest run tests/unit` — 75개 파일, 379개 테스트 통과.
- 타입 검사: `pnpm run typecheck` 통과.
- 최종 타입 재검증: `pnpm exec react-router typegen && pnpm exec tsc -b` 통과.
- 형식 검사: `git diff --check` 통과.

## 운영 영향과 우려

- 원격 D1 적용, 운영 배포, 외부 유료 호출은 수행하지 않았다.
- `worker-configuration.d.ts`는 저장소에서 기본적으로 무시되는 Wrangler 생성 파일이다. `pnpm run typecheck`로 `ONBOARDING_ENABLED` 타입 생성을 확인했으며, 14,000줄 이상의 생성물을 강제 추적하지 않고 소스 바인딩인 `wrangler.jsonc`만 커밋한다.
- 실제 브라우저의 위치 권한 허용/거부 및 390px·1440px 시각 증거는 이 단위 작업에서 캡처하지 않았다. PR 작성 전 별도 확인이 필요하다.

## 리뷰 수정 검증

- 단계 제출 시 로컬 화면 상태를 먼저 변경하지 않고, loader 재검증으로 저장된 단계가 돌아온 뒤에만 화면을 갱신하도록 수정했다. `이전`도 동일하게 서버 저장 후 이동한다.
- `returnTo`는 반복 URL 디코딩, 역슬래시·프로토콜 상대 경로 거부, 동일 출처 URL 파싱을 통과한 내부 경로만 허용한다.
- `GUEST_ONBOARDING_BADGES_INVALID`만 사용자 입력 오류로 식별해 400을 반환하며 예상하지 못한 오류는 다시 던진다.
- 단계 제목 포커스 이동과 실제 `progressbar` ARIA 값을 추가했다.
- RED: `pnpm vitest run tests/unit/taste-onboarding-contract.test.ts` — 9개 중 6개 실패로 단계 경쟁, 접근성, 악성 경로 3종, 구형 배지 오류를 재현했다.
- 집중 검증: `pnpm vitest run tests/unit/taste-onboarding-contract.test.ts tests/unit/onboarding.test.ts` — 2개 파일, 12개 테스트 통과.
- 타입 검사: `pnpm run typecheck` 통과.
- 전체 단위 테스트: `pnpm vitest run tests/unit` — 75개 파일, 387개 테스트 통과.
- 형식 검사: `git diff --check` 통과.
