# Naver OIDC Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add secure Naver login, account connection, and reauthenticated disconnection to the existing email and Google authentication system.

**Architecture:** Extend the existing D1 OAuth request and identity tables with provider, flow, and PKCE fields, then implement a focused Naver OIDC adapter around a small provider-neutral request store. Keep Naver tokens in callback memory only, enforce explicit linking for existing emails, and reuse the current Re:Taste session cookie after account resolution.

**Tech Stack:** React Router 8 Framework Mode, Cloudflare Workers/D1, Drizzle ORM, `jose`, Vitest, Cloudflare Vitest pool, Playwright.

## Global Constraints

- Collect only Naver subject, email, and nickname/name; do not request or persist profile image, gender, birthday, age, birth year, or phone.
- Require `openid`, authorization code flow, PKCE S256, state hash, a ten-minute single-use request, and verified ID token claims.
- Never persist or log access tokens, refresh tokens, authorization codes, or client secrets.
- Never auto-link a logged-out Naver identity to an existing email account.
- Disconnect only after Naver reauthentication and successful token revocation, and only when another login method remains.
- Do not modify or deploy production D1, secrets, or the Worker in this implementation branch.

---

### Task 1: Extend the OAuth persistence contract

**Files:**
- Create: `drizzle/0016_naver_oidc_auth.sql`
- Modify: `app/db/schema.ts`
- Modify: `app/cloudflare-env.d.ts`
- Test: `tests/unit/schema-contract.test.ts`
- Test: `tests/integration/oauth-request.server.test.ts`

**Interfaces:**
- Produces: `OAuthProvider = "GOOGLE" | "NAVER"`, `OAuthFlow = "LOGIN" | "CONNECT" | "DISCONNECT"`, and `issueOAuthRequest`/`consumeOAuthRequest` records containing provider, flow, nonce, code verifier, return path, and optional user ID.

- [x] **Step 1: Write failing schema and request-store tests** for NAVER provider acceptance, flow binding, PKCE verifier clearing, expiry, incorrect state, and single consumption.
- [x] **Step 2: Run the focused tests and verify failure** with `pnpm test tests/unit/schema-contract.test.ts` and `pnpm test:integration tests/integration/oauth-request.server.test.ts`.
- [x] **Step 3: Add migration 0016 and Drizzle fields** by rebuilding `auth_identities` with `GOOGLE|NAVER` and extending `oauth_requests` with `provider`, `flow`, `code_verifier`, and nullable `user_id`; preserve existing rows as `GOOGLE/LOGIN`.
- [x] **Step 4: Implement the provider-neutral request store** in `app/features/auth/oauth-request.server.ts`, and make the Google wrapper delegate to it without changing Google behavior.
- [x] **Step 5: Run focused and existing Google OAuth tests** and verify all pass.
- [x] **Step 6: Commit** with `git commit -m "2026-08-09 OAuth 요청 저장소 공통화"`.

### Task 2: Implement the Naver OIDC protocol adapter

**Files:**
- Create: `app/features/auth/naver-oauth.server.ts`
- Test: `tests/unit/naver-oauth.test.ts`

**Interfaces:**
- Produces: `buildNaverAuthorizationUrl`, `exchangeNaverCode`, `verifyNaverIdToken`, `fetchNaverProfile`, `revokeNaverToken`, and provider-specific cookie helpers.

- [x] **Step 1: Write failing protocol tests** that assert `scope=openid`, PKCE S256, state/nonce, POST token exchange, discovery/JWK validation seams, subject equality, required valid email, display-name fallback, safe errors, and revocation behavior.
- [x] **Step 2: Run `pnpm test tests/unit/naver-oauth.test.ts` and verify the expected missing-module failure.**
- [x] **Step 3: Implement minimal Naver protocol functions** using `jose`, strict response parsing, dependency-injected fetch/verifier seams, and returned account data that excludes access/refresh tokens.
- [x] **Step 4: Run the focused test and full unit suite** with `pnpm test tests/unit/naver-oauth.test.ts` then `pnpm test`.
- [x] **Step 5: Commit** with `git commit -m "2026-08-09 네이버 OIDC 프로토콜 구현"`.

### Task 3: Resolve Naver login and explicit account connection

**Files:**
- Create: `app/features/auth/naver-account.server.ts`
- Test: `tests/integration/naver-account.server.test.ts`

**Interfaces:**
- Consumes: verified `{ subject, email, displayName }` and OAuth flow context.
- Produces: `resolveNaverLogin`, `connectNaverIdentity`, `canDisconnectNaver`, and `disconnectNaverIdentity`.

- [x] **Step 1: Write failing D1 tests** for new passwordless user creation, linked-subject login, existing-email rejection, authenticated connection, cross-user subject conflict, one-Naver-per-user enforcement, last-login-method disconnection rejection, and retained identity on revocation failure.
- [x] **Step 2: Run `pnpm test:integration tests/integration/naver-account.server.test.ts` and verify failure.**
- [x] **Step 3: Implement minimal account policies** with normalized email, verified timestamp for new users, provider uniqueness checks, and delete-after-revoke ordering.
- [x] **Step 4: Run focused integration tests and the complete integration suite.**
- [x] **Step 5: Commit** with `git commit -m "2026-08-09 네이버 계정 연결 정책 구현"`.

### Task 4: Add Naver login and callback routes

**Files:**
- Create: `app/features/auth/naver-login.server.ts`
- Create: `app/routes/auth-naver.tsx`
- Create: `app/routes/auth-naver-callback.tsx`
- Modify: `app/routes.ts`
- Test: `tests/unit/naver-login.server.test.ts`

**Interfaces:**
- Consumes: provider-neutral request store, Naver adapter, account policies, current optional/required user, and session creator.
- Produces: `/auth/naver` and `/auth/naver/callback` for LOGIN, CONNECT, and DISCONNECT flows.

- [x] **Step 1: Write failing orchestration tests** for successful login, missing-email mapping, existing-account mapping, provider cancellation, request mismatch, connection user binding, revocation-before-delete, and safe error codes.
- [x] **Step 2: Run `pnpm test tests/unit/naver-login.server.test.ts` and verify failure.**
- [x] **Step 3: Implement orchestration and route loaders** with safe internal return paths, flow-specific authentication requirements, secret availability checks, two `Set-Cookie` headers on success, and no secret provider details in redirects/logs.
- [x] **Step 4: Run focused tests, route type generation, and typecheck.**
- [x] **Step 5: Commit** with `git commit -m "2026-08-09 네이버 로그인 라우트 구현"`.

### Task 5: Add login, signup, and account connection UI

**Files:**
- Create: `app/features/auth/naver-auth-ui.tsx`
- Modify: `app/features/auth/google-auth-ui.tsx`
- Modify: `app/routes/login.tsx`
- Modify: `app/routes/signup.tsx`
- Modify: `app/routes/me.tsx`
- Test: `tests/unit/naver-auth-ui.test.ts`
- Test: `tests/e2e/login.spec.ts`

**Interfaces:**
- Produces: `NaverAuthButton`, provider-aware OAuth error messages, and account actions for connect/disconnect.

- [x] **Step 1: Write failing render tests** for the accessible green `네이버로 계속하기` link, preserved return path, Korean safe error messages, and connect/disconnect links.
- [x] **Step 2: Run `pnpm test tests/unit/naver-auth-ui.test.ts` and verify failure.**
- [x] **Step 3: Implement the UI** with Google then Naver buttons, an email divider, responsive full-width controls, and provider connection state on `/me` without adding the separate account-management redesign.
- [x] **Step 4: Run UI unit tests and the login Playwright spec** at desktop and 390px mobile.
- [x] **Step 5: Commit** with `git commit -m "2026-08-09 네이버 인증 화면 추가"`.

### Task 6: Verify the branch and document operations

**Files:**
- Modify: `README.md`
- Modify: `wrangler.jsonc` only if non-secret binding documentation is required; never place client secrets in the file.

**Interfaces:**
- Produces: operator instructions for `NAVER_LOGIN_CLIENT_ID`, `NAVER_LOGIN_CLIENT_SECRET`, registered callbacks, migration sequencing, review restriction, and smoke checks.

- [x] **Step 1: Add exact local and production setup instructions** and document that public Naver login requires Naver review.
- [x] **Step 2: Run `pnpm test`, `pnpm test:integration`, `pnpm run typecheck`, `pnpm run build`, and relevant Playwright tests.**
- [x] **Step 3: Run `git diff --check`, review `git diff origin/main...HEAD`, and confirm no token/secret strings are tracked.**
- [x] **Step 4: Commit** with `git commit -m "2026-08-09 네이버 인증 운영 문서 정리"`.
