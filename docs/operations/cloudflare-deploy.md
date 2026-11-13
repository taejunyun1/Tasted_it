# Cloudflare 배포 런북

## 2026-11-14 CST 스키마 전환

0040·0041 적용과 최신 main 운영 배포는 [한정 실행 계획](./2026-11-14-cst-production-rollout.md)을 우선한다. 0040 이후 구 Worker로의 단순 rollback은 금지하며, 전면503 fence 또는 같은 스키마를 지원하는 전진 수정으로 복구한다. 과거 아래 기록의 직전 version 복원 절차를 이 전환에 그대로 적용하지 않는다.

## 운영 대상 계정 (SSOT)

2026-10-15 후속 인수: [RSI 결과 보존 결정](../decisions/2026-10-15-rsi-result-evidence.md)을 포함한 PR 병합 후 기존 정기 RSI는 `admin_audit_logs`에 결과 1개를 남긴다. 새 테이블·migration·binding·cron·토큰은 없다. 실패·origin 누락·감사 저장 실패는 Cron 실패로 전달한다. rollback은 사전 Worker `fa76558c-0e37-4ff2-89ba-9eb545459d5c`다. 배포 후 다음 기존 정기 실행의 Cron Events와 아래 읽기 쿼리로 같은 실행의 6경로를 확인한다. 원문 after_state에 비밀값이나 개인정보가 없어야 한다.

```sql
SELECT created_at, after_state FROM admin_audit_logs
WHERE action = 'RSI_SELF_CHECK' AND target_type = 'OPERATIONS'
  AND target_id = 'rsi-scheduled'
ORDER BY created_at DESC LIMIT 4;
```

라이브 Worker/D1는 아래 계정만 사용한다. 운영자 OAuth와 owner 로그인은 같은 대상이다.

| 항목 | 값 |
|---|---|
| 계정 | `7543330c65069ee2df1b7b353fb0201c` |
| Worker | `retaste-beta` |
| D1 | `retaste-production` (`5181489d-83a7-4f78-9384-db096cadaa2d`) |
| 라이브 URL | `https://retaste-beta.retaste-beta.workers.dev` |

쓰지 않는 대상: 가정 계정 `a58fbe3a0082c49f571d69d08c1227ab`, 개인 계정 `f43d6ae07d0d75a6d9ca80befae153eb`. 배포 전 `CLOUDFLARE_ACCOUNT_ID`를 위 운영 계정으로 두고 `wrangler whoami`에서 그 계정만 보이는지 확인한다. 개인 계정이 유일한/기본 계정이면 중단한다. 기존 D1를 다시 만들지 않는다.

2026-10-15: [PR #296](https://github.com/taejunyun1/Tasted_it/pull/296) 병합 main `0cf49ef`를 지정 계정에 배포하고 D1 `0037_student_invitations.sql`·`0038_student_tasks.sql`만 적용했다. 기존 기본 auth 프로필을 보존하고 `tastedit-production` 프로필에 지정 계정만의 승인 OAuth 6개를 연결했다. 최초 false Worker `02540a1c-4810-4939-b825-0e4bca6d7aac`, 초기 학생 활성화 Worker `34d297d6-1ea5-4bbd-91ef-da37fa9ca6b7`, 도입 이전 rollback `739a0b2d-d7fb-48ec-92f6-df3e21ea82ef`. 사전 Time Travel bookmark는 비공개 운영 기록에 보관했다. [Issue #297](https://github.com/taejunyun1/Tasted_it/issues/297) 범위로 별도 운영 ADMIN 1개와 감사 기록을 만들고 실제 A~D 미사용 초대 4개를 발급했다. 개인 서비스 계정의 역할·기존 두 cron·사진/AI 스위치는 유지했다. 초기 302 세 경로에서 발견한 캐시 헤더 누락을 이 변경에서 수정하며, 병합 main의 최종 배포 version·HTTP·Observability 실행 결과는 #297 및 위키에 기록한다. 실제 학생 수락·작업 전체 흐름과 새 배포 RSI는 PENDING이다. 상세 한도와 인수는 [학생 운영 런북](./student-workspace.md)을 따른다.

2026-08-17: 원격 `d1 migrations list`는 대기 없음. `origin/main` `5c4285f`를 이 계정에 배포함. Version `194a3423-7964-4c58-98d5-0f2d0d822d0d`. rollback은 직전 버전 `d899f619-3df5-49a1-85f6-c5d3b9de87bf`를 다시 배포한다.

2026-08-17: 원격 `d1 migrations list`는 대기 없음. `origin/main` `7a10dd0`를 이 계정에 배포함. Version `099d8361-989b-488d-bd94-91163551bfb6`. rollback은 직전 버전 `a78d44c8-953a-4331-9854-ed15a986b35b`를 다시 배포한다.

2026-08-18: [Issue #203](https://github.com/taejunyun1/Tasted_it/issues/203) / [PR #204](https://github.com/taejunyun1/Tasted_it/pull/204) 병합 후 `0035_naver_run_region_code.sql` apply, 이어서 `origin/main` `e8df8fa`(`#204`, 코드 기준 `57b7f1c`)를 이 계정에 배포함. Version `49064c1f-bd3f-4eec-a9e5-5985d384a0c1`. rollback은 직전 버전 `5f031bd2-c34e-4191-8d1f-656fdc4d46a0`를 다시 배포한다. 라이브 NAVER·일괄 공개·D1 create 없음.

2026-08-22: [Issue #236](https://github.com/taejunyun1/Tasted_it/issues/236) Jay 채팅 GO 후 `origin/main` [`fdf45d8`](https://github.com/taejunyun1/Tasted_it/commit/fdf45d8)(`#235`까지)를 이 계정에 배포함. 원격 `d1 migrations list` 대기 없음(최신 `0035`). Version `7579b600-7302-443b-9753-a4a5aaa3dd05`. rollback은 직전 라이브 버전 `b2268318-3473-4661-8598-e0560a7d1396`. 라이브 NAVER·일괄 공개·D1 create·secret 열람 없음. 익명 GET `/`·`/places` 200, `/admin` 302 `/login?returnTo=%2Fadmin`, `/privacy`·`/robots.txt` 200. HSTS `max-age=31536000; includeSubDomains`. Permissions-Policy `geolocation=()`. CSP에 `oapi.map.naver.com`·jsDelivr·Google Fonts.

2026-08-24: [Issue #260](https://github.com/taejunyun1/Tasted_it/issues/260) / [PR #261](https://github.com/taejunyun1/Tasted_it/pull/261) 병합 후 `origin/main` [`7bc907b`](https://github.com/taejunyun1/Tasted_it/commit/7bc907b)를 이 계정에 배포함. 원격 apply 없음(최신 `0035`). Version `f10e59ff-8e0b-4000-bb68-e8482821cfeb`. rollback은 직전 라이브 버전 `7445cc93-747f-46e0-ae0c-ef21fadc7a4f`. `REVIEW_CONFIDENT_ADVANCE_ENABLED=true`. 라이브 NAVER 일괄·일괄 공개·D1 create·secret 열람 없음. 익명 GET `/`·`/places` 200, `/admin` 302 `/login?returnTo=%2Fadmin`, `/privacy` 200. CSP `script-src`/`connect-src`에 `https://*.pstatic.net`. nelo 수집 도메인 없음.

2026-09-08: [Issue #282](https://github.com/taejunyun1/Tasted_it/issues/282) / [PR #283](https://github.com/taejunyun1/Tasted_it/pull/283) 병합 후 `origin/main` [`b46858c`](https://github.com/taejunyun1/Tasted_it/commit/b46858c)를 이 계정에 배포함. 원격 apply 없음. Version `0c4e5c32-f9f9-4b53-bec8-9fcde781f0c2`. rollback은 직전 라이브 버전 `3132ad56-7f2c-4d34-be20-a77c8f277cfe`. `RSI_CLOUDFLARE_ENABLED=true`. 온디맨드 `RSI_CHECK_TOKEN`은 아직 없음(없으면 스케줄 RSI만). 라이브 NAVER 일괄·일괄 공개·D1 create·secret 값 열람 없음. 익명 GET `/`·`/places`·`/login`·`/privacy`·`/robots.txt` 200, `/admin` 302 `/login?returnTo=%2Fadmin`. 토큰 없는 `GET /internal/rsi-self-check` 404. Observability 배포 직후 `$metadata.error` 0.

2026-09-08: [Issue #286](https://github.com/taejunyun1/Tasted_it/issues/286) / [PR #287](https://github.com/taejunyun1/Tasted_it/pull/287) 병합 후 `origin/main` [`0562910`](https://github.com/taejunyun1/Tasted_it/commit/0562910)를 이 계정에 배포함. 원격 apply 없음. Version `739a0b2d-d7fb-48ec-92f6-df3e21ea82ef`. rollback은 직전 라이브 버전 `0c4e5c32-f9f9-4b53-bec8-9fcde781f0c2`. RSI cron `47 */6 * * *`, maintenance `17 18 * * *`. 익명 GET 6경로 계약 유지. 경로 추가·원격 D1·secret 값 열람 없음.

2026-08-23: [Issue #246](https://github.com/taejunyun1/Tasted_it/issues/246) / [PR #247](https://github.com/taejunyun1/Tasted_it/pull/247) 병합 후 `origin/main` [`43503f7`](https://github.com/taejunyun1/Tasted_it/commit/43503f7)를 이 계정에 배포함. 원격 apply 없음(최신 `0035`). Version `7445cc93-747f-46e0-ae0c-ef21fadc7a4f`. rollback은 직전 라이브 버전 `7579b600-7302-443b-9753-a4a5aaa3dd05`. 라이브 NAVER·일괄 공개·D1 create·secret 열람 없음. 익명 GET `/`·`/places` 200, `/admin` 302 `/login?returnTo=%2Fadmin`. CSP `script-src`/`connect-src`에 `https://*.pstatic.net`. nelo 없음. 홈 지도 `nrbe.pstatic.net` 스타일·타일 200(데스크톱 1440·모바일 390).

## 사전 게이트

- 단위·D1 통합·E2E·타입·빌드 통과
- 실제 장소 최종 검수와 개인정보 처리방침 출시 차단 항목 해소
- 운영자 연락처, `ADMIN_EMAIL`, 강한 `SESSION_SECRET` 확정
- 기존 D1 export와 현재 Worker version 기록

## 최소 권한 로그인

사용자가 현재 터미널에서 `pnpm exec wrangler login`을 완료한다. API 토큰을 쓸 경우 Workers Scripts 편집, D1 편집, 계정 멤버십 읽기만 허용하며 Global API Key는 사용하지 않는다.

첫 배포 전에 Cloudflare 계정 이메일 인증과 `workers.dev` 서브도메인 등록도 완료해야 한다. Wrangler 오류 `10034`는 계정 이메일 인증이 끝나지 않았다는 뜻이다.

## D1과 비밀값

기존 운영 D1 `retaste-production`은 다시 만들지 않는다. `wrangler d1 create`는 최초 1회뿐이며 이 계정의 라이브 데이터베이스에는 쓰지 않는다.

원격 migration apply는 병합 PR이 대상·한도·검증·rollback을 명시한 뒤에만 한다. 대기 목록이 비어 있으면 apply하지 않는다.

최초 환경에만 아래를 **대화형**으로 넣는다. 값은 저장소, 셸 기록, 문서, PR에 남기지 않는다. 이후 배포에서는 대시보드에서 **존재 여부만** 확인한다.

```bash
pnpm exec wrangler secret put SESSION_SECRET
pnpm exec wrangler secret put ADMIN_EMAIL
```

온디맨드 RSI(`GET /internal/rsi-self-check`)를 쓰려면 같은 방식으로 `RSI_CHECK_TOKEN` 존재만 확인한다. 값은 남기지 않는다. 토큰이 없으면 스케줄 RSI만 동작한다. kill switch는 `wrangler.jsonc`의 `RSI_CLOUDFLARE_ENABLED`다. 스케줄 주기는 `47 */6 * * *`이며 maintenance `17 18 * * *`와 분리한다.

`SESSION_SECRET`은 강한 무작위 값이어야 한다. 문서 예시 문자열을 복사해 넣지 않는다.

## 배포와 데이터

명령은 `pnpm run deploy`다 (`package.json`의 `build && wrangler deploy`). `pnpm deploy`는 pnpm 워크스페이스 패키지 배포 명령이라 쓰지 않는다.

```bash
CLOUDFLARE_ACCOUNT_ID=7543330c65069ee2df1b7b353fb0201c pnpm run deploy
```

배포 후 Worker version과 직전 version을 기록한다. 익명 GET으로 `/`·`/places` 200, `/admin` 302 `/login`을 확인한다. Admin CSV 가져오기는 별도 승인 범위가 있을 때만 한다.

```bash
BASE_URL=https://<worker-url> pnpm test:e2e -- tests/e2e/release.spec.ts
```

## 롤백

오류 시 신규 데이터 공개를 `HIDDEN`으로 전환하고 Cloudflare version rollback으로 직전 정상 Worker를 복원한다. 스키마 변경은 파괴적 역마이그레이션 대신 호환 가능한 전진 수정이 원칙이다. 장애 시간, 영향, 버전, D1 상태, 조치자를 기록한다.

## 2026년 10월 15일 RSI 재검사

같은 Worker 공개 주소 점검에는 `global_fetch_strictly_public`을 유지한다. 배포 후 기존 ADMIN 세션에서 동일 origin의 `POST /admin/operations/rsi-check`에 `intent=run`을 보내 고정6경로를 검사할 수 있다. 새 토큰은 만들지 않는다. HTTP200과 `ok:true`·경로6개를 확인하고 운영 감사 `rsi-admin` 한 행을 대조한다. HTTP503 또는 감사 저장 실패는 PASS로 처리하지 않는다. 이는 수동 결과이며 기존 cron의 `rsi-scheduled` 결과를 대신하지 않는다. 실행 한도·복원·승인 범위는 [결정 문서](../decisions/2026-10-15-rsi-public-fetch.md)를 따른다.


## 필요할 때 조회하는 Cloudflare 저장 로그

2026-10-20 사용자 요청으로 로컬 실시간 수집과 정기 알림은 종료하고, 기존 Workers Logs의 수집률을 10%에서 100%로 변경한다. `wrangler.jsonc`에서 `observability.enabled=true`, `head_sampling_rate=1`, `logs.enabled=true`, `logs.invocation_logs=true`, `logs.persist=true`를 명시한다. Traces, Issues, 새 Tail Worker/Logpush/외부 저장소는 추가하지 않는다. 이 설정은 Codex나 노트북이 꺼져 있어도 Cloudflare가 새 Worker 실행 로그를 보관하도록 한다.

조회: 지정 계정 → Workers 및 Pages → `retaste-beta` → 관찰 가능성 → 로그. 시간 범위를 고르고 `/student`, `/student/tasks/`, `/login`, `STUDENT_WORKSPACE_FAILURE`, `STUDENT_INVITE_FAILED` 등을 검색한다. URL/응답 상태와 감사/D1의 좌석 연결·제출 이력을 함께 대조한다. 계정 식별 정보 없는 요청은 특정 학생의 실제 접근으로 단정하지 않는다. 과거 10% 수집에서 누락된 기록은 소급 복원되지 않는다.

2026-10-20 현재 지정 계정은 Workers Paid이며 [Workers Logs 문서](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)의 보관 기간은 7일이다. 월 2천만 이벤트가 포함되고 초과는 백만 건당 US$0.60이다. 영구 보관이 아니며 별도 요금제·구독·저장소는 구매하지 않는다. 2026-12-01부터 가격 체계 변경 공지가 있어 그 이후 장기 운영 시 문서를 다시 확인한다. 계정 일일 50억 이벤트 초과 시 1% 샘플링, 단일 로그 256KB 초과 시 잘림이라는 플랫폼 한도가 있어 무제한·무손실 보장을 뜻하지 않는다.

기존 로그와 Cloudflare의 기본 민감정보 가림을 사용한다. 요청 body/쿠키/Authorization/초대값/계정 정보/원문 자료를 새로 출력하지 않으며 `getUnredacted()`도 사용하지 않는다. 추가 로그 필드는 이 변경에 없다. 기존 `STUDENT_INVITE_FAILED` 감사 보존은 유지한다.

배포 검증: 필수 CI 후 병합 main에서 지정 프로필로 배포한다. 비민감 단발 확인 요청의 시각·경로·HTTP 상태만 기록하고, CLI tail을 켜지 않은 상태에서 Cloudflare 저장 로그 화면으로 해당 요청을 조회한다. 운영자 RSI 6경로 및 기존 초대·좌석·배정 digest를 대조한다. 대시보드에서 수집률100%·호출 로그·보관 활성 상태를 확인한다. 중지된 자동화나 로컬 collector는 재시작하지 않는다.

복원: 문제 시 직전 Worker `50c274c7-33b9-47fc-991e-7f2b837a893d`로 rollback한다. 다음 배포에도 복원이 유지되도록 feature PR로 수집률을 기존0.1로 돌린다. 저장된 로그나 운영 데이터는 삭제하지 않는다.
