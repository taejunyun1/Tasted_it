import { env } from "cloudflare:workers";
import { redirect } from "react-router";
import { createDb } from "../../db/client.server";
import { grantAdminAssurance, type AdminSession } from "./admin-assurance.server";
import { buildGoogleAuthorizationUrl, exchangeGoogleCode, expireOAuthRequestCookie, oauthRequestCookie, verifyGoogleIdToken } from "./google-oauth.server";
import { buildNaverAuthorizationUrl, exchangeNaverCode, expireNaverOAuthRequestCookie, naverOAuthRequestCookie, newPkcePair, verifyNaverIdToken } from "./naver-oauth.server";
import { consumeOAuthRequest, issueOAuthRequest } from "./oauth-request.server";
import { requireAdminSession } from "./session.server";

export async function startAdminOAuthReauth(database: D1Database, input: AdminSession & {
  provider: "GOOGLE" | "NAVER"; requestUrl: string; returnTo: string; now: Date;
}) {
  const clientId = input.provider === "GOOGLE" ? env.GOOGLE_CLIENT_ID : env.NAVER_LOGIN_CLIENT_ID;
  if (!clientId || (input.provider === "GOOGLE" ? !env.GOOGLE_CLIENT_SECRET : !env.NAVER_LOGIN_CLIENT_SECRET)) {
    throw new Error("ADMIN_PROVIDER_UNAVAILABLE");
  }
  const identity = await database.prepare("SELECT id FROM auth_identities WHERE user_id = ? AND provider = ?")
    .bind(input.actorUserId, input.provider).first();
  if (!identity) throw new Error("ADMIN_PROVIDER_UNAVAILABLE");
  const pair = await newPkcePair();
  const issued = await issueOAuthRequest(createDb(database), {
    provider: input.provider, flow: "LOGIN", userId: input.actorUserId,
    returnTo: input.returnTo, codeVerifier: input.provider === "NAVER" ? pair.verifier : null, now: input.now,
  });
  await database.prepare(`INSERT INTO admin_reauth_challenges (id, session_id, actor_user_id, method, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)`).bind(issued.id, input.sessionId, input.actorUserId, input.provider,
    input.now.toISOString(), new Date(input.now.getTime() + 600_000).toISOString()).run();
  const redirectUri = new URL(`/auth/${input.provider.toLowerCase()}/callback`, input.requestUrl).toString();
  const url = input.provider === "GOOGLE"
    ? buildGoogleAuthorizationUrl({ clientId, redirectUri, state: issued.state, nonce: issued.nonce })
    : buildNaverAuthorizationUrl({ clientId, redirectUri, state: issued.state, nonce: issued.nonce, codeChallenge: pair.challenge });
  if (input.provider === "GOOGLE") {
    // Account selection is only UI; assurance is granted only after signed auth_time validation.
    url.searchParams.set("prompt", "select_account");
    url.searchParams.set("claims", JSON.stringify({ id_token: { auth_time: { essential: true } } }));
  } else url.searchParams.set("auth_type", "reauthenticate");
  return redirect(url.toString(), { headers: { "Cache-Control": "private, no-store", Vary: "Cookie", "Set-Cookie": input.provider === "GOOGLE"
    ? oauthRequestCookie(issued.id, input.requestUrl) : naverOAuthRequestCookie(issued.id, input.requestUrl) } });
}

export async function handleAdminOAuthReauth(request: Request, requestId: string | null, provider: "GOOGLE" | "NAVER") {
  if (!requestId) return null;
  const challenge = await env.DB.prepare(`SELECT session_id AS sessionId, actor_user_id AS actorUserId,
    created_at AS createdAt FROM admin_reauth_challenges WHERE id = ? AND method = ?`)
    .bind(requestId, provider).first<AdminSession & { createdAt: string }>();
  if (!challenge) return null;
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "Set-Cookie": provider === "GOOGLE" ? expireOAuthRequestCookie(request.url) : expireNaverOAuthRequestCookie(request.url) };
  try {
    const { user, sessionId } = await requireAdminSession(request);
    if (user.id !== challenge.actorUserId || sessionId !== challenge.sessionId) throw new Error("ADMIN_SESSION_INVALID");
    const now = new Date();
    const url = new URL(request.url);
    const issued = await consumeOAuthRequest(createDb(env.DB), {
      id: requestId, state: url.searchParams.get("state") ?? "", provider, flow: "LOGIN", now,
    });
    const used = await env.DB.prepare(`UPDATE admin_reauth_challenges SET consumed_at = ?
      WHERE id = ? AND consumed_at IS NULL AND expires_at > ?`).bind(now.toISOString(), requestId, now.toISOString()).run();
    if (used.meta.changes !== 1 || issued.userId !== user.id || url.searchParams.has("error")) throw new Error("ADMIN_CREDENTIAL_INVALID");
    const code = url.searchParams.get("code");
    if (!code) throw new Error("ADMIN_CREDENTIAL_INVALID");
    let subject: string;
    if (provider === "GOOGLE") {
      const token = await exchangeGoogleCode({ code, clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: `${url.origin}/auth/google/callback` });
      const identity = await verifyGoogleIdToken({ ...token, clientId: env.GOOGLE_CLIENT_ID, nonce: issued.nonce, now, authenticatedAfter: new Date(challenge.createdAt) });
      subject = identity.subject;
    } else {
      if (!issued.codeVerifier) throw new Error("ADMIN_CREDENTIAL_INVALID");
      const token = await exchangeNaverCode({ code, codeVerifier: issued.codeVerifier, clientId: env.NAVER_LOGIN_CLIENT_ID, clientSecret: env.NAVER_LOGIN_CLIENT_SECRET, redirectUri: `${url.origin}/auth/naver/callback` });
      subject = (await verifyNaverIdToken({ ...token, clientId: env.NAVER_LOGIN_CLIENT_ID, nonce: issued.nonce, now })).subject;
    }
    const linked = await env.DB.prepare("SELECT id FROM auth_identities WHERE user_id = ? AND provider = ? AND provider_subject = ?")
      .bind(user.id, provider, subject).first();
    if (!linked) throw new Error("ADMIN_CREDENTIAL_INVALID");
    await grantAdminAssurance(env.DB, { actorUserId: user.id, sessionId, method: provider, now });
    return redirect(issued.returnTo, { headers });
  } catch (error) {
    const freshAuthMissing = error instanceof Error && error.message === "GOOGLE_FRESH_AUTH_REQUIRED";
    return redirect(`/admin/reauth?error=${freshAuthMissing ? "google_fresh_auth" : "failed"}`, { headers });
  }
}
