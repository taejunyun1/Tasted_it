# 직접인증 후속 운영 적용 · 사진 접수 종료

이 문서를 포함한 실행 PR이 병합되면 Jay/Codex가 아래 조건을 충족한 경우에만 실행한다. 대상은 #533과 같은 Cloudflare 계정, 기존 Worker `retaste-beta`, 인증 프로필 `tastedit-production`이다. 장소 상세·프로필·관리자 사진 검수의 직접인증 표기와 기존에 병합된 공개 탐색 변경을 적용한다. 이 실행은 A·B 활동 승인, 새 방문·사진 제출, 메일 발송과 별개다. [#511](https://github.com/taejunyun1/Tasted_it/issues/511) · [#533 1단계 운영 절차](2026-11-26-cst-student-dark-release.md)

## 전환 조건

1. #533 실행 영수증에서 접수 종료 상태로 배포된 정확한 버전 ID를 확인한다. 해당 버전 100%, 그 버전의 정기 RSI 6개 경로 성공과 같은 시간의 D1 감사 기록이 일치해야 한다. `stage1_version`에 이 버전만 사용한다. 1단계 전 버전의 결과와 응답 상태만으로 대신할 수 없다.
2. 대상 계정·D1 UUID·R2 바인딩·기존 비밀 이름과 변수·공개 호스트·호환 설정·기존 두 cron을 #533 직후 상태와 대조한다. 비밀값과 운영 계정의 개인정보를 출력하지 않는다. 기존 `REVIEW_PHOTOS`와 같은 비공개 직접인증 버킷이 연결돼야 한다. 직접인증 버킷의 공개 개발 URL은 비활성, 커스텀 도메인과 객체는 0개다.
3. 운영 장부는 #533의 56개 순서에 `0065_student_review_pilot_photos.sql`만 붙은 57개다. `SELECT name FROM d1_migrations ORDER BY id` 순서에 소스 파일 SHA-256을 붙인 `<name> <sha256>\n`의 연결 해시는 `fc6f85cd31144332e29488216081a45a228d7a645c43b801bf4060c6cfc6b6ad`다. 원장 856, 검수 연결 83, A·B 연결 2, 활동 승인 및 기존 A·B 방문·신규 사진 0을 읽어 확인한다. 0063·0064와 B17 보류 파일도 미적용인지 확인한다.
4. 실행 PR의 병합과 CI 뒤 소스 `8b8000c1a8fbbe23fa94c283fa9fc9952a451d80`가 `main`에 포함되고 변경이 없는 작업 트리인지 확인한다. 이 소스와 아래 해시가 맞을 때만 실행한다. 다른 코드나 사진 등록을 적용하려면 해당 입력을 고정한 승인 기록이 필요하다.

## 승인된 산출물

| 항목 | 고정값 |
|---|---|
| 코드 | `8b8000c1a8fbbe23fa94c283fa9fc9952a451d80` |
| 운영 호환 기준 소스 | `494c07f56c174df42a3b027b1639772e2d9796b7` |
| 빌드 | `1435cfc6dd24ec6380adad295c05634e9033f635c3e96510030630adbd944f37` |
| 원본 Wrangler 구성 | `9531328356d47f7add5a0fbf9544e4e7761cf6c1178357295105854afed2c14d` |
| 접수 종료 Wrangler 구성 | `b4a670ededfbc8d753194dbfbaee7e9b2d2fac7a901d56ab3b8b67872a750d4b` |
| 접수 종료 빌드 | `265b1353145bac27367e2291da9cc6096dad976358ab7808e8ed95a8be663791` |
| 공개 프로필·작성자 표기 패치 | `8ef7e317d36b8c5a0972c780e2e20943760c99d1b2cd11bdfe69b76c7b860ee1` / `7492b58fa704d8445508aba9d4dcb706ff294a364957dc6a27a57f60677fb32f` |
| 공식 Instagram 38개 레지스트리 | `f4f04c3404f4bf864c64048a358b37f05ce2d7f948978399e364bb976a6b60a3` |

검증한 원본과 접수 종료 번들을 비공개 저장소에 보존하고 `verified_release_dir`로 지정한다. 다른 디렉터리에서 같은 소스로 다시 빌드하면 생성된 Wrangler 구성의 절대 경로 두 필드가 바뀐다. 이 실행에서는 아래 지문과 일치하는 보존본을 사용한다. `STUDENT_REVIEW_PILOT_SEATS`는 미지정, 기존 전역 `REVIEW_PHOTO_UPLOAD_ENABLED`는 `false`다. 합성 장부 57개에서 데스크톱과 모바일의 A·B 방문 제출, 작성자·사진 표기, 승인 전 비공개, 등록·회수와 기존 사진 보존을 점검했다. [합성 운영 호환 결과](https://github.com/taejunyun1/Tasted_it/issues/511#issuecomment-7189301852)

```sh
set -eu
umask 077
revision=8b8000c1a8fbbe23fa94c283fa9fc9952a451d80
git merge-base --is-ancestor "$revision" origin/main
config="$verified_release_dir/prepared/build/server/wrangler.json"
node --input-type=module - "$verified_release_dir" "$revision" <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildFingerprint, digest } from './scripts/lib/release-fingerprint.mjs';
const [root, revision] = process.argv.slice(2);
const source = JSON.parse(readFileSync(join(root, 'candidate/student-pilot-release.json')));
const prepared = JSON.parse(readFileSync(join(root, 'prepared/student-pilot-config.json')));
assert.equal(source.revision, revision);
assert.equal(prepared.revision, revision);
assert.equal(prepared.phase, 'closed');
assert.equal(prepared.configuredSeats, '');
assert.equal(source.buildSha256, '1435cfc6dd24ec6380adad295c05634e9033f635c3e96510030630adbd944f37');
assert.equal(source.configSha256, '9531328356d47f7add5a0fbf9544e4e7761cf6c1178357295105854afed2c14d');
assert.equal(prepared.sourceBuildSha256, source.buildSha256);
assert.equal(prepared.sourceConfigSha256, source.configSha256);
assert.equal(buildFingerprint(join(root, 'candidate/build')), source.buildSha256);
assert.equal(buildFingerprint(join(root, 'prepared/build')), '265b1353145bac27367e2291da9cc6096dad976358ab7808e8ed95a8be663791');
const configBytes = readFileSync(join(root, 'prepared/build/server/wrangler.json'));
assert.equal(digest(configBytes), 'b4a670ededfbc8d753194dbfbaee7e9b2d2fac7a901d56ab3b8b67872a750d4b');
const config = JSON.parse(configBytes);
assert.equal(config.vars.REVIEW_PHOTO_UPLOAD_ENABLED, 'false');
assert.ok(!Object.hasOwn(config.vars, 'STUDENT_REVIEW_PILOT_SEATS'));
NODE
pnpm exec wrangler deploy --dry-run --config "$config" --profile tastedit-production
pnpm exec wrangler versions upload --dry-run --strict --config "$config" --name retaste-beta --profile tastedit-production
```

## 승인된 운영 명령

계정을 #533 대상 ID로 지정하고 `stage1_version`이 여전히 단독 100%인지 확인한 뒤 아래 명령을 실행한다. `direct_version`은 이번 업로드 출력의 정확한 ID다. 트래픽 전환 전 `versions view`에서 접수 미지정, 설정과 바인딩, 기존 비밀 이름을 대조하고 `deployments status`에서 `stage1_version` 단독 100%를 재확인한다. 출력은 비공개로 보관한다.

```sh
pnpm exec wrangler versions upload --strict --config "$config" --name retaste-beta --profile tastedit-production
pnpm exec wrangler versions view "$direct_version" --name retaste-beta --json --profile tastedit-production
pnpm exec wrangler deployments status --name retaste-beta --json --profile tastedit-production
pnpm exec wrangler versions deploy "${direct_version}@100" --name retaste-beta --yes --profile tastedit-production
pnpm exec wrangler deployments status --name retaste-beta --json --profile tastedit-production
```

업로드와 100% 전환은 각각 최대 한 번이다. 원격 데이터 변경, D1 적용, R2 생성·객체 쓰기, 운영자와 계정의 상태 변경, 외부 인증·메일·유료 API 호출, cron·라우트 변경은 각각 0이다. 기존 서비스가 예정대로 실행한 감사 기록·예약 작업은 운영자가 추가한 작업과 구분한다. 공개 검증은 기존 12개 경로와 목록·지도·분류의 페이지 이동 표본 4개, 등록된 일반 장소 38개 상세, 비로그인 비공개 사진 GET·HEAD 2회 및 초기 TEMP 표본 2개로 제한한다. 브라우저 임베드는 결과와 실패를 기록한다.

## 전환 결과·회수

- 새 버전 단독 100%, 접수 미지정, 운영 장부 57개와 기존 집계, 직접인증 사진 0행·버킷 객체 0개, 기존 두 cron을 다시 확인한다. 목록과 지도의 다음 페이지에 현재 조건이 유지되는지 확인한다. 38곳의 원문 링크·사진 실제 렌더링을 각각 대조하고 일시 차단은 게시 확인으로 계산하지 않는다. 비로그인 비공개 사진 표본의 GET·HEAD는 404/no-store여야 한다. 공용 응답에서 내부 정보가 노출되지 않는지 확인한다.
- 버전 ID·비율, 장부 해시·집계, 비공개 경계, 실제 외부 이미지 표시 건수와 회수 여부를 영수증에 기록한다. 새 버전은 같은 버전의 첫 정기 RSI 로그와 일치하는 감사 행을 추가로 확인한다. 정기 결과가 없으면 해당 검증을 대기로 남긴다. 참여자 안내와 활동 승인·접수는 후속 단계다.
- 전환 전에 불일치하거나 결과가 불확실하면 현재 트래픽을 유지하고 읽기 전용 배포 상태로 확인한다. 전환 직후 경로·개인정보·비공개 경계 회귀에서 새 직접인증 방문·사진 기록과 A·B 활동 승인이 0일 때만 `pnpm exec wrangler rollback "$stage1_version" --name retaste-beta --yes --profile tastedit-production`을 최대 한 번 쓴다. 기존 버전 100%, 57개 장부, R2와 공개 경로를 확인한다. 새 콘텐츠나 활동 승인 이력이 생겼으면 이전 카피로의 회수를 중지하고 같은 직접인증 버전의 접수 종료 상태를 보존한다.

B17과 #397은 보류한다. [버전 업로드와 전환](https://developers.cloudflare.com/workers/wrangler/commands/workers/#versions-upload) · [Worker 회수](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
