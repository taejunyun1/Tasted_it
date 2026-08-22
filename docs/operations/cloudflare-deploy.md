# Cloudflare 배포 런북

## 운영 대상 계정 (SSOT)

라이브 Worker/D1는 아래 계정만 사용한다. 운영자 OAuth와 owner 로그인은 같은 대상이다.

| 항목 | 값 |
|---|---|
| 계정 | `7543330c65069ee2df1b7b353fb0201c` |
| Worker | `retaste-beta` |
| D1 | `retaste-production` (`5181489d-83a7-4f78-9384-db096cadaa2d`) |
| 라이브 URL | `https://retaste-beta.retaste-beta.workers.dev` |

쓰지 않는 대상: 가정 계정 `a58fbe3a0082c49f571d69d08c1227ab`, 개인 계정 `f43d6ae07d0d75a6d9ca80befae153eb`. 배포 전 `CLOUDFLARE_ACCOUNT_ID`를 위 운영 계정으로 두고 `wrangler whoami`에서 그 계정만 보이는지 확인한다. 개인 계정이 유일한/기본 계정이면 중단한다. 기존 D1를 다시 만들지 않는다.

2026-08-17: 원격 `d1 migrations list`는 대기 없음. `origin/main` `5c4285f`를 이 계정에 배포함. Version `194a3423-7964-4c58-98d5-0f2d0d822d0d`. rollback은 직전 버전 `d899f619-3df5-49a1-85f6-c5d3b9de87bf`를 다시 배포한다.

2026-08-17: 원격 `d1 migrations list`는 대기 없음. `origin/main` `7a10dd0`를 이 계정에 배포함. Version `099d8361-989b-488d-bd94-91163551bfb6`. rollback은 직전 버전 `a78d44c8-953a-4331-9854-ed15a986b35b`를 다시 배포한다.

2026-08-18: [Issue #203](https://github.com/taejunyun1/Tasted_it/issues/203) / [PR #204](https://github.com/taejunyun1/Tasted_it/pull/204) 병합 후 `0035_naver_run_region_code.sql` apply, 이어서 `origin/main` `e8df8fa`(`#204`, 코드 기준 `57b7f1c`)를 이 계정에 배포함. Version `49064c1f-bd3f-4eec-a9e5-5985d384a0c1`. rollback은 직전 버전 `5f031bd2-c34e-4191-8d1f-656fdc4d46a0`를 다시 배포한다. 라이브 NAVER·일괄 공개·D1 create 없음.

2026-08-22: [Issue #236](https://github.com/taejunyun1/Tasted_it/issues/236) Jay 채팅 GO 후 `origin/main` [`fdf45d8`](https://github.com/taejunyun1/Tasted_it/commit/fdf45d8)(`#235`까지)를 이 계정에 배포함. 원격 `d1 migrations list` 대기 없음(최신 `0035`). Version `7579b600-7302-443b-9753-a4a5aaa3dd05`. rollback은 직전 라이브 버전 `b2268318-3473-4661-8598-e0560a7d1396`. 라이브 NAVER·일괄 공개·D1 create·secret 열람 없음. 익명 GET `/`·`/places` 200, `/admin` 302 `/login?returnTo=%2Fadmin`, `/privacy`·`/robots.txt` 200. HSTS `max-age=31536000; includeSubDomains`. Permissions-Policy `geolocation=()`. CSP에 `oapi.map.naver.com`·jsDelivr·Google Fonts.

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
