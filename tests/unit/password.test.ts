import { describe, expect, it } from "vitest";
import { PASSWORD_HASH_ITERATIONS, hashPassword, verifyPassword } from "../../app/features/auth/password.server";

describe("password hashing", () => {
  it("stays within the Cloudflare Workers PBKDF2 iteration ceiling", () => {
    expect(PASSWORD_HASH_ITERATIONS).toBe(100_000);
  });

  it("verifies only the original password", async () => {
    const encoded = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", encoded.hash, encoded.salt)).toBe(true);
    expect(await verifyPassword("wrong password", encoded.hash, encoded.salt)).toBe(false);
  });

  it("uses a fresh salt for every password", async () => {
    const first = await hashPassword("same-password");
    const second = await hashPassword("same-password");
    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
  });
});
