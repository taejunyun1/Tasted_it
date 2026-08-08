import { describe, expect, it, vi } from "vitest";

import {
  buildGoogleAuthorizationUrl,
  exchangeGoogleCode,
  expireOAuthRequestCookie,
  newOAuthValue,
  oauthRequestCookie,
  readOAuthRequestCookie,
  sha256Hex,
  verifyGoogleIdToken,
} from "../../app/features/auth/google-oauth.server";

describe("Google OAuth protocol", () => {
  it("builds a minimal OpenID authorization URL", () => {
    const url = buildGoogleAuthorizationUrl({
      clientId: "client-id",
      redirectUri: "https://example.com/auth/google/callback",
      state: "state-1",
      nonce: "nonce-1",
    });

    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "client-id",
      redirect_uri: "https://example.com/auth/google/callback",
      response_type: "code",
      scope: "openid email profile",
      state: "state-1",
      nonce: "nonce-1",
    });
  });

  it("generates URL-safe unpredictable values and hashes them", async () => {
    const first = newOAuthValue();
    const second = newOAuthValue();

    expect(first).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(second).not.toBe(first);
    expect(await sha256Hex("state-1")).toMatch(/^[a-f0-9]{64}$/);
    expect(await sha256Hex("state-1")).not.toBe(await sha256Hex("state-2"));
  });

  it("stores only the request id in a short-lived HttpOnly cookie", () => {
    const production = oauthRequestCookie(
      "request-1",
      "https://example.com/auth/google",
    );
    expect(production).toContain("retaste_oauth_request=request-1");
    expect(production).toContain("HttpOnly");
    expect(production).toContain("SameSite=Lax");
    expect(production).toContain("Max-Age=600");
    expect(production).toContain("Secure");
    expect(production).not.toContain("state-");

    const request = new Request("http://localhost:5173/auth/google/callback", {
      headers: { Cookie: "other=1; retaste_oauth_request=request-1" },
    });
    expect(readOAuthRequestCookie(request)).toBe("request-1");
    expect(expireOAuthRequestCookie(request.url)).toContain("Max-Age=0");
    expect(expireOAuthRequestCookie(request.url)).not.toContain("Secure");
  });

  it("exchanges an authorization code without exposing it outside the request", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ id_token: "signed-id-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await exchangeGoogleCode({
      code: "authorization-code",
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "https://example.com/auth/google/callback",
      fetcher,
    });

    expect(result).toEqual({ idToken: "signed-id-token" });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init?.method).toBe("POST");
    const body = new URLSearchParams(String(init?.body));
    expect(Object.fromEntries(body)).toMatchObject({
      code: "authorization-code",
      client_id: "client-id",
      client_secret: "client-secret",
      redirect_uri: "https://example.com/auth/google/callback",
      grant_type: "authorization_code",
    });
  });

  it("maps failed or malformed code exchanges to one safe error", async () => {
    const rejected = vi.fn(async () => new Response("denied", { status: 400 }));
    const malformed = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "not-used" }), { status: 200 }),
    );
    const input = {
      code: "secret-code",
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "https://example.com/auth/google/callback",
    };

    await expect(exchangeGoogleCode({ ...input, fetcher: rejected })).rejects.toThrow(
      "GOOGLE_TOKEN_EXCHANGE_FAILED",
    );
    await expect(exchangeGoogleCode({ ...input, fetcher: malformed })).rejects.toThrow(
      "GOOGLE_TOKEN_EXCHANGE_FAILED",
    );
  });

  it("accepts only verified Google claims matching the nonce and time window", async () => {
    const now = new Date("2026-08-08T15:00:00.000Z");
    const verifier = vi.fn(async () => ({
      sub: "google-subject",
      email: "User@Example.com",
      email_verified: true,
      name: "구글 사용자",
      nonce: "nonce-1",
      iat: Math.floor(now.getTime() / 1000) - 10,
      exp: Math.floor(now.getTime() / 1000) + 300,
    }));

    const result = await verifyGoogleIdToken(
      {
        idToken: "signed-id-token",
        clientId: "client-id",
        nonce: "nonce-1",
        now,
      },
      verifier,
    );

    expect(verifier).toHaveBeenCalledWith("signed-id-token", "client-id");
    expect(result).toEqual({
      subject: "google-subject",
      email: "User@Example.com",
      emailVerified: true,
      displayName: "구글 사용자",
    });
  });

  it.each([
    ["wrong nonce", { nonce: "other" }],
    ["unverified email", { email_verified: false }],
    ["expired token", { exp: 1 }],
    ["future-issued token", { iat: 9_999_999_999 }],
    ["missing subject", { sub: undefined }],
  ])("rejects %s claims", async (_label, override) => {
    const now = new Date("2026-08-08T15:00:00.000Z");
    const verifier = async () => ({
      sub: "google-subject",
      email: "user@example.com",
      email_verified: true,
      nonce: "nonce-1",
      iat: Math.floor(now.getTime() / 1000) - 10,
      exp: Math.floor(now.getTime() / 1000) + 300,
      ...override,
    });

    await expect(
      verifyGoogleIdToken(
        {
          idToken: "signed-id-token",
          clientId: "client-id",
          nonce: "nonce-1",
          now,
        },
        verifier,
      ),
    ).rejects.toThrow("GOOGLE_ID_TOKEN_INVALID");
  });
});
