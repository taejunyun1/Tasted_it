# NAVER 지역검색 카테고리 검증 운영 절차

## 적용 범위와 데이터 경계

- 대상은 공공데이터 동기화 뒤 자동 실행되는 대기 후보 최대 25곳과 관리자 `/admin/candidates`에서 선택하는 대기 후보 최대 25곳이다.
- 사용자 지도·목록·상세 요청에서는 NAVER 지역검색을 호출하지 않는다.
- 서버가 전송하는 값은 상호명, 주소, 서비스 지역 코드다.
- D1에는 내부 카테고리, 점수, 허용된 근거 코드, 처리 시각과 실패 코드만 저장한다. 응답 원문, 이미지, 리뷰, 소개, 업체 ID와 링크는 저장하거나 로그에 남기지 않는다.

## 현재 설정과 배포 전 확인

- 2026-08-16 `main`의 `wrangler.jsonc` 선언값은 `NAVER_LOCAL_SEARCH_ENABLED=true`, `NAVER_LOCAL_SEARCH_DAILY_LIMIT=20000`이다([PR #131](https://github.com/taejunyun1/Tasted_it/pull/131)). 이 값은 저장소의 배포 희망 설정이며, 현재 운영 Worker에 실제 반영됐다는 증거는 아니다.
- `200`은 신규 환경이나 장애 후 재활성화 때 사용하는 초기 안전 상한이다. `20000`으로 올리기 전에는 병합 PR의 승인 범위, API Hub 실제 쿼터, 앱 기록 사용량과 오류율을 확인한다.

1. NAVER API Hub 지역검색 이용 가능 상태와 일일 쿼터를 확인한다.
2. `NAVER_API_HUB_KEY_ID`, `NAVER_API_HUB_KEY`가 Worker secret으로 등록됐는지 Cloudflare 대시보드에서 **존재 여부만** 확인한다.
3. 신규 환경이나 장애 후 재활성화는 `NAVER_LOCAL_SEARCH_ENABLED=false`, `NAVER_LOCAL_SEARCH_DAILY_LIMIT=200`인 안전값으로 먼저 배포한다.
4. 단위·D1 통합·관리자 desktop/mobile E2E·타입·빌드를 통과시킨다. 테스트는 실제 NAVER API를 호출하지 않는다.
5. 기존 운영 환경은 배포 직전 `wrangler.jsonc`, Cloudflare Worker 설정, 병합 PR의 대상·한도·rollback을 서로 대조한다.

## 안전한 최초 운영 순서

1. kill switch를 `true`로 켠 새 Worker를 배포한다.
2. `/admin/candidates`에서 후보를 선택하고 **선택 장소 NAVER 근거 확인**을 실행한다.
3. 검증·자동 분류·수동 확인·실패·API 호출 수를 확인한다.
4. 자동 분류는 이름과 주소/100m 위치, 구체 NAVER 카테고리, 원천 세부업태가 모두 맞은 최대 25곳뿐인지 확인한다.
5. 애매하거나 충돌한 후보는 자동 승인하지 않고 수동 카테고리 확인으로 처리한다. 최초 단계 검증은 일일 200회 이내로 제한하고, 승인된 확대 뒤에도 앱 상한 20,000회와 API Hub 실제 쿼터 중 더 낮은 한도를 넘지 않는다.

## 중단·복구

429, 5xx, timeout, 예상 밖의 충돌 또는 잘못된 분류가 보이면 `NAVER_LOCAL_SEARCH_ENABLED=false`로 즉시 배포한다. 기존 공공데이터·상호 규칙 분류와 공개 목록은 계속 동작한다.

잘못 적용된 카테고리는 해당 `NAVER_CATEGORY_REVERIFICATION` audit의 이전 카테고리를 근거로 관리자가 forward-fix 한다. migration rollback, 공개 장소 삭제, raw provider 응답 복사는 하지 않는다.
