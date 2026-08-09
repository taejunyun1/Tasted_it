import { env } from "cloudflare:workers";
import { redirect } from "react-router";

import type { Route } from "./+types/auth-naver-callback";
import { createDb } from "../db/client.server";
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
import { consumeOAuthRequest, peekOAuthRequestContext } from "../features/auth/oauth-request.server";
import { createUserSession } from "../features/auth/session.server";

function errorRedirect(requestUrl: string, target: string, code: NaverFailureCode | "cancelled") {
  const separator = target.includes("?") ? "&" : "?";
  return redirect(`${target}${separator}oauthError=${code}`, {
    headers: { "Set-Cookie": expireNaverOAuthRequestCookie(requestUrl) },
  });
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const requestId = readNaverOAuthRequestCookie(request);
  const state = url.searchParams.get("state");
  const db = createDb(env.DB);
  const context = requestId
    ? await peekOAuthRequestContext(db, { id: requestId, provider: "NAVER" })
    : null;
  const errorTarget = context?.flow === "LOGIN" ? "/login" : "/me";
  if (!requestId || !state) return errorRedirect(request.url, errorTarget, "invalid_request");

  const providerError = url.searchParams.get("error");
  if (providerError) {
    try {
      await consumeOAuthRequest(db, { id: requestId, state, provider: "NAVER", now: new Date() });
      return errorRedirect(request.url, errorTarget, providerError === "access_denied" ? "cancelled" : "temporarily_unavailable");
    } catch {
      return errorRedirect(request.url, errorTarget, "invalid_request");
    }
  }

  const code = url.searchParams.get("code");
  if (!code || !env.NAVER_LOGIN_CLIENT_ID || !env.NAVER_LOGIN_CLIENT_SECRET) {
    return errorRedirect(request.url, errorTarget, "invalid_request");
  }
  const now = new Date();
  try {
    const result = await completeNaverFlow(
      {
        consumeRequest: (input) => consumeOAuthRequest(db, input),
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
        clientId: env.NAVER_LOGIN_CLIENT_ID,
        clientSecret: env.NAVER_LOGIN_CLIENT_SECRET,
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
      return redirect(result.returnTo, { headers });
    }
    const success = result.flow === "CONNECT" ? "naver_connected" : "naver_disconnected";
    return redirect(`/me?oauthSuccess=${success}`, { headers });
  } catch (error) {
    const code = naverFailureCode(error);
    console.error("NAVER_OAUTH_FAILED", code);
    return errorRedirect(request.url, errorTarget, code);
  }
}
