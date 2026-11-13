import { describe, expect, it } from "vitest";
import { verifyGoogleIdToken } from "../../app/features/auth/google-oauth.server";

describe("Google admin authentication freshness", () => {
  const now = new Date("2026-11-14T01:00:00Z");
  const seconds = Math.floor(now.getTime() / 1000);
  const input = { idToken: "synthetic", clientId: "synthetic", nonce: "nonce", now, authenticatedAfter: now };
  const claims = { sub: "same-subject", email: "synthetic@example.test", email_verified: true, nonce: "nonce", iat: seconds, exp: seconds + 600 };
  it("does not treat a new token without auth_time as fresh authentication", async () => {
    await expect(verifyGoogleIdToken(input, async () => claims)).rejects.toThrow("GOOGLE_FRESH_AUTH_REQUIRED");
  });
  it("rejects stale authentication and accepts signed recent authentication", async () => {
    await expect(verifyGoogleIdToken(input, async () => ({ ...claims, auth_time: seconds - 3600 }))).rejects.toThrow("GOOGLE_FRESH_AUTH_REQUIRED");
    await expect(verifyGoogleIdToken(input, async () => ({ ...claims, auth_time: seconds }))).resolves.toMatchObject({ subject: "same-subject" });
  });
});
