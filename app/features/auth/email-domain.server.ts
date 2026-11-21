import { z } from "zod";
import { resendFailureCode } from "./resend-failure";

export const emailDomainSchema = z.string().trim().toLowerCase().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/);
const domainStatus = z.enum(["not_started", "pending", "verified", "failed", "temporary_failure"]);
const domain = z.object({ id: z.uuid(), name: emailDomainSchema, status: domainStatus });
const details = domain.extend({ records: z.array(z.object({
  name: z.string().min(1).max(253).regex(/^[a-zA-Z0-9_@.*-]+(?:\.[a-zA-Z0-9_@.*-]+)*$/),
  type: z.enum(["TXT", "MX", "CNAME"]), value: z.string().max(4096),
  status: domainStatus, priority: z.number().int().min(0).max(65535).optional(),
})).max(30) });
type Input = { apiKey: string; targetDomain: string; fetcher?: typeof fetch };

async function call(input: Input, path: string, method = "GET", body?: unknown) {
  const response = await (input.fetcher ?? fetch)(`https://api.resend.com${path}`, {
    method, redirect: "error", headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(await resendFailureCode(response, { apiKey: input.apiKey }));
  return response.json();
}

export function senderDomain(from: string) {
  const match = /@([a-z0-9.-]+)>?\s*$/i.exec(from);
  const parsed = emailDomainSchema.safeParse(match?.[1]);
  return parsed.success ? parsed.data : null;
}

export async function inspectEmailDomain(input: Input) {
  const target = emailDomainSchema.parse(input.targetDomain);
  const list = z.object({ data: z.array(domain).max(100), has_more: z.boolean() }).parse(await call(input, "/domains?limit=100"));
  const match = list.data.find((item) => item.name === target);
  if (!match) {
    if (list.has_more) throw new Error("EMAIL_DOMAIN_LIST_INCOMPLETE");
    return { domain: null };
  }
  const result = details.parse(await call(input, `/domains/${match.id}`));
  if (result.name !== target || result.id !== match.id) throw new Error("EMAIL_DOMAIN_MISMATCH");
  return { domain: result };
}

export async function repairEmailDomain(input: Input & { intent: "create" | "verify"; domainId?: string }) {
  const target = emailDomainSchema.parse(input.targetDomain);
  if (input.intent === "create") {
    const result = details.parse(await call(input, "/domains", "POST", { name: target }));
    if (result.name !== target) throw new Error("EMAIL_DOMAIN_MISMATCH");
    return { domain: result };
  }
  const id = z.uuid().parse(input.domainId);
  const current = domain.parse(await call(input, `/domains/${id}`));
  if (current.name !== target || current.id !== id) throw new Error("EMAIL_DOMAIN_MISMATCH");
  await call(input, `/domains/${id}/verify`, "POST");
  return { verificationRequested: true };
}
