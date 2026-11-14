# TEMP 사진 77곳 보충

- 추적: #425. 소유: Jay/Codex.
- 상태: 사용자의 2026-11-14 NAVER 공개 사진 보충 요청에 따른 구현. 실제 데이터 반입·배포는 hash가 고정된 운영 PR 범위에서 수행한다.
- 범위: 현재 `temp100-652f4d261db7795b`의 사진 없는 77행. 기존 23개 공공누리 사진·원본 manifest·canonical 장소·회원 평가를 변경하지 않는다.

## 표시와 출처

NAVER 지도·플레이스·검색·블로그의 공개 페이지와 NAVER 이미지에서 확인한 사진 1개씩을 보충한다. source page와 image URL은 별도의 HTTPS 호스트 allowlist로 검증하며 임의 URL fetch·proxy 기능은 만들지 않는다. 검색 이미지 proxy URL의 내포된 src도 명시된 NAVER 미디어 호스트만 허용한다. legacy HTTP src는 HTTPS search.pstatic.net proxy 내부의 출처 값으로만 허용하며 직접 HTTP 이미지·다른 호스트·재귀 proxy는 거절한다.

사진에는 원문 링크·확인일·출처를 표시하고 `UNVERIFIED`를 유지한다. 공공누리·저작권 동의·현장 촬영으로 바꾸어 기록하지 않는다. 공개 사실과 이용권리 검증을 혼동하지 않는다. 기존 23개는 기존 공공누리 설명을 유지한다. 로컬 자료의 metadata 확인·개인정보 육안 점검 결과는 실제 수행 범위만 기록하며 모든 개인정보 검증 완료로 확대하지 않는다.

## 저장과 적용

0046의 `temp_photo_supplement_batches`가 불변 manifest/hash와 ACTIVE/WITHDRAWN/version을 보관하고, `temp_photo_supplements`가 기존 entry에 FK로 연결된다. 원본 manifest의 photo=null인 정확한 77행만 허용한다. 상호·주소·sourceId·현재 공개 상태·base version·canonical version을 확인한다.

관리자가 생성한 하나의 보충 batch INSERT 안에서 77행 생성과 감사 기록이 함께 실행된다. 한 행이라도 잘못되면 전부 rollback된다. 같은 hash/id의 재실행은 변경하지 않으며 다른 hash로 같은 target을 덮어쓸 수 없다. 데이터·actor·manifest는 불변이고, WITHDRAWN 전환은 현재 ADMIN·version과 감사 기록을 요구한다.

공개 route는 원본 공공누리 사진을 우선하고, 없을 때만 ACTIVE 보충 사진을 사용한다. 기존 `hero_image_url`은 수정하지 않는다. null일 때 읽기 결과에서만 보충 URL을 제공하고 회수하면 원래 값으로 돌아간다. 공개 batch와 canonical 장소 상태를 확인한 뒤 기존 R2 binding의 정확한 `temp100-naver/<batch>/<entry>-<sha>.<ext>`만 읽는다. 파일당 8MiB 이내의 실제 바이트 SHA/MIME을 검증한다. 런타임 외부 이미지 fetch는 없다.

## 운영 도구와 검증

`node --experimental-strip-types scripts/temp-photo-supplement-sql.mjs <manifest> <snapshot> <ADMIN-id> <ISO-now> <private-output.sql> [apply|withdraw]`

- manifest: schemaVersion=1, targetBatchId 고정, entries 77개. 최종 파일 bytes SHA·MIME·NAVER 출처·UNVERIFIED 포함.
- snapshot: `{targetBatch,canonicalVersion,entries,photos}`. canonical version을 전후 대조하여 일관된 snapshot만 사용한다. entries는 원본 100행이며 photos는 실제 R2 다운로드 검증의 `{key,sha256,contentType,size}`다. 파일당 8MiB, 합계 64MiB, SQL 100,000byte, private 입력 2MiB 상한을 둔다.
- withdraw snapshot에는 `{supplementBatch}`를 추가한다. 출력 SQL은 해당 보충 batch만 WITHDRAWN으로 바꾸며 원본 장소·사진·평가를 보존한다. 동일 회수의 재실행은 무변경이다.
- 원격 반입은 77개 전체 출처/이미지 확인과 hash 고정, 사진 다운로드/개인정보 점검, 실제 R2 bytes 검증 뒤 시행한다. 자동 승인이나 권리 확보를 주장하지 않는다.

검증은 호스트/중첩 URL/권리 오기입 거절, 77행 원자 적용/실패/중복 재실행, 기존 23장·canonical 불변, 공개 이미지 바이트·숨김/회수 차단, desktop/mobile 표시를 포함한다. 이 변경은 새 의존성·공급자 API·binding·cron·인증 방식을 추가하지 않는다. runtime 변경 후 live RSI 확인은 운영 담당자가 수행한다.

## Rollback과 제거

먼저 보충 batch를 WITHDRAWN으로 바꾸고 공개 route가 404·기존 이미지 복귀하는지 확인한다. 물리 R2 삭제는 hash가 고정된 해당 77개 key만 별도 승인된 운영 단계에서 시행한다. 불변 출처/감사 이력은 보존한다. 코드 rollback은 보충 데이터를 이해하는 merged source의 maintenance fence/forward fix를 우선한다.
