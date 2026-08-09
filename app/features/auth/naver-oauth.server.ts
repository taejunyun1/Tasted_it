import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

import { newOAuthValue } from "./google-oauth.server";

const NAVER_AUTHORIZATION_URL = "https://nid.naver.com/oauth2/authorize";
const NAVER_TOKEN_URL = "https://nid.naver.com/oauth2/token";
const NAVER_PROFILE_URL = "https://openapi.naver.com/v1/nid/me";
const NAVER_REVOCATION_URL = "https://nid.naver.com/oauth2.0/revoke";
const NAVER_JWKS = createRemoteJWKSet(
  new URL("https://nid.naver.com/oauth2/jwks"),
);
const NAVER_COOKIE = "retaste_naver_oauth";
const encoder = new TextEncoder();

export type NaverJwtVerifier = (
  idToken: string,
  clientId: string,
) => Promise<JWTPayload>;

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export async function newPkcePair() {
  const verifier = newOAuthValue();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

export function buildNaverAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}) {
  const url = new URL(NAVER_AUTHORIZATION_URL);
  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: "openid",
    state: input.state,
    nonce: input.nonce,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  }).toString();
  return url;
}

export async function exchangeNaverCode(input: {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetcher?: typeof fetch;
}) {
  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)(NAVER_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: input.code,
        code_verifier: input.codeVerifier,
        client_id: input.clientId,
        client_secret: input.clientSecret,
        redirect_uri: input.redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });
  } catch {
    throw new Error("NAVER_TOKEN_EXCHANGE_FAILED");
  }
  if (!response.ok) throw new Error("NAVER_TOKEN_EXCHANGE_FAILED");

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("NAVER_TOKEN_EXCHANGE_FAILED");
  }
  if (
    !body ||
    typeof body !== "object" ||
    !("id_token" in body) ||
    typeof body.id_token !== "string" ||
    !("access_token" in body) ||
    typeof body.access_token !== "string"
  ) {
    throw new Error("NAVER_TOKEN_EXCHANGE_FAILED");
  }
  return { idToken: body.id_token, accessToken: body.access_token };
}

async function verifyWithNaverKeys(idToken: string, clientId: string) {
  const { payload } = await jwtVerify(idToken, NAVER_JWKS, {
    issuer: "https://nid.naver.com",
    audience: clientId,
  });
  return payload;
}

export async function verifyNaverIdToken(
  input: { idToken: string; clientId: string; nonce: string; now?: Date },
  verifier: NaverJwtVerifier = verifyWithNaverKeys,
) {
  try {
    const payload = await verifier(input.idToken, input.clientId);
    const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1_000);
    if (
      typeof payload.sub !== "string" ||
      !payload.sub ||
      payload.nonce !== input.nonce ||
      typeof payload.iat !== "number" ||
      payload.iat > nowSeconds + 60 ||
      typeof payload.exp !== "number" ||
      payload.exp <= nowSeconds
    ) {
      throw new Error("NAVER_ID_TOKEN_INVALID");
    }
    return { subject: payload.sub };
  } catch {
    throw new Error("NAVER_ID_TOKEN_INVALID");
  }
}

export async function fetchNaverProfile(input: {
  accessToken: string;
  expectedSubject: string;
  fetcher?: typeof fetch;
}) {
  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)(NAVER_PROFILE_URL, {
      headers: { Authorization: `Bearer ${input.accessToken}` },
    });
  } catch {
    throw new Error("NAVER_PROFILE_FAILED");
  }
  if (!response.ok) throw new Error("NAVER_PROFILE_FAILED");

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("NAVER_PROFILE_FAILED");
  }
  if (!body || typeof body !== "object" || !("response" in body)) {
    throw new Error("NAVER_PROFILE_FAILED");
  }
  const profile = body.response;
  if (!profile || typeof profile !== "object") {
    throw new Error("NAVER_PROFILE_FAILED");
  }
  const subject = "id" in profile ? profile.id : null;
  if (typeof subject !== "string" || subject !== input.expectedSubject) {
    throw new Error("NAVER_SUBJECT_MISMATCH");
  }
  const email = "email" in profile ? profile.email : null;
  if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email.trim())) {
    throw new Error("NAVER_EMAIL_REQUIRED");
  }
  const nickname = "nickname" in profile ? profile.nickname : null;
  const name = "name" in profile ? profile.name : null;
  const displayName =
    (typeof nickname === "string" && nickname.trim()) ||
    (typeof name === "string" && name.trim()) ||
    "네이버 회원";
  return { subject, email: email.trim(), displayName };
}

export async function revokeNaverToken(input: {
  accessToken: string;
  clientId: string;
  clientSecret: string;
  fetcher?: typeof fetch;
}) {
  try {
    const response = await (input.fetcher ?? fetch)(NAVER_REVOCATION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        access_token: input.accessToken,
        client_id: input.clientId,
        client_secret: input.clientSecret,
      }).toString(),
    });
    if (!response.ok) throw new Error("NAVER_REVOCATION_FAILED");
  } catch {
    throw new Error("NAVER_REVOCATION_FAILED");
  }
}

function cookieAttributes(requestUrl: string, maxAge: number) {
  const attributes = [
    "Path=/auth/naver",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (new URL(requestUrl).protocol === "https:") attributes.push("Secure");
  return attributes.join("; ");
}

export function naverOAuthRequestCookie(id: string, requestUrl: string) {
  return `${NAVER_COOKIE}=${encodeURIComponent(id)}; ${cookieAttributes(requestUrl, 600)}`;
}

export function expireNaverOAuthRequestCookie(requestUrl: string) {
  return `${NAVER_COOKIE}=; ${cookieAttributes(requestUrl, 0)}`;
}

export function readNaverOAuthRequestCookie(request: Request) {
  const cookie = request.headers.get("Cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === NAVER_COOKIE) {
      try {
        return decodeURIComponent(value.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}
