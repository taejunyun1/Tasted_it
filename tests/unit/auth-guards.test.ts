import { describe, expect, it } from "vitest";

import { assertRole } from "../../app/features/auth/guards.server";

describe("role guards", () => {
  it("allows a matching role", () => {
    expect(() => assertRole("ADMIN", ["ADMIN"])).not.toThrow();
  });

  it("rejects a non-matching role with HTTP 403", () => {
    try {
      assertRole("USER", ["ADMIN"]);
      throw new Error("expected assertRole to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(403);
    }
  });
});
