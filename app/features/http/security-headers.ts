import { NO_STORE_HEADERS } from "../students/policy";

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "script-src 'self' 'unsafe-inline' https://oapi.map.naver.com https://*.pstatic.net https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
  "font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://oapi.map.naver.com https://naveropenapi.apigw.ntruss.com https://*.pstatic.net",
  "worker-src 'self' blob:",
].join("; ");

export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), payment=(), geolocation=()",
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
} as const;

export function applySecurityHeaders(headers: Headers) {
  const next = new Headers(headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!next.has(key)) next.set(key, value);
  }
  return next;
}

function isStudentWorkspaceRequest(request: Request) {
  let path = new URL(request.url).pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // The raw namespace can still identify malformed student paths.
  }
  path = path.toLowerCase();
  return path === "/student" || path === "/student.data" || path.startsWith("/student/")
    || path === "/admin/students" || path === "/admin/students.data" || path.startsWith("/admin/students/");
}

export function withSecurityHeaders(response: Response, request?: Request) {
  const headers = applySecurityHeaders(response.headers);
  // Router redirects bypass route-level headers. Enforce privacy on the final
  // Worker response, including auth redirects, errors, and single-fetch data.
  if (request && isStudentWorkspaceRequest(request)) {
    for (const [key, value] of Object.entries(NO_STORE_HEADERS)) headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
