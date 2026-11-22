import { env } from "cloudflare:workers";
import { redirect } from "react-router";

import type { Route } from "./+types/auth-google-callback";
import { createDb } from "../db/client.server";
import { handleAdminOAuthReauth } from "../features/auth/admin-reauth-oauth.server";
import { sendGoogleWelcomeIfNeeded } from "../features/auth/email.server";
import { resolveGoogleAccount } from "../features/auth/google-account.server";
import {
  completeGoogleLogin,
  oauthFailureCode,
  type OAuthFailureCode,
} from "../features/auth/google-login.server";
import { consumeGoogleOAuthRequest } from "../features/auth/google-oauth-request.server";
import {
  exchangeGoogleCode,
  expireOAuthRequestCookie,
  readOAuthRequestCookie,
  verifyGoogleIdToken,
} from "../features/auth/google-oauth.server";
import { oauthFailureHref } from "../features/auth/oauth-failure";
import { createUserSession } from "../features/auth/session.server";
import { ACCOUNT_RESTRICTED_MESSAGE, isAccountRestrictedError } from "../features/auth/member-access.server";
import { appendGuestTasteMergeCookie } from "../features/onboarding/guest-merge.server";

function errorRedirect(
  requestUrl: string,
  code: OAuthFailureCode | "cancelled",
  returnTo?: string,
) {
  return redirect(oauthFailureHref({ provider: "GOOGLE", code, returnTo }), {
    headers: { "Set-Cookie": expireOAuthRequestCookie(requestUrl), "Cache-Control": "private, no-store" },
  });
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const requestId = readOAuthRequestCookie(request);
  const adminReauth = await handleAdminOAuthReauth(request, requestId, "GOOGLE");
  if (adminReauth) return adminReauth;
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");
  const now = new Date();
  const db = createDb(env.DB);

  if (!requestId || !state) return errorRedirect(request.url, "invalid_request");

  let returnTo: string | undefined;
  const consumeRequest = async (input: Parameters<typeof consumeGoogleOAuthRequest>[1]) => {
    const verified = await consumeGoogleOAuthRequest(db, input);
    returnTo = verified.returnTo;
    return verified;
  };
  const code = url.searchParams.get("code");
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (providerError || !code || !clientId || !clientSecret) {
    try {
      await consumeRequest({ id: requestId, state, now });
    } catch {
      return errorRedirect(request.url, "invalid_request");
    }
    const providerFailure = providerError === "access_denied" ? "cancelled" : "temporarily_unavailable";
    return errorRedirect(request.url, !providerError && !code ? "invalid_request" : providerFailure, returnTo);
  }

  try {
    const redirectUri = `${url.origin}/auth/google/callback`;
    const result = await completeGoogleLogin(
      {
        consumeRequest,
        exchangeCode: exchangeGoogleCode,
        verifyIdToken: verifyGoogleIdToken,
        resolveAccount: (input) => resolveGoogleAccount(db, input),
      },
      {
        requestId,
        state,
        code,
        clientId,
        clientSecret,
        redirectUri,
        adminEmail: env.ADMIN_EMAIL,
        now,
      },
    );
    await sendGoogleWelcomeIfNeeded({
      isNewUser: result.isNewUser,
      apiKey: env.RESEND_API_KEY,
      from: env.RESEND_FROM_EMAIL,
      to: result.email,
      displayName: result.displayName,
      appBaseUrl: env.APP_BASE_URL || url.origin,
      onError: () => console.error("GOOGLE_WELCOME_EMAIL_FAILED"),
    });
    const headers = new Headers();
    headers.append(
      "Set-Cookie",
      await createUserSession({
        userId: result.userId,
        now,
        requestUrl: request.url,
      }),
    );
    headers.append("Set-Cookie", expireOAuthRequestCookie(request.url));
    await appendGuestTasteMergeCookie({
      headers,
      db,
      request,
      userId: result.userId,
      now: now.toISOString(),
    });
    return redirect(result.returnTo, { headers });
  } catch (error) {
    if (isAccountRestrictedError(error)) return new Response(ACCOUNT_RESTRICTED_MESSAGE, { status: 403, headers: { "Cache-Control": "private, no-store", Vary: "Cookie", "Content-Type": "text/plain; charset=utf-8", "Set-Cookie": expireOAuthRequestCookie(request.url) } });
    const publicCode = oauthFailureCode(error);
    console.error("GOOGLE_OAUTH_FAILED", publicCode);
    return errorRedirect(request.url, publicCode, returnTo);
  }
}
