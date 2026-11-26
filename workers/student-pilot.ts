import { timingSafeEqual } from "node:crypto";
import { createRequestHandler, redirect } from "react-router";
import { requireAdminSession } from "../app/features/auth/session.server";
import { readBoundedBody } from "../app/features/http/bounded-body";
import { withSecurityHeaders } from "../app/features/http/security-headers";

type PilotEnv = Env & { PILOT_BROWSER_PASSWORD?: string; PILOT_EXPIRES_AT?: string; ASSETS?: Fetcher };
const cloudPilotHost = "retaste-student-pilot.retaste-beta.workers.dev";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

const readWrite = new Set([
  "/login", "/student/join", "/reviewer/apply", "/reviewer/ratings",
  "/admin/students", "/admin/reviewers", "/admin/reviewer-visits",
  "/admin/reauth", "/admin/poi-media",
]);
const readOnly = new Set([
  "/student", "/resources/reviewer-places", "/privacy", "/terms", "/__manifest",
]);
const detail = /^\/(?:places|reviewers|review-photos|poi-media)\/[^/]+$/;
const photoPreview = /^\/admin\/poi-media\/[^/]+\/preview$/;
const task = /^\/student\/tasks\/[^/]+$/;

const accessHeaders = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "X-Retaste-Environment": "student-pilot",
  "Content-Security-Policy": [
    "default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'",
    "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:", "font-src 'self' data:", "worker-src 'self' blob:",
    "form-action 'self'",
  ].join("; "),
};

function routePath(pathname: string) {
  const path = pathname.endsWith("/_.data") ? pathname.slice(0, -7)
    : pathname.endsWith(".data") ? pathname.slice(0, -5) : pathname;
  const normalized = path.replace(/\/$/, "") || "/";
  try {
    const segments = normalized.split("/").map(decodeURIComponent);
    if (segments.some((segment) => /[\/\\\0]/.test(segment))) return null;
  } catch {
    return null;
  }
  return normalized;
}

async function isAuthorized(request: Request, password?: string) {
  const credentials = request.headers.get("Authorization");
  if (!password || !/^[A-Za-z0-9_-]{24,128}$/.test(password) || !credentials?.startsWith("Basic ") || credentials.length > 384) return false;
  const encoder = new TextEncoder();
  const [actual, expected] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(credentials.slice(6))),
    crypto.subtle.digest("SHA-256", encoder.encode(btoa(`pilot:${password}`))),
  ]);
  return timingSafeEqual(new Uint8Array(actual), new Uint8Array(expected));
}

async function passwordReauthentication(request: Request) {
  if (request.headers.get("Content-Type")?.split(";", 1)[0] !== "application/x-www-form-urlencoded") return false;
  try {
    const body = await readBoundedBody(request.clone() as Request, 4096);
    const form = new URLSearchParams(new TextDecoder().decode(body));
    return form.getAll("intent").length === 1 && form.get("intent") === "password";
  } catch {
    return false;
  }
}

const adminNavigation = `<!doctype html><html lang="ko"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>학생 실증 관리자</title>
<main><h1>학생 실증 관리자</h1><ul>
<li><a href="/admin/students">학생 좌석과 초대</a></li>
<li><a href="/admin/reviewers">리뷰어 승인</a></li>
<li><a href="/admin/reviewer-visits">방문 리뷰 검수</a></li>
<li><a href="/admin/poi-media">장소 사진 관리</a></li>
</ul></main></html>`;

function pilotResponse(response: Response, request: Request) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(accessHeaders)) headers.set(name, value);
  return withSecurityHeaders(new Response(response.body, {
    status: response.status, statusText: response.statusText, headers,
  }), request);
}

export default {
  async fetch(request, env) {
    const { hostname, pathname, protocol } = new URL(request.url);
    const loopback = hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "localhost";
    if (!loopback && (hostname !== cloudPilotHost || protocol !== "https:" || !env.PILOT_EXPIRES_AT)) {
      return new Response(null, { status: 404, headers: accessHeaders });
    }
    if (pathname === "/robots.txt" && request.method === "GET") {
      return new Response("User-agent: *\nDisallow: /\n", { headers: { ...accessHeaders, "Content-Type": "text/plain" } });
    }
    if (!env.PILOT_BROWSER_PASSWORD || (env.PILOT_EXPIRES_AT && !(Date.parse(env.PILOT_EXPIRES_AT) > Date.now()))) {
      return new Response(null, { status: 404, headers: accessHeaders });
    }
    if (!await isAuthorized(request, env.PILOT_BROWSER_PASSWORD)) {
      return new Response(null, { status: 401, headers: { ...accessHeaders, "WWW-Authenticate": 'Basic realm="ReTaste student pilot"' } });
    }

    const path = routePath(pathname);
    const read = request.method === "GET" || request.method === "HEAD";
    if (read && env.ASSETS && (pathname.startsWith("/assets/") || pathname === "/favicon.ico")) {
      return pilotResponse(await env.ASSETS.fetch(request), request);
    }
    if (path === "/" && read) return redirect("/student", { headers: accessHeaders });
    if ((path === "/admin" || path === "/admin/places") && read) {
      try {
        await requireAdminSession(request);
      } catch (error) {
        if (error instanceof Response) return pilotResponse(error, request);
        throw error;
      }
      return pilotResponse(new Response(request.method === "HEAD" ? null : adminNavigation, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }), request);
    }
    const allowed = path && (read
      ? readWrite.has(path) || readOnly.has(path) || task.test(path) || detail.test(path) || photoPreview.test(path)
      : request.method === "POST" && (readWrite.has(path) || task.test(path) || path === "/logout"));
    if (!allowed) return new Response(null, { status: 404, headers: accessHeaders });
    if (path === "/admin/reauth" && request.method === "POST" && !await passwordReauthentication(request)) {
      return new Response(null, { status: 403, headers: accessHeaders });
    }

    return pilotResponse(await requestHandler(request), request);
  },
} satisfies ExportedHandler<PilotEnv>;
