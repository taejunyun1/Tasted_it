import { describe, expect, it } from "vitest";

import {
  hashMailRateLimitBucket,
  mailRateLimitRetryAfterSeconds,
  mailRateLimitWindowStart,
} from "../../app/features/security/rate-limit.server";

describe("mail rate limit helpers", () => {
  it("floors the window start to the hour", () => {
    expect(mailRateLimitWindowStart(new Date("2026-08-14T12:37:11.500Z")).toISOString()).toBe(
      "2026-08-14T12:00:00.000Z",
    );
  });

  it("returns remaining seconds until the window ends", () => {
    expect(mailRateLimitRetryAfterSeconds(new Date("2026-08-14T12:58:30.000Z"))).toBe(90);
  });

  it("hashes email buckets without embedding the raw address", async () => {
    const email = "Abuse.User+tag@Example.com";
    const hash = await hashMailRateLimitBucket("email", "SIGNUP", email);

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain("abuse");
    expect(hash).not.toContain("example.com");
    await expect(hashMailRateLimitBucket("email", "SIGNUP", "abuse.user+tag@example.com")).resolves.toBe(hash);
    await expect(hashMailRateLimitBucket("email", "RESET_PASSWORD", email)).resolves.not.toBe(hash);
    await expect(hashMailRateLimitBucket("email", "LOGIN", email)).resolves.not.toBe(hash);
  });
});
