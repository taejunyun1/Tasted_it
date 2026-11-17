import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { parseActivityQuery } from "../../app/features/operations/admin-activity";
import { readAdminActivity } from "../../app/features/operations/admin-activity.server";
import { commitAdminOperation, prepareAdminOperation } from "../../app/features/operations/admin-operation.server";

it("links a public sync receipt to only the matching run and preserves unknown legacy status", async () => {
  const now = new Date().toISOString(), expires = new Date(Date.now() + 600_000).toISOString();
  const actorUserId = crypto.randomUUID(), sessionId = crypto.randomUUID(), runId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES(?,?,?,'ADMIN',?,?)")
    .bind(actorUserId, `${actorUserId}@example.test`, "합성 관리자", now, now).run();
  await env.DB.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)").bind(sessionId, actorUserId, expires, now).run();
  await env.DB.prepare("INSERT INTO admin_session_assurances(session_id,actor_user_id,method,verified_at,expires_at) VALUES(?,?,'PASSWORD',?,?)")
    .bind(sessionId, actorUserId, now, expires).run();
  await env.DB.prepare("INSERT INTO public_data_sync_runs(id,source_type,region_code,address_field,status,started_at,created_at,updated_at) VALUES(?,'BAKERY','GWANGJU_JEONNAM','ROAD_NM_ADDR','PENDING',?,?,?)")
    .bind(runId, now, now, now).run();
  const input = { actorUserId, sessionId, now, kind: "PUBLIC_SYNC_CONTROL" as const };
  const op = await prepareAdminOperation(env.DB, { ...input, payload: { reason: "private-reason" }, summary: { title: "private-title", count: 1 } });
  await commitAdminOperation(env.DB, { ...input, operationId: op.operationId }, () => ({
    checks: [env.DB.prepare("INSERT INTO admin_operation_checks(operation_id,check_name,passed) VALUES(?,'scope',1)").bind(op.operationId)],
    statements: [], result: { runId, sourceType: "BAKERY", addressField: "ROAD_NM_ADDR", reason: "private-reason" },
  }));
  const query = parseActivityQuery(new URLSearchParams({ view: "operations", kind: "PUBLIC_SYNC_CONTROL", operation: op.operationId }), now);
  const pending = await readAdminActivity(env.DB, query, now);
  expect(pending.detail).toMatchObject({ title: "공공 인허가 동기화", auditLinked: true, job: { status: "PENDING" } });
  expect(JSON.stringify(pending)).not.toContain("private-");
  await env.DB.prepare("UPDATE public_data_sync_runs SET status='RUNNING',lease_id=NULL WHERE id=?").bind(runId).run();
  expect((await readAdminActivity(env.DB, query, now)).detail?.job?.status).toBe("UNKNOWN");
  await env.DB.prepare("UPDATE public_data_sync_runs SET lease_id='synthetic',lease_expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(runId).run();
  expect((await readAdminActivity(env.DB, query, now)).detail?.job?.status).toBe("STALE");
  await env.DB.prepare("UPDATE public_data_sync_runs SET source_type='REST_CAFE' WHERE id=?").bind(runId).run();
  expect((await readAdminActivity(env.DB, query, now)).detail?.job?.status).toBe("UNKNOWN");
});
