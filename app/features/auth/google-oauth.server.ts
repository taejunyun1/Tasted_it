import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
} from "jose";

const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
const OAUTH_COOKIE = "retaste_oauth_request";
const OAUTH_TTL_SECONDS = 10 * 60;
const encoder = new TextEncoder();

export type GoogleJwtVerifier = (
  idToken: string,
  clientId: string,
) => Promise<JWTPayload>;

function bytesToBase64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function newOAuthValue() {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export function buildGoogleAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
}) {
  const url = new URL(GOOGLE_AUTHORIZATION_URL);
  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: input.state,
    nonce: input.nonce,
  }).toString();
  return url;
}

export async function exchangeGoogleCode(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetcher?: typeof fetch;
}) {
  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: input.code,
        client_id: input.clientId,
        client_secret: input.clientSecret,
        redirect_uri: input.redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });
  } catch {
    throw new Error("GOOGLE_TOKEN_EXCHANGE_FAILED");
  }

  if (!response.ok) throw new Error("GOOGLE_TOKEN_EXCHANGE_FAILED");

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("GOOGLE_TOKEN_EXCHANGE_FAILED");
  }
  if (
    !body ||
    typeof body !== "object" ||
    !("id_token" in body) ||
    typeof body.id_token !== "string"
  ) {
    throw new Error("GOOGLE_TOKEN_EXCHANGE_FAILED");
  }
  return { idToken: body.id_token };
}

async function verifyWithGoogleKeys(idToken: string, clientId: string) {
  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    audience: clientId,
    issuer: ["https://accounts.google.com", "accounts.google.com"],
  });
  return payload;
}

export async function verifyGoogleIdToken(
  input: {
    idToken: string;
    clientId: string;
    nonce: string;
    now?: Date;
  },
  verifier: GoogleJwtVerifier = verifyWithGoogleKeys,
) {
  try {
    const payload = await verifier(input.idToken, input.clientId);
    const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
    if (
      typeof payload.sub !== "string" ||
      !payload.sub ||
      typeof payload.email !== "string" ||
      payload.email_verified !== true ||
      payload.nonce !== input.nonce ||
      typeof payload.iat !== "number" ||
      payload.iat > nowSeconds + 60 ||
      typeof payload.exp !== "number" ||
      payload.exp <= nowSeconds
    ) {
      throw new Error("GOOGLE_ID_TOKEN_INVALID");
    }

    const fallbackName = payload.email.split("@")[0];
    const displayName =
      typeof payload.name === "string" && payload.name.trim()
        ? payload.name.trim()
        : fallbackName;
    return {
      subject: payload.sub,
      email: payload.email,
      emailVerified: true as const,
      displayName,
    };
  } catch {
    throw new Error("GOOGLE_ID_TOKEN_INVALID");
  }
}

function cookieAttributes(requestUrl: string, maxAge: number) {
  const attributes = [
    "Path=/auth/google",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (new URL(requestUrl).protocol === "https:") attributes.push("Secure");
  return attributes.join("; ");
}

export function oauthRequestCookie(id: string, requestUrl: string) {
  return `${OAUTH_COOKIE}=${encodeURIComponent(id)}; ${cookieAttributes(requestUrl, OAUTH_TTL_SECONDS)}`;
}

export function expireOAuthRequestCookie(requestUrl: string) {
  return `${OAUTH_COOKIE}=; ${cookieAttributes(requestUrl, 0)}`;
}

export function readOAuthRequestCookie(request: Request) {
  const cookie = request.headers.get("Cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === OAUTH_COOKIE) return decodeURIComponent(value.join("="));
  }
  return null;
}
