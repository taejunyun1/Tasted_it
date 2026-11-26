import { NO_STORE_HEADERS } from "../students/policy";
import { INSTAGRAM_PHOTO_FRAME_SOURCES } from "../poi-media/instagram-photos";
import { THREADS_PHOTO_FRAME_SOURCE } from "../poi-media/photo-original-sources";

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
  "Permissions-Policy": "camera=(), microphone=(), payment=(), geolocation=(self)",
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

function isPrivateWorkspaceRequest(request: Request) {
  let path = new URL(request.url).pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep malformed paths inside their original private namespace.
  }
  path = path.toLowerCase();
  return path === "/student" || path === "/student.data" || path.startsWith("/student/")
    || path === "/admin" || path === "/admin.data" || path.startsWith("/admin/");
}

function isPlaceBrowsingDocument(request?: Request) {
  if (!request) return false;
  const path = new URL(request.url).pathname;
  return path === "/" || /^\/(?:places|maps)(?:\/|$)/u.test(path);
}

export function withSecurityHeaders(response: Response, request?: Request, instagramPhotosEnabled?: string, threadsPhotosEnabled?: string) {
  const headers = applySecurityHeaders(response.headers);
  const privateWorkspace = Boolean(request && isPrivateWorkspaceRequest(request));
  // The parent document's CSP also applies to the detail sheet after SPA navigation.
  // Allow the specific curated frames without granting first-party script access.
  if (headers.get("Content-Type")?.startsWith("text/html") && !response.headers.has("Content-Security-Policy")) {
    const allowedFrames = [
      instagramPhotosEnabled === "true" ? INSTAGRAM_PHOTO_FRAME_SOURCES : "",
      threadsPhotosEnabled === "true" && response.ok && isPlaceBrowsingDocument(request) ? THREADS_PHOTO_FRAME_SOURCE : "",
    ].filter(Boolean).join(" ");
    if (allowedFrames) headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY.replace("frame-src 'none'", `frame-src ${allowedFrames}`));
  }
  // Router redirects bypass route-level headers. Enforce privacy on the final
  // Worker response, including auth redirects, errors, and single-fetch data.
  if (privateWorkspace) {
    for (const [key, value] of Object.entries({ ...NO_STORE_HEADERS, Vary: "Cookie" })) {
      if (key.toLowerCase() === "vary" && headers.has("Vary")) {
        const fields = headers.get("Vary")!.split(",").map((field) => field.trim());
        if (!fields.some((field) => field.toLowerCase() === "cookie" || field === "*")) fields.push("Cookie");
        headers.set("Vary", fields.join(", "));
      } else headers.set(key, value);
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
