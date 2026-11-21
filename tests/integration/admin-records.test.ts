import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { exportAdminActivity } from "../../app/features/operations/admin-records.server";
import { encodeExportCursor, parseExportQuery } from "../../app/features/operations/admin-records";
import { action, loader } from "../../app/routes/admin-records";
import { readPolicyVersions } from "../../app/features/operations/admin-policy.server";

const now = "2026-11-18T00:00:00.000Z";
const filters = { from: "2026-11-17", to: "2026-11-18", view: "audit", kind: "all", limit: "2" };
async function actor(role = "ADMIN", assured = true) {
  const actorUserId = crypto.randomUUID(), sessionId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES(?,?,?,?,?,?)")
    .bind(actorUserId, `${actorUserId}@example.test`, "private-name", role, now, now).run();
  await env.DB.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,'2099-01-01T00:00:00.000Z',?)").bind(sessionId, actorUserId, now).run();
  if (assured) await env.DB.prepare("INSERT INTO admin_session_assurances(session_id,actor_user_id,method,verified_at,expires_at) VALUES(?,?,'PASSWORD','2020-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z')")
    .bind(sessionId, actorUserId).run();
  return { actorUserId, sessionId, now };
}
function request(sessionId?: string, values = filters, origin = "https://records.test") {
  return new Request("https://records.test/admin/records", { method: "POST", body: new URLSearchParams(values),
    headers: { Origin: origin, ...(sessionId ? { Cookie: `retaste_session=${sessionId}` } : {}) } });
}
describe("admin minimal records export", () => {
  it("enforces current ADMIN, recent authentication and same origin", async () => {
    const member = await actor("USER"), admin = await actor("ADMIN", false);
    for (const [sessionId, code] of [[undefined, 302], [member.sessionId, 403]] as const) {
      const response = await action({ request: request(sessionId) } as never).catch((error) => error);
      expect(response.status).toBe(code);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
    const notRecent = await action({ request: request(admin.sessionId) } as never);
    expect(notRecent.init?.status).toBe(403); expect(notRecent.data.result).toBeNull();
    const crossOrigin = await action({ request: request(admin.sessionId, filters, "https://evil.test") } as never);
    expect(crossOrigin.init?.status).toBe(403);
  });
  it("rejects malformed cursors before returning an export", async () => {
    const admin = await actor();
    const cursor = encodeExportCursor(parseExportQuery(new URLSearchParams(filters)), "invalid-cursor");
    const response = await action({ request: request(admin.sessionId, { ...filters, cursor } as typeof filters) } as never);
    expect(response.init?.status).toBe(400); expect(response.data.result).toBeNull();
  });
  it("keeps a stable bounded snapshot, excludes raw data and records each generation", async () => {
    const admin = await actor();
    for (const [id, at] of [["records-1", "2026-11-17T00:00:00.000Z"], ["records-2", "2026-11-17T01:00:00.000Z"], ["records-3", "2026-11-17T02:00:00.000Z"], ["records-outside", "2026-11-16T23:59:59.000Z"]]) {
      await env.DB.prepare("INSERT INTO admin_audit_logs(id,actor_user_id,action,target_type,target_id,before_state,after_state,created_at) VALUES(?,?,'APPROVE_CANDIDATE','USER','private-target','private-before','private-after',?)").bind(id, admin.actorUserId, at).run();
    }
    const first = await exportAdminActivity(env.DB, { ...admin, query: parseExportQuery(new URLSearchParams(filters)) });
    expect(first.rowCount).toBe(2); expect(first.truncated).toBe(true); expect(first.nextCursor).toBeTruthy();
    expect(first.csv).not.toMatch(/private|@example|records-\d|actor_user_id|before_state|after_state/);
    const second = await exportAdminActivity(env.DB, { ...admin, query: parseExportQuery(new URLSearchParams({ ...filters, cursor: first.nextCursor! })) });
    expect(second.rowCount).toBe(1); expect(second.nextCursor).toBeNull();
    expect(second.csv).not.toContain("CSV");
    const audit = await env.DB.prepare("SELECT action,after_state FROM admin_audit_logs WHERE id=?").bind(first.exportId).first<{action:string;after_state:string}>();
    expect(audit?.action).toBe("ADMIN_AUDIT_EXPORT");
    expect(JSON.parse(audit!.after_state)).toMatchObject({ rowCount: 2, truncated: true, limit: 2 });
    expect(audit!.after_state).not.toContain(admin.sessionId);
  });
  it("fails closed when the session is revoked or the audit cannot be persisted", async () => {
    const admin = await actor();
    await env.DB.prepare("CREATE TRIGGER reject_export BEFORE INSERT ON admin_audit_logs WHEN NEW.action='ADMIN_AUDIT_EXPORT' BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END").run();
    const failure = await action({ request: request(admin.sessionId) } as never);
    expect(failure.init?.status).toBe(503); expect(failure.data.result).toBeNull();
    await env.DB.prepare("DROP TRIGGER reject_export").run();
    await env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(admin.sessionId).run();
    await expect(exportAdminActivity(env.DB, { ...admin, query: parseExportQuery(new URLSearchParams(filters)) })).rejects.toThrow("ADMIN_REQUIRED");
  });
  it("shows original document fingerprints and unresolved implementation facts without changing the source", async () => {
    const admin = await actor();
    const before = await env.DB.prepare("SELECT count(*) n FROM admin_audit_logs").first("n");
    const result = await loader({ request: new Request("https://records.test/admin/records", { headers: { Cookie: `retaste_session=${admin.sessionId}` } }) } as never);
    expect(result.data.documents).toEqual(await readPolicyVersions());
    expect(result.data.documents.map((doc) => [doc.href, doc.status, doc.effectiveDate])).toEqual([
      ["/privacy", "출시 전 검토본", null], ["/terms", "출시 전 검토본", null],
    ]);
    for (const doc of result.data.documents) expect(doc.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.data.unresolved.join(" ")).toContain("실제 운영주체");
    expect(await env.DB.prepare("SELECT count(*) n FROM admin_audit_logs").first("n")).toBe(before);
  });
});
