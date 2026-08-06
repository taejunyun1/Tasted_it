# Week 1 장소 데이터 운영 런북

## 원본과 권리

`data/week1-places.csv`는 OpenStreetMap/Overpass 및 Nominatim에서 확인한 20개 장소 후보로 시작한다. 출처, 스냅샷, 확인일과 ODbL 조건은 `data/SOURCES.md`를 따른다. 사진은 권리 증빙 없이는 등록하지 않는다.

## CSV 계약

필수: `name`, `slug`, `address`, `neighborhood`, `latitude`, `longitude`, `primary_category`. 선택: `phone`, `parking_summary`, `kakao_place_id`, `hero_image_url`, `status`. 좌표는 위도 33–39, 경도 124–132, slug는 소문자·숫자·하이픈만 허용한다. 카테고리는 `ramen`, `donkatsu`, `gukbap`, `bakery` 중 하나다.

## 공개 전 수동 확인

1. 공식 채널 또는 현장 확인으로 영업 여부와 상호 확인
2. 좌표와 도로명 주소 대조
3. 대표 카테고리가 실제 주력 메뉴와 맞는지 확인
4. 전화·주차·사진은 출처와 이용 권한이 있을 때만 입력
5. 검수자, 날짜, 근거 URL을 별도 운영 로그에 기록

## 가져오기

관리자로 `/admin/import`에 로그인해 CSV를 업로드하고 오류 0건을 확인한 다음 확정한다. 로컬 검증은 다음을 사용한다.

```bash
npm run db:migrate:local
./node_modules/.bin/wrangler d1 execute retaste-local --local --file scripts/seed-week1.sql
./node_modules/.bin/wrangler d1 execute retaste-local --local --command "SELECT COUNT(*) total, SUM(hero_image_url IS NULL) missing_images, SUM(latitude IS NULL OR longitude IS NULL) missing_coordinates FROM places WHERE status='PUBLISHED'"
./node_modules/.bin/wrangler d1 execute retaste-local --local --command "SELECT slug, COUNT(*) count FROM places GROUP BY slug HAVING count > 1"
```

## 롤백

가져오기 전에 대상 slug와 기존 ID를 내보낸다. 잘못된 신규 행은 우선 `HIDDEN`으로 전환한 뒤 참조 관계를 확인하고 관리자 승인하에 삭제한다. 기존 행 갱신은 감사용 CSV와 이전 D1 export를 기준으로 복원한다. 운영 DB에서 범위 없는 `DELETE`를 실행하지 않는다.
# 공공데이터 후보 동기화

공공데이터포털 일반 인증키는 로컬 `.dev.vars`의 `DATA_GO_KR_SERVICE_KEY`와 Cloudflare Worker secret에만 저장한다. 키는 이미 인코딩된 형태와 디코딩된 형태를 모두 허용하지만 코드에서 정확히 한 번만 URL 인코딩한다.

배포 후 `/admin/data-sync`에서 출처와 주소 필드를 선택해 최대 5페이지씩 이어서 동기화한다. 도로명/지번 결과는 관리번호로 중복 제거된다. 매일 03:17 KST 예약 실행도 가장 오래된 미완료 작업을 이어간다.

후보 검수는 `/admin/candidates`에서 한다. 영업 중 대기 후보만 목록과 네이버 지도에 표시되며, 좌표가 없으면 목록에서 직접 확인·입력해야 승인할 수 있다. 휴업·폐업 데이터는 후보로 표시되지 않고, 연결된 공개 장소가 있으면 자동으로 숨겨진다.

## 평가 v2 운영

- 공개 점수는 활성 8표부터 표시하고 일반 회원·리뷰어 집단도 각각 8표 전에는 표본 수만 표시한다.
- 투표는 원본 이벤트를 보존하고 재계산 작업을 만든다. 예약 작업은 리뷰어 신뢰도·유사도, 최대 25개 점수 작업, Golden Pick 만료, 조작 신호를 순서대로 처리한다.

## 발견 피드 평가 QA 데이터

장소 목록의 평가 공개 경계와 추천 레일을 검증할 때만 다음 시드를 사용한다. 이 파일은 `qa-discovery-*` 사용자·투표·Golden Pick만 교체하며 실제 회원 데이터는 수정하지 않는다.

```bash
# 로컬 D1
./node_modules/.bin/wrangler d1 execute DB --local --file scripts/seed-discovery-ratings.sql

# 운영 D1 — 기능 PR 병합과 배포 후 실행
./node_modules/.bin/wrangler d1 execute DB --remote --file scripts/seed-discovery-ratings.sql
```

장소 ID 정렬 기준 앞의 일곱 곳에는 각각 0, 3, 7, 8, 12, 25, 50표가 배정된다. 출력 결과에서 `sample_count`를 확인하고 `/places`에서 8표 미만은 `평가 n/8`, 8표 이상은 추천률과 평가 인원이 함께 표시되는지 확인한다.
- 리뷰어 신뢰도는 일반 회원 합의와 비교 가능한 평가 5개부터 보정하며, 공통 10곳·80% 이상 일치하는 리뷰어 군집은 `1/sqrt(k)`로 감쇠한다.
- `/admin/ratings`에서 stale 스냅샷, 실패 작업, 열린 조작 사건을 확인하고 수동 재계산 또는 사건 상태 변경을 수행한다.
- 무효화는 `vote_events`를 삭제하지 않고 `invalidated_vote_events`와 관리자 감사 로그를 남긴 뒤 해당 장소만 다시 계산한다.

운영 반영 전 백업과 마이그레이션:

```bash
mkdir -p /tmp/retaste-rating-backup
./node_modules/.bin/wrangler d1 export retaste-production --remote --output /tmp/retaste-rating-backup/before-rating-v2.sql
./node_modules/.bin/wrangler d1 migrations apply retaste-production --remote
```

실패 작업은 원인을 수정한 뒤 관리자 화면에서 장소별 재계산을 등록한다. 롤백 시 새 알고리즘 설정의 `active_until`을 지정하고 이전 Worker 버전을 재배포하며, 원시 투표와 마지막 정상 스냅샷은 그대로 유지한다. D1 전체 복원은 장애 범위를 확인한 뒤 백업 파일로만 수행한다.
