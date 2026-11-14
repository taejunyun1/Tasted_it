# TEMP100 잔여 77곳 사진 운영 적용 — 2026-11-14

- 상태: 사용자 요청에 따른 구현 범위. 이 문서를 포함한 기능 PR의 필수 검증·독립 리뷰·병합 뒤 GO.
- 담당: Jay/Codex, #425. NAVER 공개 사진을 TEMP에 연결하라는 사용자 지시를 반영한다. 권리 상태는 UNVERIFIED이며 실제 라이선스·동의·방문 사실을 만들어 기록하지 않는다.
- 대상: 기존 Cloudflare 계정 `7543330c65069ee2df1b7b353fb0201c`, Worker `retaste-beta`, D1 `retaste-production` (`5181489d-83a7-4f78-9384-db096cadaa2d`), R2 `retaste-review-photos`. 공개 batch `temp100-652f4d261db7795b`에서 photo=null인 정확한 77곳만 추가한다.

## 데이터와 변경

원래 manifest·100개 장소·기존 공공누리 사진 23개·평가·회원·학생 권한은 보존한다. 새 0046의 별도 사진 보충 batch/entry와 제한된 영구 trigger로 한 INSERT에 정확한 77개와 감사 1행을 생성한다. 사진의 공개 원문, 매장 동일성, 실제 바이트·SHA·MIME를 확인한다. 공개 목록·상세는 sidecar를 읽으며 canonical 행을 갱신하지 않는다.

sourcePage/image URL은 NAVER의 명시된 호스트 allowlist로 제한하며 런타임 외부 fetch는 없다. 로그인·CAPTCHA·차단 우회, 새 provider/binding/cron/유료 API는 추가하지 않는다.

## 운영 순서와 한도

1. 병합 main과 현재 Worker를 기록하고 새 0046 hash, private 최종 manifest hash, 기존 base batch version, 전역 canonical version, 원래 100행·사진 23개 hash를 고정한다. 0045(B06)가 필요하면 먼저 적용하고 0046을 순차 적용한다. 추가 schema는 기존 Worker 동작·자료를 바꾸지 않으며 전면 차단·전체 DB 복원은 하지 않는다.
2. private 0700/0600의 최종 77개 manifest와 별도 upload plan으로 `temp100-naver/temp100-652f4d261db7795b/` 아래 정확한 77개 key에 최대 77회 PUT한다. 파일당 8MiB·전체 64MiB 이하, JPEG/PNG/WebP·SHA-256을 요구한다. 각 key를 R2 GET 최대 77회로 읽어 실제 바이트·SHA·MIME를 검증한다. 다른 prefix와 기존 23개 key는 삭제하지 않는다.
3. snapshot 전후 canonical version이 같은지 확인하고 병합된 SQL 생성기로 private SQL을 생성한다. sourceId/name/address/base.photo=null, 정확한 77개 대상, 현재 ADMIN, base/canonical version 검사를 유지한 단일 INSERT를 실행한다. 생성 전후 hash를 기록하며 응답 유실 시 재실행 전에 동일 batch·감사·77개 entry 상태를 조회한다. 기대와 다르면 공개 상태를 확정하지 않는다.
4. 병합 main만 배포하고 새 version 100%를 확인한다. 업로드나 출처 자료가 부족하면 사진을 활성화하지 않고 B06만 독립 배포할 수 있다. B06이 이미 배포됐다면 사진 변경을 포함한 최신 main으로 후속 배포한다.
5. 실제 100곳에 사진 URL이 있는지 확인한다(기존 23+추가 77). 새 77개 GET의 실제 바이트·SHA, 대표 HEAD, 범위 밖 404, 공개 목록·상세·사진 출처, 기존 23개 중 대표 1개를 검증한다. 사진 원문·업소 주소·쿠키·백업은 공개 repo/wiki에 넣지 않는다. 사용자 화면은 공개 출처 링크와 UNVERIFIED를 표시한다.
6. 기존 승인 검증용 ADMIN 임시 30분 세션 최대 1개로 RSI 단 1회와 감사 1행을 확인하고, finally에서 정확한 세션의 잔존 0을 확인한다. B06과 같은 배포라면 동일 검증 세션·RSI 1회를 공유한다. 실제 역할 변경·메일·OAuth·평가 생성은 하지 않는다.

한도: 사진 PUT 77회 / 검증 R2 GET 77회, 새 사진 77개·기존 23개 총 100개, 사진 관련 수동 HTTP 110회 이하 / 운영 D1 읽기 25회 이하, 관리자 세션 최대 1개 / RSI 1회(B06과 공유 가능). NAVER 공개 페이지·이미지 수집은 로그인 없는 읽기만 하며 403/429 대상에 재시도·우회하지 않는다.

## 복구와 완료

새 사진에 문제가 있으면 정확한 보충 batch만 WITHDRAWN으로 바꾸고 감사 1행과 함께 사진 77개를 숨긴다. 원래 100개 장소·공공누리 사진 23개는 유지하며 원본·실행 원장을 삭제하지 않는다. R2 정리가 필요하면 이번 77개 key에 한정한다. 같은 manifest 재실행은 기존 영수증 확인이며 다른 manifest 덮어쓰기는 실패한다. 교체·재활성화는 새 명시 계획을 따른다.

운영 DB 전체 복원, 적용 migration 수정·제거는 이번 범위가 아니다. Worker 복구는 현재 schema와 호환되는 version 또는 forward fix로 한다. 정확한 77개 entry·감사 1행, 공개 사진 100개, 실제 바이트·화면·RSI·정리 결과를 SSOT/wiki에 기록한다. 확인하지 않은 이용권리를 승인됨으로 바꾸지 않는다.
