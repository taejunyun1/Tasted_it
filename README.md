# Re:Taste

광주·전남의 검수된 음식점을 현재 위치 기반 네이버 지도에서 탐색하고, 추천·비추천과 저장으로 개인 취향을 기록하는 서비스입니다.

## 로컬 실행

Node.js와 pnpm을 준비한 뒤 다음 명령을 실행합니다.

```bash
pnpm install
pnpm run db:migrate:local
pnpm run db:seed:local
pnpm dev --host 127.0.0.1
```

기본 주소는 `http://localhost:5173`입니다. 네이버 클라우드 플랫폼 Web Dynamic Map의 Web 서비스 URL에도 이 주소를 등록합니다.

## 환경 변수와 비밀값

로컬에서는 `.dev.vars`, Cloudflare에서는 `wrangler secret put <NAME>`을 사용합니다. 실제 값은 저장소에 커밋하지 않습니다.

| 이름 | 용도 | 관리 방식 |
| --- | --- | --- |
| `NAVER_MAPS_CLIENT_ID` | 네이버 Web Dynamic Map Client ID | secret |
| `DATA_GO_KR_SERVICE_KEY` | 공공데이터포털 일반 인증키 | secret |
| `ADMIN_EMAIL` | 가입 시 ADMIN 역할을 부여할 운영자 이메일 | secret |
| `RESEND_API_KEY` | 가입 인증·비밀번호 재설정 메일 발송 | secret |
| `RESEND_FROM_EMAIL` | Resend에서 인증한 발신 주소 | secret |
| `APP_BASE_URL` | 이메일 링크의 공개 서비스 기준 URL | 환경별 변수 또는 secret |
| `GOOGLE_CLIENT_ID` | Google OAuth 웹 클라이언트 ID와 ID 토큰 audience 검증 | secret |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 승인 코드 교환 | secret |
| `NAVER_LOGIN_CLIENT_ID` | 네이버 로그인 OIDC Client ID | secret |
| `NAVER_LOGIN_CLIENT_SECRET` | 네이버 로그인 승인 코드 교환·연동 해제 | secret |

예시:

```bash
pnpm exec wrangler secret put NAVER_MAPS_CLIENT_ID
pnpm exec wrangler secret put DATA_GO_KR_SERVICE_KEY
pnpm exec wrangler secret put ADMIN_EMAIL
pnpm exec wrangler secret put RESEND_API_KEY
pnpm exec wrangler secret put RESEND_FROM_EMAIL
pnpm exec wrangler secret put APP_BASE_URL
pnpm exec wrangler secret put GOOGLE_CLIENT_ID
pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET
pnpm exec wrangler secret put NAVER_LOGIN_CLIENT_ID
pnpm exec wrangler secret put NAVER_LOGIN_CLIENT_SECRET
pnpm exec wrangler secret list
```

Google Cloud Console의 웹 OAuth 클라이언트에는 다음 주소를 정확히 등록합니다.

승인된 JavaScript 원본:

```text
http://localhost:5173
https://retaste-beta.retaste-beta.workers.dev
```

승인된 리디렉션 URI:

```text
http://localhost:5173/auth/google/callback
https://retaste-beta.retaste-beta.workers.dev/auth/google/callback
```

Google 로그인은 `openid email profile` 권한만 사용합니다. 클라이언트 보안 비밀번호, 승인 코드, Google 토큰은 저장소·DB·로그에 남기지 않습니다.

네이버 개발자센터의 네이버 로그인 애플리케이션에는 다음 Callback URL을 정확히 등록합니다.

```text
http://localhost:5173/auth/naver/callback
https://retaste-beta.retaste-beta.workers.dev/auth/naver/callback
```

네이버 로그인은 `openid` 권한과 이메일·이름/닉네임만 사용합니다. `NAVER_MAPS_CLIENT_ID`와 로그인 Client ID는 서로 다른 값입니다. 승인 코드, 액세스 토큰, 갱신 토큰은 저장소·DB·로그에 남기지 않습니다. 전체 이용자에게 공개하기 전 네이버 개발자센터 검수를 완료해야 하며, 검수 전에는 등록된 개발 계정으로만 확인합니다.

운영 반영 순서는 `0016_naver_oidc_auth.sql` 원격 D1 migration 적용, 네이버 비밀값 등록, 병합된 `main` 배포, 지정 개발 계정 로그인·연결·해제 스모크 확인입니다.

## 검증

```bash
pnpm test
pnpm run test:integration
pnpm run test:e2e
pnpm run typecheck
pnpm run build
```

E2E는 로컬 D1 migration, 샘플 데이터, 관리자 QA fixture를 자동 준비합니다. 운영 데이터에는 QA fixture를 적용하지 않습니다.

## 배포

모든 변경은 feature branch → PR → checks 통과 → squash merge 순서로 `main`에 반영합니다. 운영 배포는 병합된 `main`에서만 실행합니다.

```bash
pnpm run deploy
```

첫 운영 배포 전에는 D1 원격 migration과 위 비밀값 등록이 필요합니다.
