import { describe, expect, it } from "vitest";

import { safeReturnTo } from "../../app/features/auth/login";

describe("safeReturnTo", () => {
  it("always returns to the member map after login", () => {
    expect(safeReturnTo("/places/sample-place-1?from=map")).toBe("/");
    expect(safeReturnTo("/admin/candidates")).toBe("/");
    expect(safeReturnTo(null)).toBe("/");
  });

  it("rejects protocol-relative and external URLs", () => {
    expect(safeReturnTo("//evil.example/path")).toBe("/");
    expect(safeReturnTo("https://evil.example/path")).toBe("/");
  });
});
