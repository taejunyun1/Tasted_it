# 직접인증·인증 복귀와 육모정 첫 반입의 단일 운영 전환

이 문서를 포함한 실행 PR이 병합되면 Jay/Codex가 아래 조건 안에서 진행한다. 동일한 Re:Taste 계정, Worker `retaste-beta`, D1 `DB`, 기존 비공개 R2와 `tastedit-production` 프로필을 사용한다. 이 실행안은 #552의 미실행 후속 버전을 대체한다. #533의 입력·실행 범위·정기 검증을 그대로 적용한다. [#533 1단계](2026-11-26-cst-student-dark-release.md) · [#552 후속 범위](2026-11-26-cst-direct-verification-rollout.md)

## 실행 조건

1. #533의 운영 영수증에서 독립적인 1단계 버전 단독 100%, 그 버전의 정기 RSI 6개 경로 성공과 같은 시각의 D1 감사 기록을 확인한다. #552는 미실행이어야 한다. 정확한 1단계 버전을 `stage1_version`에 기록한다.
2. 1단계의 검증한 계정을 `CLOUDFLARE_ACCOUNT_ID`로 고정하고 작업 기록에 출력하지 않는다. 1단계의 D1 UUID·두 R2와 운영 배포 설정을 대조한다. 57개 장부 해시는 `fc6f85cd31144332e29488216081a45a228d7a645c43b801bf4060c6cfc6b6ad`다. 원장 856, 검수 연결 83, 연결 A·B 두 좌석, 승인과 실제 승인 방문 0, 직접인증 사진 원장·전용 버킷 객체 0과 대상 장소의 기존 적격성을 읽어 확인한다. 일반 사진 마이그레이션과 대상 원본 키는 미적용·미존재 상태다.
3. #553·#554·#555를 포함한 병합 소스 `2911bd498a1f6f4aa9d07db359665048d6c09cd8`의 `--student-pilot --poi-media` 원본과 접수 종료 번들을 사용한다. 생성 도구의 절대 경로 두 필드를 제외하면 #533 구성에서 바뀌는 값은 `POI_MEDIA_PUBLIC_ENABLED=true` 하나다. `STUDENT_REVIEW_PILOT_SEATS`는 미지정이고 `REVIEW_PHOTO_UPLOAD_ENABLED=false`다. 기존 두 cron, 비밀 이름, 라우트, 호환 날짜와 바인딩을 확인한다. 설정과 대상이 어긋나면 전환하지 않는다.

## 고정한 입력

| 대상 | SHA-256 |
|---|---|
| 원본 Worker 빌드 | `958db244bc9b75b66c30192d85eff86438b1eb47d7d7c1b1a34d98e1d15a036b` |
| 원본 Wrangler 설정 | `c8c3a468622093c842af2d9e4a1387705b8cf8cd7ea017573e0ebb1de6232b0a` |
| 일반 사진만 활성화한 최종 빌드 | `f59573f4694d7d512d5e38e98b04bd81890d8a9f24facdad0d88411f4045156b` |
| 최종 Wrangler 설정 | `dceccdc59c0e87e5ae25ee1c833bf8200164661b51a31856a2e7cf3756d3390c` |
| `0063_place_poi_media.sql` | `946e06e9974eb3f5e8652b0b8601595d2108333942e3e416c59036e8cd98fe4d` |
| `0064_place_poi_media_identity_guard.sql` | `6f19cb90902699d2e3f2d8797c2d153cbcebf4f9df7808835424a2b268164211` |
| 정확한 한 행의 비공개 STAGED SQL | `a24937633518cfef7bfa1e6737dddc64670f4da2e5e14fd19cb0a05f86874378` |
| 육모정 JPEG 454570바이트 | `e0584085348b0f3c49efcf37c85a996199284496f93ede3f5f411dd09d70e0eb` |

보존한 번들의 두 빌드와 JSON 바이트를 `scripts/lib/release-fingerprint.mjs`의 `buildFingerprint`와 `digest`로 다시 대조한다. 두 마이그레이션과 한 행 SQL은 승인 해시를 각각 확인한다. JPEG는 남원시 숲정이1길 4의 육모정, TourAPI 대표 사진 한 장이다. 배포된 사진의 전체 프레임과 사진 밖의 **한국관광공사 TourAPI · 공공누리 제3유형** 표시 및 원본 링크를 확인한다. [육모정 원본](https://tong.visitkorea.or.kr/cms/resource/60/2899760_image2_1.jpg) · [공공누리 제3유형](https://www.kogl.or.kr/info/licenseType3.do)

## 적용 순서와 한도

1. `selected_db_config`는 #533 운영 D1과 아래 두 파일만 담은 전용 `migrations_dir`을 사용한다. 대기 파일이 정확히 0063·0064이고 해시가 확인된 뒤 한 번 적용한다. 기존 순서 뒤에 0065, 0063, 0064가 끝 순으로 남는다. 59개 장부 해시 `c968f4252c2ef02399a8d615b22b4c6ef8cd8b87fb073c65915ca7b4ed55cce2`, 추가 대기 0, 일반 사진 표 0행과 기존 장부 집계를 확인한다.

   ```sh
   pnpm exec wrangler d1 migrations list DB --remote --config "$selected_db_config" --profile tastedit-production
   pnpm exec wrangler d1 migrations apply DB --remote --config "$selected_db_config" --profile tastedit-production
   pnpm exec wrangler d1 migrations list DB --remote --config "$selected_db_config" --profile tastedit-production
   ```

2. `config`에는 검증한 최종 Wrangler 설정을 연결한다. 두 dry-run 결과를 확인하고 버전 한 개만 업로드한다. `candidate_version`은 그 업로드의 정확한 결과다. 구성·바인딩·플래그와 현재 `stage1_version`의 단독 100%를 확인한 뒤 새 버전으로 한 번 전환한다. 설정 검사나 조회가 모호하면 트래픽을 유지하고 실제 버전 목록을 다시 읽는다.

   ```sh
   pnpm exec wrangler deploy --dry-run --config "$config" --profile tastedit-production
   pnpm exec wrangler versions upload --dry-run --strict --config "$config" --name retaste-beta --profile tastedit-production
   pnpm exec wrangler versions upload --strict --config "$config" --name retaste-beta --profile tastedit-production
   pnpm exec wrangler versions view "$candidate_version" --name retaste-beta --json --profile tastedit-production
   pnpm exec wrangler deployments status --name retaste-beta --json --profile tastedit-production
   pnpm exec wrangler versions deploy "${candidate_version}@100" --name retaste-beta --yes --profile tastedit-production
   ```

3. 새 버전 단독 100%와 기존 인증·탐색·관리 접근, TEMP 경계와 직접인증 사진 접수 종료, 일반 사진 표 0행을 확인한다. 보존된 `staged_file`의 해시를 대조해 육모정 한 행만 등록한다. 원장의 실제 STAGED 1·공개 0, 정확한 장소·출처·원본 해시, 대상 익명 GET·HEAD 404를 확인한다.

   ```sh
   pnpm exec wrangler d1 execute DB --remote --config "$selected_db_config" --profile tastedit-production --file "$staged_file"
   ```

4. 운영 관리자가 기존 세션에서 재인증하고 장소 사진 관리의 정확한 STAGED ID를 연다. **원본 첨부**에 지정한 JPEG를 선택한다. 같은 파일 외에는 제출하지 않는다. 지정 비공개 키에 조건부 생성 최대 한 번, 성공 첨부 감사 한 건, 관리자 미리보기의 정확한 바이트와 익명 조회 404를 확인한다. 결과가 불확실하면 같은 ID·키·감사를 읽고, 필요하면 같은 파일로 한 번 재시도한다. 확인이 끝난 뒤 별도의 **공개 확정**과 사유·감사 한 건으로 공개한다.

5. 데스크톱 상세와 모바일 시트에서 출처 링크와 전체 원본을 확인한다. 공개 GET·HEAD 200과 GET 길이·해시, TEMP 및 직접인증 경계를 대조한다. 기존 등록 사진은 Instagram 38개 원문과 실제 렌더링 결과를 각각 기록한다. 등록 수를 실제 표시 수로 대신하지 않는다. 관리자 재인증이 대기 중이면 Worker 전환과 사진 상태를 각각 기록하고 새 Worker의 정기 RSI와 대응 D1 감사 검증을 계속한다.

운영 한도는 D1 두 파일 한 번, 한 행 STAGED 한 번, 새 Worker 업로드·전환 각각 한 번, 원본 저장 성공 한 건과 공개 승인 한 건이다. 기존 서비스 검사 12경로와 페이지 이동 4개, Instagram 38곳의 원문·브라우저 표본, TEMP 2개, 대상 사진과 비공개 표본의 확인을 허용한다. 신규 외부 인증·메일·유료 API·새 버킷·계정 승인·직접인증 업로드·예약 변경은 0이다. 기존 Worker, D1·R2와 브라우저 요청 사용량이 비용에 반영된다. 비밀과 개인 정보는 비공개로 유지한다.

## 복구

- 전환 전에 장부·설정·버킷·장소 기록이 다르면 1단계 버전을 유지한다. 0063만 성공해도 적용한 기록과 자원을 보존하고 다음 단계를 멈춘다. 불확실한 D1/R2 쓰기 결과는 읽기 전용으로 상태를 확인한다.
- 사진 문제는 같은 ID의 **회수 확정** 한 번으로 처리하고 익명 GET·HEAD와 관리자 미리보기 404를 확인한다. 원본과 장부는 보존한다.
- Worker에 중대한 회귀가 있고 A·B 승인·방문·사진이 0일 때만 `pnpm exec wrangler rollback "$stage1_version" --name retaste-beta --yes --profile tastedit-production`을 최대 한 번 허용한다. 동일한 1단계 버전 100%와 보존된 59개 장부를 확인한다. 공개된 사진을 먼저 회수하지 못했으면 후속 일반 사진 활성화 전에 원장 회수와 404를 확인한다.

59개 장부의 정확한 병합 빌드에서 육모정 실제 JPEG의 비공개 첨부·공개·회수, 원본 해시와 출처, 404를 확인했다. 격리 Wrangler는 57개 뒤 0063·0064만 적용해 59개와 빈 사진 원장을 만들었다. 보존 번들의 두 dry-run도 통과했다. A·B 실제 승인·접수·안내 발송, B17·#397은 이후 범위다. [#555](https://github.com/taejunyun1/Tasted_it/pull/555) · [버전 전환](https://developers.cloudflare.com/workers/wrangler/commands/workers/#versions-deploy)
