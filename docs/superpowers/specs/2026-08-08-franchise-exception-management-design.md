# 프랜차이즈 MVP 필터와 승인 불가·예외 관리 설계

## 1. 목표

광주·전남 음식점 공공데이터 후보에서 전국·광역 프랜차이즈와 서비스 대상이 아닌 유흥업종을 수집 단계에서 제외하고, 관리자가 일반 후보를 직접 예외 처리하거나 오탐을 복원할 수 있게 한다. 독립 음식점과 로컬 체인을 우선 보존하며 애매한 판정은 자동 제외하지 않는다.

이번 범위는 첨부된 프랜차이즈 제외 명세의 MVP 1단계다. 공정거래위원회 API 실연동, 지역별 매장 수 자동 계산, 월별 동기화, 별도 Franchise Filter 관리 화면은 서비스키 확보 후 후속 단계로 남긴다.

## 2. 판정 순서

후보 처리 순서는 다음과 같다.

1. 원본 공공데이터를 현재 `raw_payload`에 보존한다.
2. 영업상태와 광주·전남 주소를 확인한다.
3. 상호명과 원천 업태를 정규화한다.
4. 룸살롱·유흥주점 자동 제외 정책을 적용한다.
5. 로컬 체인·독립점 allowlist를 확인한다.
6. 전국·광역 체인 blacklist와 alias를 확인한다.
7. 중복 검사 후 일반 후보 또는 제외 기록으로 저장한다.

우선순위는 `manual allowlist > manual blacklist > alias·이름 휴리스틱`이다. 공정위 자동 판정은 이번 구현에 포함하지 않는다.

## 3. 프랜차이즈 MVP 데이터

코드 안의 거대한 문자열 배열 대신 다음 JSON 파일을 사용한다.

- `data/franchise-manual-blacklist.json`: 공식 브랜드명, 체인 범위, alias, 짧은 이름 여부
- `data/franchise-local-allowlist.json`: 자동 제외하지 않을 광주·전남 로컬 브랜드와 독립점

blacklist의 초기 브랜드는 첨부 명세 11절의 햄버거·커피·치킨·피자·분식·김밥·중식·도시락·고기·족발·샤브샤브·패밀리레스토랑·베이커리·아이스크림·주점 목록을 모두 포함한다. 파리바게뜨와 뚜레쥬르의 기존 오타 alias도 유지한다.

각 항목은 다음 구조를 가진다.

```json
{
  "id": "MEGA_MGC_COFFEE",
  "brandName": "메가MGC커피",
  "chainScope": "NATIONAL_CHAIN",
  "aliases": ["메가커피", "메가MGC", "메가엠지씨커피"],
  "shortName": false
}
```

allowlist는 정규화한 공식명 또는 alias가 일치하면 모든 blacklist 판정보다 먼저 `LOCAL_CHAIN`으로 반환한다.

## 4. 상호 정규화와 매칭

정규화는 NFKC, 소문자화, 공백·특수문자 제거, `(주)`·`주식회사`·`유한회사` 제거를 적용한다. 원본 상호는 변경하지 않는다.

비교용 값은 두 가지다.

- `normalizedBusinessName`: 전체 정규화 상호
- `branchStrippedBusinessName`: 끝의 `점`, `호점`, `지점`, `본점`, `직영점`, `가맹점`, `점포`, `DT`, `DT점`, `드라이브스루점`과 지역 지점 표현을 제거한 값

매칭 순서와 신뢰도는 다음과 같다.

| 방법 | 신뢰도 |
|---|---:|
| 수동 blacklist exact | 1.00 |
| 검증된 alias exact | 0.97 |
| 공식 브랜드 prefix | 0.95 |
| alias prefix | 0.90 |
| 길이 4 이상 공식 브랜드 contains | 0.75 |

자동 제외 기준은 `confidence >= 0.90`이다. contains 결과는 기록 가능한 참고 신호지만 자동 제외하지 않는다. `본가`, `본죽`, `두찜`, `공차`, `설빙`, `미소야`, `이차돌`, `아웃닭` 같은 짧거나 일반적인 브랜드는 exact, prefix, 검증 alias만 허용한다. fuzzy matching은 사용하지 않는다.

## 5. 체인 상태

분류 결과는 다음 상태 중 하나다.

- `INDEPENDENT`: 수동 독립점 allowlist
- `NATIONAL_CHAIN`: 전국 체인 blacklist
- `REGIONAL_CHAIN`: 광역 체인 blacklist
- `LOCAL_CHAIN`: 로컬 allowlist
- `UNKNOWN`: 판정 근거 부족

`NATIONAL_CHAIN`과 `REGIONAL_CHAIN`이면서 신뢰도 0.90 이상인 후보만 자동 제외한다. `LOCAL_CHAIN`, `INDEPENDENT`, `UNKNOWN`은 일반 후보로 유지한다.

## 6. 유흥업종 자동 제외

다음 중 하나면 `ADULT_ENTERTAINMENT` 사유로 자동 제외한다.

- 정규화한 상호명에 `룸살롱` 또는 `룸싸롱` 포함
- 원천 업태에 `유흥주점영업` 포함

`단란주점`은 이번 자동 제외 대상이 아니다. 업종 정책은 체인 판정보다 먼저 적용하고, 기존 `OPEN`·`PENDING` 후보도 migration으로 backfill한다.

## 7. 범용 예외 기록

기존 `business_license_exclusions`를 유지하되 새 migration에서 범용 구조로 재생성한다.

필드:

- `business_license_id`
- `reason`: `CHAIN_STORE`, `ADULT_ENTERTAINMENT`, `ADMIN_EXCEPTION`
- `exclusion_category`: 업종 제외, 음식점 아님, 중복·잘못된 데이터, 운영 정책 제외, 기타
- `matched_rule`, `matched_brand`, `matched_alias`
- `chain_scope`, `match_method`, `match_confidence`
- `note`
- `status`: `ACTIVE`, `OVERRIDDEN`, `CLEARED`
- `excluded_by`, `excluded_at`
- `overridden_by`, `overridden_at`
- 생성·수정 시각

기존 8개 체인 제외 기록은 손실 없이 이전한다. 자동 판정과 관리자 판정은 삭제가 아니라 이 테이블에 기록하고, 원본 `business_licenses`와 `raw_payload`는 유지한다.

## 8. 관리자 화면

### 8.1 탭

- `체인점 제외`: `CHAIN_STORE` 활성 제외만 표시
- `승인 불가·예외`: 기존 좌표·중복 등 기술적 승인 불가 후보와 `ADULT_ENTERTAINMENT`, `ADMIN_EXCEPTION` 활성 제외를 함께 표시

탭 숫자는 두 종류를 합산한다. 기술적 승인 불가 행에는 기존 차단 근거를 표시하고, 예외 행에는 사유·메모·처리자·처리일을 표시한다.

### 8.2 일괄 예외 처리

일반 검수 화면의 선택 작업 영역에 `선택 장소 예외 처리` 버튼을 추가한다. 누르면 다음 사유 중 하나를 선택한다.

- 업종 제외
- 음식점 아님
- 중복·잘못된 데이터
- 운영 정책 제외
- 기타

`기타`는 메모를 필수로 하고 나머지는 메모 선택이다. 선택 후보를 `ADMIN_EXCEPTION` 활성 제외로 기록한 후 일반 검수 목록에서 제거한다. 이미 제외되거나 승인된 후보는 건너뛰고 결과를 안내한다.

### 8.3 복원

체인점 제외와 승인 불가·예외 탭의 활성 제외 행에는 `검수 대기로 복원` 버튼을 제공한다. 복원은 `OVERRIDDEN`으로 기록하며 동일 자동 정책이 재실행되어도 다시 제외하지 않는다. 기술적 승인 불가 행은 데이터 조건을 해결하기 전에는 복원 버튼을 표시하지 않는다.

## 9. 기존 데이터 backfill

새 migration은 다음 순서로 실행한다.

1. 범용 제외 테이블로 기존 체인 기록 이전
2. `OPEN`·`PENDING` 룸살롱·룸싸롱·유흥주점영업을 업종 제외 등록
3. JSON blacklist와 동일한 초기 전국·광역 브랜드를 기존 후보에서 prefix 방식으로 찾아 체인 제외 등록

SQL migration이 JSON을 직접 읽을 수 없으므로, 초기 blacklist의 정규화 prefix 목록을 생성한 SQL 값 목록으로 함께 관리하고 테스트에서 JSON과 migration 브랜드 ID의 일관성을 확인한다. 기존 `OVERRIDDEN` 행은 `INSERT OR IGNORE`로 보존한다.

## 10. 오류와 안전 정책

- 오탐이 누락보다 위험하므로 0.90 미만 결과는 자동 제외하지 않는다.
- 짧은 브랜드 contains, fuzzy matching, 단란주점 자동 제외는 금지한다.
- 일반 후보 승인 로직은 활성 제외 후보를 계속 차단한다.
- 관리자 일괄 처리는 최대 25곳으로 제한하고 처리자와 시각을 감사 로그에 남긴다.
- 공정위 API 키나 실제 응답은 저장소·로그·PR에 기록하지 않는다.

## 11. 테스트와 운영 감사

- 첨부 blacklist의 모든 공식명과 주요 alias 표 기반 테스트
- exact, prefix, alias, contains 임계값과 짧은 브랜드 오탐 테스트
- allowlist가 blacklist보다 우선하는 테스트
- 룸살롱·룸싸롱·유흥주점영업 제외와 단란주점 유지 테스트
- 기존 `OVERRIDDEN` 상태 보존 테스트
- 관리자 최대 25곳 일괄 예외 처리와 기타 메모 필수 테스트
- 일반 목록 제거, 탭 표시, 복원 브라우저 테스트
- migration이 기존 체인 기록을 보존하는 로컬 D1 테스트

운영 적용 전후에 다음 숫자만 감사한다.

- 새 blacklist가 잡은 전국·광역 체인 수
- 룸살롱·유흥주점 제외 수
- 0.90 미만 검토 신호 수
- 일반 검수 큐의 고신뢰 체인·유흥업종 잔존 수
- 관리자 예외·복원 수

## 12. 완료 기준

- 명세의 초기 blacklist와 alias가 JSON에서 관리된다.
- 전국·광역 체인과 유흥업종은 수집 즉시 일반 후보에서 제외된다.
- 기존 대상도 backfill되어 올바른 탭에 표시된다.
- 관리자가 선택 후보를 사유와 함께 예외 처리하고 복원할 수 있다.
- 전체 단위·통합·브라우저 테스트, 타입 검사, 빌드가 통과한다.
- 운영 migration과 배포 후 일반 큐의 고신뢰 체인·유흥업종 잔존 수가 0이다.
