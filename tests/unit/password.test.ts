import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../app/features/auth/password.server";

describe("password hashing", () => {
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
