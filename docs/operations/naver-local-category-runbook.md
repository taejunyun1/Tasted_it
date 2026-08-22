# NAVER 지역검색 카테고리 검증 운영 절차

## 적용 범위와 데이터 경계

- 운영 화면은 `/admin/place-operations` 2단계(`NAVER_VERIFICATION`)다. `/admin/candidates`와 `/admin/candidates/bulk`는 1단계로만 보내는 레거시 경로이며 일괄 검증 UI가 아니다.
- 운영자가 라이브에서 호출하는 대상은 ACTIVE 항목 **한 곳씩**, 표본은 **1–3곳**이다. 대기 후보 25곳 선택 일괄, 한도 상향, 스케줄러 강제 실행은 하지 않는다.
- 사용자 지도·목록·상세 요청에서는 NAVER 지역검색을 호출하지 않는다.
- 서버가 전송하는 값은 상호명, 주소, 서비스 지역 코드다.
- D1에는 내부 카테고리, 점수, 허용된 근거 코드, 처리 시각과 실패 코드만 저장한다. 응답 원문, 이미지, 리뷰, 소개, 업체 ID와 링크는 저장하거나 로그에 남기지 않는다.

예약 공공데이터 동기화 코드에 후보 검증 `limit: 25`가 남아 있어도 **이 런북의 운영 절차가 아니다.** 그 경로를 운영 일괄로 쓰지 않고, 이 문서 범위에서 cron을 바꾸지 않는다.

## 현재 한도와 배포 전 확인

앱이 enforce하는 일일 예산은 지역 팩이다. 광주 `10_000`, 전남 `10_000` (`region-pack.ts` `naverDailyBudget`). 카운터도 지역으로 나뉜다([PR #202](https://github.com/taejunyun1/Tasted_it/pull/202)).

`wrangler.jsonc`의 `NAVER_LOCAL_SEARCH_DAILY_LIMIT=20000`은 팩 합과 같은 선언값이다. 운영 절차에서 전역 `20000`으로 올리거나, 그 숫자를 일괄 호출 근거로 쓰지 않는다. 한도 변경은 별도 병합 PR 범위가 있을 때만 한다.

1. NAVER API Hub 지역검색 이용 가능 상태와 일일 쿼터를 확인한다.
2. `NAVER_API_HUB_KEY_ID`, `NAVER_API_HUB_KEY`가 Worker secret으로 등록됐는지 Cloudflare 대시보드에서 **존재 여부만** 확인한다. 값은 읽지 않는다.
3. 신규 환경이나 장애 후 재활성화는 `NAVER_LOCAL_SEARCH_ENABLED=false`인 안전값으로 먼저 배포한다.
4. 단위·D1 통합·관리자 desktop/mobile E2E·타입·빌드를 통과시킨다. 테스트는 실제 NAVER API를 호출하지 않는다.
5. 기존 운영 환경은 배포 직전 지역 팩 예산, Cloudflare Worker 설정, 병합 PR의 대상·한도·rollback을 서로 대조한다.

## 라이브 표본 검증 (관리자 검수)

운영 Worker의 Cloudflare secrets가 호출 원본이다. 로컬 `.dev.vars`를 만들거나 secret 값을 읽지 않는다.

1. 대상은 `/admin/place-operations` 2단계(`NAVER_VERIFICATION`) ACTIVE 항목 1–3곳만이다. 일괄 25곳, 한도 상향, 스케줄러 강제 실행은 하지 않는다.
2. 인증은 로컬 E2E의 `qa-admin-session`이 아니라, 이미 있는 ADMIN 사용자에 대한 단기 D1 세션이다. 제품 로그인(`/login`, OAuth, `/forgot-password`+RESEND)과 같은 `retaste_session` 쿠키를 쓴다. 이메일·비밀번호·secret 값은 기록하지 않는다.
3. 배포된 Worker에 `intent=auto-verify-review-item-with-naver`를 한 곳씩 POST한다. 자격 증명은 Worker의 `NAVER_API_HUB_KEY_ID` / `NAVER_API_HUB_KEY`다.
4. 기록은 대상 수, 성공/실패 코드, 오늘 지역별 `api_call_count` 합계, HTTP/1102 여부만 남긴다. 상호명·주소·원문 응답은 남기지 않는다.
5. 끝나면 표본용 세션 행을 삭제한다. 429·5xx·1102·예상 밖 대량 호출이면 `NAVER_LOCAL_SEARCH_ENABLED=false`로 배포한다.

## 안전한 운영 순서

1. kill switch가 켜진 운영 Worker에서만 표본을 돌린다. 새 D1를 만들지 않는다.
2. `/admin/place-operations` 2단계에서 대기를 선택하고 **NAVER 검증**을 한 곳씩 실행한다.
3. 검증·자동 분류·수동 확인·실패·지역별 API 호출 수를 확인한다. 광주·전남 각 일일 `10_000`과 API Hub 실제 쿼터 중 더 낮은 한도를 넘지 않는다.
4. 이름·주소/100m 위치·NAVER 세부 업종·원천 세부업태가 모두 맞은 항목만 분류를 확정한다. 광역 업종만 있으면 세부 카테고리로 자동 지정하지 않는다([PR #218](https://github.com/taejunyun1/Tasted_it/pull/218)).
5. 애매하거나 충돌·노매치인 후보는 자동 승인하지 않는다. 수동 근거 20자 또는 확인필요로 남긴다([PR #215](https://github.com/taejunyun1/Tasted_it/pull/215)).

## 중단·복구

429, 5xx, timeout, 예상 밖의 충돌 또는 잘못된 분류가 보이면 `NAVER_LOCAL_SEARCH_ENABLED=false`로 즉시 배포한다. 기존 공공데이터·상호 규칙 분류와 공개 목록은 계속 동작한다.

잘못 적용된 카테고리는 해당 `NAVER_CATEGORY_REVERIFICATION` audit의 이전 카테고리를 근거로 관리자가 forward-fix 한다. migration rollback, 공개 장소 삭제, raw provider 응답 복사는 하지 않는다.
