import { env } from "cloudflare:workers";
import { redirect } from "react-router";

import type { Route } from "./+types/auth-google-callback";
import { createDb } from "../db/client.server";
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
import { createUserSession } from "../features/auth/session.server";

function errorRedirect(
  requestUrl: string,
  code: OAuthFailureCode | "cancelled",
) {
  return redirect(`/login?oauthError=${code}`, {
    headers: { "Set-Cookie": expireOAuthRequestCookie(requestUrl) },
  });
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const requestId = readOAuthRequestCookie(request);
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");
  const now = new Date();
  const db = createDb(env.DB);

  if (!requestId || !state) return errorRedirect(request.url, "invalid_request");

  if (providerError) {
    try {
      await consumeGoogleOAuthRequest(db, { id: requestId, state, now });
      return errorRedirect(
        request.url,
        providerError === "access_denied" ? "cancelled" : "temporarily_unavailable",
      );
    } catch {
      return errorRedirect(request.url, "invalid_request");
    }
  }

  const code = url.searchParams.get("code");
  if (!code || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return errorRedirect(request.url, "invalid_request");
  }

  try {
    const redirectUri = `${url.origin}/auth/google/callback`;
    const result = await completeGoogleLogin(
      {
        consumeRequest: (input) => consumeGoogleOAuthRequest(db, input),
        exchangeCode: exchangeGoogleCode,
        verifyIdToken: verifyGoogleIdToken,
        resolveAccount: (input) => resolveGoogleAccount(db, input),
      },
      {
        requestId,
        state,
        code,
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
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
    return redirect(result.returnTo, { headers });
  } catch (error) {
    const publicCode = oauthFailureCode(error);
    console.error("GOOGLE_OAUTH_FAILED", publicCode);
    return errorRedirect(request.url, publicCode);
  }
}
