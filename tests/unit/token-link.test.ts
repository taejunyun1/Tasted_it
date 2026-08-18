import { describe, expect, it } from "vitest";

import { accountActionUrl } from "../../app/features/auth/token-link";

describe("accountActionUrl", () => {
  it("puts the token in the hash, not the query", () => {
    expect(accountActionUrl("https://example.com/", "/verify-email", "abc+token")).toBe(
      "https://example.com/verify-email#abc+token",
    );
    expect(accountActionUrl("https://example.com", "/reset-password", "xyz")).not.toContain("?token=");
  });
});
