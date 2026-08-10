import { describe, expect, it } from "vitest";

import { safeReturnTo } from "../../app/features/auth/login";

describe("safeReturnTo", () => {
  it("returns to a requested place after login but not an admin route", () => {
    expect(safeReturnTo("/places/sample-place-1?from=map")).toBe("/places/sample-place-1?from=map");
    expect(safeReturnTo("/admin/candidates")).toBe("/");
    expect(safeReturnTo(null)).toBe("/");
  });

  it("rejects protocol-relative and external URLs", () => {
    expect(safeReturnTo("//evil.example/path")).toBe("/");
    expect(safeReturnTo("https://evil.example/path")).toBe("/");
  });
});
