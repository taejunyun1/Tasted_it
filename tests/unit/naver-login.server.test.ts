import { describe, expect, it, vi } from "vitest";

import {
  completeNaverFlow,
  naverFailureCode,
} from "../../app/features/auth/naver-login.server";

function dependencies(flow: "LOGIN" | "CONNECT" | "DISCONNECT" = "LOGIN") {
  return {
    consumeRequest: vi.fn(async () => ({
      nonce: "nonce-1",
      returnTo: flow === "LOGIN" ? "/" : "/me",
      codeVerifier: "verifier-1",
      userId: flow === "LOGIN" ? null : "user-1",
      provider: "NAVER" as const,
      flow,
    })),
    exchangeCode: vi.fn(async () => ({ idToken: "id-token", accessToken: "access-token" })),
    verifyIdToken: vi.fn(async () => ({ subject: "naver-subject" })),
    fetchProfile: vi.fn(async () => ({
      subject: "naver-subject",
      email: "user@example.com",
      displayName: "네이버 회원",
    })),
    resolveLogin: vi.fn(async () => ({
      userId: "user-1",
      email: "user@example.com",
      displayName: "네이버 회원",
      role: "USER" as const,
      isNewUser: true,
    })),
    connectIdentity: vi.fn(async () => undefined),
    disconnectIdentity: vi.fn(async (input: { revoke: () => Promise<void> }) => input.revoke()),
    revokeToken: vi.fn(async () => undefined),
  };
}

const input = {
  requestId: "request-1",
  state: "state-1",
  code: "code-1",
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "https://example.com/auth/naver/callback",
  adminEmail: "admin@example.com",
  now: new Date("2026-08-09T00:00:00.000Z"),
};

describe("completeNaverFlow", () => {
  it("resolves a verified LOGIN request", async () => {
    const deps = dependencies();
    const result = await completeNaverFlow(deps, input);
    expect(deps.exchangeCode).toHaveBeenCalledWith(expect.objectContaining({
      codeVerifier: "verifier-1",
    }));
    expect(deps.resolveLogin).toHaveBeenCalledWith(expect.objectContaining({
      providerSubject: "naver-subject",
      email: "user@example.com",
    }));
    expect(result).toMatchObject({ flow: "LOGIN", userId: "user-1", returnTo: "/" });
  });

  it("binds CONNECT to the request user", async () => {
    const deps = dependencies("CONNECT");
    await expect(completeNaverFlow(deps, input)).resolves.toMatchObject({
      flow: "CONNECT",
      userId: "user-1",
    });
    expect(deps.connectIdentity).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1" }));
  });

  it("revokes before DISCONNECT can complete", async () => {
    const deps = dependencies("DISCONNECT");
    await completeNaverFlow(deps, input);
    expect(deps.disconnectIdentity).toHaveBeenCalledOnce();
    expect(deps.revokeToken).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "access-token" }));
  });

  it.each([
    [new Error("OAUTH_REQUEST_INVALID"), "invalid_request"],
    [new Error("NAVER_EMAIL_REQUIRED"), "email_required"],
    [new Error("NAVER_EXISTING_ACCOUNT_LOGIN_REQUIRED"), "existing_account"],
    [new Error("NAVER_IDENTITY_CONFLICT"), "identity_conflict"],
    [new Error("NAVER_LAST_LOGIN_METHOD"), "last_login_method"],
    [new Error("NAVER_TOKEN_EXCHANGE_FAILED"), "temporarily_unavailable"],
  ])("maps failures to safe codes", (error, expected) => {
    expect(naverFailureCode(error)).toBe(expected);
  });
});
