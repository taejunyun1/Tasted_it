import { env } from "cloudflare:workers";
import { redirect } from "react-router";

import type { Route } from "./+types/auth-naver";
import { createDb } from "../db/client.server";
import { safeReturnTo } from "../features/auth/login";
import { oauthFailureHref } from "../features/auth/oauth-failure";
import { issueOAuthRequest, type OAuthFlow } from "../features/auth/oauth-request.server";
import {
  buildNaverAuthorizationUrl,
  naverOAuthRequestCookie,
  newPkcePair,
} from "../features/auth/naver-oauth.server";
import { getOptionalUser } from "../features/auth/session.server";

function requestedFlow(value: string | null): OAuthFlow {
  return value === "connect" ? "CONNECT" : value === "disconnect" ? "DISCONNECT" : "LOGIN";
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const flow = requestedFlow(url.searchParams.get("flow"));
  const returnTo = flow === "LOGIN" ? safeReturnTo(url.searchParams.get("returnTo")) : "/me";
  const user = await getOptionalUser(request);
  if (flow === "LOGIN" && user) return redirect(returnTo);
  if (flow !== "LOGIN" && !user) {
    return redirect(`/login?returnTo=${encodeURIComponent("/me")}`);
  }
  if (!env.NAVER_LOGIN_CLIENT_ID || !env.NAVER_LOGIN_CLIENT_SECRET) {
    const destination = flow === "LOGIN" ? "/login" : "/me";
    return redirect(oauthFailureHref({ provider: "NAVER", code: "temporarily_unavailable", destination, returnTo }));
  }

  const pkce = await newPkcePair();
  const issued = await issueOAuthRequest(createDb(env.DB), {
    provider: "NAVER",
    flow,
    userId: user?.id ?? null,
    returnTo,
    codeVerifier: pkce.verifier,
    now: new Date(),
  });
  const redirectUri = `${url.origin}/auth/naver/callback`;
  const authorizationUrl = buildNaverAuthorizationUrl({
    clientId: env.NAVER_LOGIN_CLIENT_ID,
    redirectUri,
    state: issued.state,
    nonce: issued.nonce,
    codeChallenge: pkce.challenge,
  });
  return redirect(authorizationUrl.toString(), {
    headers: { "Set-Cookie": naverOAuthRequestCookie(issued.id, request.url) },
  });
}
