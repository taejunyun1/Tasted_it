import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { commitAdminOperation, getAdminOperation, prepareAdminOperation } from "../../app/features/operations/admin-operation.server";

const now = "2026-11-14T03:00:00.000Z";
async function actor(role = "ADMIN", fresh = true) {
  const actorUserId = crypto.randomUUID(), sessionId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES(?,?,?,?,?,?)")
    .bind(actorUserId, `${actorUserId}@example.test`, "합성 관리자", role, now, now).run();
  await env.DB.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)")
    .bind(sessionId, actorUserId, "2026-11-15T03:00:00.000Z", now).run();
  if (fresh) await env.DB.prepare("INSERT INTO admin_session_assurances(session_id,actor_user_id,method,verified_at,expires_at) VALUES(?,?,'PASSWORD',?,?)")
    .bind(sessionId, actorUserId, now, "2026-11-14T03:10:00.000Z").run();
  return { actorUserId, sessionId };
}
const kind = "CSV_IMPORT" as const;
async function prepared(who: Awaited<ReturnType<typeof actor>>) {
  return prepareAdminOperation(env.DB, { ...who, kind, payload: { rows: [{ name: "합성 식당" }], version: 1 }, summary: { title: "장소 가져오기", count: 1 }, now });
}
function plan(operationId: string, valid = true, failAudit = false) {
  return {
    checks: [env.DB.prepare("INSERT INTO admin_operation_checks(operation_id,check_name,passed) VALUES(?,'target',?)").bind(operationId, valid ? 1 : 0)],
    statements: [env.DB.prepare("INSERT INTO categories(id,slug,name,emoji,sort_order,created_at,updated_at) VALUES(?,?,?,'🍽️',0,?,?)").bind(operationId, `test-${operationId}`, "합성 분류", now, now)],
    result: { inserted: 1, ...(failAudit ? { password: "must-not-persist" } : {}) },
  };
}
describe("ADMIN operation contract", () => {
  it("binds preview to its authenticated session and current administrator role", async () => {
    const admin = await actor(), other = await actor(), user = await actor("USER");
    const op = await prepared(admin);
    await expect(getAdminOperation(env.DB, { ...other, operationId: op.operationId, kind, now })).rejects.toThrow("ADMIN_OPERATION_UNAVAILABLE");
    await expect(prepared(user)).rejects.toThrow("ADMIN_REQUIRED");
    await env.DB.prepare("UPDATE users SET role='USER' WHERE id=?").bind(admin.actorUserId).run();
    await expect(getAdminOperation(env.DB, { ...admin, operationId: op.operationId, kind, now })).rejects.toThrow("ADMIN_REQUIRED");
  });
  it("requires recent authentication only when committing a risky preview", async () => {
    const admin = await actor("ADMIN", false), op = await prepared(admin);
    await expect(commitAdminOperation(env.DB, { ...admin, operationId: op.operationId, kind, now }, () => plan(op.operationId))).rejects.toThrow("ADMIN_RECENT_AUTH_REQUIRED");
    expect(await env.DB.prepare("SELECT id FROM categories WHERE id=?").bind(op.operationId).first()).toBeNull();
  });
  it("commits effect and receipt once and replays only the saved result", async () => {
    const admin = await actor(), op = await prepared(admin), input = { ...admin, operationId: op.operationId, kind, now };
    expect(await commitAdminOperation(env.DB, input, () => plan(op.operationId))).toMatchObject({ replayed: false, result: { inserted: 1 } });
    expect(await commitAdminOperation(env.DB, input, () => { throw new Error("must not rerun"); })).toMatchObject({ replayed: true, result: { inserted: 1 } });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM admin_audit_logs WHERE target_id=? AND action='ADMIN_OPERATION_COMMITTED'").bind(op.operationId).first("n")).toBe(1);
    expect(await env.DB.prepare("SELECT payload_json FROM admin_operations WHERE id=?").bind(op.operationId).first("payload_json")).toBeNull();
  });
  it("rolls the claim, mutation and receipt back when the target changes", async () => {
    const admin = await actor(), op = await prepared(admin);
    await expect(commitAdminOperation(env.DB, { ...admin, operationId: op.operationId, kind, now }, () => plan(op.operationId, false))).rejects.toThrow("ADMIN_OPERATION_CONFLICT");
    expect(await env.DB.prepare("SELECT id FROM categories WHERE id=?").bind(op.operationId).first()).toBeNull();
    expect(await env.DB.prepare("SELECT status FROM admin_operations WHERE id=?").bind(op.operationId).first("status")).toBe("PENDING");
    expect(await env.DB.prepare("SELECT operation_id FROM admin_operation_commits WHERE operation_id=?").bind(op.operationId).first()).toBeNull();
  });
  it("checks role and assurance again inside the transaction after the adapter loads", async () => {
    const admin = await actor(), op = await prepared(admin);
    await expect(commitAdminOperation(env.DB, { ...admin, operationId: op.operationId, kind, now }, async () => {
      await env.DB.prepare("DELETE FROM admin_session_assurances WHERE session_id=?").bind(admin.sessionId).run();
      return plan(op.operationId);
    })).rejects.toThrow("ADMIN_RECENT_AUTH_REQUIRED");
    expect(await env.DB.prepare("SELECT id FROM categories WHERE id=?").bind(op.operationId).first()).toBeNull();
  });
  it("rejects expired previews and secret-shaped payload/result fields", async () => {
    const admin = await actor(), op = await prepared(admin);
    await expect(getAdminOperation(env.DB, { ...admin, operationId: op.operationId, kind, now: "2026-11-14T03:11:00.000Z" })).rejects.toThrow("ADMIN_OPERATION_EXPIRED");
    await expect(prepareAdminOperation(env.DB, { ...admin, kind, payload: { password: "secret" }, summary: { title: "제한", count: 1 }, now })).rejects.toThrow("ADMIN_OPERATION_INPUT_INVALID");
    await expect(commitAdminOperation(env.DB, { ...admin, operationId: op.operationId, kind, now }, () => plan(op.operationId, true, true))).rejects.toThrow("ADMIN_OPERATION_INPUT_INVALID");
  });
  it("commits concurrent requests once and preserves receipts after session revocation", async () => {
    const admin = await actor(), op = await prepared(admin), input = { ...admin, operationId: op.operationId, kind, now };
    const results = await Promise.all([commitAdminOperation(env.DB, input, () => plan(op.operationId)), commitAdminOperation(env.DB, input, () => plan(op.operationId))]);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM admin_audit_logs WHERE target_id=?").bind(op.operationId).first("n")).toBe(1);
    await expect(env.DB.prepare("DELETE FROM admin_audit_logs WHERE target_id=?").bind(op.operationId).run()).rejects.toThrow("ADMIN_OPERATION_IMMUTABLE");
    await env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(admin.sessionId).run();
    expect(await env.DB.prepare("SELECT status FROM admin_operations WHERE id=? AND session_id IS NULL").bind(op.operationId).first("status")).toBe("COMMITTED");
    await expect(getAdminOperation(env.DB, input)).rejects.toThrow("ADMIN_REQUIRED");
  });
  it("rolls the effect back when the audit write fails", async () => {
    const admin = await actor(), op = await prepared(admin);
    await env.DB.exec("CREATE TRIGGER reject_operation_audit BEFORE INSERT ON admin_audit_logs WHEN NEW.action='ADMIN_OPERATION_COMMITTED' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;");
    try {
      await expect(commitAdminOperation(env.DB, { ...admin, operationId: op.operationId, kind, now }, () => plan(op.operationId))).rejects.toThrow("ADMIN_OPERATION_RESULT_UNKNOWN");
      expect(await env.DB.prepare("SELECT id FROM categories WHERE id=?").bind(op.operationId).first()).toBeNull();
      expect(await env.DB.prepare("SELECT status FROM admin_operations WHERE id=?").bind(op.operationId).first("status")).toBe("PENDING");
    } finally { await env.DB.exec("DROP TRIGGER reject_operation_audit;"); }
  });
});
