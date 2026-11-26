# 공식 장소 사진 운영 배포

## 적용 범위

[#526](https://github.com/taejunyun1/Tasted_it/pull/526) 배포 직전의 `retaste-beta` 100% 버전은 `ff51553c-c8fb-462d-a9ae-a72c4f9e1082`였다. [#475](https://github.com/taejunyun1/Tasted_it/pull/475)의 소스 `494c07f56c174df42a3b027b1639772e2d9796b7`와 D1 장부 56개를 읽기 전용으로 확인했다. 새 앱 전체에는 보류 중인 스키마를 읽는 경로가 있다. [56개 장부 호환성 기록](../evidence/cst-runtime-schema-baseline-20261122/summary.json)

병합된 main의 전용 빌드는 위 소스에 검토된 사진 패치를 적용한다. 공식 사진 레지스트리와 표시 컴포넌트는 같은 main 커밋에서 가져온다. 정식 장소 상세와 모바일 시트에 공식 임베드와 작은 원문 링크를 표시한다. 공개 상태·주분류·정확한 상호와 주소를 서버에서 다시 확인하며 폐업과 TEMP 장소를 제외한다. 기존 대표사진을 우선한다. 패치가 적용된 파일과 입력 해시를 빌드 산출물에 기록한다.

차이는 사진 표시, 필요한 CSP 경로, 표시 플래그에 한정된다. 기존 Worker의 두 cron, D1·R2 바인딩, 인증, B09 및 리뷰 흐름을 대조한다. 적용 범위에 D1 마이그레이션·R2 반입·학생 계정·메일·B17·#397은 없다. 이미지 파일을 Worker에서 다운로드하지 않는다.

## 사전 검증

1. 배포 담당자가 병합된 정확한 main의 깨끗한 체크아웃에서 대상 계정·Worker·현재 100% 버전을 대조한다. 기존 운영 버전이 위 값과 다르면 중단한다.
2. 운영 DB의 마이그레이션 순서를 읽어 56개 기준과 비교한다. 파일명 배열은 실제 적용 순서가 기준이다. 0032가 0031 앞에 있다. [Cloudflare D1 마이그레이션](https://developers.cloudflare.com/d1/reference/migrations/)
3. 별도 로컬 D1에 56개 장부를 적용한다. 기준과 후보에서 공개 목록·상세, 로그인, 관리자·학생 접근 및 기존 예약 핸들러를 대조한다. 등록 사진의 데스크톱 상세와 모바일 시트에서 원문 링크를 확인한다. 비활성 플래그, 잘못된 상호·주소, 폐업과 TEMP의 비노출을 함께 확인한다.
4. 필수 CI 네 항목과 병합 후, 정확한 main에서 아래 빌드를 재현한다. 생성 설정의 Worker 이름, 운영 DB·R2 바인딩, 두 cron과 비밀값 부재를 대조한다. 승인 범위의 PR 본문과 필수 증거를 모두 확인한다.

```bash
export CLOUDFLARE_ACCOUNT_ID=7543330c65069ee2df1b7b353fb0201c
export WRANGLER_SEND_METRICS=false
release_parent="$(mktemp -d /tmp/retaste-official-photos.XXXXXX)"
node scripts/build-official-photo-release.mjs "$release_parent/candidate"
pnpm exec wrangler deploy --dry-run --config "$release_parent/candidate/build/server/wrangler.json" --profile tastedit-production
```

로컬 브라우저 화면은 합성 임베드를 사용한다. 모바일 390px 시트를 열면 가게명과 주소가 사진 위에 보인다. [데스크톱](../evidence/cst-official-photo-release-20261126/desktop.png) · [모바일](../evidence/cst-official-photo-release-20261126/mobile.png) · [실행 기록](../evidence/cst-official-photo-release-20261126/summary.json)

## 운영 확인과 회수

- 승인 PR에 명시된 빌드를 `wrangler versions upload --config`로 1회 올린다. 이전 버전이 트래픽 100%를 받고 있는지, 새 버전의 바인딩·설정이 일치하는지 재확인한 뒤 `wrangler versions deploy`로 새 버전에 100%를 배정한다. 기존 트리거와 공개 호스트 설정은 그대로 사용한다. [Cloudflare 배포 관리](https://developers.cloudflare.com/workers/versions-and-deployments/deployment-management/)
- 공개 홈·장소 목록·로그인·정책 페이지와 관리자 접근 보호를 확인한다. 승인된 전체 사진 장소의 공개 상세에서 등록된 정확한 임베드와 출처 URL을 읽는다. 대표 1곳에서 데스크톱·모바일의 실제 사진을 확인한다. 기존 RSI 결과의 확인 범위와 데이터 변경 여부를 배포 영수증에 기록한다.
- 공개 상세 실패, 대상 아닌 사진 노출, 인증·보안 헤더나 56개 장부의 예상 밖 차이가 나오면 같은 Worker를 이전 100% 버전으로 롤백한다. 버전과 공개 화면을 다시 대조한다. [Cloudflare 버전과 배포](https://developers.cloudflare.com/workers/versions-and-deployments/)

## #528 공식 사진 4곳 추가 배포

[#526 운영 영수증](https://github.com/taejunyun1/Tasted_it/pull/526)의 26곳과 실제 표시 결과를 기존 기준으로 보존한다. 2026-11-26의 배포 메타데이터에서 `retaste-beta`의 활성 버전 `6b8f3892-7032-424f-a4e9-47516b346a8a`가 트래픽 100%임을 읽기 전용으로 확인했다. 이 버전을 새 배포의 시작 조건과 롤백 대상으로 사용한다.

이 절을 승인한 운영 PR이 병합되고 [#528](https://github.com/taejunyun1/Tasted_it/pull/528)이 `main`에 반영되면, #528이 검수한 공식 임베드 4곳만 추가하도록 배포 담당 Jay/Codex에게 승인한다. 최종 레지스트리는 30곳이다. 기존 Worker·D1·비공개 R2·두 cron·공개 호스트·기능 플래그를 유지한다. 마이그레이션, 운영 D1 데이터 변경, R2 반입, 자원 추가, 실제 학생 설정·메일 발송, 유료 제공자 호출은 승인 범위 밖이다. 브라우저는 승인된 Instagram 임베드만 읽으며 Worker는 사진 파일을 받지 않는다. B17과 #397은 보류다.

1. 정확한 병합 `main`에서 `scripts/build-official-photo-release.mjs`로 기존 #475 기준 소스와 #526 사진 패치를 다시 적용한다. `tastedit-production` 프로필의 계정과 Worker를 대조한다. 현재 레지스트리를 읽어 이전 26곳과 #528의 4곳만 포함됐는지 확인하고, 빌드·설정·레지스트리 해시를 고정한다. 운영 100% 버전 또는 기준 설정이 달라졌으면 중단한다.
2. 운영 장부 56개를 적용 순서 그대로 읽기 전용으로 대조한다. `0032_place_course_context.sql`은 `0031_remove_workers_ai.sql`보다 먼저 적용됐다. 파일명과 각 SQL 파일의 SHA-256을 한 줄에 하나씩 실제 적용 순서로 넣은 로컬 검증 매니페스트의 SHA-256은 `a9beee8c240ccef6d667125f9968c4d70483c315d1afe458f99b18c582762928`이다. 정확한 후보 빌드를 이 순서로 재현한 합성 D1에서 검증한다. 공개 목록·상세, 로그인·관리자 접근, 두 예약 경로의 기존 동작과 CSP의 정확한 임베드 경로 30개를 비교한다. 실제 주소와 다른 합성 행, 폐업·TEMP, 플래그 비활성에서 임베드가 숨겨지는지 확인한다. 모바일 시트가 주소를 먼저 보여 주고 사진 아래에 원문 링크를 제공하는지도 확인한다.
3. 필수 CI 4개와 로컬 증거를 확인한 뒤 생성된 같은 설정으로 아래 두 dry-run을 모두 마친다. 생성 설정과 기존 운영의 Worker·D1·R2·기능 플래그 및 두 cron이 일치하는지, 비밀값이 평문 설정에 포함되지 않았는지 확인한다.

```bash
export WRANGLER_SEND_METRICS=false
release_dir="$(mktemp -d /tmp/retaste-official-photos-30.XXXXXX)"
node scripts/build-official-photo-release.mjs "$release_dir/candidate"
photo_build_config="$release_dir/candidate/build/server/wrangler.json"
pnpm exec wrangler deploy --dry-run --config "$photo_build_config" --profile tastedit-production
pnpm exec wrangler versions upload --dry-run --config "$photo_build_config" --profile tastedit-production
```

4. 방금 검증한 설정으로 `pnpm exec wrangler versions upload --config "$photo_build_config" --profile tastedit-production`을 1회 실행한다. 새 버전의 D1·R2와 기능 플래그를 읽기 전용으로 확인하고 기존 버전이 여전히 100%인지 대조한다. 일치할 때만 새 버전 ID 하나에 `wrangler versions deploy <새-버전-ID>@100 --name retaste-beta --profile tastedit-production`을 1회 적용한다. 재시도나 롤아웃 비율 변경은 이 범위에 포함하지 않는다.
5. 새 버전 100%, 공개 상세 30곳 각각의 정확한 iframe·원문 링크, 대표 1곳의 실제 데스크톱 사진과 모바일 시트, TEMP 대조의 비노출을 확인한다. 기존 공개 경로·관리자 접근과 같은 버전의 `RSI_SELF_CHECK` 정상 결과를 확인하고 D1 장부가 같은 순서의 56개인지 다시 읽는다. RSI는 기존 Worker 로그나 기존 토큰을 이용한 `GET /internal/rsi-self-check`로 확인한다. 배포 버전과 관측 결과를 영수증에 남긴다.
6. 새 버전의 바인딩·공개 회귀·사진 공개 범위·장부 상태가 조건과 다르면 공개 전환을 중단한다. 100% 배정 뒤 문제가 발견되면 `6b8f3892-7032-424f-a4e9-47516b346a8a@100`으로 복원한 뒤 기존 26곳과 공개 접근을 재확인한다.
