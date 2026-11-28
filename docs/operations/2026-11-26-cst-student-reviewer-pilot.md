# CST 학생 리뷰어 두 명 방문 실증

[실증 추적 #511](https://github.com/taejunyun1/Tasted_it/issues/511) · [12월 10일 SSOT](../plans/2026-11-13-cst-service-ssot.md) · [사진 공개 기준](../decisions/2026-11-13-cst-implementation-policy.md)

## 대상과 현재 상태

학생 작업공간에는 연결된 좌석 2개와 빈 좌석 2개가 있다. 활동 리뷰어로 연결된 좌석과 유효 초대는 0개다. 파일럿 참여자는 운영자가 확인한 두 계정으로 확정한다. 이미 연결된 계정에는 기존 학생 좌석을 사용한다. 새 참여자가 확정되면 빈 좌석의 개별 초대를 사용한다.

기존 운영 Worker의 사진 업로드는 비활성이다. 로컬에서는 지정된 두 학생 리뷰어가 같은 장소에 각자의 사진과 방문 평가를 제출했고 두 건이 검수 대기로 저장됐다. 실제 방문과 운영 수신은 대기다. [로컬 증거](../evidence/cst-student-reviewer-pilot-20261126/summary.json)

## 격리 검증 범위

운영과 같은 56개 마이그레이션을 빈 로컬 D1에 적용한 뒤 0055에서 사진 정리 열·인덱스·트랜잭션 가드에 해당하는 SQL 7문만 실행했다. 개인정보 요청 테이블의 부재도 확인했다. 합성 계정 두 명으로 학생 초대 발급·수락, 리뷰어 신청·승인, 같은 장소의 JPEG 제출, 관리자 검수, 작성자 철회까지 확인했다. 검수 중 작성자 미리보기는 200, 익명 조회는 404였다. 승인 후에는 공개 응답의 JPEG 바이트가 일치했다. 철회하면 익명 응답은 404로 돌아왔고 R2 객체와 정리 작업은 0건이었다.

```sh
pnpm run test:integration tests/integration/student-reviewer-cleanup-only.test.ts
```

이 증거는 격리 D1·R2를 쓰는 로컬 라우트 검증에 한정된다. B17과 #397은 보류이며 운영 Worker의 전환 적합성은 대기다. 영속 D1에 0055 일부를 먼저 실행하지 않는다. 이후 기존 0055의 열 추가가 중복되고 마이그레이션 원장과 스키마가 어긋날 수 있다.

클라우드에서 계정별 화면을 다시 확인해야 할 때는 별도 승인 PR에 운영 트래픽을 받지 않는 Worker 하나와 전용 D1 하나, 비공개 R2 버킷 하나를 명시한다. 빈 D1에 확정 마이그레이션 세트를 적용하고, 합성 데이터와 새 시험 계정만으로 검증한다. 기존 운영 계정·자격 증명·초대 링크 가져오기와 실제 이메일 발송은 각각 승인될 때까지 보류한다.

### 후보 Worker 로컬 실행

후보는 학생 C·D와 관리자 한 명의 합성 계정으로 시작한다. 전역 사진 업로드는 꺼 두고 학생 두 좌석만 지정한다. 브라우저 진입과 서비스 로그인 모두를 확인하며, 학생 신청·사진 리뷰·관리자 검수·장소 사진 경로만 사용한다. OAuth, 가입·복구 메일, 예약 작업과 운영 관리 경로는 후보에서 제외된다.

```sh
umask 077
pilot_dir=$(mktemp -d)
node --experimental-strip-types scripts/prepare-student-pilot.mjs "$pilot_dir/candidate"
pilot_config="$pilot_dir/candidate/wrangler.json"
pilot_state="$pilot_dir/state"
pnpm exec wrangler d1 migrations apply DB --local --config "$pilot_config" --persist-to "$pilot_state"
pnpm exec wrangler d1 execute DB --local --config "$pilot_config" --persist-to "$pilot_state" --file "$pilot_dir/candidate/seed.sql"
CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH="$pilot_config" RETASTE_PILOT_STATE_DIR="$pilot_state" pnpm run build
CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH="$pilot_config" RETASTE_PILOT_STATE_DIR="$pilot_state" pnpm exec vite preview --host 127.0.0.1 --port 5184 --strictPort
```

후보 전용 장부는 기준 56개, 장소 사진 0063·0064, 사본 0065의 59개다. 사본에는 0055 중 사진 정리 SQL 7문만 들어간다. 생성 설정은 빈 후보용 ID와 로컬 인증 정보를 포함하고 모든 공개 호스트를 비활성화한다. `credentials.json`은 합성 계정 로그인에만 사용한다. 새 후보를 검수할 때는 새 출력 경로와 빈 로컬 상태에서 시작한다.

미리보기와 별도 터미널에서 아래 명령에 생성된 합성 자격 증명 파일의 경로를 전달한다. 사이트 접속, 초대·수락, 두 학생의 사진 제출·공개·철회, 출처 링크, 데스크톱·모바일을 한 번에 확인한다.

```sh
node scripts/verify-student-pilot.mjs http://127.0.0.1:5184 /path/to/candidate/credentials.json
```

별도 로컬 후보를 빌드해 Chromium 데스크톱·모바일에서 관리자 재인증, 초대 2건 발급·수락, 리뷰어 신청 2건 승인, 사진 제출·공개·출처 2건·작성자 철회까지 확인했다. 승인 전 직접 조회와 철회 후 조회는 404였다. Wrangler 배포 사전 점검은 로컬에서 통과했다. [데스크톱](../evidence/cst-student-pilot-worker-20261126/desktop.png) · [모바일](../evidence/cst-student-pilot-worker-20261126/mobile.png)

### 클라우드 합성 실증

승인 범위는 전용 Worker `retaste-student-pilot`, 이름이 같은 전용 D1 하나와 `retaste-student-pilot-photos` 비공개 표준 R2 하나다. 검증 대상은 합성 관리자와 학생 C·D다. 운영 자원과 B17·#397은 보류한다. 합성 검증에는 Worker의 무작위 브라우저 비밀번호와 앱의 별도 계정 인증을 사용한다. 실사용 계정 및 Cloudflare Access 구성을 적용하는 단계는 별도 승인 범위다. [Vite 환경 설정](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/) · [Cloudflare Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)

1. 승인 PR 병합 후, 일치하는 `main`의 깨끗한 체크아웃에서 `tastedit-production` 프로필이 기존 Re:Taste 계정인지 대조한다. 운영 배포 버전과 D1 장부 건수를 먼저 읽는다. 이름이 정확히 일치하는 후보 자원이 각각 0건이어야 신규 생성으로 넘어간다. D1과 표준 R2를 각 1개까지 생성하며 기존 자원을 가져오지 않는다.
2. D1 목록의 후보 이름과 UUID를 함께 대조한다. 비어 있는 후보에만 `node --experimental-strip-types scripts/prepare-student-pilot.mjs <비공개-새-출력경로> --cloud <확정한-후보-D1-UUID>`를 실행한다. 후보 설정을 지정해 `wrangler d1 migrations apply DB --remote`, 이어 `wrangler d1 execute DB --remote --file <seed.sql>`로 실행한다. 장부 59개, 보류 migration 0개, 합성 사용자 3개, 지정 좌석 2개 및 빈 리뷰·사진을 대조한다.
3. `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH`로 후보의 `wrangler.json`을 골라 빌드한다. 나온 `build/server/wrangler.json`의 Worker 이름, D1 UUID, R2 이름, 정적 자산의 Worker 우선 처리, 비활성 호스트·버전 URL, 외부 바인딩 부재를 확인한다. 같은 설정과 `--secrets-file <worker-secrets.json>`을 사용해 `wrangler deploy --dry-run`과 닫힌 첫 배포를 실행한다. 비밀 파일은 권한 0600으로 로컬에 보관한다.
4. 닫힌 배포가 확인되면 같은 커밋으로 `wrangler.open.json`을 지정해 다시 빌드한다. 같은 이름과 바인딩을 확인하고 후보 호스트만 연다. Worker가 요청 당 검증 주소와 만료 시각을 대조한다. 공개 도메인 연결과 별도 버전 URL은 비활성이다. 비밀번호 없는 브라우저가 일반 경로와 정적 자산에서 401을 받는지 먼저 확인한다.
5. `node scripts/verify-student-pilot.mjs https://retaste-student-pilot.retaste-beta.workers.dev <credentials.json> --cloud`로 검증한다. 공개 효과는 브라우저 입장 인증을 통과한 비로그인 앱 세션을 기준으로 확인한다. 두 학생의 가입·리뷰·사진 승인과 철회를 한 번 수행한다. R2 업로드는 합성 JPEG 각각 1장이다. 철회 후 익명 앱 조회 404, D1 사진·정리 작업 0건을 확인하고 운영 버전과 장부를 다시 읽는다.
6. 실패하면 전환을 중지하고 기존 후보 상태를 확인한다. 브라우저 호스트를 회수할 때는 3단계 닫힌 설정을 같은 후보에 적용하고 후보 URL 응답과 운영 버전을 대조한다. 설정의 최대 유효 시간 24시간 뒤에는 Worker가 입장을 닫는다. 합성 D1·R2는 검증 기록과 함께 보존하고 실제 사용자·메일 등록은 별도 범위에서 다룬다.

사용량 상한은 후보 3자원, D1 장부 59개와 합성 시드 1회, 합성 브라우저 검증 1회와 확인 요청, 2장 업로드, 비활성·활성 배포 각 1회다. 별도 요금제 변경, 외부 메일, 지도·AI 유료 호출은 없다. 표준 R2와 D1의 사용량은 기존 계정 내 포함량을 따른다. [D1 요금](https://developers.cloudflare.com/d1/platform/pricing/) · [R2 요금](https://developers.cloudflare.com/r2/pricing/) · [첫 Worker 배포](https://developers.cloudflare.com/workers/versions-and-deployments/deployment-management/#first-upload) · [Wrangler 비밀 바인딩](https://developers.cloudflare.com/workers/configuration/secrets/)

### 2026-11-26 원격 실행 확인

- `ad19278e`에 후보 트래픽 100%를 적용했다. 닫힌 첫 배포의 학생 경로는 404, 검증 주소의 비인증 학생 경로와 실제 JS 자산은 401이었다. 앱 입장은 11월 27일 15:30:13 KST에 만료된다.
- 전용 D1의 장부 59개와 합성 계정 3개를 확인했다. 두 학생이 각 JPEG 한 장을 제출했다. 작성자는 검수 중 자기 사진을 확인했고 직접 공개 조회는 404였다. 운영자 승인 뒤 앱 비로그인 상세에서 JPEG와 출처 링크 두 개를 확인했다. 각 작성자 철회 후 직접 조회는 404, D1 사진·정리 작업·가드와 R2 객체는 0건이었다.
- 운영 Worker `ff51553c` 100%, 장소 원장 856건과 장부 56개는 대조값이 일치했다. 실제 학생 연결과 메일 발송은 대기다. [#521 실행 영수증](https://github.com/taejunyun1/Tasted_it/pull/521)

## A·B의 기존 계정으로 사진 제출

A·B는 현재 운영 계정으로 리뷰어를 신청하고 기존 관리자 절차에서 승인받는다. 활동 리뷰어가 방문 내용을 제출한 뒤 후속 호환 빌드의 검수 요청 완료 화면 또는 **내 제출 기록 → 직접인증 사진 관리**에서 직접 촬영 사진 한 장을 첨부할 수 있다. 내 계정과 관리자만 검수 전 사진을 볼 수 있다. 공개는 현재 방문 리뷰의 승인과 관리자의 사진 검수 및 재인증을 모두 거친다. 장소 상세에 승인된 방문 작성자를 **직접인증**과 함께 표시한다. 사진이 공개되면 그 아래에도 작성자 공개 프로필 링크가 붙는다.

0065는 기존 방문 리뷰의 ID·내용 버전과 장소 식별자를 사용하며 실증 사진의 원장과 객체 키를 따로 만든다. 기존 리뷰 사진 개수와 정리 원장은 그대로 사용한다. 운영 활성화에는 별도로 검증된 비공개 R2 바인딩과 `STUDENT_REVIEW_PILOT_SEATS`가 필요하다. 설정이 비어 있으면 신규 첨부가 닫힌다. 이미 첨부한 사진의 조회·철회와 예약 정리는 바인딩을 유지한 상태에서 계속 작동한다.

철회, 리뷰 변경, 장소 폐업과 작성자 자격 상실 시 현재 공개 조건을 다시 확인한다. 정리 대상은 이 경로가 예약한 정확한 객체 키에 한정한다. 업로드 결과가 불확실하고 객체가 보이지 않으면 추적 행을 남겨 예약 작업에서 재확인한다. 운영 책임자는 미확인 행을 확인할 담당과 보존 기준을 실행 PR에 기록한다. 운영 DB 적용·R2 구성·좌석 활성화는 검증과 배포 범위를 담은 별도 실행 PR이 필요하다. B17과 #397은 보류다. [A·B 진행 기록 #511](https://github.com/taejunyun1/Tasted_it/issues/511)

로컬 합성 계정의 데스크톱·모바일 제출, 관리자 검수, 공개 이미지와 출처, 철회 후 GET·HEAD 404를 확인했다. 운영 기준 장부 56개에 0065만 추가한 통합 환경에서 A·B의 수락, C의 차단, 승인 전 비공개, 업로드 도중 세션 철회, R2 쓰기 지연과 후속 정리를 확인했다. [학생 데스크톱](../evidence/cst-student-ab-photo-20261126/student-desktop.png) · [학생 모바일](../evidence/cst-student-ab-photo-20261126/student-mobile.png) · [관리자 데스크톱](../evidence/cst-student-ab-photo-20261126/admin-desktop.png) · [관리자 모바일](../evidence/cst-student-ab-photo-20261126/admin-mobile.png) · [공개 출처](../evidence/cst-student-ab-photo-20261126/public-attribution.png)

### 첫 신청부터 사진 공개까지 로컬 검증

[#533](https://github.com/taejunyun1/Tasted_it/pull/533)의 고정 소스 `59f09e2`와 운영 적용 순서 56개에 0065를 더한 합성 환경에서 확인했다. 이메일 인증된 합성 A·B는 리뷰어 프로필과 제출 이력이 없는 상태에서 신청했다. 제안 승인 0건인 두 신청을 일반 승인 미리보기에서 제외하고, 관리자가 사유를 기록한 B08 예외 승인에서 작업 영수증까지 확인했다. 두 학생은 방문 리뷰를 작성해 직접 촬영을 가정한 합성 JPEG를 첨부했다. 방문 리뷰와 각 사진의 독립 승인 뒤 출처 링크와 직접 사진을 확인했고, 작성자 철회 뒤 익명 GET·HEAD에 404가 반환됐다. [B08 승인 기준](../decisions/2026-11-14-b08-reviewers.md)

첫 방문 작성 중 사진 안내가 데스크톱의 고정 탭에 가려지고, 접수 가능 계정에도 준비 중이라고 표시되는 조건을 재현했다. 다음 호환 후보 `1000033`에서 자격을 충족하는 좌석에 제출 뒤 첨부를 안내했다. 사진 단계에 들어가면 안내 제목이 초점을 받고 본문이 가려지지 않는다. 접수가 가능한 해당 리뷰에만 검수 요청 확인에서 **실증 사진 관리** 링크를 제공한다. 데스크톱·모바일의 일반 진입과 사진 검수·공개·철회, 기존 사진 저장소 대조와 외부 호출 0건을 확인했다. 이 후보의 운영 적용은 별도 범위다. [데스크톱 사진 안내](../evidence/cst-student-ab-first-visit-20261126/desktop-guidance.png) · [모바일 제출 확인](../evidence/cst-student-ab-first-visit-20261126/mobile-receipt.png)

## 운영 전 확인

2026-11-26 실제 실증 참여자는 기존 운영 A·B 좌석으로 확정했다. 두 계정은 이메일 인증된 연결 계정이다. 활동 리뷰어와 대기 신청은 0건이며 이후 지정 계정의 기존 로그인과 리뷰어 신청을 확인한다. 사진 작업, 안내와 발송에는 승인된 운영 절차를 적용한다. [#511](https://github.com/taejunyun1/Tasted_it/issues/511)

1. 지정된 운영자는 참여자 두 명의 계정과 좌석, 이메일 인증 상태를 비공개로 대조한다. 새 학생 초대에는 한 사람당 하나만 발급한다. 초대는 최대 7일이며 좌석 만료를 넘지 않는다.
2. 참여자가 기존 계정으로 리뷰어를 신청한 뒤 운영자는 B08의 사유·미리보기·최근 재인증으로 승인한다. 기준 미달의 프로젝트 예외 승인이 필요한 경우 실제 사유를 기록한다. 발급과 권한 결정은 감사 이력으로 확인한다.
3. 현재 운영 D1의 56개 적용 원장을 기준으로 호환 Worker를 확인한다. 이번 동일 서비스의 A·B 경로는 전용 0065와 비공개 R2를 별도로 사용한다. 앞선 합성 실증의 0055 부분 구성은 당시 격리 후보의 기록으로 보존한다. [운영 호환 빌드와 전환 준비](./2026-11-26-cst-student-production-compat.md)
4. 후보 Worker의 정확한 버전에서 두 좌석의 자격, 미승인 사진 직접 GET·HEAD, 승인 후 공개, 철회·정리, 기존 B09와 일정·회원 경로를 대조한다. B17과 #397은 보류다.

## 활성화와 확인

동일 서비스의 **STUDENT_REVIEW_PILOT_SEATS**는 기본 미지정이다. 앞선 격리 합성 환경의 설정명은 **STUDENT_REVIEWER_PHOTO_PILOT_SEATS**였다. 호환성이 입증된 운영 후보에서 한 좌석부터 확인하고 두 번째로 늘린다. 기존 전역 사진 업로드는 비활성으로 두고 활성·유효·이메일 인증된 대상 좌석과 활성 REVIEWER 자격을 동시에 충족할 때 파일럿 사진 제출을 연다.

- 각 계정의 첫 실제 방문 장소 1곳에서 방문일·설명과 직접 촬영 사진 한 장을 제출한다. 검수 대기 동안 공개 상세와 익명 직접 URL에 사진이 나타나지 않는지 확인한다.
- 범위 밖 계정의 사진 제출 거절과 R2 쓰기 0을 확인한다. 작성자 미리보기, 관리자 승인, 승인 사진의 공개 상세·출처 링크, 철회 후 정확한 키 정리를 각각 확인한다.
- 환경·담당·상한·검증·되돌리기를 명시한 운영 PR을 병합한 범위에서 전환과 필수 live를 실행한다. 되돌릴 때 파일럿 좌석 설정을 비우고 기존 운영 Worker와 활성 버전을 확인한다. 제출·감사 이력은 보존한다.
- 안내 메일은 운영 준비를 확인하고 사용자에게 문안과 수신자 승인을 받은 뒤 각각 발송한다. 주소와 토큰은 전달본에만 둔다. 메일 전달과 실제 접속·방문·제출을 각각 기록한다.

### A·B 직접인증 안내 발송 범위

이 범위를 승인한 PR이 병합되면 Jay가 운영 담당자 메일함의 Gmail 발송 경로에서 사용자 승인 검토본 v2의 제목과 본문을 기존 A와 B에 각각 보낸다. 좌석당 단독 수신 한 건, 총 두 건까지다. 수신자는 사전 확인한 연결 계정과 발송 직전 현재의 유효 좌석·이메일 인증을 대조한다. #563 신청 전용 Worker 단독 100%, 11월 27일 21:47 KST 정기 점검 6개 경로와 같은 실행의 D1 감사가 선행한다. 첨부, 참조, 숨은참조, 신규 초대와 신규 비용은 없다.

발송 전 같은 제목과 각 수신자로 보낸편지함을 확인한다. 발송 후 메시지별 보낸편지함 기록과 제목·단독 수신자를 대조한다. 이미 보냈거나 결과가 모호하면 같은 좌석에 다시 보내기 전에 기존 기록으로 발송 여부를 확정한다. 취소할 수 없는 발송은 기록하고 오류 시 남은 발송을 중단한다. 주소·메시지 ID는 비공개 영수증에만 보존한다. 발송 결과와 실제 본인 신청·방문·사진 검증은 따로 기록한다. [#563 운영 절차](2026-11-26-cst-direct-verification-ab-activation.md)

## 장소 사진 확보

공개 178곳 중 TEMP 100곳과 일반 장소 78곳을 확인했다. 일반 78곳에는 대표사진 또는 공개 적격 리뷰 사진 메타데이터가 없다. 원장 856곳은 보존한다. 현행 광주·전남·전북 공개 범위와 체인·미확정·타지역 비노출을 따른다.

직접 방문 원본, 업소가 재사용을 허용한 원본, 개별 사진의 이용 조건이 확인된 공공 자료 순으로 확보한다. 사진별 정확한 상호·주소, 원문 URL, 촬영자 또는 제공자, 재사용 근거, 확인일과 이미지 해시를 기록한다. 일반 장소 사진은 별도 공개·회수 상태를 쓰며 방문 리뷰의 자료와 구분한다. 원본 게시물만 확인된 곳은 링크 후보로 남긴다. [NAVER 접근 정책](https://policy.naver.com/policy/disclaimer.html) · [Instagram oEmbed](https://developers.facebook.com/docs/graph-api/reference/instagram-oembed/) · [공공누리 제1유형](https://www.kogl.or.kr/info/licenseType1.do)

일반 장소 가운데 출처와 이용 근거가 확인된 사진이 화면에 표시되는 장소 수를 센다. TEMP 사진 77곳의 이용권리 미확인 표시는 보존한다. 이용 근거가 확인된 자료로 교체할 때 출처와 회수 근거를 함께 갱신한다.
