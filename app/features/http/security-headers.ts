export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), payment=()",
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
