# A·B 1단계 운영 적용 · 신규 접수 미지정

이 문서를 승인한 [#511 실증 기록](https://github.com/taejunyun1/Tasted_it/issues/511)의 병합 이후 Jay/Codex가 명시한 조건에서만 실행한다. [#530](https://github.com/taejunyun1/Tasted_it/pull/530)과 [#531](https://github.com/taejunyun1/Tasted_it/pull/531)은 코드·로컬 확인 범위다. #529가 확인한 `retaste-beta` 버전 `1343a5e8-8bfe-496b-9950-80b41482ea90` 100%를 기준으로 한다. A·B 좌석 설정을 계속 미지정으로 두며 전역 리뷰 사진도 false다. 실제 계정·좌석·방문·메일·예약 작업 구성·기존 사진·B17·#397 변경은 0이다.

## 읽기 전용 점검

- 이 실행 PR의 정확한 병합 SHA와 필수 CI, 수정이 없는 해당 SHA의 작업 트리, 기존 Re:Taste 계정 `7543330c65069ee2df1b7b353fb0201c`과 `tastedit-production`, 기존 Worker·D1 UUID·R2·비밀 이름·변수·호환 날짜와 플래그·공개 호스트·두 cron을 확인한다. 현행 100% 버전은 위 UUID 하나다. `versions view` 출력은 비공개로 비교하고 비밀값은 출력하지 않는다. 다른 버전 또는 권한·리소스 불일치면 멈춘다.
- `d1 info`의 DB 이름·UUID와 적용 순서대로 `SELECT name FROM d1_migrations ORDER BY id`를 대조한다. #531의 56개 순서 해시 `a9beee8c240ccef6d667125f9968c4d70483c315d1afe458f99b18c582762928`와 맞아야 한다. 운영 결과의 이름 순서대로 `<name> <sha256>\n`을 이어 붙여 SHA-256을 계산한다. SQL 바이트 지문은 깨끗한 병합 소스에서 계산한다. 원장 856, 검수 연결 83, 연결 학생 2를 읽고 신규 테이블·7개 트리거 및 0065의 부재, 보류 0053·0054·0055·0056·0059·0060과 0063·0064 미적용을 확인한다. 승인 PR의 복구 시점 메타데이터에 기록하되 복원 작업은 이 단계 범위에 두지 않는다.
- 새 버킷 이름은 `retaste-ab-review-photo-pilot-20261126`을 제안한다. 올바른 계정의 `r2 bucket list`에서 정확히 0건이어야 한다. 목록 조회 실패나 동명이 이미 있으면 재사용하지 않고 중단한다. 예상 한도는 기존 Worker의 새 버전 1개, 비공개 R2 Standard 1개, 운영 D1의 추가 DDL 파일 1개다. 운영 사진 객체와 사용자 데이터 쓰기는 0이다. 버킷은 운영 계정 공유 용량·요청 사용량에 따라 과금되며 무조건 무료로 판정하지 않는다.
- 트래픽 전환 전 #529에서 이미 지정한 `1343a5e8…`의 같은 버전 RSI를 Observability에서 대조한다. 예약 `47 */6 * * *`의 첫 해당 기회는 2026-11-26 21:47 KST다. 이전 15:47 실행, 테스트용 로컬 cron, 다른 Worker, 익명 200은 대체 근거가 아니다. 사용 가능한 승인된 토큰이 없으므로 예약 결과를 대기한다. 이는 Cloudflare 업로드 자체의 기술 조건과 별개인 이미 승인된 배포 확인 범위다.

## 허용된 실행의 순서

`CLOUDFLARE_ACCOUNT_ID`를 위 운영 계정으로 고정한다. #531 병합과 #529의 동일 버전 RSI를 모두 확인할 때까지 아래 단계의 운영 쓰기를 시작하지 않는다.

1. `umask 077`을 두고 별도 디렉터리에 `node scripts/build-official-photo-release.mjs "$pilot_release/candidate" --student-pilot`을 실행한다. `student-pilot-release.json`의 소스·기준선·패치 입력·빌드·원본 구성 해시를 고정한다. 56개 장부 로컬 기존 12 경로·2 cron·공식 사진 30곳과 57개 장부 로컬 접수/비공개/공개/회수 흐름을 현재 산출물로 확인한다. 레지스트리 SHA-256은 `e4a3d3d54a8140ef1c9661b8f1589e593dc2afe0686f4a100229f94f1964407e`인 30곳이다. 이후 다른 사진 변경이 main에 병합되어도 이 실행 PR의 정확한 병합 소스로만 빌드한다.
2. 승인 프로필에서 아래 명령으로 Standard 전용 버킷 1개와 비공개 상태를 확인한다. 공개 개발 URL 비활성, 커스텀 도메인 0개, 생성 직후 Cloudflare R2 목록 조회에서 새 버킷만 지정해 객체 0개를 확인한다. 관측을 위해 새 객체를 쓰지 않는다. [Cloudflare R2 목록 API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/objects/methods/list/)

   ```sh
   pnpm exec wrangler r2 bucket create retaste-ab-review-photo-pilot-20261126 --storage-class Standard --profile tastedit-production
   pnpm exec wrangler r2 bucket info retaste-ab-review-photo-pilot-20261126 --json --profile tastedit-production
   pnpm exec wrangler r2 bucket dev-url get retaste-ab-review-photo-pilot-20261126 --profile tastedit-production
   pnpm exec wrangler r2 bucket domain list retaste-ab-review-photo-pilot-20261126 --profile tastedit-production
   ```

3. 0065 파일을 한 개만 담는 비공개 migration 디렉터리와 DB 전용 설정을 만든다. 설정의 `binding=DB`, 이름 `retaste-production`, UUID는 `d1 info`와 기존 빌드의 정확한 UUID, `migrations_dir`은 그 디렉터리 상대 경로다. 선택한 파일 `0065_student_review_pilot_photos.sql`의 SHA-256은 `565ba6556234103c607a6dcce29e2f635c7357adf25d55bd74b14b304aafca74`와 매니페스트의 해당 해시 모두에 일치해야 한다. 기준 Worker가 여전히 100%이고 상태가 동일할 때 아래 목록의 유일한 대기 파일과 해시를 검증한 뒤 apply를 1회 실행한다. 전체 `drizzle` 디렉터리는 사용하지 않는다.

   ```sh
   pnpm exec wrangler d1 migrations list DB --remote --config "$pilot_migration_cfg" --profile tastedit-production
   pnpm exec wrangler d1 migrations apply DB --remote --config "$pilot_migration_cfg" --profile tastedit-production
   pnpm exec wrangler d1 migrations list DB --remote --config "$pilot_migration_cfg" --profile tastedit-production
   ```

   56개 이름과 순서는 동일하고 끝에 0065만 추가돼 57개여야 한다. 보류 migration과 추가 대기는 0개, 신규 원장 0행, 신규 체계의 정확한 7개 트리거와 5개 명시 인덱스, 기존 집계·경로가 일치해야 한다. 이 시점에도 이전 버전이 100%다.
4. 원본 빌드 설정의 해시를 다시 대조한다. 상대 자산 경로를 유지하려고 같은 `build/server` 디렉터리에 새 JSON을 쓴다. 기존 두 cron과 비밀 이름·환경 변수·D1/기존 R2·자산·공개 호스트·호환 설정을 보존하고 후보 R2 바인딩 하나만 추가한다. `STUDENT_REVIEW_PILOT_SEATS`는 미지정이다. 원본 설정과 새 설정 모두를 정규화해 새 바인딩 행을 제거하면 내용이 정확히 같은지 비교한다. 새 설정 해시를 별도로 고정하고 기록한다.

   ```sh
   jq '.r2_buckets += [{"binding":"STUDENT_REVIEW_PILOT_PHOTOS","bucket_name":"retaste-ab-review-photo-pilot-20261126"}]' "$pilot_built_cfg" > "$pilot_dark_cfg"
   pnpm exec wrangler deploy --dry-run --config "$pilot_dark_cfg" --profile tastedit-production
   pnpm exec wrangler versions upload --dry-run --strict --config "$pilot_dark_cfg" --name retaste-beta --profile tastedit-production
   pnpm exec wrangler versions upload --strict --config "$pilot_dark_cfg" --name retaste-beta --profile tastedit-production
   pnpm exec wrangler versions view "$pilot_new_version" --name retaste-beta --json --profile tastedit-production
   pnpm exec wrangler deployments status --name retaste-beta --json --profile tastedit-production
   pnpm exec wrangler versions deploy "${pilot_new_version}@100" --name retaste-beta --yes --profile tastedit-production
   ```

   업로드와 100% 변경을 각각 1회로 제한한다. 새 버전 ID는 업로드 결과를 대조한 값이다. 변경 전 후보 버전의 실제 바인딩 추가, 미지정 좌석, 기존 flags·비밀 이름, `preview_urls=false`, 두 기존 트리거를 확인하고 구 버전이 여전히 100%인지 재확인한다. `wrangler deploy`의 실제 실행, `wrangler triggers deploy`, Worker 새로 만들기와 Access 변경은 범위 밖이다.

## 확인과 회수

- 새 버전 100%, 공개 경로·관리자 로그인 접근, 공식 사진 30곳의 정확한 프레임·원문과 TEMP 비노출, 새 R2 객체 0개와 D1 장부 57개·기존 집계를 확인한다. 비로그인 제한 경로는 로그인 이동, 정확한 형식의 합성 미등록 ID `/student-review-photos/00000000-0000-4000-8000-000000000000`에 익명 GET·HEAD가 404/no-store인지 확인한다. 학생 접수 닫힘은 실제 미지정 변수와 로컬 검증, 예약 0행으로 확인한다. 실제 사람 계정에 로그인하거나 운영 POST를 보내지 않는다. 날짜/버전이 일치한 새 버전 RSI를 별도 확인하며 대기 중이면 그대로 기록한다. 이전 버전의 마지막 성공은 이 검증으로 쓰지 않는다.
- 배포 전에 실패하면 트래픽을 유지한다. D1 또는 버킷을 이미 추가했다면 그 상태를 보고하고 0065 drop, Time Travel, 버킷 삭제는 실행하지 않는다. 배포 뒤 회귀·예상 밖의 공개/데이터 변동은 `pnpm exec wrangler rollback 1343a5e8-8bfe-496b-9950-80b41482ea90 --name retaste-beta --yes --profile tastedit-production`을 최대 1회 실행하고 정확한 100%, 기존 공개 경로, 사진 30곳과 57개 원장을 확인한다. 스키마와 버킷을 보존한다. 정책의 보관 기간은 확인 대기로 유지한다. DARK에서 예상과 달리 예약이 한 건이라도 생겼다면 예약 키를 보존하고 새 쓰기를 중지한 상태에서 별도 정리 복구를 승인받는다. 이전 Worker는 새 사진을 정리하지 않는다.

[Cloudflare R2 명령](https://developers.cloudflare.com/workers/wrangler/commands/r2/) · [D1 장부](https://developers.cloudflare.com/d1/reference/migrations/) · [버전 업로드와 전환](https://developers.cloudflare.com/workers/wrangler/commands/workers/) · [롤백](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
