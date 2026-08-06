# Re:Taste 장소 운영 릴리스 구현 계획

**목표:** 회원 제안부터 관리자 승인, 외부 정정 요청, 중복 병합, 변경 이력·복원, 폐업 재검증까지 원본과 감사 이력을 보존하는 장소 운영 흐름을 완성한다.

**구조:** `place_suggestions`, `place_correction_requests`, `place_duplicate_candidates`, `place_slug_redirects`, `place_revisions`, `place_revalidation_cases`를 D1에 추가한다. React Router action은 인증·입력 검증만 담당하고, `place-operations.server.ts`가 중복 판정과 상태 전이, 관계 이동, revision·감사 로그를 소유한다. 자동 병합과 자동 공개는 하지 않는다.

## Task 1 — 스키마와 순수 정책

- 중복 판정(정규화 이름·주소·전화·100m 거리), 상태 전이, 긴급 정정 우선순위의 실패 단위 테스트를 먼저 작성한다.
- `drizzle/0006_place_operations.sql`과 Drizzle schema, 인덱스·FK 계약 테스트를 추가한다.

## Task 2 — 회원 장소 제안

- 이메일 확인 회원만 상호·주소·대표 카테고리·설명·선택 좌표·전화번호를 제출한다.
- 중복 후보가 있으면 기존 장소 정정 전환 또는 `다른 장소` 사유를 요구한다.
- 관리자는 추가정보 요청·검토·중복·반려·승인을 처리한다. 승인 시 DRAFT Place와 대표 카테고리를 만들고 승인 제안 수를 갱신한다.
- 회원 `/suggestions/new`, `/me/suggestions`, 관리자 `/admin/place-operations` 흐름을 E2E로 검증한다.

## Task 3 — 정정·이의 제기

- 비회원도 요청할 수 있지만 이메일 확인 토큰 완료 전에는 `PENDING_VERIFICATION`으로 유지한다.
- 정보 정정·이전·휴업·폐업·권리 침해·기타 유형, 요청자 관계, 변경 JSON, 증빙 설명을 보존한다.
- 관리자 적용 시 즉시 직접 수정하지 않고 revision과 감사 로그를 함께 기록한다.

## Task 4 — 병합·revision·복원

- 관리자가 기준·흡수 장소와 충돌 필드 선택을 확정한다.
- 투표, 현재 투표, 저장, 카테고리, 출처 링크를 기준 장소로 이동하고 이전 slug redirect를 만든다.
- 모든 수정·병합·복원은 before/after JSON revision을 추가한다. 복원은 과거 값을 적용하는 새 revision이다.
- 이전 `/places/:slug`는 기준 장소의 새 URL로 redirect한다.

## Task 5 — 폐업 재검증

- 공개 장소 연결 원천이 CLOSED면 HIDDEN 전환과 `CLOSED` 사건을 원자적으로 생성한다.
- TEMPORARILY_CLOSED·UNKNOWN·90일 초과는 공개 상태를 유지하고 운영 큐에 추가한다.
- 관리자는 영업 재개·숨김 유지·공개 복원을 사유와 함께 처리한다.

## Task 6 — 검증·PR·배포

- 타입, 단위, D1 통합, 빌드, 회원·관리자·redirect E2E를 실행한다.
- PR diff에서 비밀값, 무범위 삭제, 관계 손실, 역할 우회, 700+ font weight를 검토한다.
- squash merge 후 원격 D1 export, 0006 적용, 병합 main 배포, 운영 smoke/E2E를 수행한다.
