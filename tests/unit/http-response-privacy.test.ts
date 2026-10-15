import { describe, expect, test } from "vitest";
import { withSecurityHeaders } from "../../app/features/http/security-headers";
import { NO_STORE_HEADERS } from "../../app/features/students/policy";

const origin = "https://retaste.invalid";

describe("student response privacy at the Worker boundary", () => {
  test.each([
    "/student",
    "/student/",
    "/student/join",
    "/student/tasks/example",
    "/student/%FF",
    "/student.data",
    "/student/join.data",
    "/admin/students",
    "/admin/students.data",
    "/%73tudent.data",
    "/admin/%73tudents",
  ])("overrides cacheable login redirects for %s", (path) => {
    const response = new Response(null, {
      status: 302,
      headers: {
        Location: "/login?returnTo=%2Fstudent",
        "Cache-Control": "public, max-age=3600",
        "Set-Cookie": "test_session=value; HttpOnly; Secure",
      },
    });
    const result = withSecurityHeaders(response, new Request(origin + path));

    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toBe("/login?returnTo=%2Fstudent");
    expect(result.headers.get("Set-Cookie")).toBe("test_session=value; HttpOnly; Secure");
    for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
      expect(result.headers.get(name)).toBe(value);
    }
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
  });

  test.each([200, 303, 403, 404])("protects student status %s", (status) => {
    const result = withSecurityHeaders(new Response(null, { status }), new Request(origin + "/student"));
    expect(result.status).toBe(status);
    expect(result.headers.get("Cache-Control")).toBe("no-store, private");
  });

  test.each(["/places", "/students", "/student-guide", "/admin/students-report"])(
    "preserves unrelated cache policy for %s",
    (path) => {
      const result = withSecurityHeaders(
        new Response(null, { headers: { "Cache-Control": "public, max-age=60" } }),
        new Request(origin + path),
      );
      expect(result.headers.get("Cache-Control")).toBe("public, max-age=60");
      expect(result.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    },
  );
});
