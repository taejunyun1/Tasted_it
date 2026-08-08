import { describe, expect, it, vi } from "vitest";

import {
  completeGoogleLogin,
  oauthFailureCode,
} from "../../app/features/auth/google-login.server";

function dependencies() {
  return {
    consumeRequest: vi.fn(async () => ({
      nonce: "nonce-1",
      returnTo: "/courses",
    })),
    exchangeCode: vi.fn(async () => ({ idToken: "signed-id-token" })),
    verifyIdToken: vi.fn(async () => ({
      subject: "google-subject",
      email: "user@example.com",
      emailVerified: true as const,
      displayName: "구글 사용자",
    })),
    resolveAccount: vi.fn(async () => ({
      userId: "user-1",
      email: "user@example.com",
      displayName: "구글 사용자",
      role: "USER" as const,
      isNewUser: true,
    })),
  };
}

const input = {
  requestId: "request-1",
  state: "state-1",
  code: "authorization-code",
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "https://example.com/auth/google/callback",
  adminEmail: "admin@example.com",
  now: new Date("2026-08-09T00:00:00.000Z"),
};

describe("completeGoogleLogin", () => {
  it("consumes state before exchanging and resolves the verified account", async () => {
    const deps = dependencies();

    const result = await completeGoogleLogin(deps, input);

    expect(deps.consumeRequest).toHaveBeenCalledWith({
      id: "request-1",
      state: "state-1",
      now: input.now,
    });
    expect(deps.exchangeCode).toHaveBeenCalledWith({
      code: "authorization-code",
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "https://example.com/auth/google/callback",
    });
    expect(deps.verifyIdToken).toHaveBeenCalledWith({
      idToken: "signed-id-token",
      clientId: "client-id",
      nonce: "nonce-1",
      now: input.now,
    });
    expect(deps.resolveAccount).toHaveBeenCalledWith({
      providerSubject: "google-subject",
      email: "user@example.com",
      emailVerified: true,
      displayName: "구글 사용자",
      adminEmail: "admin@example.com",
      now: input.now,
    });
    expect(result).toMatchObject({
      userId: "user-1",
      returnTo: "/courses",
      isNewUser: true,
    });
  });

  it("does not exchange a code when the one-time request is invalid", async () => {
    const deps = dependencies();
    deps.consumeRequest.mockRejectedValueOnce(new Error("OAUTH_REQUEST_INVALID"));

    await expect(completeGoogleLogin(deps, input)).rejects.toThrow(
      "OAUTH_REQUEST_INVALID",
    );
    expect(deps.exchangeCode).not.toHaveBeenCalled();
    expect(deps.verifyIdToken).not.toHaveBeenCalled();
    expect(deps.resolveAccount).not.toHaveBeenCalled();
  });

  it.each([
    [new Error("OAUTH_REQUEST_INVALID"), "invalid_request"],
    [new Error("GOOGLE_EMAIL_UNVERIFIED"), "unverified_email"],
    [new Error("GOOGLE_ID_TOKEN_INVALID"), "temporarily_unavailable"],
    ["unexpected", "temporarily_unavailable"],
  ])("maps internal failures to a limited public code", (error, expected) => {
    expect(oauthFailureCode(error)).toBe(expected);
  });
});
