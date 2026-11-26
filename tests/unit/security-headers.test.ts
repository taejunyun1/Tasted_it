import { describe, expect, it } from "vitest";

import { applySecurityHeaders, CONTENT_SECURITY_POLICY, SECURITY_HEADERS, withSecurityHeaders } from "../../app/features/http/security-headers";

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
    expect(csp).toContain("https://*.pstatic.net");
    expect(csp).toMatch(/script-src[^;]*https:\/\/\*\.pstatic\.net/);
    expect(csp).toMatch(/connect-src[^;]*https:\/\/\*\.pstatic\.net/);
    expect(csp).not.toContain("nelo.navercorp.com");
    expect(headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
    expect(headers.get("Permissions-Policy")).toBe("camera=(), microphone=(), payment=(), geolocation=(self)");
  });

  it("prevents shared caching of every admin HTML, data, redirect and error response", () => {
    for (const path of ["/admin", "/admin.data", "/admin/identities", "/admin/import.data", "/admin/reauth", "/admin/%ZZ", "/student/tasks/1"]) {
      for (const status of [200, 302, 403, 500]) {
        const response = withSecurityHeaders(new Response(null, { status, headers: { "Cache-Control": "public, max-age=86400", Vary: "Accept-Encoding" } }), new Request(`https://example.test${path}`));
        expect(response.headers.get("Cache-Control")).toContain("no-store");
        expect(response.headers.get("Vary")).toBe("Accept-Encoding, Cookie");
      }
    }
    const publicResponse = withSecurityHeaders(new Response(null, { headers: { "Cache-Control": "public, max-age=60" } }), new Request("https://example.test/places"));
    expect(publicResponse.headers.get("Cache-Control")).toBe("public, max-age=60");
  });

  it("allows only curated Instagram frames in HTML when the photo flag is enabled", () => {
    const response = () => new Response(null, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    const request = new Request("https://example.test/places");
    expect(withSecurityHeaders(response(), request).headers.get("Content-Security-Policy")).toBe(CONTENT_SECURITY_POLICY);
    const allowed = withSecurityHeaders(response(), request, "true").headers.get("Content-Security-Policy");
    const directives = allowed?.split("; ") ?? [];
    const frames = directives.find((value) => value.startsWith("frame-src "))?.split(" ").slice(1);
    expect(frames).toEqual(expect.arrayContaining([
      "https://www.instagram.com/p/DVU7dmQEnHV/embed/",
      "https://www.instagram.com/reel/DfoJ1gpSJ9e/embed/",
      "https://www.instagram.com/reel/DRMh-qcgOyX/embed/",
    ]));
    expect(frames).not.toContain("https://www.instagram.com/");
    expect(directives.find((value) => value.startsWith("script-src "))).not.toContain("instagram.com");
    expect(withSecurityHeaders(new Response(null, { headers: { "Content-Type": "application/json" } }), request, "true")
      .headers.get("Content-Security-Policy")).toBe(CONTENT_SECURITY_POLICY);
  });

  it("allows only the selected Threads frames in public HTML when enabled", () => {
    const frames = [
      "https://www.threads.com/t/DWkUdT7E-7W/embed/",
      "https://www.threads.com/t/DcxYATFkzc9/embed/",
    ].join(" ");
    const html = () => new Response(null, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    const publicRequest = new Request("https://example.test/places");
    const policy = (response: Response) => response.headers.get("Content-Security-Policy");
    const threadsEnabled = { threads: "true" };
    expect(policy(withSecurityHeaders(html(), publicRequest, undefined, threadsEnabled))).toBe(
      CONTENT_SECURITY_POLICY.replace("frame-src 'none'", `frame-src ${frames}`),
    );
    expect(policy(withSecurityHeaders(html(), publicRequest, "true", threadsEnabled))).toContain(`${frames};`);
    for (const path of ["/admin/places", "/me/privacy", "/reviewer/pilot-photo/fixture", "/login", "/privacy"]) {
      expect(policy(withSecurityHeaders(html(), new Request(`https://example.test${path}`), undefined, threadsEnabled))).toBe(CONTENT_SECURITY_POLICY);
    }
    expect(policy(withSecurityHeaders(new Response(null, { status: 404, headers: { "Content-Type": "text/html" } }), publicRequest, undefined, threadsEnabled))).toBe(CONTENT_SECURITY_POLICY);
    expect(policy(withSecurityHeaders(new Response(null, { headers: { "Content-Type": "application/json" } }), publicRequest, undefined, threadsEnabled))).toBe(CONTENT_SECURITY_POLICY);
  });

  it("allows only curated privacy-enhanced YouTube players on public browse documents", () => {
    const html = () => new Response(null, { headers: { "Content-Type": "text/html" } });
    const youtube = { youtube: "true" };
    const request = (path: string) => new Request(`https://example.test${path}`);
    const frames = withSecurityHeaders(html(), request("/places/fixture"), undefined, youtube).headers
      .get("Content-Security-Policy")?.split("; ").find((value) => value.startsWith("frame-src "));
    expect(frames?.split(" ").slice(1)).toEqual([
      "https://www.youtube-nocookie.com/embed/XdOXi2ctQQo",
      "https://www.youtube-nocookie.com/embed/g9UdzGNidBA",
      "https://www.youtube-nocookie.com/embed/aNhumVtW-U4",
      "https://www.youtube-nocookie.com/embed/ZnbtJLRHUzM",
      "https://www.youtube-nocookie.com/embed/edU_JvgAprI",
      "https://www.youtube-nocookie.com/embed/VfODxqfwx9w",
      "https://www.youtube-nocookie.com/embed/bLChzMGGUSI",
      "https://www.youtube-nocookie.com/embed/UuAk8wjryzY",
      "https://www.youtube-nocookie.com/embed/XVApkkeXoRQ",
      "https://www.youtube-nocookie.com/embed/kTz_GZQEXZ4",
      "https://www.youtube-nocookie.com/embed/fFQgQMYL8ag",
      "https://www.youtube-nocookie.com/embed/INk0aC5hoK4",
      "https://www.youtube-nocookie.com/embed/glRm4NcRhac",
      "https://www.youtube-nocookie.com/embed/nILy25jCyaI",
      "https://www.youtube-nocookie.com/embed/oZOV6I1EbHg",
      "https://www.youtube-nocookie.com/embed/osYf3qz36HI",
    ]);
    expect(withSecurityHeaders(html(), request("/me"), undefined, youtube).headers.get("Content-Security-Policy")).toBe(CONTENT_SECURITY_POLICY);
  });
});

