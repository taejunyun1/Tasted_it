import { env } from "cloudflare:workers";
import { z } from "zod";
import type { Route } from "./+types/admin-rsi-check";
import { requireAdmin } from "../features/auth/session.server";
import { isSameOriginMutation } from "../features/http/same-origin";
import { runAdminRsiSelfCheck } from "../features/operations/rsi-self-check.server";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Robots-Tag": "noindex, nofollow" };
async function admin(request: Request) {
  try { return await requireAdmin(request); }
  catch (error) {
    if (error instanceof Response) {
      const merged = new Headers(error.headers);
      for (const [key, value] of Object.entries(headers)) merged.set(key, value);
      throw new Response(error.body, { status: error.status, headers: merged });
    }
    throw new Response(null, { status: 503, headers });
  }
}
export async function loader({ request }: Route.LoaderArgs) {
  await admin(request);
  return new Response(null, { status: 405, headers: { ...headers, Allow: "POST" } });
}
export async function action({ request }: Route.ActionArgs) {
  const user = await admin(request);
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { ...headers, Allow: "POST" } });
  if (!isSameOriginMutation(request)) return new Response(null, { status: 403, headers });
  const form = await request.formData().catch(() => null);
  if (!form || !z.object({ intent: z.literal("run") }).strict().safeParse(Object.fromEntries(form)).success) {
    return Response.json({ ok: false, code: "INPUT_INVALID" }, { status: 400, headers });
  }
  try {
    const outcome = await runAdminRsiSelfCheck(env, user.id);
    if ("skipped" in outcome) return Response.json(outcome, { status: 503, headers });
    return Response.json({ ok: outcome.ok, failed: outcome.failed, originHost: outcome.originHost,
      paths: outcome.results.map(({ path, status, ok }) => ({ path, status, ok })) }, { headers });
  } catch {
    return Response.json({ ok: false, code: "RSI_SELF_CHECK_FAILED" }, { status: 503, headers });
  }
}
