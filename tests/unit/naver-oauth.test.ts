import { describe, expect, it, vi } from "vitest";

import {
  buildNaverAuthorizationUrl,
  exchangeNaverCode,
  fetchNaverProfile,
  newPkcePair,
  naverOAuthRequestCookie,
  readNaverOAuthRequestCookie,
  revokeNaverToken,
  verifyNaverIdToken,
} from "../../app/features/auth/naver-oauth.server";

describe("Naver OIDC protocol", () => {
  it("builds an OpenID authorization URL with PKCE S256", async () => {
    const pair = await newPkcePair();
    const url = buildNaverAuthorizationUrl({
      clientId: "naver-client",
      redirectUri: "https://example.com/auth/naver/callback",
      state: "state-1",
      nonce: "nonce-1",
      codeChallenge: pair.challenge,
    });

    expect(url.origin + url.pathname).toBe("https://nid.naver.com/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "naver-client",
      redirect_uri: "https://example.com/auth/naver/callback",
      response_type: "code",
      scope: "openid",
      state: "state-1",
      nonce: "nonce-1",
      code_challenge_method: "S256",
      code_challenge: pair.challenge,
    });
    expect(pair.verifier).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(pair.challenge).not.toBe(pair.verifier);
  });

  it("exchanges a code while omitting refresh tokens from its result", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        access_token: "access-secret",
        refresh_token: "refresh-secret",
        id_token: "signed-token",
        token_type: "Bearer",
      }),
    );
    const result = await exchangeNaverCode({
      code: "authorization-secret",
      codeVerifier: "verifier-1",
      clientId: "naver-client",
      clientSecret: "naver-secret",
      redirectUri: "https://example.com/auth/naver/callback",
      fetcher,
    });

    expect(result).toEqual({ idToken: "signed-token", accessToken: "access-secret" });
    expect(JSON.stringify(result)).not.toContain("refresh-secret");
    const [, init] = fetcher.mock.calls[0];
    expect(init?.method).toBe("POST");
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toMatchObject({
      code: "authorization-secret",
      code_verifier: "verifier-1",
      grant_type: "authorization_code",
    });
  });

  it("verifies timed subject and nonce claims", async () => {
    const now = new Date("2026-08-09T00:00:00.000Z");
    const verifier = vi.fn(async () => ({
      sub: "naver-subject",
      nonce: "nonce-1",
      iat: Math.floor(now.getTime() / 1000) - 2,
      exp: Math.floor(now.getTime() / 1000) + 300,
    }));
    await expect(
      verifyNaverIdToken(
        { idToken: "signed", clientId: "naver-client", nonce: "nonce-1", now },
        verifier,
      ),
    ).resolves.toEqual({ subject: "naver-subject" });
  });

  it("requires the profile subject and a valid email", async () => {
    const valid = vi.fn(async () =>
      Response.json({
        resultcode: "00",
        response: {
          id: "naver-subject",
          email: "User@Example.com",
          nickname: "네이버 별명",
          name: "실명",
        },
      }),
    );
    await expect(
      fetchNaverProfile({ accessToken: "secret", expectedSubject: "naver-subject", fetcher: valid }),
    ).resolves.toEqual({
      subject: "naver-subject",
      email: "User@Example.com",
      displayName: "네이버 별명",
    });

    const missingEmail = vi.fn(async () =>
      Response.json({ resultcode: "00", response: { id: "naver-subject" } }),
    );
    await expect(
      fetchNaverProfile({ accessToken: "secret", expectedSubject: "naver-subject", fetcher: missingEmail }),
    ).rejects.toThrow("NAVER_EMAIL_REQUIRED");
  });

  it("revokes using POST and reports failure safely", async () => {
    const success = vi.fn(async () => new Response(null, { status: 204 }));
    await revokeNaverToken({
      accessToken: "secret",
      clientId: "id",
      clientSecret: "secret-key",
      fetcher: success,
    });
    expect(success.mock.calls[0][1]?.method).toBe("POST");

    await expect(
      revokeNaverToken({
        accessToken: "secret",
        clientId: "id",
        clientSecret: "secret-key",
        fetcher: async () => new Response("denied", { status: 400 }),
      }),
    ).rejects.toThrow("NAVER_REVOCATION_FAILED");
  });

  it("uses a provider-specific secure request cookie", () => {
    const cookie = naverOAuthRequestCookie("request-1", "https://example.com/auth/naver");
    expect(cookie).toContain("retaste_naver_oauth=request-1");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    const request = new Request("https://example.com/auth/naver/callback", {
      headers: { Cookie: cookie },
    });
    expect(readNaverOAuthRequestCookie(request)).toBe("request-1");
  });
});
