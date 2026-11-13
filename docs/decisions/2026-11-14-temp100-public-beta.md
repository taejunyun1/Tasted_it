# TEMP100 베타 공개와 회수

- 추적: [#408](https://github.com/taejunyun1/Tasted_it/issues/408), [#413](https://github.com/taejunyun1/Tasted_it/issues/413)
- 담당: Jay/Codex. 구현·운영 책임자는 Jay이며 역할별 조직 투입을 전제하지 않는다.
- 근거: 2026-11-14 사용자의 TEMP100 공개·머지·배포 지시. 이전 [비공개 준비 정책](2026-11-14-temp100-seed-quarantine.md)의 공개 보류를 이 범위에 한해 갱신한다.

## 공개 범위

공식 웹 출처가 있는 실제 음식점 100곳의 상호·주소·분류, 독자 작성 소개, 원문 링크·확인일을 공개한다. 사진은 개별 저작물의 공공누리 제1유형 근거·저작자·장소 일치가 확보된 23장만 사용한다. 나머지 77곳은 사진 미제공과 공식 원문 링크를 표시한다. 외부 공식 소개·선정은 회원/리뷰어 점수와 분리하며 가짜 방문·투표·평가·인허가 번호는 생성하지 않는다.

목록·검색·상세·모바일 상세창에 TEMP와 현재 영업 미확인을 표시한다. `/places?temp=1`은 지도 범위와 독립적으로 100곳 전체를 탐색하며 검색어와 카테고리는 유지한다. TEMP 상세는 검색엔진 `noindex,follow`를 표시한다. 실제 운영 확인·현장 검수 완료 또는 정상 영업을 보증하는 목록으로 설명하지 않는다.

## 저장·좌표·중복

`temp_catalog_batches`와 `temp_catalog_entries`는 출처·권리 metadata를 canonical 장소와 분리한다. 신규 장소에만 TEMP 소유권을 기록하고 기존 공개 장소의 정확한 정규화 상호+주소 일치는 참조로 재사용한다. 기존 비공개/숨김 장소 또는 다중 일치는 충돌로 중단하며 기존 필드·사진·평가를 덮어쓰지 않는다. 출처 payload와 manifest hash는 DB trigger로 불변이다. 정규화의 SQL 차이로 중복이 생기지 않도록 모든 장소 INSERT/UPDATE/DELETE는 단일 canonical version을 증가시킨다(장소 변경당 작은 정수 행 쓰기 1회). 미리보기에서 전체 정규화 중복을 다시 확인하고 확정에서 같은 version을 요구한다.

좌표 0 또는 도시 중심값을 대신 넣지 않는다. 공식 페이지의 대상 상호·주소와 직접 결속된 좌표는 페이지 해시와 확인일을 남겨 관리자 확인한다. 근처 장소·기본 지도 중심점은 제외한다. 남은 행은 기존 NAVER Local adapter와 지역별 기존 quota를 사용해 한 행당 최대 1회, 배치 최대 100회 조회한다. 재시도·추가 공급자·유료 계약·cron은 추가하지 않는다. 정규화 상호·주소가 정확히 일치하는 단일 결과만 채택하고 실패/불일치는 배치를 중단한다. 실패 행은 동일 공식 원문 근거로 명시 확인한 뒤 재개한다.

## 확정과 회수

관리자 화면의 공개/회수는 B02의 세션 결속 미리보기·10분 이내 최근 인증·현재 권한·버전·감사·중복 실행 영수증을 사용한다. 100행 좌표 완료와 사진 23장의 지정 R2 key/content-type 및 실제 저장 바이트의 SHA-256 확인 없이는 공개 미리보기를 만들 수 없다. 파일당 8MiB, 전체 25MiB를 상한으로 읽는다. custom metadata는 필요하지 않으며 해시 검증을 대체하지 않는다. 공개 사진 응답도 실제 바이트 해시를 확인한다. 공개는 전체 100행을 원자적으로 적용한다.

베타 초기 1회 운영 반입은 머지된 운영 PR이 지정한 manifest/hash/기존 관리자/100행 범위만 허용한다. `scripts/temp100-publication-sql.mjs`는 공개 manifest와 최신 D1 snapshot·사진 확인 결과를 대조해 private SQL 세 파일을 만든다. 고정된 audit marker에만 동작하는 임시 trigger에서 권한·버전·100행 현재값 확인·변경·감사를 하나의 INSERT 문장으로 처리한다. 실패하면 변경과 감사가 함께 rollback된다. 동일 marker 재실행은 무변경이다. 실행자는 성공/실패와 관계없이 `finally`에서 **생성된 정확한 trigger**를 DROP하고 잔존 여부를 조회한다. 최근 인증 데이터를 조작하거나 런타임 우회 endpoint를 만들지 않는다.

회수는 batch를 WITHDRAWN으로 바꾸고 해당 배치가 새로 생성한 장소만 HIDDEN으로 전환한다. 기존 canonical 장소와 회원 투표/저장/감사는 유지한다. 사진 route는 공개 batch+공개 장소+검증된 정확한 prefix/key만 조회하고, 회수 즉시 `no-store` 404가 된다. R2 물리 삭제는 자동 수행하지 않으며 승인된 정확한 23 key 목록으로 별도 확인 후 처리한다.

## 운영 인계

1. 머지된 main의 0042/0044 migration 적용 여부 확인.
2. `build-temp100-public.mjs <원본 private 디렉터리> <새 private 디렉터리>`로 source SHA 고정·사진 SHA 검증. 원본은 덮어쓰지 않는다.
3. manifest를 ADMIN 전용 stage에 제출. 기존 canonical 참조와 충돌 수를 확인한다.
4. 공식 좌표 증거를 `coordinate-source`로 반영하고, 남은 행만 `geocode` 한 번씩 실행한다. 실패가 있으면 원문을 확인하고 중단 원인을 기록한다.
5. 승인된 `photo-upload-plan.json`의 23 key에만 표준 CLI로 업로드하며 content type을 지정한다. custom metadata 옵션은 사용하지 않는다.
6. canonical version을 먼저 읽고 batch/100 entries/기존 장소 및 R2에서 내려받은 실제 바이트 해시 결과를 private snapshot으로 저장한 뒤 version을 다시 읽어 같음을 확인한다. 다르면 재수집한다. SQL 생성 입력은 `{canonicalVersion,batch,entries,places,photos}`이며 `photos`는 `{key,sha256,contentType}`의 실제 바이트 검증 결과다. 사진 확인 합계는 25MiB/23개 이내로 제한한다.
7. 운영 PR의 승인 범위에서 install → apply → 현재상태·audit 확인 → finally cleanup → 임시 trigger 잔존 0 확인. 기본 UI 확정은 최근 인증 절차를 사용한다.
8. 실제 `/places?temp=1` 100곳, 검색·상세, 사진 있음/없음, 비로그인 관리자 거절, Worker RSI를 확인하고 SSOT에 실제 결과를 기록한다.

원본 manifest·실사진·좌표 상세·운영 SQL·로그는 `.superpowers/operations`의 0700/0600 자료이며 Git에 포함하지 않는다. 공개 증거는 수량·해시·검증 결과만 기록한다.
