import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { parseActivityQuery } from "../../app/features/operations/admin-activity";
import { readAdminActivity } from "../../app/features/operations/admin-activity.server";
import { claimParkingJob } from "../../app/features/parking/parking-job.server";
import { prepareParkingJobAction, commitParkingJobAction } from "../../app/features/parking/parking-job-admin.server";

it("shows the exact parking control result without exposing its reason or mismatched source", async () => {
  const now = new Date().toISOString(), expires = new Date(Date.now() + 600_000).toISOString();
  const actorUserId = crypto.randomUUID(), sessionId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES(?,?,?,'ADMIN',?,?)")
    .bind(actorUserId, `${actorUserId}@example.test`, "합성 관리자", now, now).run();
  await env.DB.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)").bind(sessionId, actorUserId, expires, now).run();
  await env.DB.prepare("INSERT INTO admin_session_assurances(session_id,actor_user_id,method,verified_at,expires_at) VALUES(?,?,'PASSWORD',?,?)")
    .bind(sessionId, actorUserId, now, expires).run();
  const { job } = await claimParkingJob(createDb(env.DB), "PARKING", now);
  const input = { actorUserId, sessionId, now };
  const preview = await prepareParkingJobAction(env.DB, { ...input, runId: job.id, action: "CANCEL", reason: "private-reason" });
  await commitParkingJobAction(env.DB, { ...input, operationId: preview.operationId });
  const query = parseActivityQuery(new URLSearchParams({ view: "operations", kind: "PARKING_SYNC_CONTROL", operation: preview.operationId }), now);
  const activity = await readAdminActivity(env.DB, query, now);
  expect(activity.detail).toMatchObject({ title: "주차·EV 작업 제어", auditLinked: true, job: { status: "CANCELLED" } });
  expect(JSON.stringify(activity)).not.toContain("private-reason");
  await env.DB.prepare("UPDATE parking_sync_runs SET source='EV' WHERE id=?").bind(job.id).run();
  expect((await readAdminActivity(env.DB, query, now)).detail?.job?.status).toBe("UNKNOWN");
});
