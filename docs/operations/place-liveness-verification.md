# 장소 영업 실재성 자동검증 운영 문서

작성일: 2026-08-13
추적: GitHub Issue #89
적용 범위: 장소 영업 실재성 자동검증(place liveness verification) 예약 작업과 관리자 검수

## 운영 경계

- 제품 책임자: Issue #89의 승인 범위와 `OBSERVE -> RECOMMEND -> HIDE` 단계 전환 승인자를 지정한다.
- 운영자: 승인된 환경에서만 secret 등록, 기능 플래그 변경, migration, 배포, 관찰 지표 점검, rollback을 실행한다.
- 구현자와 자동화 에이전트: 로컬 mock 검증과 문서 갱신까지만 수행한다. 별도 운영자 승인 없이 실제 Kakao API 호출, 운영 D1 migration, 운영 배포를 실행하지 않는다.
- 최종 승인 기준: 저장소의 병합된 Pull Request와 Issue #89에 기록된 승인 범위다. 채팅, 테스트 통과, 로컬 HTTP 200, 열려 있는 포트는 운영 승인으로 보지 않는다.

## Kakao 공식 근거

이 기능은 서버에서 Kakao Map REST API의 키워드 장소 검색만 사용한다.

- Kakao Map 이해하기: https://developers.kakao.com/docs/ko/kakaomap/common
- REST API 레퍼런스, 키워드로 장소 검색: https://developers.kakao.com/docs/ko/rest-api/reference
- Quota 안내: https://developers.kakao.com/docs/en/getting-started/quota
- Statistics와 quota 확인 위치: https://developers.kakao.com/docs/en/getting-started/stat
- REST API 오류 코드: https://developers.kakao.com/docs/en/rest-api/error-code

Kakao의 제공 quota와 유료 정책은 변경될 수 있으므로 운영 전 Kakao Developers의 앱 관리 화면 `Statistics > Quota`에서 현재 한도를 직접 확인한다. Re:Taste 자체 상한은 공급자 한도와 별개로 월 1,500회 이하로 제한한다.

## 기능 플래그와 기본값

운영 기본값은 항상 비활성 관찰 준비 상태다.

```text
KAKAO_PLACE_VERIFICATION_ENABLED=false
KAKAO_PLACE_VERIFICATION_MODE=OBSERVE
```

- `KAKAO_PLACE_VERIFICATION_ENABLED !== "true"`이면 예약 작업은 Kakao 호출을 즉시 건너뛴다.
- `OBSERVE`: 판정 스냅샷만 저장하고 추천 제외나 공개 숨김을 적용하지 않는다.
- `RECOMMEND`: 2회 연속 미검색부터 추천 후보 제외만 적용한다.
- `HIDE`: 추천 제외에 더해 3회 연속 미검색, 14일 경과, 최근 90일 활동 없음, 최근 120일 공공데이터 `OPEN` 미관측 등 보호 조건을 모두 만족할 때만 임시 숨김을 적용한다.
- `RECOMMEND`와 `HIDE` 전환은 각각 별도 사람 승인과 Issue #89 또는 PR 기록이 필요하다.

## Secret 등록

키 값은 문서, PR, 로그, 터미널 기록 공유본에 남기지 않는다. 운영자가 승인된 Cloudflare 계정과 대상 Worker를 확인한 뒤 프롬프트에 직접 입력한다.

```bash
pnpm wrangler secret put KAKAO_REST_API_KEY
```

환경별로 secret이 분리되어 있으면 대상 환경을 명시한다.

```bash
pnpm wrangler secret put KAKAO_REST_API_KEY --env preview
pnpm wrangler secret put KAKAO_REST_API_KEY --env production
```

위 명령은 키 값을 인자로 받지 않는다. 실행 후에는 Cloudflare dashboard에서 secret 존재 여부만 확인하고 값을 조회하거나 복사하지 않는다.

## 호출량, timeout, retry

- 하루 대상 장소 최대 25곳.
- 장소당 Kakao API 호출 최대 1회.
- 한 예약 실행의 외부 호출 최대 50회. 429 또는 5xx 재시도까지 포함한 상한이다.
- 월 자체 상한 최대 1,500회.
- 요청 timeout은 3초다.
- retry는 429와 5xx에만 최대 1회 허용한다.
- 인증 오류 3회 또는 한 실행 오류율 50% 이상이면 남은 대상 처리를 중단한다.
- 공급자 장애 중에는 어떤 장소도 자동 숨김하지 않는다.

## 개인정보와 데이터 최소화

- Kakao에는 상호명, 도로명 주소, 기존 장소 좌표, 제한 반경만 전송한다.
- 회원 위치, 이메일, 계정 정보, 리뷰 내용, 리뷰어 신원은 전송하지 않는다.
- Kakao 원본 응답 전체는 저장하지 않는다.
- D1에는 일치 결과, 점수 구성, 공급자 오류 종류, 확인 시각, 연속 미검색 횟수, 비식별 내부 활동 집계만 저장한다.
- 로그에는 요청 URL, Authorization header, 상호, 주소, 전화번호, 원본 응답 body를 남기지 않는다.
- 내부 활동 증거는 장소 ID와 최신 시각 또는 boolean 집계로만 사용한다.

## 7일 관찰 모드 점검

`OBSERVE` 7일 동안 추천 제외와 숨김은 적용하지 않고 다음 지표를 매일 확인한다.

- 실행 수, claim 수, checked 수, error 수, hidden 수가 예상 범위인지 확인한다. `OBSERVE`에서 hidden은 항상 0이어야 한다.
- `MATCHED`, `AMBIGUOUS`, `NOT_FOUND`, `ERROR`, `SKIPPED` 분포를 확인한다.
- `SUSPECTED` 또는 `HIDDEN`으로 전이될 예정이었던 장소 수를 별도 표본으로 검수한다.
- 최근 90일 리뷰어 방문·사진 또는 회원 평가·저장이 있는데 `NOT_FOUND`가 반복된 장소를 오탐 후보로 본다.
- 최근 120일 공공데이터 `OPEN` 관측이 있는데 3회 미검색된 장소는 `SUSPECTED`까지만 허용되는지 확인한다.
- Kakao 후보가 `FD6` 또는 `CE7`이 아니어서 제외된 장소 중 실제 음식점·카페가 있는지 표본 확인한다.
- 공급자 `ERROR`가 연속 횟수나 숨김 전이로 변환되지 않았는지 확인한다.
- 관리자 화면의 운영 의심, 임시 숨김, 공급자 오류 필터에서 원본 Kakao 응답이나 개인정보가 노출되지 않는지 확인한다.

관찰 결과 오탐률이 허용 범위를 넘거나 원인 미상의 `ERROR`가 지속되면 기능 플래그를 비활성화하고 `RECOMMEND` 전환을 보류한다.

## 전환 승인 기준

`RECOMMEND` 전환 전에는 최소 7일 관찰 결과를 Issue #89 또는 PR에 기록한다.

- 월 1,500회 자체 상한을 넘지 않는 실행량 증거.
- 대표 표본에서 음식점·카페 오탐이 허용 범위 안이라는 사람 검수 기록.
- `ERROR`가 상태 전이를 만들지 않는다는 검증.
- 추천 제외 rollback 절차의 관리자 실행자와 근거 문구.

`HIDE` 전환 전에는 `RECOMMEND` 운영 결과를 별도로 검토한다.

- 자동 추천 제외 장소의 재개업·정상 영업 오탐 처리 기록.
- 자동 숨김 후보마다 최근 90일 내부 활동 없음과 최근 120일 `OPEN` 미관측 조건 확인.
- 잘못 숨긴 장소를 기존 place revision으로 복원하는 운영자와 절차 확인.
- 운영 배포, remote D1, 실제 Kakao 1곳 contract smoke 승인 기록.

## Kill switch

즉시 중단 조건이 발생하면 다음 순서로 중단한다.

1. `KAKAO_PLACE_VERIFICATION_ENABLED=false`로 설정한 Worker를 배포한다.
2. 다음 예약 실행 결과가 `DISABLED`이고 Kakao 호출 수가 0인지 확인한다.
3. Kakao Developers `Statistics > Quota`에서 추가 호출이 멈췄는지 확인한다.
4. Issue #89 또는 운영 기록에 중단 시각, 담당자, 원인, 영향 범위, 다음 조치를 기록한다.

Kill switch는 신규 외부 호출과 신규 자동 조치를 멈춘다. 이미 저장된 파생 상태 행은 삭제하지 않아도 일반 지도와 상세 조회를 막지 않는다.

## Rollback

추천 제외 rollback은 관리자 화면 `/admin/place-operations`의 `자동 추천 제외 전체 해제`를 사용한다.

- 이 동작은 현재 liveness status가 `SUSPECTED`이고 `recommendation_excluded=true`인 파생 플래그만 해제한다.
- 장소, 리뷰, 평가, 저장, revision 원문 데이터는 삭제하지 않는다.
- 수동 또는 자동 `HIDDEN` 상태는 이 일괄 해제 대상이 아니다.
- 실행자는 해제 근거를 입력하고 audit log를 확인한다.

잘못 숨긴 장소는 D1 전체 rollback이 아니라 기존 장소 revision 복원 흐름으로 되돌린다.

1. `/admin/place-operations`의 최근 변경·복원에서 해당 장소의 숨김 전 revision을 확인한다.
2. 복원 사유를 입력해 새 `RESTORE` revision을 생성한다.
3. 장소가 공개 조회에 돌아왔는지 확인한다.
4. 관련 liveness case를 정상 영업으로 검수하고 90일 보호 기간을 설정한다.

운영 D1의 파괴적 역 migration이나 Time Travel 복원은 이 기능의 일반 rollback 절차가 아니다. 데이터 손상 사고로 판단될 때만 별도 incident 승인과 백업 증거를 갖추고 진행한다.

## 명시적 금지 사항

다음 작업은 별도 운영자 승인 전 금지한다.

- 실제 Kakao API를 호출하는 1곳 contract smoke.
- 운영 또는 원격 D1 migration 적용.
- `pnpm run deploy` 또는 Cloudflare production deploy.
- Kakao 유료 lane, quota 증액, 앱 설정 변경.
- `KAKAO_PLACE_VERIFICATION_MODE=RECOMMEND` 또는 `HIDE` 전환.
- 운영 데이터의 파괴적 수정, D1 Time Travel 복원, 원격 데이터 삭제.

이번 Task 8 문서 작업은 위 작업을 실행하지 않는다.

## 운영 기록 템플릿

```text
일시:
담당자:
Issue/PR:
환경:
기능 플래그:
Kakao quota 확인:
실행 모드:
claimed / checked / errors / hidden:
7일 관찰 오탐 점검:
전환 승인 여부:
rollback 필요 여부:
남은 위험:
```
