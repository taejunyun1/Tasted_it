import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { places } from "../../app/db/schema";
import { parseActivityQuery } from "../../app/features/operations/admin-activity";
import { readAdminActivity } from "../../app/features/operations/admin-activity.server";
import { commitAdminOperation, prepareAdminOperation } from "../../app/features/operations/admin-operation.server";
import { enqueueRatingRecompute } from "../../app/features/ratings/recompute.server";
import { action, loader } from "../../app/routes/admin-activity";

const now = "2026-11-14T08:00:00.000Z";
async function actor(role = "ADMIN", expires = "2099-01-01T00:00:00.000Z") {
  const actorUserId = crypto.randomUUID(), sessionId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES(?,?,?,?,?,?)")
    .bind(actorUserId, `${actorUserId}@example.test`, "private-display-name", role, now, now).run();
  await env.DB.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)").bind(sessionId, actorUserId, expires, now).run();
  return { actorUserId, sessionId };
}
function request(sid?: string, query = "", method = "GET") {
  return new Request(`https://activity.test/admin/activity${query}`, { method, headers: sid ? { Cookie: `retaste_session=${sid}` } : {} });
}
const read = (query = "", at = now) => readAdminActivity(env.DB, parseActivityQuery(new URLSearchParams(query), at), at);
async function snapshot() {
  return Promise.all(["admin_audit_logs", "admin_operations", "admin_operation_commits", "rating_recompute_jobs"].map(async (table) =>
    JSON.stringify((await env.DB.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results)));
}
describe("read-only administrator activity", () => {
  it("rejects anonymous, member and expired sessions, malformed input and direct POST", async () => {
    const member = await actor("USER"), expired = await actor("ADMIN", "2020-01-01T00:00:00.000Z"), admin = await actor();
    for (const [sid, expected] of [[undefined, 302], [member.sessionId, 403], [expired.sessionId, 302]] as const) {
      const response = await loader({ request: request(sid) } as never).catch((error: unknown) => error);
      expect(response).toBeInstanceOf(Response); expect((response as Response).status).toBe(expected);
      expect((response as Response).headers.get("Cache-Control")).toBe("private, no-store");
    }
    const invalid = await loader({ request: request(admin.sessionId, "?cursor=bad") } as never).catch((error: unknown) => error);
    expect((invalid as Response).status).toBe(400);
    const before = await snapshot();
    expect((await action({ request: request(admin.sessionId, "", "POST") } as never)).status).toBe(405);
    expect(await snapshot()).toEqual(before);
  });

  it("pages tied timestamps deterministically and excludes records inserted after the first page", async () => {
    const at = "2026-11-14T08:00:01.000Z";
    await env.DB.batch(Array.from({ length: 52 }, (_, index) => env.DB.prepare("INSERT INTO admin_audit_logs(id,action,target_type,target_id,before_state,after_state,created_at) VALUES(?,?,?,?,?,?,?)")
      .bind(`activity-${String(index).padStart(3, "0")}`, "APPROVE_CANDIDATE", "USER", "private-target", "private-before", "private-after", ["2026-11-14T08:00:00.123789Z", "2026-11-14 08:00:00.123789", "2026-11-14T17:00:00.123789+09:00"][index % 3])));
    const first = await read("", at); expect(first.rows).toHaveLength(50); expect(first.nextCursor).toBeTruthy();
    await env.DB.prepare("INSERT INTO admin_audit_logs(id,action,target_type,target_id,created_at) VALUES('activity-new','REJECT_CANDIDATE','USER','private-new',?)").bind("2026-11-14T08:00:00.123789Z").run();
    const before = await snapshot();
    const second = await read(`cursor=${first.nextCursor}`, at), repeated = await read(`cursor=${first.nextCursor}`, at);
    expect(second.rows).toHaveLength(2); expect(second.rows).toEqual(repeated.rows); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.rows, ...second.rows].map((row) => row.key)).size).toBe(52);
    expect(JSON.stringify(second)).not.toMatch(/private-|before_state|after_state|actor_user_id/);
    expect(await snapshot()).toEqual(before);
  });

  it("links the exact operation, receipt and job without exposing free-form data", async () => {
    const admin = await actor(), placeId = crypto.randomUUID(), db = createDb(env.DB);
    await db.insert(places).values({ id: placeId, slug: placeId, name: "private-place-name", status: "PUBLISHED", address: "private-address", neighborhood: "동명동", latitude: 35.1, longitude: 126.9, searchText: "private", createdAt: now, updatedAt: now });
    const job = await enqueueRatingRecompute(db, { placeId, reason: "private-reason", now });
    const op = await prepareAdminOperation(env.DB, { ...admin, now, kind: "RATING_RECOMPUTE", payload: { note: "private-payload" }, summary: { title: "private-summary-title", count: 1 } });
    await commitAdminOperation(env.DB, { ...admin, now, kind: "RATING_RECOMPUTE", operationId: op.operationId }, () => ({
      checks: [env.DB.prepare("INSERT INTO admin_operation_checks(operation_id,check_name,passed) VALUES(?,'scope',1)").bind(op.operationId)], statements: [],
      result: { jobId: job.id, placeId, configId: job.configId, status: "PENDING", email: "private@example.test", note: "private-result" },
    }));
    const before = await snapshot();
    const result = await read(`view=operations&kind=RATING_RECOMPUTE&operation=${op.operationId}`);
    expect(result.detail).toMatchObject({ operationId: op.operationId, state: "COMMITTED", auditLinked: true, count: 1, job: { status: "PENDING" } });
    expect(JSON.stringify(result)).not.toMatch(/private|summary_json|result_json|payload|session_id|@example/);
    expect(await snapshot()).toEqual(before);
    await env.DB.prepare("UPDATE rating_recompute_jobs SET status='COMPLETED',finished_at=? WHERE id=?").bind(now, job.id).run();
    expect((await read(`operation=${op.operationId}`)).detail?.job?.status).toBe("COMPLETED");
    await env.DB.prepare("INSERT INTO admin_audit_logs(id,actor_user_id,action,target_type,target_id,created_at) VALUES(?,?,'OTHER','ADMIN_OPERATION',?,?)")
      .bind(crypto.randomUUID(), admin.actorUserId, op.operationId, now).run();
    const audit = await read("kind=RATING_RECOMPUTE"); expect(audit.rows.filter((row) => row.operationId === op.operationId)).toHaveLength(1);
    await env.DB.prepare("INSERT INTO admin_audit_logs(id,actor_user_id,action,target_type,target_id,created_at) VALUES(?,?,'ADMIN_OPERATION_COMMITTED','ADMIN_OPERATION',?,?)")
      .bind(crypto.randomUUID(), admin.actorUserId, op.operationId, now).run();
    expect((await read(`operation=${op.operationId}`)).detail).toMatchObject({ state: "INCOMPLETE", auditLinked: false, job: { status: "UNKNOWN" } });
  });

  it("keeps expired previews and malformed or missing receipts unconfirmed", async () => {
    const admin = await actor();
    const op = await prepareAdminOperation(env.DB, { ...admin, now, kind: "RATING_RECOMPUTE", payload: { note: "private" }, summary: { title: "private", count: 1 } });
    expect((await read(`operation=${op.operationId}`, "2026-11-14T08:11:00.000Z")).detail).toMatchObject({ state: "EXPIRED", auditLinked: false, job: null });
    const id = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO admin_operations(id,kind,actor_user_id,session_id,payload_json,payload_hash,summary_json,requires_recent_auth,status,result_json,created_at,expires_at,committed_at)
      VALUES(?,'CSV_IMPORT',?,?,NULL,'unused','{broken',0,'COMMITTED','{broken',?,?,?)`).bind(id, admin.actorUserId, admin.sessionId, now, now, now).run();
    expect((await read(`operation=${id}`)).detail).toMatchObject({ state: "INCOMPLETE", resultUnavailable: true, count: null });
    expect((await read(`operation=${crypto.randomUUID()}`)).detailMissing).toBe(true);
  });

  it("uses ordered read indexes for cursor pages and exact operation linkage", async () => {
    const plans = await Promise.all([
      env.DB.prepare("EXPLAIN QUERY PLAN SELECT id,created_at FROM admin_audit_logs WHERE rowid<=? AND julianday(created_at)<=julianday(?) AND (julianday(created_at),id)<(?,?) ORDER BY julianday(created_at) DESC,id DESC LIMIT 51").bind(999999, now, 2461358.833334768, "z").all<{ detail: string }>(),
      env.DB.prepare("EXPLAIN QUERY PLAN SELECT id,created_at FROM admin_operations WHERE rowid<=? AND julianday(created_at)<=julianday(?) AND (julianday(created_at),id)<(?,?) ORDER BY julianday(created_at) DESC,id DESC LIMIT 51").bind(999999, now, 2461358.833334768, "z").all<{ detail: string }>(),
      env.DB.prepare("EXPLAIN QUERY PLAN SELECT id FROM admin_audit_logs WHERE target_type='ADMIN_OPERATION' AND target_id=? AND action='ADMIN_OPERATION_COMMITTED' AND actor_user_id=?").bind("fixture", "actor").all<{ detail: string }>(),
    ]);
    const descriptions = plans.map((plan) => plan.results.map((row) => row.detail).join("; "));
    console.info("B06_QUERY_PLAN", JSON.stringify(descriptions));
    for (const description of descriptions) expect(description).toContain("INDEX admin_");
    expect(descriptions.join(" ")).not.toContain("TEMP B-TREE");
  });
});
