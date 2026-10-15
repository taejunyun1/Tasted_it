import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Route } from "./+types/admin-email-domain";
import { createDb } from "../db/client.server";
import { adminAuditLogs } from "../db/schema";
import { requireAdmin } from "../features/auth/session.server";
import { emailDomainSchema, inspectEmailDomain, repairEmailDomain, senderDomain } from "../features/auth/email-domain.server";
import { safeResendLogCode } from "../features/auth/resend-failure";
import { isSameOriginMutation } from "../features/http/same-origin";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Robots-Tag": "noindex, nofollow" };
function target() {
  const parsed = emailDomainSchema.safeParse(env.EMAIL_DOMAIN_REPAIR_TARGET);
  if (!parsed.success) throw new Response("Not found", { status: 404, headers });
  return parsed.data;
}
function failure(error: unknown) {
  const raw = error instanceof Error ? error.message : "UNKNOWN";
  const code = raw.startsWith("RESEND_SEND_FAILED:") ? safeResendLogCode(raw) : "EMAIL_DOMAIN_OPERATION_FAILED";
  return Response.json({ ok: false, code }, { status: 502, headers });
}
export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const targetDomain = target();
  if (!env.RESEND_API_KEY) return Response.json({ ok: false, code: "EMAIL_NOT_CONFIGURED" }, { status: 503, headers });
  try {
    const configuredFrom = env.RESEND_FROM_EMAIL ?? "";
    const fromDomain = senderDomain(configuredFrom);
    return Response.json({ ok: true, senderDomain: fromDomain,
      configuredFrom: fromDomain && configuredFrom.length <= 320 && !/[\r\n]/.test(configuredFrom) ? configuredFrom : null, targetDomain,
      ...await inspectEmailDomain({ apiKey: env.RESEND_API_KEY, targetDomain }) }, { headers });
  } catch (error) { return failure(error); }
}
export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request);
  if (!isSameOriginMutation(request)) return new Response("Forbidden", { status: 403, headers });
  const targetDomain = target();
  const parsed = z.object({ intent: z.enum(["create", "verify"]), domainId: z.uuid().optional() }).strict()
    .refine((value) => value.intent !== "verify" || !!value.domainId)
    .safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return Response.json({ ok: false, code: "INPUT_INVALID" }, { status: 400, headers });
  if (!env.RESEND_API_KEY) return Response.json({ ok: false, code: "EMAIL_NOT_CONFIGURED" }, { status: 503, headers });
  const db = createDb(env.DB); const id = crypto.randomUUID();
  // Write an attempt before the external mutation so an audit failure denies the operation.
  await db.insert(adminAuditLogs).values({ id, actorUserId: admin.id, action: "EMAIL_DOMAIN_REPAIR", targetType: "OPERATIONS",
    targetId: targetDomain, afterState: JSON.stringify({ intent: parsed.data.intent, state: "REQUESTED" }), createdAt: new Date().toISOString() });
  try {
    const result = await repairEmailDomain({ apiKey: env.RESEND_API_KEY, targetDomain, ...parsed.data });
    await db.update(adminAuditLogs).set({ afterState: JSON.stringify({ intent: parsed.data.intent, state: "COMPLETED" }) }).where(eq(adminAuditLogs.id, id));
    return Response.json({ ok: true, ...result }, { headers });
  } catch (error) { return failure(error); }
}
