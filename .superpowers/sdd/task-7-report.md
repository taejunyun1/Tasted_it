# Task 7 구현 보고서: 개인정보 없는 제품 이벤트 기록

## 구현 범위

- 제품 이벤트 이름 9개와 metadata 키 5개를 단일 상수 allowlist에서 타입으로 파생해 컴파일 시점과 실행 시점 계약을 일치시켰다.
- metadata 값은 문자열 또는 유한 정수만 허용한다. 중첩 객체, 배열, `null`, 실수, `NaN`, `Infinity`, 알 수 없는 키와 이메일·이름·주소·원본 좌표 키는 `EVENT_METADATA_NOT_ALLOWED`로 거절한다.
- 이벤트 ID는 기본적으로 서버에서 무작위 UUID로 생성한다. 추천 상세 열람의 revalidation 중복 방지에 한해 `PlaceCard`가 생성한 UUID v4 요청 ID를 허용하며, UUID 형식이 아닌 호출자 ID는 거절한다. 이메일, 이름, 주소나 좌표를 ID에 조합하지 않는다.
- 회원 ID와 비회원 세션 ID가 모두 없으면 이벤트를 쓰지 않고 `{ recorded: false, id: null }`을 반환한다. 값이 있으면 기존 `product_events` 외래 키가 실제 `users` 또는 `guest_taste_sessions` 행만 허용한다.
- 온보딩 시작과 비회원 전환에는 `(guest_session_id, event_name)` 부분 유일 인덱스를 적용했다. 모든 성공한 온보딩 loader가 시작 이벤트를 insert-if-absent로 시도하므로 같은 세션의 순차·동시 revalidation은 한 행만 남긴다.
- 쿠키가 전혀 없는 동시 요청은 브라우저 지문 없이 각각 새 무작위 비회원 세션을 발급하므로 서로 다른 측정 단위다. 이 경우 세션마다 시작 이벤트 한 건이 기록되는 정직한 한계를 유지한다.
- 온보딩 폼은 `currentStep`, `targetStep`, `direction`을 구분한다. 서버는 실제 인접 이동을 검증하고 전진 성공에만 현재 단계를 완료로 기록한다. 뒤로 가기에는 완료 이벤트가 없으며, 건너뛰기는 현재 단계, 선택 개수는 FOOD 또는 STYLE 해당 단계만 기록한다.
- 최초 원자적 비회원 취향 병합이 성공한 경계에서만 `GUEST_CONVERTED`를 insert-if-absent로 기록한다. 반복·동시 병합은 중복을 만들지 않으며 이벤트 실패도 병합과 비회원 쿠키 만료를 취소하지 않는다.
- 추천 `PlaceCard`는 PERSONAL/TRUSTED/GOLDEN rail과 해당 rail에서 가능한 discovery mode 조합만 상세 URL에 전달한다. 클릭 시 개인정보 없는 UUID 요청 ID를 추가한다. 서버는 세 값을 함께 검증하고 성공한 상세 loader에서 `RECOMMENDATION_DETAIL_OPENED`를 요청당 한 번 기록한다.
- 모바일 추천 card도 slug가 아니라 같은 recommendation request path 전체를 sheet callback에 전달한다. 목록 URL 상태, sheet loader, 회원 save form action, 비회원 login `returnTo`까지 동일한 검증된 same-origin 상대 경로를 유지한다.
- sheet가 수용하는 경로는 query 없는 단일 `/places/:slug` 또는 source rail·discovery mode·UUID 요청 ID가 모두 있는 정확한 추천 경로뿐이다. 외부 origin, protocol-relative URL, 경로 정규화 우회, 알 수 없는·중복·부분 query, 허용되지 않은 rail/mode 조합을 거절한다. 지도와 전체 목록의 직접 경로는 계속 query가 없다.
- 추천 출처가 검증된 상세 action의 저장·긍정·부정 성공만 추천 이벤트로 기록한다. 직접 URL, 지도·전체 목록, 잘못된 출처 조합, 저장 해제와 핵심 동작 실패에는 추천 이벤트를 만들지 않는다.
- 이벤트 쓰기 실패는 성공한 사용자 동작을 취소하지 않으며 예외, ID 또는 개인정보를 로그에 포함하지 않고 `PRODUCT_EVENT_WRITE_FAILED` 고정 코드만 남긴다.

## TDD 기록

- RED 1: 신규 통합 테스트가 `onboarding-events.server` 모듈 부재로 실패하는 것을 확인했다.
- GREEN 1: 정확한 이벤트·metadata allowlist, 내부 UUID, 값 검증, identity 부재 no-op, 외래 키 실패 계약을 최소 서비스로 구현해 17개 서비스 테스트를 통과시켰다.
- RED 2: Workers 테스트의 React 모듈 해석 문제를 테스트 harness mock으로 먼저 제거한 뒤, 라우트 이벤트 행과 고정 오류 로그가 없어서 9개 행위 테스트가 실패하는 것을 확인했다.
- GREEN 2: 새 세션 loader와 성공한 온보딩·장소 상세 action에 이벤트 기록을 연결해 전체 집중 테스트 28개를 통과시켰다.

## 독립 리뷰 수정 TDD 기록

- RED/GREEN: 실제 `TasteOnboarding` 렌더 결과와 공유 navigation helper로 현재·목적지·방향 분리 부재를 재현했다. action 계약을 함께 변경해 전진·뒤로·건너뛰기와 단계별 선택 개수를 검증했다.
- RED/GREEN: 8개 동시 lifecycle insert가 모두 성공하고 병합 후 전환 이벤트가 0건인 결함을 재현했다. 신규 `0020_product_event_lifecycle_uniqueness.sql` 부분 유일 인덱스와 conflict-safe insert로 같은 비회원 세션의 시작·전환을 각각 한 건으로 제한했다.
- RED/GREEN: 세 개의 동시 병합에서 전환 이벤트가 없고 강제 event insert 실패 로그도 없는 상태를 재현했다. 최초 merge marker 1행 변경 뒤에만 전환 이벤트를 시도하고 실패를 `PRODUCT_EVENT_WRITE_FAILED`로 격리했다.
- RED/GREEN: 추천 URL helper와 상세 열람이 없고 직접 저장도 추천 저장으로 오기록되는 상태를 재현했다. 실제 `PlaceCard` 경로, rail/mode 조합 검증, UUID request dedupe, loader/action 실행 테스트로 수정했다.
- RED/GREEN: 같은 기존 비회원 세션의 동시 loader revalidation이 시작 이벤트를 0건 남기는 상태를 재현했다. 모든 성공 loader의 insert-if-absent로 한 건을 보장하고, 쿠키 없는 동시 요청은 서로 다른 세션임을 별도 회귀로 고정했다.
- RED/GREEN: detail loader 후반 실패 전에 상세 열람이 먼저 기록되는 상태와 불가능한 GOLDEN/EXPLORATION 조합 수용을 재현했다. 전체 loader 성공 뒤 기록하고 `PlaceCard`가 만들 수 있는 조합만 허용하도록 수정했다.

## 모바일 sheet 재리뷰 수정 TDD 기록

- RED/GREEN: Pixel 7 viewport에서 실제 PERSONAL rail card를 눌렀을 때 UUID 추천 경로가 취소되고 `place=<slug>`만 남아 상세·저장 이벤트가 누락되는 흐름을 브라우저로 재현했다. callback과 목록 상태가 검증된 전체 request path를 전달하도록 수정하고 실제 D1에 `RECOMMENDATION_DETAIL_OPENED`, `RECOMMENDATION_SAVED`가 정확한 metadata로 각각 한 건 남는지 검증했다.
- RED/GREEN: 외부 URL과 query 없는 경로도 recommendation request ID helper가 수용하고, `/places/a/../b`가 정규화되어 허용되는 결함을 단위 테스트로 재현했다. canonical same-origin 상대 경로와 정확한 query key·값·조합만 허용하도록 차단했다.
- RED/GREEN: sheet save 성공 응답이 detail fetcher data를 덮어 `data.place` 렌더 오류를 만드는 실제 브라우저 실패를 재현했다. loader와 save fetcher를 분리해 성공 action이 상세 내용을 깨뜨리지 않도록 했다.
- 실제 모바일 전체 목록 save, 직접 상세 loader, 지도 pin→sheet loader가 query 없는 경로를 사용하고 추천 이벤트를 한 건도 만들지 않는 회귀를 추가했다. 완료한 비회원 세션의 추천 rail→sheet 로그인 링크도 동일 추천 경로를 인코딩한 `returnTo`로 유지하는지 실행 검증했다.

## 검증 결과

- 집중 제품 이벤트 통합: `tests/integration/onboarding-events.server.test.ts` 41개 테스트 통과
- 관련 통합: 5개 파일, 78개 테스트 통과
- 관련 단위·계약: 5개 파일, 34개 테스트 통과
- 모바일 경로 단위·계약: 2개 파일, 8개 테스트 통과
- 관련 Playwright 전체 spec: 9개 통과, desktop에서 mobile 전용 3개 의도적 skip
- 전체 단위: 75개 파일, 406개 테스트 통과
- 전체 Workers 통합: 40개 파일, 175개 테스트 통과
- `pnpm run typecheck`: 통과
- `git diff --check`: 통과

Workers 통합 테스트는 종료 코드 0으로 완료된 뒤 저장소의 기존 Vite 종료 지연 경고를 출력했다. AI binding 접근 가능성 경고도 표시됐지만 테스트에서 Workers AI API를 호출하지 않았다.

## 운영 영향과 남은 확인

- 신규 순방향 migration `0020_product_event_lifecycle_uniqueness.sql`을 추가했다. 기존 migration은 수정하지 않았고 의존성, lockfile, 환경 변수 변경은 없다.
- 원격 D1 변경, Workers AI 호출, 이메일 발송, 유료 API 호출, push, PR, 병합, 배포를 수행하지 않았다.
- 기능 브랜치와 worktree는 다음 Task 또는 독립 리뷰가 이어질 수 있도록 로컬에 보존한다.
