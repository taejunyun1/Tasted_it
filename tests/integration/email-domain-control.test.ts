import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { commitEmailDomainAction, prepareEmailDomainAction, refreshEmailDomain, readEmailDomainControl } from "../../app/features/auth/email-domain-control.server";
import { parseActivityQuery } from "../../app/features/operations/admin-activity";
import { readAdminActivity } from "../../app/features/operations/admin-activity.server";

const targetDomain = "mail.example.test";
const providerId = "2dde7bcf-cb0a-4ea1-a213-052fb2e2fb03";
const provider = (status = "pending") => ({ id: providerId, name: targetDomain, status, records: [] });
const response = (value: unknown) => new Response(JSON.stringify(value));
async function setup(recent = true) {
  const now = new Date().toISOString(), expires = new Date(Date.now() + 600_000).toISOString();
  const actorUserId = crypto.randomUUID(), sessionId = crypto.randomUUID();
  await env.DB.prepare("DELETE FROM email_domain_actions").run();
  await env.DB.prepare("DELETE FROM email_domain_state").run();
  await env.DB.prepare("INSERT INTO users(id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES(?,?,'합성 운영자','ADMIN',?,?,?)")
    .bind(actorUserId, `${actorUserId}@example.test`, now, now, now).run();
  await env.DB.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)").bind(sessionId, actorUserId, expires, now).run();
  if (recent) await env.DB.prepare("INSERT INTO admin_session_assurances(session_id,actor_user_id,method,verified_at,expires_at) VALUES(?,?,'PASSWORD',?,?)").bind(sessionId, actorUserId, now, expires).run();
  return { actorUserId, sessionId, now, targetDomain, apiKey: "private-test-key" };
}
const absent = () => vi.fn(async () => response({ data: [], has_more: false }));

describe("durable email-domain controls", () => {
  it("requires an observation and recent authentication before any external mutation", async () => {
    const input = await setup(false), fetcher = absent();
    await expect(prepareEmailDomainAction(env.DB, { ...input, intent: "create" })).rejects.toThrow("EMAIL_DOMAIN_OBSERVATION_REQUIRED");
    await refreshEmailDomain(env.DB, { ...input, fetcher });
    const prepared = await prepareEmailDomainAction(env.DB, { ...input, intent: "create" });
    await expect(commitEmailDomainAction(env.DB, { ...input, operationId: prepared.operationId, fetcher })).rejects.toThrow("ADMIN_RECENT_AUTH_REQUIRED");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("dispatches one create across concurrent confirmations and replay", async () => {
    const input = await setup(); await refreshEmailDomain(env.DB, { ...input, fetcher: absent() });
    const prepared = await prepareEmailDomainAction(env.DB, { ...input, intent: "create" });
    const fetcher = vi.fn(async () => response(provider()));
    await Promise.allSettled([1, 2].map(() => commitEmailDomainAction(env.DB, { ...input, operationId: prepared.operationId, fetcher })));
    await commitEmailDomainAction(env.DB, { ...input, operationId: prepared.operationId, fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const view = await readEmailDomainControl(env.DB, input.targetDomain);
    expect(view.actions[0].state).toBe("CREATED");
    expect(JSON.stringify(view)).not.toContain(input.apiKey);
    expect(JSON.stringify(view)).not.toContain("records");
    const activity = await readAdminActivity(env.DB, parseActivityQuery(new URLSearchParams({ view: "operations", kind: "EMAIL_DOMAIN_CONTROL", operation: prepared.operationId }), input.now), input.now);
    expect(activity.detail).toMatchObject({ title: "메일 도메인 요청", auditLinked: true });
    expect(activity.detail?.fields).toContainEqual({ label: "요청 결과", value: "생성 응답 확인 · 존재 조회 대기" });
    expect(JSON.stringify(activity)).not.toContain(targetDomain);
  });
  it("keeps a timeout unknown and reconciles existence without replaying create", async () => {
    const input = await setup(); await refreshEmailDomain(env.DB, { ...input, fetcher: absent() });
    const prepared = await prepareEmailDomainAction(env.DB, { ...input, intent: "create" });
    const fetcher = vi.fn(async () => { throw new Error("timeout private-test-key"); });
    await commitEmailDomainAction(env.DB, { ...input, operationId: prepared.operationId, fetcher });
    await commitEmailDomainAction(env.DB, { ...input, operationId: prepared.operationId, fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await readEmailDomainControl(env.DB, targetDomain)).actions[0].state).toBe("UNKNOWN");
    await expect(prepareEmailDomainAction(env.DB, { ...input, intent: "create" })).rejects.toThrow();
    const inspect = vi.fn().mockResolvedValueOnce(response({ data: [provider()], has_more: false })).mockResolvedValueOnce(response(provider()));
    await refreshEmailDomain(env.DB, { ...input, fetcher: inspect });
    expect((await readEmailDomainControl(env.DB, targetDomain)).actions[0].state).toBe("OBSERVED_PRESENT");
    expect(inspect).toHaveBeenCalledTimes(2);
  });
  it("does not repeat an acknowledged create while the list is eventually absent or changes identity", async () => {
    const input = await setup(); await refreshEmailDomain(env.DB, { ...input, fetcher: absent() });
    const prepared = await prepareEmailDomainAction(env.DB, { ...input, intent: "create" });
    await commitEmailDomainAction(env.DB, { ...input, operationId: prepared.operationId, fetcher: vi.fn(async () => response(provider())) });
    await refreshEmailDomain(env.DB, { ...input, fetcher: absent() });
    await expect(prepareEmailDomainAction(env.DB, { ...input, intent: "create" })).rejects.toThrow("EMAIL_DOMAIN_RESULT_PENDING");
    const other = { ...provider(), id: crypto.randomUUID() };
    await refreshEmailDomain(env.DB, { ...input, fetcher: vi.fn().mockResolvedValueOnce(response({ data: [other], has_more: false })).mockResolvedValueOnce(response(other)) });
    expect((await readEmailDomainControl(env.DB, targetDomain)).actions[0].state).toBe("CREATED");
    await refreshEmailDomain(env.DB, { ...input, fetcher: vi.fn().mockResolvedValueOnce(response({ data: [provider()], has_more: false })).mockResolvedValueOnce(response(provider())) });
    expect((await readEmailDomainControl(env.DB, targetDomain)).actions[0].state).toBe("OBSERVED_PRESENT");
  });
  it("does not equate accepted asynchronous verification with verified", async () => {
    const input = await setup();
    await refreshEmailDomain(env.DB, { ...input, fetcher: vi.fn().mockResolvedValueOnce(response({ data: [provider()], has_more: false })).mockResolvedValueOnce(response(provider())) });
    const prepared = await prepareEmailDomainAction(env.DB, { ...input, intent: "verify" });
    const fetcher = vi.fn().mockResolvedValueOnce(response(provider())).mockResolvedValueOnce(response({ object: "domain", id: providerId }));
    await commitEmailDomainAction(env.DB, { ...input, operationId: prepared.operationId, fetcher });
    expect((await readEmailDomainControl(env.DB, targetDomain)).actions[0].state).toBe("ACCEPTED");
    await refreshEmailDomain(env.DB, { ...input, fetcher: vi.fn().mockResolvedValueOnce(response({ data: [provider("verified")], has_more: false })).mockResolvedValueOnce(response(provider("verified"))) });
    expect((await readEmailDomainControl(env.DB, targetDomain)).actions[0].state).toBe("OBSERVED_VERIFIED");
  });
  it("rejects stale preview and target tampering with no dispatch", async () => {
    const input = await setup(); await refreshEmailDomain(env.DB, { ...input, fetcher: absent() });
    const prepared = await prepareEmailDomainAction(env.DB, { ...input, intent: "create" });
    await refreshEmailDomain(env.DB, { ...input, fetcher: absent() });
    const fetcher = vi.fn();
    await expect(commitEmailDomainAction(env.DB, { ...input, operationId: prepared.operationId, fetcher })).rejects.toThrow("ADMIN_OPERATION_CONFLICT");
    await expect(commitEmailDomainAction(env.DB, { ...input, operationId: prepared.operationId, targetDomain: "other.example.test", fetcher })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not store an incomplete list as an absent domain", async () => {
    const input = await setup();
    await expect(refreshEmailDomain(env.DB, { ...input, fetcher: vi.fn(async () => response({ data: [], has_more: true })) })).rejects.toThrow("EMAIL_DOMAIN_LIST_INCOMPLETE");
    expect((await readEmailDomainControl(env.DB, targetDomain)).observation).toBeNull();
  });
  it("never sends when the atomic grant response is lost, including on replay", async () => {
    const input = await setup(); await refreshEmailDomain(env.DB, { ...input, fetcher: absent() });
    const prepared = await prepareEmailDomainAction(env.DB, { ...input, intent: "create" });
    let loseResponse = true;
    const database = new Proxy(env.DB, { get(target, key) {
      if (key === "batch") return async (statements: D1PreparedStatement[]) => {
        const result = await target.batch(statements);
        if (loseResponse) { loseResponse = false; throw new Error("synthetic lost commit response"); }
        return result;
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const fetcher = vi.fn();
    await commitEmailDomainAction(database, { ...input, operationId: prepared.operationId, fetcher });
    await commitEmailDomainAction(env.DB, { ...input, operationId: prepared.operationId, fetcher });
    expect(fetcher).not.toHaveBeenCalled();
    expect((await readEmailDomainControl(env.DB, targetDomain)).actions[0].state).toBe("UNKNOWN");
  });
});
