import { describe, expect, it } from "vitest";

import { safeReturnTo } from "../../app/features/auth/login";

describe("safeReturnTo", () => {
  it("returns to a requested place or admin path after login", () => {
    expect(safeReturnTo("/places/sample-place-1?from=map")).toBe("/places/sample-place-1?from=map");
    expect(safeReturnTo("/admin")).toBe("/admin");
    expect(safeReturnTo("/admin/candidates")).toBe("/admin/candidates");
    expect(safeReturnTo("/admin/place-operations?step=1")).toBe("/admin/place-operations?step=1");
    expect(safeReturnTo(null)).toBe("/");
  });

  it("rejects protocol-relative and external URLs", () => {
    expect(safeReturnTo("//evil.example/path")).toBe("/");
    expect(safeReturnTo("https://evil.example/path")).toBe("/");
  });
});
