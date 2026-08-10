# Task 7 구현 보고서: 개인정보 없는 제품 이벤트 기록

## 구현 범위

- 제품 이벤트 이름 9개와 metadata 키 5개를 단일 상수 allowlist에서 타입으로 파생해 컴파일 시점과 실행 시점 계약을 일치시켰다.
- metadata 값은 문자열 또는 유한 정수만 허용한다. 중첩 객체, 배열, `null`, 실수, `NaN`, `Infinity`, 알 수 없는 키와 이메일·이름·주소·원본 좌표 키는 `EVENT_METADATA_NOT_ALLOWED`로 거절한다.
- 이벤트 ID는 호출자 입력을 받지 않고 서버에서 무작위 UUID로 생성한다. 이메일, 이름, 주소나 좌표를 ID에 조합하지 않는다.
- 회원 ID와 비회원 세션 ID가 모두 없으면 이벤트를 쓰지 않고 `{ recorded: false, id: null }`을 반환한다. 값이 있으면 기존 `product_events` 외래 키가 실제 `users` 또는 `guest_taste_sessions` 행만 허용한다.
- 온보딩 시작은 새 비회원 세션 쿠키를 발급한 loader에서 한 번만 기록한다. 같은 쿠키를 사용한 revalidation에서는 중복 시작 이벤트를 만들지 않는다.
- 온보딩 단계 저장·완료·건너뛰기와 회원의 추천 저장·긍정·부정 반응이 성공한 뒤에만 이벤트를 기록한다. 저장 해제와 핵심 동작 실패에는 이벤트를 만들지 않는다.
- 이벤트 쓰기 실패는 성공한 사용자 동작을 취소하지 않으며 예외, ID 또는 개인정보를 로그에 포함하지 않고 `PRODUCT_EVENT_WRITE_FAILED` 고정 코드만 남긴다.
- `GUEST_CONVERTED`와 `RECOMMENDATION_DETAIL_OPENED`는 요구된 서비스 allowlist에는 포함했지만, 이번 소유 라우트에는 진실한 전환 또는 추천 출처가 보장되는 실행 지점이 없어 emit하지 않았다.

## TDD 기록

- RED 1: 신규 통합 테스트가 `onboarding-events.server` 모듈 부재로 실패하는 것을 확인했다.
- GREEN 1: 정확한 이벤트·metadata allowlist, 내부 UUID, 값 검증, identity 부재 no-op, 외래 키 실패 계약을 최소 서비스로 구현해 17개 서비스 테스트를 통과시켰다.
- RED 2: Workers 테스트의 React 모듈 해석 문제를 테스트 harness mock으로 먼저 제거한 뒤, 라우트 이벤트 행과 고정 오류 로그가 없어서 9개 행위 테스트가 실패하는 것을 확인했다.
- GREEN 2: 새 세션 loader와 성공한 온보딩·장소 상세 action에 이벤트 기록을 연결해 전체 집중 테스트 28개를 통과시켰다.

## 검증 결과

- 집중 제품 이벤트 통합: `tests/integration/onboarding-events.server.test.ts` 28개 테스트 통과
- 관련 온보딩·취향 학습 통합: 3개 파일, 47개 테스트 통과
- 관련 단위·계약: 2개 파일, 16개 테스트 통과
- 전체 단위: 75개 파일, 403개 테스트 통과
- 전체 Workers 통합: 40개 파일, 160개 테스트 통과
- `pnpm run typecheck`: 통과
- `git diff --check`: 통과

Workers 통합 테스트는 종료 코드 0으로 완료된 뒤 저장소의 기존 Vite 종료 지연 경고를 출력했다. AI binding 접근 가능성 경고도 표시됐지만 테스트에서 Workers AI API를 호출하지 않았다.

## 운영 영향과 남은 확인

- 신규 migration, 의존성, lockfile, 환경 변수 변경은 없다. Task 1에서 추가한 `product_events` 테이블을 그대로 사용한다.
- 원격 D1 변경, Workers AI 호출, 이메일 발송, 유료 API 호출, push, PR, 병합, 배포를 수행하지 않았다.
- 기능 브랜치와 worktree는 다음 Task 또는 독립 리뷰가 이어질 수 있도록 로컬에 보존한다.
