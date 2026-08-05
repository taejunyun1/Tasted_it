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
pnpm db:migrate:local
pnpm exec wrangler d1 execute retaste-local --local --file scripts/seed-week1.sql
pnpm exec wrangler d1 execute retaste-local --local --command "SELECT COUNT(*) total, SUM(hero_image_url IS NULL) missing_images, SUM(latitude IS NULL OR longitude IS NULL) missing_coordinates FROM places WHERE status='PUBLISHED'"
pnpm exec wrangler d1 execute retaste-local --local --command "SELECT slug, COUNT(*) count FROM places GROUP BY slug HAVING count > 1"
```

## 롤백

가져오기 전에 대상 slug와 기존 ID를 내보낸다. 잘못된 신규 행은 우선 `HIDDEN`으로 전환한 뒤 참조 관계를 확인하고 관리자 승인하에 삭제한다. 기존 행 갱신은 감사용 CSV와 이전 D1 export를 기준으로 복원한다. 운영 DB에서 범위 없는 `DELETE`를 실행하지 않는다.
