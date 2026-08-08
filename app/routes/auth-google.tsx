import { env } from "cloudflare:workers";
import { redirect } from "react-router";

import type { Route } from "./+types/auth-google";
import { createDb } from "../db/client.server";
import { issueGoogleOAuthRequest } from "../features/auth/google-oauth-request.server";
import {
  buildGoogleAuthorizationUrl,
  oauthRequestCookie,
} from "../features/auth/google-oauth.server";
import { safeReturnTo } from "../features/auth/login";
import { getOptionalUser } from "../features/auth/session.server";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));
  if (await getOptionalUser(request)) return redirect(returnTo);
  if (!env.GOOGLE_CLIENT_ID) {
    return redirect("/login?oauthError=temporarily_unavailable");
  }

  const issued = await issueGoogleOAuthRequest(createDb(env.DB), {
    returnTo,
    now: new Date(),
  });
  const redirectUri = `${url.origin}/auth/google/callback`;
  const authorizationUrl = buildGoogleAuthorizationUrl({
    clientId: env.GOOGLE_CLIENT_ID,
    redirectUri,
    state: issued.state,
    nonce: issued.nonce,
  });

  return redirect(authorizationUrl.toString(), {
    headers: { "Set-Cookie": oauthRequestCookie(issued.id, request.url) },
  });
}
