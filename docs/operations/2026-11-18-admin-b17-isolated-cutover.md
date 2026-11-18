# B17 이전 요청 확인과 격리 전환 검토안

2026-11-18 · #460 / #470 · 담당 Codex root · **PROPOSED / 운영 HOLD**. B09 기준 소스는 `e96360c`다. 이 문서는 CI 복구 전 준비와 검증의 기록이다. GitHub 필수 CI와 병합, 아래 대상·비용·권한·보존 범위가 명시된 별도 운영 변경 PR의 승인을 각각 거친다. #397은 계속 HOLD다.

## Cloudflare 확인 결과

공개 문서·API에서 **정확한 이전 버전의 모든 HTTP 실행, `waitUntil` 및 이미 발행한 R2·D1 작업의 종료를 확인하는 계약**을 찾지 못했다. Cloudflare는 배포 이후에도 시작된 실행이 이전 코드를 계속 사용할 수 있고, 배포 성공이 기존 실행과 외부 작업의 완료를 확인해 주지 않는다고 명시한다. 100% 트래픽, 배포/버전 삭제 성공 응답, 소수 위치의 503은 전환 또는 객체 상태의 자료로 사용한다. [Cloudflare 배포의 기존 요청 처리](https://developers.cloudflare.com/workers/versions-and-deployments/deployment-management/#in-flight-requests) · [Deployments API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/)

HTTP 연결에는 고정 실행시간 상한이 없다. Cron 15분은 해당 시작 시점의 Cron 실행 한도이고, 런타임 업데이트의 grace period는 애플리케이션 배포 시계로 사용할 수 없다. Observability·Wrangler tail의 종료 행은 관측한 실행에 한해 근거가 된다. R2의 강한 일관성도 조회 시점의 객체 상태를 설명한다. 무로그나 안정된 R2 목록으로 남은 실행 수를 계산하지 않는다. [Workers 실행시간](https://developers.cloudflare.com/workers/platform/limits/#duration) · [실시간 로그 한도](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/#limits) · [R2 일관성](https://developers.cloudflare.com/r2/reference/consistency/)

향후 Cloudflare 지원 확인에는 실제 계정의 Worker·이전/점검 버전·배포 ID·UTC를 제공하고, 모든 위치에서 이전 버전으로 새 실행이 배정되지 않는 시점, HTTP/cron/백그라운드의 종료 또는 취소, 이미 제출된 R2/D1 요청의 완료·취소 범위를 각각 요청한다. 답변이 실행 범위와 시점을 포괄하고 원본 채널에서 검증돼야 현재 `continue`의 종료 근거로 검토할 수 있다. 접근 권한과 답변 가능 여부는 미확인이다. 문의 초안을 기록하며 이 작업에서 지원 티켓은 제출하지 않았다. [Cloudflare 지원 안내](https://developers.cloudflare.com/support/contacting-cloudflare-support/)

## 선택한 대체안

이전 버전의 실행이 남는 경우에는 **원본에 마지막으로 확정된 상태를 보존한 뒤, 별도 대상 D1·R2에서 새 서비스를 재개하는 방식**을 검토한다. B09는 HTTP에서 사진을 R2에 올린 뒤 D1을 확정하고, 정리 작업은 R2 삭제 뒤 D1 상태를 반영한다. 새 lease나 플래그는 이미 진행 중인 구버전 코드에 적용되지 않는다. 같은 버킷에서 새 prefix만 붙이는 방식은 기존 cleanup·키 전달 경로 전체의 접근 한계를 별도로 보증해야 한다. 여기서는 물리적으로 다른 버킷과 D1 ID를 경계로 사용한다. [B09 사진 저장](https://github.com/taejunyun1/Tasted_it/blob/e96360c2c0dc4b7d619262021ef8001ad373bac9/app/features/ratings/reviewer-photo.server.ts) · [B09 사진 정리](https://github.com/taejunyun1/Tasted_it/blob/e96360c2c0dc4b7d619262021ef8001ad373bac9/app/features/ratings/reviewer-photo-deletion.server.ts)

| 단계 | 조치와 진입 조건 | 관찰 결과와 중단 기준 |
| --- | --- | --- |
| 0. 설계 승인과 대체 환경 | CI 복구 후 대상 D1 1개·R2 1개, 허용 권한과 비용, 보존·삭제 기한, 이전 자료 접근자를 별도 PR에 명시한다. 격리 환경에서 새 Worker가 후보 binding만 가진다는 사실과, 원본에 연결된 다른 쓰기 주체 및 버전별 binding을 목록화한다. 고객 데이터 반입 전 합성 데이터로 전체 경로·소요시간·한도를 검증한다. | 원본/후보의 ID가 겹치거나 원본 직통 쓰기 주체·R2 규칙·보존 기한을 설명할 수 없으면 운용 창을 열지 않는다. |
| 1. 새 유입 제한과 원본 보호 | 승인한 창에서 B09와 호환되는 점검 버전으로 새 작업 유입을 닫는다. 원본 R2의 모든 복사 대상 키를 포괄하는 보호 규칙을 먼저 적용·재조회한다. 원본 D1은 실제 0049 catalog의 82개 앱 테이블 각각에 INSERT/UPDATE/DELETE 거절 장벽을 **하나의 D1 트랜잭션**으로 설치한다. 배포 100%나 모든 위치의 새 버전 전파에 원본 쓰기 차단을 의존시키지 않는다. | R2 규칙 확인, D1 246개 장벽 및 기존 schema 확인, 대표 구버전 쓰기 거절과 읽기 성공 뒤 확정 경계를 기록한다. 짧은 TTL로 복사 중 보호가 풀리거나, 원본에 DDL/복원 가능한 별도 작업자가 남거나, 부분 설치 또는 결과 불명이면 후보를 열지 않는다. 완료 전의 DB 커밋은 스냅샷에 포함하며 이후의 쓰기는 거절돼야 한다. |
| 2. 고정 원본에서 후보로 이동 | 장벽 확인 뒤 원본 bookmark와 안전한 사본을 확보한다. 후보 DB에 원본 schema·장부·82개 테이블의 기존 열과 정확한 rowid를 옮기고 양쪽 digest·FK를 비교한다. 후보에만 고정 9개 migration을 적용하고 기존 값과 새 기본값·FK를 재확인한다. D1의 Time Travel은 사본 생성 기능으로 사용하지 않는다. 객체는 고정된 D1의 승인·권리 정보와 현재 조합으로 참조 키를 선정해 후보 R2로 복사하고 SHA-256·길이·필수 metadata를 대조한다. | 원본 보호 이후 생성된 미참조 객체, 결속 없는 pending 업로드, 폐기·회수된 객체는 새 공개 목록에 포함하지 않는다. 존재하지 않는 필수 원본, digest·rowid·FK 차이, 과거 작업 상태가 모호한 사진은 보호 상태로 남기고 공개 진행을 멈춘다. [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) · [D1 가져오기·내보내기](https://developers.cloudflare.com/d1/best-practices/import-export-data/) |
| 3. 후보 공개 읽기 | 모든 필수 확인을 통과한 후보에서 부작용 없는 익명 읽기 허용 목록만 연다. 계정/관리자, 작업·스케줄, 메일·LIVE RSI 감사·provider 호출, 조회 수 기록·세션 touch처럼 GET에서 발생하는 쓰기도 닫도록 실제 경로를 확인한다. 원본·후보의 정적 assets가 겹치는 동안 공개 읽기 경계를 확인한다. | 표본 페이지·정적 파일·공개 사진의 권리와 직접 URL, 허용 목록 밖 경로 거절, 후보 두 binding과 쓰기 0을 확인한다. 404/누락·알 수 없는 요청 결과는 진입 보류다. 원본 구 응답이 이미 전송된 바이트의 회수나 이후 취소를 보장하지 않는다. |
| 4. 후보 쓰기와 외부 기능 단계 개방 | 후보가 유일한 쓰기 원본임을 증명한 뒤 기존 권한·세션·동시성·감사 검증을 거쳐 내부 쓰기를 차례로 연다. 원본 장벽은 유지한다. 이전 메일·NAVER 등 외부 수신 측에 두 번 전달할 수 있는 작업은 영수증·quota·멱등으로 중복 방지가 입증될 때까지 보류한다. 사진 정리·삭제, 권리 취소와 개인정보 처리의 원본/후보 양쪽 보존 의무를 결정한다. | 정상 기능별 개방 근거를 분리한다. 과거 pending/running 행을 자동 재생하지 않는다. 원본 접근 및 보호 해제·삭제·보존 종료는 남은 요청의 전 범위 종료 근거 또는 영구 격리·권리 처리에 대한 별도 검토가 필요하다. |

## 실제 적용 경계와 되돌리기

- D1 장벽은 원본의 모든 앱 테이블에 적용하며 새로운 테이블·트리거·간접 갱신 경로가 발견되면 목록부터 갱신한다. 구버전 코드에 원본 DDL·관리 호출 경로가 있는지 검토하고, 전환 중 운영 import·Time Travel·바인딩 교체를 실행할 외부 작업자를 중지한다. 원본에 0050~0060을 적용하면 테이블 재구성으로 장벽이 떨어질 수 있으므로 9개 파일은 후보에만 적용한다. 공식 D1 batch의 트랜잭션 의미와 로컬 확인을 사용하며, 실제 계정에서 246문장과 응답 제한을 충족할 운영 도구가 필요하다. 장벽 설치만 246개로 기존 관리 SQL 180 상한을 초과하므로 별도 한도를 산정한다. 원격 원자 설치가 불가능하면 이 안은 HOLD다. [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) · [D1 한도](https://developers.cloudflare.com/d1/platform/limits/)
- 0049 원본 schema 해시에 장벽이 추가되므로 기존 보존 도구의 catalog 판정을 그대로 재사용할 수 없다. 원본은 승인된 장벽의 정확한 이름·대상·DDL 해시 집합과 기존 catalog를 각각 대조한다. 후보에는 기존 앱 트리거만 옮긴다. 데이터 반입 중 기존 seed 행을 중복 생성하거나 앱 트리거로 publication epoch 등을 바꾸지 않도록 schema·데이터·앱 트리거의 복원 순서를 검증한다. 82표의 암묵적 rowid도 signed 64bit 원문 그대로 이식한다. 일반 SQL export/import의 성공 여부와 별도로 실제 양쪽의 rowid·형식·값을 비교한다. 내보내기에서 원본 장부나 암묵적 rowid가 빠지면 검증 가능한 전용 복사 경로를 준비한다.
- R2 보호 규칙의 기존 설정을 저장하고 필요한 범위만 검토한다. 잠금 적용 성공 뒤 보호 객체의 덮어쓰기·삭제 및 이전 시작 업로드의 보호 객체 갱신이 차단된다. 새 키는 여전히 생성될 수 있으므로 원본 bucket 전체의 신규 객체 생성 차단이나 bucket 안정으로 해석하지 않는다. 규칙 갱신 API는 기존 구성을 교체하며 읽은 설정과 병합해 검토해야 한다. 정책과 부합하는 보호 기간·해제 주체가 확정되기 전에는 실행 대상이 아니다. [R2 bucket lock](https://developers.cloudflare.com/r2/buckets/bucket-locks/) · [규칙 교체 API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/locks/methods/update/)
- 원본 키의 서버 제공 생성 시각·etag 등 식별과 앱의 승인·보존 근거를 결속한다. 기준 이후 생성된 필수 키나 시점을 확정하지 못한 항목은 후기 업로드 후보로 격리해 읽기 목록에서도 보류한다. 복사 시 원본을 조건부로 읽고 후보를 다시 읽어 bytes SHA-256·필수 metadata를 비교한다. ETag만으로 내용 일치를 판정하지 않는다. [R2 조건부 동작](https://developers.cloudflare.com/r2/api/s3/conditional-operations/)
- 원본과 후보를 동시에 쓰기 대상으로 두지 않는다. 후보의 첫 쓰기 전에는 점검 상태로 되돌리고 후보를 봉인할 수 있다. 원본 쓰기 복원은 미확정 외부 작업과 권리 처리의 재대조 뒤 별도 선택한다. 첫 후보 쓰기 이후에는 구 DB로 트래픽을 되돌리면 그 쓰기가 유실될 수 있다. 후보에서 쓰기를 닫아 보호하고 현재 데이터 기준으로 전진 수정한다.
- 비용은 D1 사본의 저장·쓰기, R2 사본의 저장·조회·복사, 임시 보호 유지기간을 실제 행수·객체 수·바이트로 산정한다. 새 자원·자격·정책 테스트와 사본 반입·파기는 별도 변경 PR에 명시한다. 읽기 전용 버전과 복사 도구·운영 예산은 이 계획의 후속 산출물이다.

`b17-rollout-runner.mjs`의 현재 대상은 기존 D1·R2와 확정된 종료 근거를 전제로 한다. 새 대체안으로 현재 `UNKNOWN`을 변경하지 않는다. 운영 실행 상태와 사용자 수용은 별도로 기록한다.

## 필요한 로컬 검증

[지정 D1 시험](../../tests/integration/b17-isolated-cutover.test.ts)은 실제 0049 migration으로 만든 원본의 82개 앱 테이블·853개 열과 schema를 확인한다. 마지막 CREATE를 일부러 실패시킨 247문장 batch 뒤 장벽 0개와 쓰기 가능을 확인하고, 정상 batch는 246개를 원자적으로 설치한다. 늦은 장소 갱신·세션 삽입·회원 삭제가 원본에서 거절되며 원본의 행·rowid·값과 FK가 보존된다. 별도 후보 D1의 동일 식별자는 유지되고 후보 갱신은 통과한다.

시험은 두 로컬 D1에 합성 데이터를 각각 넣어 격리 경계를 확인했다. 운영 DB 복사·실제 R2 보호와 객체 전송·버전별 binding·공개 읽기 개방은 후속 운영 도구의 검증 항목이다. GitHub CI와 별개로 이번 Cloudflare 운영 조회·변경은 0이다.

통합 커밋 `bf94d9b`의 집중 통합시험 1건이 통과했다. 독립 검토에서 차단 의견은 없었다.

```sh
pnpm test:integration tests/integration/b17-isolated-cutover.test.ts
```
