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

실제 클라우드 후보에서는 별도 승인된 D1 ID와 비공개 R2를 확인하고 후보 전용 인증을 비밀 바인딩으로 주입한다. 기존 운영 Worker와 운영 자원은 대상에서 제외하며, Cloudflare Access 보호와 후보 주소 회수 범위를 운영 PR에 넣는다. 후보 주소를 열기 전에 승인된 참여자와 검증 상한을 확인한다. [Vite 환경 설정](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/) · [Cloudflare Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)

## 운영 전 확인

1. 지정된 운영자는 참여자 두 명의 계정과 좌석, 이메일 인증 상태를 비공개로 대조한다. 새 학생 초대에는 한 사람당 하나만 발급한다. 초대는 최대 7일이며 좌석 만료를 넘지 않는다.
2. 참여자가 기존 계정으로 리뷰어를 신청한 뒤 운영자는 B08의 사유·미리보기·최근 재인증으로 승인한다. 기준 미달의 프로젝트 예외 승인이 필요한 경우 실제 사유를 기록한다. 발급과 권한 결정은 감사 이력으로 확인한다.
3. 현재 운영 D1의 56개 적용 원장을 기준으로 새 Worker를 검증한다. 사진 복구 작업과 트랜잭션 가드는 0055의 열과 테이블을 사용한다. 이 스키마가 없는 운영 원장 및 정리 가드만 빠진 합성 상태에서 파일럿 사진 제출은 409이며 R2 쓰기 0이다. 0055에는 개인정보 요청·관리 작업이 포함되어 있다. 운영 적용 범위는 기존 격리 전환 또는 선행 스키마가 명시된 운영 PR을 따른다.
4. 후보 Worker의 정확한 버전에서 두 좌석의 자격, 미승인 사진 직접 GET·HEAD, 승인 후 공개, 철회·정리, 기존 B09와 일정·회원 경로를 대조한다. B17과 #397은 보류다.

## 활성화와 확인

새 **STUDENT_REVIEWER_PHOTO_PILOT_SEATS** 설정은 기본 미지정이다. 호환성이 입증된 운영 후보에서 한 좌석부터 확인하고 두 번째로 늘린다. 기존 전역 사진 업로드는 비활성으로 두고 활성·유효·이메일 인증된 대상 좌석과 활성 REVIEWER 자격을 동시에 충족할 때 파일럿 사진 제출을 연다.

- 각 계정의 첫 실제 방문 장소 1곳에서 방문일·설명과 직접 촬영 사진 한 장을 제출한다. 검수 대기 동안 공개 상세와 익명 직접 URL에 사진이 나타나지 않는지 확인한다.
- 범위 밖 계정의 사진 제출 거절과 R2 쓰기 0을 확인한다. 작성자 미리보기, 관리자 승인, 승인 사진의 공개 상세·출처 링크, 철회 후 정확한 키 정리를 각각 확인한다.
- 환경·담당·상한·검증·되돌리기를 명시한 운영 PR을 병합한 범위에서 전환과 필수 live를 실행한다. 되돌릴 때 파일럿 좌석 설정을 비우고 기존 운영 Worker와 활성 버전을 확인한다. 제출·감사 이력은 보존한다.
- 안내 메일은 운영 준비를 확인하고 사용자에게 문안과 수신자 승인을 받은 뒤 각각 발송한다. 주소와 토큰은 전달본에만 둔다. 메일 전달과 실제 접속·방문·제출을 각각 기록한다.

## 장소 사진 확보

공개 178곳 중 TEMP 100곳과 일반 장소 78곳을 확인했다. 일반 78곳에는 대표사진 또는 공개 적격 리뷰 사진 메타데이터가 없다. 원장 856곳은 보존한다. 현행 광주·전남·전북 공개 범위와 체인·미확정·타지역 비노출을 따른다.

직접 방문 원본, 업소가 재사용을 허용한 원본, 개별 사진의 이용 조건이 확인된 공공 자료 순으로 확보한다. 사진별 정확한 상호·주소, 원문 URL, 촬영자 또는 제공자, 재사용 근거, 확인일과 이미지 해시를 기록한다. 일반 장소 사진은 별도 공개·회수 상태를 쓰며 방문 리뷰의 자료와 구분한다. 원본 게시물만 확인된 곳은 링크 후보로 남긴다. [NAVER 접근 정책](https://policy.naver.com/policy/disclaimer.html) · [Instagram oEmbed](https://developers.facebook.com/docs/graph-api/reference/instagram-oembed/) · [공공누리 제1유형](https://www.kogl.or.kr/info/licenseType1.do)

일반 장소 가운데 출처와 이용 근거가 확인된 사진이 화면에 표시되는 장소 수를 센다. TEMP 사진 77곳의 이용권리 미확인 표시는 보존한다. 이용 근거가 확인된 자료로 교체할 때 출처와 회수 근거를 함께 갱신한다.
