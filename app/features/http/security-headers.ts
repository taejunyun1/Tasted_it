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

export function withSecurityHeaders(response: Response) {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: applySecurityHeaders(response.headers),
  });
}
