import { env } from "cloudflare:workers";
import { redirect } from "react-router";

import type { Route } from "./+types/auth-naver-callback";
import { createDb } from "../db/client.server";
import { handleAdminOAuthReauth } from "../features/auth/admin-reauth-oauth.server";
import { sendGoogleWelcomeIfNeeded } from "../features/auth/email.server";
import {
  connectNaverIdentity,
  disconnectNaverIdentity,
  resolveNaverLogin,
} from "../features/auth/naver-account.server";
import { completeNaverFlow, naverFailureCode, type NaverFailureCode } from "../features/auth/naver-login.server";
import {
  exchangeNaverCode,
  expireNaverOAuthRequestCookie,
  fetchNaverProfile,
  readNaverOAuthRequestCookie,
  revokeNaverToken,
  verifyNaverIdToken,
} from "../features/auth/naver-oauth.server";
import { oauthFailureHref } from "../features/auth/oauth-failure";
import { consumeOAuthRequest, peekOAuthRequestContext } from "../features/auth/oauth-request.server";
import { createUserSession, getOptionalUser } from "../features/auth/session.server";
import { ACCOUNT_RESTRICTED_MESSAGE, isAccountRestrictedError, assertMemberAccess } from "../features/auth/member-access.server";
import { appendGuestTasteMergeCookie } from "../features/onboarding/guest-merge.server";

async function errorRedirect(request: Request, code: NaverFailureCode | "cancelled", returnTo?: string) {
  // Without verified login intent, only the current member session selects the account screen.
  const destination = returnTo === undefined && await getOptionalUser(request) ? "/me" : "/login";
  return redirect(oauthFailureHref({ provider: "NAVER", code, destination, returnTo }), {
    headers: { "Set-Cookie": expireNaverOAuthRequestCookie(request.url), "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const requestId = readNaverOAuthRequestCookie(request);
  const adminReauth = await handleAdminOAuthReauth(request, requestId, "NAVER");
  if (adminReauth) return adminReauth;
  const state = url.searchParams.get("state");
  const db = createDb(env.DB);
  const context = requestId
    ? await peekOAuthRequestContext(db, { id: requestId, provider: "NAVER" })
    : null;
  if (!requestId || !state) return errorRedirect(request, "invalid_request");

  let returnTo: string | undefined;
  const consumeRequest = async (input: Parameters<typeof consumeOAuthRequest>[1]) => {
    const verified = await consumeOAuthRequest(db, input);
    if (verified.flow === "LOGIN") returnTo = verified.returnTo;
    return verified;
  };
  const now = new Date();
  const providerError = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const clientId = env.NAVER_LOGIN_CLIENT_ID;
  const clientSecret = env.NAVER_LOGIN_CLIENT_SECRET;
  if (providerError || !code || !clientId || !clientSecret) {
    try {
      await consumeRequest({ id: requestId, state, provider: "NAVER", now });
    } catch {
      return errorRedirect(request, "invalid_request");
    }
    const providerFailure = providerError === "access_denied" ? "cancelled" : "temporarily_unavailable";
    return errorRedirect(request, !providerError && !code ? "invalid_request" : providerFailure, returnTo);
  }

  try {
    if (context?.userId) await assertMemberAccess(db, context.userId, now.toISOString());
    const result = await completeNaverFlow(
      {
        consumeRequest,
        exchangeCode: exchangeNaverCode,
        verifyIdToken: verifyNaverIdToken,
        fetchProfile: fetchNaverProfile,
        resolveLogin: (input) => resolveNaverLogin(db, input),
        connectIdentity: (input) => connectNaverIdentity(db, input),
        disconnectIdentity: (input) => disconnectNaverIdentity(db, input),
        revokeToken: revokeNaverToken,
      },
      {
        requestId,
        state,
        code,
        clientId,
        clientSecret,
        redirectUri: `${url.origin}/auth/naver/callback`,
        adminEmail: env.ADMIN_EMAIL,
        now,
      },
    );
    const headers = new Headers();
    headers.append("Set-Cookie", expireNaverOAuthRequestCookie(request.url));
    if (result.flow === "LOGIN") {
      await sendGoogleWelcomeIfNeeded({
        isNewUser: result.isNewUser,
        apiKey: env.RESEND_API_KEY,
        from: env.RESEND_FROM_EMAIL,
        to: result.email,
        displayName: result.displayName,
        appBaseUrl: env.APP_BASE_URL || url.origin,
        onError: () => console.error("NAVER_WELCOME_EMAIL_FAILED"),
      });
      headers.append("Set-Cookie", await createUserSession({ userId: result.userId, now, requestUrl: request.url }));
      await appendGuestTasteMergeCookie({
        headers,
        db,
        request,
        userId: result.userId,
        now: now.toISOString(),
      });
      return redirect(result.returnTo, { headers });
    }
    const success = result.flow === "CONNECT" ? "naver_connected" : "naver_disconnected";
    return redirect(`/me?oauthSuccess=${success}`, { headers });
  } catch (error) {
    if (isAccountRestrictedError(error)) return new Response(ACCOUNT_RESTRICTED_MESSAGE, { status: 403, headers: { "Cache-Control": "private, no-store", Vary: "Cookie", "Content-Type": "text/plain; charset=utf-8", "Set-Cookie": expireNaverOAuthRequestCookie(request.url) } });
    const code = naverFailureCode(error);
    console.error("NAVER_OAUTH_FAILED", code);
    return errorRedirect(request, code, returnTo);
  }
}
