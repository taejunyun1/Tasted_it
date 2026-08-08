# Google OAuth 로그인 및 Resend 환영 메일 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 검증된 Google 계정으로 기존 또는 신규 Re:Taste 계정에 로그인하고, 신규 가입자에게 Resend 환영 메일을 보내는 서버 기반 인증 흐름을 구축한다.

**Architecture:** Worker가 OAuth 승인 코드 교환과 OpenID Connect ID 토큰 검증을 전담한다. 일회성 OAuth 요청과 영구 Google 계정 연결을 D1의 별도 테이블에 저장하고, 로그인 완료 후 기존 Re:Taste 세션을 발급한다.

**Tech Stack:** React Router 8, Cloudflare Workers/D1, Drizzle ORM, `jose`, Vitest, Resend API

## Global Constraints

- Google 권한은 `openid email profile`만 요청한다.
- Google `email_verified=true`인 계정만 로그인·연결한다.
- 동일 이메일의 기존 계정은 자동 연결하되 기존 역할·비밀번호·표시 이름을 변경하지 않는다.
- 액세스 토큰·갱신 토큰·승인 코드·클라이언트 secret은 DB와 로그에 저장하지 않는다.
- 외부 호출은 테스트에서 모의 처리한다.
- 운영 migration과 배포는 PR 사람 승인·병합 후 `main`에서만 수행한다.

---

## File Structure

- Create `drizzle/0015_google_oauth.sql`: identity와 일회성 OAuth 요청 테이블.
- Modify `app/db/schema.ts`: 두 테이블의 Drizzle 선언.
- Create `app/features/auth/google-account.server.ts`: Google identity 조회·기존 계정 연결·신규 계정 생성.
- Create `app/features/auth/google-oauth.server.ts`: 난수·해시·승인 URL·토큰 교환·ID 토큰 검증·쿠키 처리.
- Create `app/features/auth/google-oauth-request.server.ts`: 일회성 요청 발급·소비·만료 정리.
- Create `app/routes/auth-google.tsx`: Google 승인 시작 loader.
- Create `app/routes/auth-google-callback.tsx`: 콜백 검증·계정 결정·세션·환영 메일.
- Modify `app/routes.ts`: OAuth 경로 등록.
- Modify `app/features/auth/email.server.ts`: 링크 없는 Google 환영 메일 함수.
- Modify `app/features/auth/login.ts`: 안전한 내부 `returnTo` 지원.
- Modify `app/routes/login.tsx`, `app/routes/signup.tsx`: Google 버튼, 구분선, 오류 문구.
- Modify `app/cloudflare-env.d.ts`, `README.md`: 환경 변수 계약과 운영 명령.
- Create/modify tests under `tests/unit` and `tests/integration` for each boundary.

---

### Task 1: OAuth 데이터 모델과 Google 계정 결정

**Files:**
- Create: `tests/integration/google-account.server.test.ts`
- Create: `drizzle/0015_google_oauth.sql`
- Modify: `app/db/schema.ts`
- Create: `app/features/auth/google-account.server.ts`

**Interfaces:**
- Produces: `resolveGoogleAccount(db, input): Promise<{ userId: string; email: string; displayName: string; role: UserRole; isNewUser: boolean }>`
- Consumes: `AppDb`, `users`, 신규 `authIdentities`

- [ ] **Step 1: 신규·기존·반복 로그인 실패 테스트 작성**

```ts
const input = {
  providerSubject: `sub-${key}`,
  email: `google-${key}@example.com`,
  emailVerified: true,
  displayName: "구글 사용자",
  adminEmail: "admin@example.com",
  now: new Date("2026-08-08T15:00:00Z"),
};
const created = await resolveGoogleAccount(db, input);
expect(created).toMatchObject({ isNewUser: true, role: "USER" });

const repeated = await resolveGoogleAccount(db, { ...input, displayName: "변경 이름" });
expect(repeated).toMatchObject({ userId: created.userId, isNewUser: false, displayName: "구글 사용자" });
```

기존 비밀번호 계정의 이메일로 호출했을 때 같은 `userId`를 반환하고 `password_hash`, `role`, `display_name`이 유지되는 경우와 `emailVerified:false`가 `GOOGLE_EMAIL_UNVERIFIED`를 던지는 경우도 포함한다.

- [ ] **Step 2: 테스트를 실행해 구현 부재로 실패 확인**

Run: `pnpm exec vitest run --config vitest.workers.config.ts tests/integration/google-account.server.test.ts`
Expected: FAIL — `google-account.server` 또는 `resolveGoogleAccount`를 찾을 수 없음

- [ ] **Step 3: migration과 Drizzle 모델 작성**

```sql
CREATE TABLE auth_identities (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('GOOGLE')),
  provider_subject TEXT NOT NULL,
  provider_email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, provider_subject),
  UNIQUE(provider, user_id)
);

CREATE TABLE oauth_requests (
  id TEXT PRIMARY KEY NOT NULL,
  state_hash TEXT NOT NULL UNIQUE,
  nonce TEXT NOT NULL,
  return_to TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX oauth_requests_expiry_idx ON oauth_requests(expires_at, consumed_at);
```

`app/db/schema.ts`에는 `authIdentities`와 `oauthRequests`를 같은 열·고유 인덱스로 선언한다.

- [ ] **Step 4: 최소 계정 결정 로직 작성**

```ts
export async function resolveGoogleAccount(db: AppDb, input: GoogleAccountInput) {
  if (!input.emailVerified) throw new Error("GOOGLE_EMAIL_UNVERIFIED");
  const email = input.email.trim().toLowerCase();
  const linkedIdentity = await db.query.authIdentities.findFirst({
    where: and(eq(authIdentities.provider, "GOOGLE"), eq(authIdentities.providerSubject, input.providerSubject)),
  });
  if (linkedIdentity) {
    const linkedUser = await db.query.users.findFirst({ where: eq(users.id, linkedIdentity.userId) });
    if (!linkedUser) throw new Error("GOOGLE_IDENTITY_CONFLICT");
    return { userId: linkedUser.id, email: linkedUser.email, displayName: linkedUser.displayName, role: linkedUser.role, isNewUser: false };
  }

  let user = await db.query.users.findFirst({ where: eq(users.email, email) });
  const isNewUser = !user;
  if (!user) {
    const id = crypto.randomUUID();
    await db.insert(users).values({
      id,
      email,
      displayName: input.displayName.trim().slice(0, 40) || email.split("@")[0],
      role: input.adminEmail?.trim().toLowerCase() === email ? "ADMIN" : "USER",
      passwordHash: null,
      passwordSalt: null,
      emailVerifiedAt: input.now.toISOString(),
      createdAt: input.now.toISOString(),
      updatedAt: input.now.toISOString(),
    });
    user = await db.query.users.findFirst({ where: eq(users.id, id) });
  }
  if (!user) throw new Error("GOOGLE_ACCOUNT_CREATE_FAILED");

  await db.insert(authIdentities).values({
    id: crypto.randomUUID(),
    userId: user.id,
    provider: "GOOGLE",
    providerSubject: input.providerSubject,
    providerEmail: email,
    createdAt: input.now.toISOString(),
    updatedAt: input.now.toISOString(),
  });
  return { userId: user.id, email: user.email, displayName: user.displayName, role: user.role, isNewUser };
}
```

`GoogleAccountInput`은 위 입력 필드를 모두 명시한다. 고유 제약 충돌 시 `(provider, provider_subject)`를 다시 조회하고, 같은 이메일 사용자의 연결이면 그 사용자를 반환한다. 다른 사용자에 이미 연결된 모순 상태면 `GOOGLE_IDENTITY_CONFLICT`를 던진다.

- [ ] **Step 5: 통합 테스트 통과 확인**

Run: `pnpm exec vitest run --config vitest.workers.config.ts tests/integration/google-account.server.test.ts`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add drizzle/0015_google_oauth.sql app/db/schema.ts app/features/auth/google-account.server.ts tests/integration/google-account.server.test.ts
git commit -m "2026-08-08 Google 계정 연결 기반 추가"
```

### Task 2: 일회성 OAuth 요청과 프로토콜 검증

**Files:**
- Create: `tests/unit/google-oauth.test.ts`
- Create: `tests/integration/google-oauth-request.server.test.ts`
- Create: `app/features/auth/google-oauth.server.ts`
- Create: `app/features/auth/google-oauth-request.server.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `newOAuthValue()`, `sha256Hex(value)`, `buildGoogleAuthorizationUrl(input)`, `exchangeGoogleCode(input)`, `verifyGoogleIdToken(input)`, `oauthRequestCookie(id, requestUrl)`, `readOAuthRequestCookie(request)`, `expireOAuthRequestCookie(requestUrl)`
- Produces: `issueGoogleOAuthRequest(db, input)` and `consumeGoogleOAuthRequest(db, input)`

- [ ] **Step 1: 승인 URL·쿠키·토큰 교환 실패 테스트 작성**

```ts
const url = buildGoogleAuthorizationUrl({
  clientId: "client-id",
  redirectUri: "https://example.com/auth/google/callback",
  state: "state-1",
  nonce: "nonce-1",
});
expect(url.searchParams.get("scope")).toBe("openid email profile");
expect(url.searchParams.get("state")).toBe("state-1");
expect(url.searchParams.get("nonce")).toBe("nonce-1");
expect(url.searchParams.get("response_type")).toBe("code");
```

`exchangeGoogleCode`는 `grant_type=authorization_code`와 정확한 `redirect_uri`를 POST하고, 비정상 응답·`id_token` 누락을 `GOOGLE_TOKEN_EXCHANGE_FAILED`로 변환하는 테스트를 포함한다.

- [ ] **Step 2: 단위 테스트 실패 확인**

Run: `pnpm exec vitest run tests/unit/google-oauth.test.ts`
Expected: FAIL — 모듈 또는 함수 없음

- [ ] **Step 3: `jose` 의존성과 프로토콜 함수 구현**

Run: `pnpm add jose`

```ts
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export async function verifyGoogleIdToken(input: VerifyGoogleIdTokenInput, jwks = GOOGLE_JWKS) {
  const { payload } = await jwtVerify(input.idToken, jwks, {
    audience: input.clientId,
    issuer: ["https://accounts.google.com", "accounts.google.com"],
  });
  if (payload.nonce !== input.nonce || typeof payload.sub !== "string" || typeof payload.email !== "string" || payload.email_verified !== true) {
    throw new Error("GOOGLE_ID_TOKEN_INVALID");
  }
  return { subject: payload.sub, email: payload.email, emailVerified: true, displayName: typeof payload.name === "string" ? payload.name : payload.email.split("@")[0] };
}
```

쿠키 이름은 `retaste_oauth_request`, 최대 수명은 600초로 하고 운영 HTTPS에서만 `Secure`를 붙인다. ID 토큰이나 코드는 반환 쿠키에 넣지 않는다.

- [ ] **Step 4: OAuth 요청 저장소 실패 테스트 작성**

```ts
const issued = await issueGoogleOAuthRequest(db, { returnTo: "/courses?meal=1", now });
const consumed = await consumeGoogleOAuthRequest(db, {
  id: issued.id,
  state: issued.state,
  now: new Date(now.getTime() + 1000),
});
expect(consumed).toMatchObject({ nonce: issued.nonce, returnTo: "/courses?meal=1" });
await expect(consumeGoogleOAuthRequest(db, { id: issued.id, state: issued.state, now })).rejects.toThrow("OAUTH_REQUEST_INVALID");
```

만료, 잘못된 state, 두 번째 소비를 각각 거절하는 테스트를 포함한다.

- [ ] **Step 5: 해시 비교와 단일 소비 저장소 구현**

`consumeGoogleOAuthRequest`는 유효 행을 조회한 뒤 `consumed_at IS NULL` 조건으로 UPDATE하고 `meta.changes===1`일 때만 값을 반환한다. `state`는 SHA-256 해시로 비교하고 로그인 시작 시 이미 만료된 행을 삭제한다.

- [ ] **Step 6: 단위·통합 테스트 통과 확인**

Run: `pnpm exec vitest run tests/unit/google-oauth.test.ts`
Expected: PASS

Run: `pnpm exec vitest run --config vitest.workers.config.ts tests/integration/google-oauth-request.server.test.ts`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add package.json pnpm-lock.yaml app/features/auth/google-oauth.server.ts app/features/auth/google-oauth-request.server.ts tests/unit/google-oauth.test.ts tests/integration/google-oauth-request.server.test.ts
git commit -m "2026-08-08 Google OAuth 요청 검증 추가"
```

### Task 3: Google 시작·콜백 route와 세션 연결

**Files:**
- Create: `app/routes/auth-google.tsx`
- Create: `app/routes/auth-google-callback.tsx`
- Modify: `app/routes.ts`
- Modify: `app/cloudflare-env.d.ts`
- Create: `tests/unit/google-auth-route.test.ts`

**Interfaces:**
- Consumes: Task 1의 `resolveGoogleAccount`, Task 2의 OAuth 함수, 기존 `createUserSession`
- Produces: GET `/auth/google`, GET `/auth/google/callback`

- [ ] **Step 1: 시작·콜백 오케스트레이션 테스트 작성**

route 자체의 전역 `env` 대신 순수 함수 `completeGoogleLogin(deps, input)`을 내보내 테스트한다.

```ts
const result = await completeGoogleLogin(deps, {
  requestId: "request-1",
  state: "state-1",
  code: "code-1",
  requestUrl: "https://example.com/auth/google/callback",
  now,
});
expect(deps.exchangeCode).toHaveBeenCalledOnce();
expect(deps.verifyIdToken).toHaveBeenCalledWith(expect.objectContaining({ nonce: "nonce-1" }));
expect(result).toMatchObject({ userId: "user-1", returnTo: "/courses", isNewUser: true });
```

state 오류일 때 코드 교환이 호출되지 않는 경우, 미검증 이메일, Google 취소 오류를 포함한다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm exec vitest run tests/unit/google-auth-route.test.ts`
Expected: FAIL — route 또는 함수 없음

- [ ] **Step 3: route와 환경 계약 구현**

```ts
route("auth/google", "routes/auth-google.tsx"),
route("auth/google/callback", "routes/auth-google-callback.tsx"),
```

`auth-google.tsx` loader는 `issueGoogleOAuthRequest` 후 승인 URL로 redirect하며 OAuth 요청 쿠키를 설정한다. 콜백 loader는 요청을 먼저 소비한 뒤 코드 교환·토큰 검증·계정 결정을 수행하고 기존 세션 쿠키와 OAuth 만료 쿠키를 모두 설정한다.

`app/cloudflare-env.d.ts`에 아래를 추가한다.

```ts
GOOGLE_CLIENT_ID: string;
GOOGLE_CLIENT_SECRET: string;
```

오류는 `/login?oauthError=cancelled|invalid_request|unverified_email|temporarily_unavailable`의 제한된 값으로만 보낸다.

- [ ] **Step 4: 테스트와 타입 검사 통과 확인**

Run: `pnpm exec vitest run tests/unit/google-auth-route.test.ts`
Expected: PASS

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add app/routes.ts app/routes/auth-google.tsx app/routes/auth-google-callback.tsx app/cloudflare-env.d.ts tests/unit/google-auth-route.test.ts
git commit -m "2026-08-08 Google 로그인 경로 및 세션 연결"
```

### Task 4: Resend 환영 메일과 인증 UI

**Files:**
- Modify: `app/features/auth/email.server.ts`
- Modify: `tests/unit/resend-email.test.ts`
- Modify: `app/features/auth/login.ts`
- Create: `tests/unit/auth-login.test.ts`
- Modify: `app/routes/login.tsx`
- Modify: `app/routes/signup.tsx`
- Create: `tests/unit/google-auth-ui.test.tsx`

**Interfaces:**
- Produces: `sendGoogleWelcomeEmail(input): Promise<{ id: string }>`
- Produces: `GoogleAuthButton({ returnTo? })`, `oauthErrorMessage(value)`
- Consumes: callback route에서 신규 계정일 때만 환영 메일 호출

- [ ] **Step 1: 환영 메일 실패 테스트 작성**

```ts
await sendGoogleWelcomeEmail({
  apiKey: "secret",
  from: "Re:Taste <account@example.com>",
  to: "new@example.com",
  displayName: "새 회원",
  appBaseUrl: "https://example.com",
  fetcher,
});
const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
expect(body.subject).toContain("Re:Taste에 오신 것을 환영합니다");
expect(body.html).toContain("새 회원");
expect(body.html).toContain("https://example.com/courses");
```

사용자 입력 표시 이름은 HTML escape하여 삽입하는 테스트를 포함한다.

- [ ] **Step 2: 이메일 테스트 실패 확인 후 최소 구현**

Run: `pnpm exec vitest run tests/unit/resend-email.test.ts`
Expected: FAIL — `sendGoogleWelcomeEmail` 없음

`sendGoogleWelcomeEmail`은 Resend의 동일 endpoint와 인증 헤더를 사용하지만 인증 링크 만료 문구를 넣지 않는다. callback에서는 `isNewUser`일 때만 호출하고 `try/catch`로 실패를 격리한다.

- [ ] **Step 3: 내부 복귀 경로 테스트와 구현**

```ts
expect(safeReturnTo("/courses?meal=1")).toBe("/courses?meal=1");
expect(safeReturnTo("https://evil.example")).toBe("/");
expect(safeReturnTo("//evil.example")).toBe("/");
expect(safeReturnTo("/auth/google/callback")).toBe("/");
```

`safeReturnTo`는 하나의 `/`로 시작하고 `//`가 아니며 인증 콜백 경로가 아닌 내부 경로만 허용한다.

- [ ] **Step 4: Google 버튼·오류 문구 실패 테스트 작성**

```tsx
expect(source).toContain('Google로 계속하기');
expect(source).toContain('/auth/google');
expect(source).toContain('또는 이메일로 계속하기');
```

로그인·회원가입 양쪽에 버튼이 있고 `returnTo`가 인코딩되어 전달되며, 네 가지 제한 오류 코드가 한국어로 변환되는지 검사한다.

- [ ] **Step 5: 기존 디자인에 맞는 UI 구현**

```tsx
export function GoogleAuthButton({ returnTo }: { returnTo?: string }) {
  const href = `/auth/google${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`;
  return <a href={href} className="flex min-h-12 items-center justify-center gap-3 border border-neutral-300 bg-white px-5 font-semibold text-neutral-950 focus-visible:outline-2 focus-visible:outline-offset-2">Google로 계속하기</a>;
}
```

로그인 loader는 `oauthError`와 안전한 `returnTo`를 반환한다. signup에는 기본 Google 버튼을 표시한다. 이메일 폼과 약관 문구는 유지한다.

- [ ] **Step 6: 단위 테스트·타입 검사 통과 확인**

Run: `pnpm exec vitest run tests/unit/resend-email.test.ts tests/unit/auth-login.test.ts tests/unit/google-auth-ui.test.tsx`
Expected: PASS

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add app/features/auth/email.server.ts app/features/auth/login.ts app/routes/login.tsx app/routes/signup.tsx tests/unit/resend-email.test.ts tests/unit/auth-login.test.ts tests/unit/google-auth-ui.test.tsx app/routes/auth-google-callback.tsx
git commit -m "2026-08-08 Google 로그인 UI 및 환영 메일 추가"
```

### Task 5: 운영 문서·전체 회귀·화면 검증

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-08-google-oauth-resend-design.md` only if implementation reveals an approved deviation
- Create: `artifacts/google-auth-login-desktop.png`
- Create: `artifacts/google-auth-login-mobile.png`

**Interfaces:**
- Consumes: 전체 Google OAuth 흐름
- Produces: PR 검증 증거와 배포 절차

- [ ] **Step 1: 운영 환경 변수 문서화**

```bash
pnpm exec wrangler secret put GOOGLE_CLIENT_ID
pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET
pnpm exec wrangler secret list
```

README 표에 두 secret의 용도와 Google Console의 정확한 로컬·운영 callback URI를 추가한다. secret 값 자체는 문서에 쓰지 않는다.

- [ ] **Step 2: 전체 단위·통합·타입·빌드 검증**

Run: `pnpm test`
Expected: 모든 단위 테스트 PASS

Run: `pnpm run test:integration`
Expected: 모든 Workers/D1 통합 테스트 PASS

Run: `pnpm run typecheck`
Expected: PASS

Run: `pnpm run build`
Expected: PASS

- [ ] **Step 3: 로컬 migration과 화면 검증**

Run: `pnpm run db:migrate:local`
Expected: `0015_google_oauth.sql` 적용 성공

Run: `pnpm run dev -- --host 127.0.0.1`
Expected: 로그인·회원가입 페이지가 열리고 Google 버튼이 데스크톱·모바일에서 보이며 키보드 포커스 가능

브라우저 증거를 `artifacts/google-auth-login-desktop.png`, `artifacts/google-auth-login-mobile.png`에 저장한다. 실제 Google 로그인은 로컬 callback 등록이 전파된 후 확인한다.

- [ ] **Step 4: 최종 문서 커밋**

```bash
git add README.md docs/superpowers/specs/2026-08-08-google-oauth-resend-design.md docs/superpowers/plans/2026-08-08-google-oauth-resend.md artifacts/google-auth-login-desktop.png artifacts/google-auth-login-mobile.png
git commit -m "2026-08-08 Google 인증 운영 문서 및 검증 증거"
```

### Task 6: PR, 사람 승인, 병합, 운영 배포

**Files:**
- No source changes expected

**Interfaces:**
- Consumes: 검증 완료 feature branch
- Produces: 승인된 `main`과 운영 Worker

- [ ] **Step 1: 최신 main 반영과 최종 차이 검토**

```bash
git fetch origin main
git merge --no-edit origin/main
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
```

Expected: 충돌 없음, whitespace 오류 없음, 인증 범위 외 변경 없음

- [ ] **Step 2: feature branch 푸시와 PR 생성**

```bash
git push -u origin tj_google-auth-resend
gh pr create --base main --head tj_google-auth-resend --title "Google 로그인과 Resend 환영 메일" --body-file <PR_BODY_FILE>
```

PR 본문에 범위, migration, 새 secret 이름, 테스트 결과, 데스크톱·모바일 증거, 운영 영향, 남은 위험을 기록한다.

- [ ] **Step 3: 필수 검사와 사람 리뷰 대기**

Run: `gh pr checks <PR_NUMBER> --watch`
Expected: 모든 required check PASS

작성자가 아닌 사람의 승인 1개를 확인한다. 승인 전에는 병합·운영 migration·배포를 실행하지 않는다.

- [ ] **Step 4: squash merge와 branch 정리**

```bash
gh pr merge <PR_NUMBER> --squash --delete-branch
git -C "/Users/taejun-yun/Documents/Codex/TASTED IT" pull --ff-only origin main
```

- [ ] **Step 5: 병합된 main에서 운영 migration과 배포**

```bash
pnpm exec wrangler d1 migrations apply DB --remote
pnpm run deploy
```

Expected: migration `0015_google_oauth.sql` 적용, Worker 배포 성공, `/login` HTTP 200

- [ ] **Step 6: 운영 스모크 테스트와 롤백 판단**

지정된 Google 테스트 계정으로 1회 로그인하고 세션·기존 계정 연결·신규 계정 환영 메일 중 해당 경로를 확인한다. 오류율 또는 인증 실패가 있으면 이전 Worker 버전으로 롤백하고 `auth_identities` 데이터는 유지한다.
