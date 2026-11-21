import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import { createDb } from "../../app/db/client.server";
import { recordOperationalAlert } from "../../app/features/operations/alerts.server";
import { prepareAlertResolution, commitAlertResolution } from "../../app/features/operations/alert-resolution.server";
import { readReliability, summarizeRsiRecord } from "../../app/features/operations/reliability.server";
import { RSI_PUBLIC_PATH_CHECKS } from "../../app/features/operations/rsi-self-check";
import { loader, action } from "../../app/routes/admin-reliability";

const now = new Date().toISOString();
async function fixture(fresh = true, role = "ADMIN") {
  const actorUserId = crypto.randomUUID(), sessionId = crypto.randomUUID(), db = createDb(env.DB);
  await env.DB.prepare("INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES(?,?,?,?,?,?)")
    .bind(actorUserId, `${actorUserId}@example.test`, "private-name", role, now, now).run();
  await env.DB.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)")
    .bind(sessionId, actorUserId, "2099-01-01T00:00:00.000Z", now).run();
  if (fresh) await env.DB.prepare("INSERT INTO admin_session_assurances(session_id,actor_user_id,method,verified_at,expires_at) VALUES(?,?,'PASSWORD',?,?)")
    .bind(sessionId, actorUserId, now, "2099-01-01T00:00:00.000Z").run();
  const alertId = await recordOperationalAlert(db, { alertType: "PUBLIC_DATA_SYNC", sourceId: "private-source-id", message: "private-key-error", details: { credential: "private-detail" }, now });
  return { db, alertId, actorUserId, sessionId, now };
}
it("requires recent auth, commits one human-resolution receipt and preserves original detail", async () => {
  const f = await fixture(false), op = await prepareAlertResolution(env.DB, { ...f, note: "합성 검토를 기록합니다" });
  await expect(commitAlertResolution(env.DB, { ...f, operationId: op.operationId })).rejects.toThrow("ADMIN_RECENT_AUTH_REQUIRED");
  await env.DB.prepare("INSERT INTO admin_session_assurances(session_id,actor_user_id,method,verified_at,expires_at) VALUES(?,?,'PASSWORD',?,?)")
    .bind(f.sessionId, f.actorUserId, now, "2099-01-01T00:00:00.000Z").run();
  expect(await commitAlertResolution(env.DB, { ...f, operationId: op.operationId })).toMatchObject({ replayed: false });
  expect(await commitAlertResolution(env.DB, { ...f, operationId: op.operationId })).toMatchObject({ replayed: true });
  expect(await env.DB.prepare("SELECT status,message,details_json FROM operational_alerts WHERE id=?").bind(f.alertId).first())
    .toMatchObject({ status: "RESOLVED", message: "private-key-error", details_json: '{"credential":"private-detail"}' });
  const saved = await env.DB.prepare("SELECT result_json FROM admin_operations WHERE id=?").bind(op.operationId).first<string>("result_json");
  expect(JSON.parse(saved!)).toMatchObject({ recoveryVerified: false, meaning: "HUMAN_REVIEW_RECORDED" });
  expect(await env.DB.prepare("SELECT count(*) AS n FROM admin_audit_logs WHERE target_id=?").bind(op.operationId).first("n")).toBe(1);
});
it("rejects a new occurrence after preview with no receipt or resolution", async () => {
  const f = await fixture(), op = await prepareAlertResolution(env.DB, { ...f, note: "합성 검토를 기록합니다" });
  await recordOperationalAlert(f.db, { alertType: "PUBLIC_DATA_SYNC", sourceId: "private-source-id", message: "new-error", details: {}, now });
  await expect(commitAlertResolution(env.DB, { ...f, operationId: op.operationId })).rejects.toThrow("ADMIN_OPERATION_CONFLICT");
  expect(await env.DB.prepare("SELECT status FROM operational_alerts WHERE id=?").bind(f.alertId).first("status")).toBe("OPEN");
  expect(await env.DB.prepare("SELECT count(*) FROM admin_operation_commits WHERE operation_id=?").bind(op.operationId).first("count(*)")).toBe(0);
});
it("rolls resolution back when the audit write fails", async () => {
  const f = await fixture(), op = await prepareAlertResolution(env.DB, { ...f, note: "합성 검토를 기록합니다" });
  await env.DB.exec("CREATE TRIGGER reject_b14_audit BEFORE INSERT ON admin_audit_logs WHEN NEW.action='ADMIN_OPERATION_COMMITTED' BEGIN SELECT RAISE(ABORT,'audit failure'); END;");
  try {
    await expect(commitAlertResolution(env.DB, { ...f, operationId: op.operationId })).rejects.toThrow("ADMIN_OPERATION_RESULT_UNKNOWN");
    expect(await env.DB.prepare("SELECT status FROM operational_alerts WHERE id=?").bind(f.alertId).first("status")).toBe("OPEN");
  } finally { await env.DB.exec("DROP TRIGGER reject_b14_audit"); }
});
it("accepts only complete matching RSI results and independently reports stale scheduled observations", async () => {
  const paths = RSI_PUBLIC_PATH_CHECKS.map(({ path, status }) => ({ path, status, ok: true }));
  const row = { id: "rsi-test", created_at: "2026-11-01T00:00:00.000Z", after_state: JSON.stringify({ trigger: "scheduled", ok: true, failed: 0, paths }) };
  expect(summarizeRsiRecord(row, now)).toMatchObject({ status: "PASSED", stale: true });
  expect(summarizeRsiRecord({ ...row, after_state: JSON.stringify({ trigger: "admin", ok: true, failed: 0, paths: paths.slice(1) }) }, now).status).toBe("INCOMPLETE");
  expect(summarizeRsiRecord({ ...row, after_state: '{"trigger":"scheduled","skipped":true}' }, now).status).toBe("SKIPPED");
});
it("blocks members and projects no private alert text or network calls", async () => {
  const f = await fixture(), member = await fixture(false, "USER");
  const req = (sessionId: string) => new Request("https://example.test/admin/reliability", { headers: { Cookie: `retaste_session=${sessionId}` } });
  const denied = await loader({ request: req(member.sessionId) } as never).catch((error) => error as Response);
  expect(denied.status).toBe(403);
  expect(denied.headers.get("Cache-Control")).toContain("no-store");
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network"));
  try {
    const response = await loader({ request: req(f.sessionId) } as never);
    expect(JSON.stringify(response.data)).not.toMatch(/private-key-error|private-detail|private-source-id|private-name/);
    expect(fetch).not.toHaveBeenCalled();
    expect((await readReliability(env.DB, now)).alerts.length).toBeGreaterThan(0);
    const cross = await action({ request: new Request("https://example.test/admin/reliability", { method: "POST", headers: { Cookie: `retaste_session=${f.sessionId}`, Origin: "https://evil.test" } }) } as never);
    expect(cross.init?.status).toBe(403);
  } finally { fetch.mockRestore(); }
});
