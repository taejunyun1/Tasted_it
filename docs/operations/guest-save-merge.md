# 비회원 임시 저장과 계정 연결

상위 기준은 [CST 구현 정책 DEC-04/06](../decisions/2026-11-13-cst-implementation-policy.md)과 [12/10 SSOT W04·T03](../plans/2026-11-13-cst-service-ssot.md)다. 구현/시험의 소유와 변경 기록은 #368에 남긴다.

## 동작과 보존

비회원은 공개 장소를 최대 50곳 임시 저장·해제한다. 공개 반응과 계정의 영구 저장은 기존 로그인 권한을 유지한다. 임시 저장은 기존 무작위 guest 세션 쿠키로만 식별하며 URL이나 body에서 다른 세션 ID를 받지 않는다. HttpOnly·HTTPS Secure·SameSite=Lax를 유지한다.

`guest_saved_places(session_id,place_id,created_at)`는 기존 guest 세션과 같은 최대30일 수명을 갖는다. 진행 중 세션은 기존 온보딩 활동 수명 규칙을 따르고, 완료/건너뛰기 세션의 만료는 추천/저장 조회로 연장하지 않는다. 만료 세션의 기존 일일 정리가 FK cascade로 임시 저장도 삭제한다. 성공 병합은 임시 배지와 저장을 같은 batch에서 삭제하고 guest 쿠키를 만료한다. 병합 표시 세션은 기존 수명까지 유지하며 새 추적 식별자·외부 저장소를 만들지 않는다.

계정의 기존 USER 배지 값·근거·수정시각과 저장 행의 생성시각을 보존하고 guest의 누락분만 더한다. `member_save_choices(user_id,place_id,saved,updated_at)`는 새 명시 저장/해제를 기록하여 나중의 guest 연결이 계정 해제를 되살리지 않게 한다. 과거 absence를 해제로 추정 backfill하지 않는다. 선택표식은 다음 명시 선택까지 유지하고 탈퇴/계정 삭제 시 제거한다. 이 표식은 공개 평가에 합산하지 않는다.

로그인 성공과 임시 자료 연결 성공을 구분한다. batch 실패 시 배지·저장·병합표시·원본정리를 모두 rollback하고 쿠키를 보존한다. 돌아온 화면의 **임시 자료 다시 연결**에서 로그인한 계정으로 재시도할 수 있다. 계정의 기존 선택이 우선이며 이미 다른 계정에 병합된 세션은 복사하지 않는다. 네트워크 실패 후 마지막 성공 상태와 원래 저장/해제 의도를 유지한다.

## HTTP·남용 방어

`GET /resources/guest-saves?placeId=…`는 본인 쿠키의 공개 장소 저장 상태만 읽는다. GET은 세션·선택·rate-limit 창을 생성하지 않는다. POST는 동일 Origin, URL-encoded body 실제1024바이트, 허용 intent/필드, 중복 필드 거절, 공개 장소·소유 세션·만료 조건을 검사한다. merge는 로그인한 계정이 필요하다. 응답은 성공·실패 모두 `no-store, private`, `Vary: Cookie`다.

원자적 삽입 조건과 DB trigger가 세션당50곳을 강제한다. POST는 기존 `rate_limit_windows`에 IP의 용도 구분 SHA-256 hash·15분 창·횟수만 기록하며 15분당120회에서 차단한다. 이는 구현상 남용 방어 한도이며 계약 처리량이 아니다. 원문 IP·쿠키·오류·학생자료를 기록하지 않는다. POST와 기존 일일 onboarding lifecycle에서24시간 이전 창을 정리하고 새 cron을 추가하지 않는다.

## 적용·복원 경계

새 migration `0041_guest_saved_places.sql`만 추가한다. 기존 적용 migration은 수정하지 않는다. 실제 운영 migration·백업·배포·반입은 이 구현 작업에 포함하지 않는다. 향후 운영 적용 PR에서 현재 Worker와 D1 백업, 0040 등 선행 migration·0041의 대기 목록, 격리/한도/검증·live RSI·담당·rollback을 구체화해야 한다.

새 코드가 참조하는 테이블이 먼저 준비되어야 한다. 코드 rollback은 새 테이블과 기존 자료를 삭제하지 않고 직전 호환 Worker로 복귀한다. 스키마 복원은 검증된 forward-fix로 수행하며 과거 migration을 수정하거나 테이블을 자동 drop하지 않는다. 실제 문의처·법적 보존기간·수용 서명은 이 문서가 추정하지 않는다.
