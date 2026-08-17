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

## 사전 게이트

- 단위·D1 통합·E2E·타입·빌드 통과
- 실제 장소 최종 검수와 개인정보 처리방침 출시 차단 항목 해소
- 운영자 연락처, `ADMIN_EMAIL`, 강한 `SESSION_SECRET` 확정
- 기존 D1 export와 현재 Worker version 기록

## 최소 권한 로그인

사용자가 현재 터미널에서 `pnpm wrangler login`을 완료한다. API 토큰을 쓸 경우 Workers Scripts 편집, D1 편집, 계정 멤버십 읽기만 허용하며 Global API Key는 사용하지 않는다.

첫 배포 전에 Cloudflare 계정 이메일 인증과 `workers.dev` 서브도메인 등록도 완료해야 한다. Wrangler 오류 `10034`는 계정 이메일 인증이 끝나지 않았다는 뜻이다.

## D1과 비밀값

```bash
pnpm exec wrangler d1 create retaste-production
```

반환된 `database_id`를 `wrangler.jsonc` 운영 설정에 반영한 다음:

```bash
pnpm exec wrangler d1 migrations apply retaste-production --remote
pnpm exec wrangler secret put SESSION_SECRET
pnpm exec wrangler secret put ADMIN_EMAIL
```

비밀값은 저장소, 셸 기록, 문서에 남기지 않는다.

## 배포와 데이터

```bash
pnpm deploy
```

배포 URL에서 Admin CSV 가져오기로 검증 완료 데이터를 적재한다. 홈, 카테고리, 상세, 로그인, 투표, 저장, 관리자 거부, `/privacy`, `/terms`를 확인한다.

```bash
BASE_URL=https://<worker-url> pnpm test:e2e -- tests/e2e/release.spec.ts
```

## 롤백

오류 시 신규 데이터 공개를 `HIDDEN`으로 전환하고 Cloudflare version rollback으로 직전 정상 Worker를 복원한다. 스키마 변경은 파괴적 역마이그레이션 대신 호환 가능한 전진 수정이 원칙이다. 장애 시간, 영향, 버전, D1 상태, 조치자를 기록한다.
