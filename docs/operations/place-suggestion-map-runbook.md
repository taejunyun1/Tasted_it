# 장소 제안 지도 위치 운영 런북

## 목적과 범위

회원 장소 제안과 관리자 승인 화면은 기존 NAVER Maps Dynamic Map의 주소 지오코딩(Geocoding)을 사용해 `주소 검색 → 지도 핀 확인 → 위치 확정`만 제공한다. 지도 표시와 장소 지오코딩은 같은 NAVER Cloud 애플리케이션을 재사용하며, 새 공급자·새 비밀값·새 D1 테이블·NAVER 장소 ID 저장은 없다.

## 운영 설정

| 항목 | 값과 책임 |
| --- | --- |
| 지도 client ID | `NAVER_MAPS_CLIENT_ID` secret. 브라우저에는 Dynamic Map용 공개 client ID만 전달한다. |
| 기능 kill switch | `NAVER_PLACE_GEOCODING_ENABLED`. 안전 기본값은 `false`이며, 이번 운영 배포는 `true`로 활성화한다. 값이 `true`일 때만 주소 검색과 지도 확정을 표시한다. |
| 비용·쿼터 책임 | 서비스 운영자(taejun-yun). NAVER Cloud Console의 해당 애플리케이션 Geocoding 일일 쿼터와 과금 한도를 확인한다. |
| 허용 URL | 로컬 `http://localhost:5173`, 운영 `https://retaste-beta.retaste-beta.workers.dev`를 NAVER Cloud Web 서비스 URL에 등록한다. |

기능을 켜기 전에는 NAVER Cloud Console에서 Dynamic Map과 Geocoding 사용 설정이 모두 활성인지 확인한다. 이번 PR 병합과 운영 배포는 `NAVER_PLACE_GEOCODING_ENABLED=true`를 함께 적용한다. 배포 직후 QA 계정으로 한 번의 주소 검색·핀 확정·관리자 승인을 확인한다.

## 호출량·개인정보 경계

- 주소 지오코딩은 사용자가 `지도에서 위치 찾기`를 누를 때에만 한 번 호출한다. 타이핑 자동완성·주기적 재시도는 없다.
- 한 검색의 후보는 최대 5개이며, 광주·전남 이외 후보와 경계 밖 좌표는 저장 전에 거부한다.
- 주소는 서비스가 제안 장소 검토를 위해 이미 수집하는 정보다. 서버 로그에는 원문 주소, 좌표, NAVER 응답, 비밀값을 남기지 않는다.
- 운영 데이터가 아닌 QA 계정과 테스트 제안만 실제 NAVER 호출에 사용한다. 실제 운영 장소를 테스트 승인하지 않는다.

## 사용자·관리자 동작 확인

1. 회원이 상호명·주소를 입력하고 `지도에서 위치 찾기`를 누른다.
2. 후보 주소를 선택한 후 핀을 확인하고 `이 위치가 맞아요`를 누른다.
3. 주소를 다시 수정하면 확정 표시와 hidden 좌표가 비워지는지 확인한다.
4. 광주·전남 밖 주소와 2km 초과 핀 조정이 거부되는지 확인한다.
5. 관리자는 제안 카드에서 `기존 위치 지도에서 확인`을 눌러 필요한 카드의 지도만 열고, 위치와 승인 근거를 확정한 뒤 초안 승인한다.
6. 같은 승인 버튼을 다시 누르거나 응답을 잃고 재시도해도 같은 초안 하나만 반환되는지 확인한다.

승인된 제안은 `DRAFT` 상태의 비공개 장소가 된다. 공개 지도에는 관리자가 별도로 발행하기 전까지 노출되지 않는다.

## 오류 코드와 대응

| 코드·상태 | 사용자/관리자 응답 | 운영 대응 |
| --- | --- | --- |
| `LOCATION_REQUIRED`, `SUGGESTION_COORDINATES_REQUIRED` (400) | 지도에서 위치를 확인해 달라는 카드 안내 | 주소·핀 확정 흐름을 다시 확인한다. |
| `LOCATION_OUT_OF_SCOPE` (400) | 광주·전남 범위 안내 | NAVER 후보 주소와 좌표가 같은 지역인지 확인한다. |
| `SUGGESTION_NOT_REVIEWABLE` (409 성격) | 이미 처리됨 안내 | 새로고침 후 승인된 초안 링크를 확인한다. |
| `APPROVAL_FAILED` (503 성격) | 안전한 재시도 안내 | `place_suggestions.approved_place_id`와 `places.id`를 확인해 commit 후 응답 유실인지 먼저 판별한다. |
| 지도 SDK/지오코더 장애 | 입력값 유지, 위치 확정 차단 | NAVER 상태·허용 URL·쿼터를 확인한다. 지속되면 kill switch를 끈다. |

## 장애 중단과 롤백

지오코더 오류율, 위치 확정 이탈, 승인 400·409·503 비율이 비정상일 경우 대상 환경의 `NAVER_PLACE_GEOCODING_ENABLED=false`로 즉시 중단한다. 이때 기존 제안 조회와 비지도 관리 기능은 유지되며, 데이터나 migration을 되돌릴 필요가 없다.

승인 중 오류가 나도 원시 D1 오류를 화면에 표시하지 않는다. 재시도 전에 제안의 `status='APPROVED'`와 `approved_place_id`가 존재하는지 확인한다. 두 값과 같은 `places.id`가 있으면 승인 commit은 성공했으므로 새 초안을 만들지 않고 기존 결과로 처리한다.

## 제거 조건

NAVER Maps 정책·쿼터·서비스 종료로 주소 지오코딩을 더 이상 유지할 수 없거나 다른 지도 공급자로 공식 전환하는 PR이 병합되면, 먼저 kill switch를 끄고 이 런북과 UI adapter를 제거한다. 기존 D1 주소·WGS84 좌표는 Re:Taste의 단일 기준 원본이므로 보존한다.
