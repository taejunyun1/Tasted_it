import { describe, expect, it } from "vitest";

import { safeReturnTo } from "../../app/features/auth/login";

describe("safeReturnTo", () => {
  it.each([
    ["/courses?meal=1", "/courses?meal=1"],
    ["/me", "/me"],
    ["/maps/food", "/maps/food"],
    ["/onboarding/taste", "/onboarding/taste"],
    ["/member", "/"],
    ["/places", "/places"],
    ["/places/sample-place-1?from=map", "/places/sample-place-1?from=map"],
    [undefined, "/"],
    ["", "/"],
    ["https://evil.example", "/"],
    ["//evil.example", "/"],
    ["/%5Cevil.example/path", "/"],
    ["/places/%252e%252e/admin", "/"],
    ["javascript:alert(1)", "/"],
    ["/admin", "/admin"],
    ["/admin/candidates", "/admin/candidates"],
    ["/administration", "/"],
    ["/auth/google", "/"],
    ["/auth/google/callback?code=secret", "/"],
  ])("maps %s to a safe internal destination", (value, expected) => {
    expect(safeReturnTo(value)).toBe(expected);
  });
});
