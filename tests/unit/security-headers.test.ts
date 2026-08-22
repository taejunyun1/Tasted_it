import { describe, expect, it } from "vitest";

import { applySecurityHeaders, CONTENT_SECURITY_POLICY, SECURITY_HEADERS } from "../../app/features/http/security-headers";

describe("applySecurityHeaders", () => {
  it("adds baseline headers without overwriting an existing nosniff", () => {
    const headers = applySecurityHeaders(new Headers({ "X-Content-Type-Options": "nosniff" }));
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe(SECURITY_HEADERS["X-Frame-Options"]);
    expect(headers.get("Referrer-Policy")).toBe(SECURITY_HEADERS["Referrer-Policy"]);
  });

  it("sends CSP, HSTS, and geolocation Permissions-Policy for existing fonts and NAVER Maps", () => {
    const headers = applySecurityHeaders(new Headers());
    const csp = headers.get("Content-Security-Policy");
    expect(csp).toBe(CONTENT_SECURITY_POLICY);
    expect(csp).toContain("https://cdn.jsdelivr.net");
    expect(csp).toContain("https://fonts.googleapis.com");
    expect(csp).toContain("https://fonts.gstatic.com");
    expect(csp).toContain("https://oapi.map.naver.com");
    expect(headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
    expect(headers.get("Permissions-Policy")).toContain("geolocation=()");
  });
});

