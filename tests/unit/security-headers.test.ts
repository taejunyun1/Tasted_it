import { describe, expect, it } from "vitest";

import { applySecurityHeaders, SECURITY_HEADERS } from "../../app/features/http/security-headers";

describe("applySecurityHeaders", () => {
  it("adds baseline headers without overwriting an existing nosniff", () => {
    const headers = applySecurityHeaders(new Headers({ "X-Content-Type-Options": "nosniff" }));
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe(SECURITY_HEADERS["X-Frame-Options"]);
    expect(headers.get("Referrer-Policy")).toBe(SECURITY_HEADERS["Referrer-Policy"]);
  });
});
