# NAVER 지역검색 카테고리 검증 운영 절차

## 적용 범위와 데이터 경계

- 대상은 관리자 `/admin/candidates`에서 실행하는 대기 후보 검수와 공개 장소 100곳 단위 재분류뿐이다.
- 사용자 지도·목록·상세 요청에서는 NAVER 지역검색을 호출하지 않는다.
- 서버가 전송하는 값은 상호명, 주소, 서비스 지역 코드다.
- D1에는 내부 카테고리, 점수, 허용된 근거 코드, 처리 시각과 실패 코드만 저장한다. 응답 원문, 이미지, 리뷰, 소개, 업체 ID와 링크는 저장하거나 로그에 남기지 않는다.

## 배포 전 확인

1. NAVER API Hub 지역검색 이용 가능 상태와 일일 쿼터를 확인한다.
2. `NAVER_LOCAL_SEARCH_CLIENT_ID`, `NAVER_LOCAL_SEARCH_CLIENT_SECRET`가 Worker secret으로 등록됐는지 Cloudflare 대시보드에서 **존재 여부만** 확인한다.
3. `NAVER_LOCAL_SEARCH_ENABLED=false`, `NAVER_LOCAL_SEARCH_DAILY_LIMIT=200`인 안전 기본값으로 migration과 Worker를 먼저 배포한다.
4. 단위·D1 통합·관리자 desktop/mobile E2E·타입·빌드를 통과시킨다. 테스트는 실제 NAVER API를 호출하지 않는다.

## 안전한 최초 운영 순서

1. kill switch를 `true`로 켠 새 Worker를 배포한다.
2. `/admin/candidates`의 **NAVER 100곳 미리보기**를 한 번 실행한다.
3. `CHANGE`, `MANUAL`, `FAILED`, API 호출 수를 확인한다.
4. `CHANGE`는 이름과 주소/100m 위치, 구체 NAVER 카테고리, 원천 세부업태가 모두 맞은 최대 100곳뿐인지 확인한다.
5. 이상이 없을 때만 **검증 결과 적용**을 실행한다. 적용 후 `NAVER_CATEGORY_REVERIFICATION` audit 수와 화면의 변경 수를 대조한다.
6. 커서가 남으면 다음 100곳을 다시 미리보기부터 반복한다. 일일 200회 상한을 넘지 않는다.

## 중단·복구

429, 5xx, timeout, 예상 밖의 충돌 또는 잘못된 분류가 보이면 `NAVER_LOCAL_SEARCH_ENABLED=false`로 즉시 배포한다. 기존 공공데이터·상호 규칙 분류와 공개 목록은 계속 동작한다.

잘못 적용된 카테고리는 해당 `NAVER_CATEGORY_REVERIFICATION` audit의 이전 카테고리를 근거로 관리자가 forward-fix 한다. migration rollback, 공개 장소 삭제, raw provider 응답 복사는 하지 않는다.
