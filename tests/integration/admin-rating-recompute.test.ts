import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "../../app/db/client.server";
import { places, ratingConfigs, ratingRecomputeJobs, ratingSnapshots, sessions, users } from "../../app/db/schema";
import { enqueueRatingRecompute, getRatingJobResult, processRatingJob } from "../../app/features/ratings/recompute.server";
import { grantAdminAssurance } from "../../app/features/auth/admin-assurance.server";
import { commitRatingJobAction, inspectRatingJob, prepareRatingJobAction, readRatingJobAction } from "../../app/features/ratings/rating-job-admin.server";
import { recomputePlaceRating, markRatingStale } from "../../app/features/ratings/recompute.server";
import { action, loader } from "../../app/routes/admin-ratings";

async function fixture() {
  const db = createDb(env.DB), suffix = crypto.randomUUID(), now = new Date().toISOString();
  const adminId = `recompute-admin-${suffix}`, sessionId = crypto.randomUUID();
  const earlier = `earlier-${suffix}`, target = `target-${suffix}`;
  await db.insert(users).values({ id: adminId, email: `${adminId}@example.test`, displayName: "재계산 관리자", role: "ADMIN", createdAt: now, updatedAt: now });
  await db.insert(sessions).values({ id: sessionId, userId: adminId, expiresAt: "2099-01-01T00:00:00.000Z", createdAt: now });
  await db.insert(places).values([earlier, target].map((id) => ({ id, slug: id, name: id, status: "PUBLISHED" as const, address: "광주", neighborhood: "동명동", latitude: 35.1, longitude: 126.9, searchText: id, createdAt: now, updatedAt: now })));
  const oldJob = await enqueueRatingRecompute(db, { placeId: earlier, reason: "OLDER_PENDING", now: "2026-08-06T00:00:00.000Z" });
  return { db, adminId, sessionId, earlier, target, oldJob };
}

describe("ADMIN requested rating job", () => {
  it("processes the chosen place instead of an earlier unrelated pending job", async () => {
    const f = await fixture();
    const request = (body: Record<string, string>) => new Request("https://example.test/admin/ratings", {
      method: "POST", headers: { Origin: "https://example.test", Cookie: `retaste_session=${f.sessionId}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    });
    const preview = await action({ request: request({ intent: "recompute", placeId: f.target }) } as never);
    if (!("preview" in preview)) throw new Error("Expected operation preview");
    expect(await f.db.select().from(ratingRecomputeJobs).where(eq(ratingRecomputeJobs.placeId, f.target))).toHaveLength(0);
    const response = await action({ request: request({ intent: "confirm-recompute", operationId: preview.preview.operationId }) } as never);
    const replay = await action({ request: request({ intent: "confirm-recompute", operationId: preview.preview.operationId }) } as never);
    expect(replay).toMatchObject({ requestedJob: { replayed: true, job: { attempts: 1 } } });
    const [targetJob] = await f.db.select().from(ratingRecomputeJobs).where(eq(ratingRecomputeJobs.placeId, f.target));
    const [oldJob] = await f.db.select().from(ratingRecomputeJobs).where(eq(ratingRecomputeJobs.id, f.oldJob.id));
    expect(targetJob.status).toBe("COMPLETED");
    expect(oldJob.status).toBe("PENDING");
    expect(response).toMatchObject({ ok: true, requestedJob: { job: { id: targetJob.id, placeId: f.target, configId: targetJob.configId }, status: "COMPLETED" } });
    const page = await loader({ request: new Request(`https://example.test/admin/ratings?jobId=${targetJob.id}`, { headers: { Cookie: `retaste_session=${f.sessionId}` } }) } as never);
    expect(page.requestedJob).toMatchObject({ status: "COMPLETED", job: { id: targetJob.id } });
  });

  it("rejects confirmation after the reviewed place changes without enqueuing work", async () => {
    const f = await fixture();
    const request = (body: Record<string, string>) => new Request("https://example.test/admin/ratings", {
      method: "POST", headers: { Origin: "https://example.test", Cookie: `retaste_session=${f.sessionId}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    });
    const preview = await action({ request: request({ intent: "recompute", placeId: f.target }) } as never);
    if (!("preview" in preview)) throw new Error("Expected operation preview");
    await f.db.update(places).set({ voteRevision: 1 }).where(eq(places.id, f.target));
    expect(await action({ request: request({ intent: "confirm-recompute", operationId: preview.preview.operationId }) } as never)).toMatchObject({ ok: false, message: "검토 후 대상이 변경됐습니다. 최신 상태에서 다시 검토해 주세요." });
    expect(await f.db.select().from(ratingRecomputeJobs).where(eq(ratingRecomputeJobs.placeId, f.target))).toHaveLength(0);
  });

  it("retries only a confirmed failed job and replays the same receipt", async () => {
    const f = await fixture();
    await f.db.update(ratingRecomputeJobs).set({ status: "FAILED", attempts: 1, errorSummary: "RATING_RECOMPUTE_FAILED" }).where(eq(ratingRecomputeJobs.id, f.oldJob.id));
    const request = (body: Record<string, string>) => new Request("https://example.test/admin/ratings", {
      method: "POST", headers: { Origin: "https://example.test", Cookie: `retaste_session=${f.sessionId}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    });
    const preview = await action({ request: request({ intent: "retry-recompute", placeId: f.earlier, jobId: f.oldJob.id }) } as never);
    if (!("preview" in preview)) throw new Error("Expected retry preview");
    expect(await getRatingJobResult(f.db, f.oldJob.id)).toMatchObject({ status: "FAILED", job: { attempts: 1 } });
    await grantAdminAssurance(env.DB, { actorUserId: f.adminId, sessionId: f.sessionId, method: "PASSWORD", now: new Date() });
    const confirm = () => action({ request: request({ intent: "confirm-recompute", operationId: preview.preview.operationId }) } as never);
    expect(await confirm()).toMatchObject({ requestedJob: { status: "COMPLETED", job: { id: f.oldJob.id, attempts: 2 } } });
    expect(await confirm()).toMatchObject({ requestedJob: { replayed: true, status: "COMPLETED", job: { id: f.oldJob.id, attempts: 2 } } });
  });

  it("keeps acceptance separate from an unknown processing result and recovers by receipt", async () => {
    const f = await fixture();
    const request = (body: Record<string, string>) => new Request("https://example.test/admin/ratings", {
      method: "POST", headers: { Origin: "https://example.test", Cookie: `retaste_session=${f.sessionId}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    });
    const preview = await action({ request: request({ intent: "recompute", placeId: f.target }) } as never);
    if (!("preview" in preview)) throw new Error("Expected operation preview");
    await env.DB.exec(`CREATE TRIGGER reject_job_claim BEFORE UPDATE OF status ON rating_recompute_jobs WHEN NEW.place_id = '${f.target}' AND NEW.status='RUNNING' BEGIN SELECT RAISE(ABORT, 'fixture-only claim failure'); END;`);
    const confirm = () => action({ request: request({ intent: "confirm-recompute", operationId: preview.preview.operationId }) } as never);
    try {
      expect(await confirm()).toMatchObject({ ok: false, requestedJob: { jobId: preview.preview.jobId, status: "UNKNOWN", job: null } });
      expect(await getRatingJobResult(f.db, preview.preview.jobId)).toMatchObject({ status: "PENDING" });
    } finally {
      await env.DB.exec("DROP TRIGGER reject_job_claim");
    }
    expect(await confirm()).toMatchObject({ requestedJob: { replayed: true, status: "COMPLETED", job: { id: preview.preview.jobId, attempts: 1 } } });
  });

  it("claims an exact job once when manual and scheduled processors race", async () => {
    const f = await fixture();
    const job = await enqueueRatingRecompute(f.db, { placeId: f.target, now: new Date().toISOString(), reason: "TEST" });
    const input = { jobId: job.id, placeId: f.target, configId: job.configId, now: new Date().toISOString() };
    const results = await Promise.all([processRatingJob(f.db, input), processRatingJob(f.db, input)]);
    expect(results.filter((result) => result.claimed)).toHaveLength(1);
    expect(await getRatingJobResult(f.db, job.id)).toMatchObject({ status: "COMPLETED", job: { attempts: 1 } });
    expect(await f.db.select().from(ratingSnapshots).where(eq(ratingSnapshots.placeId, f.target))).toHaveLength(1);
    expect(await processRatingJob(f.db, input)).toMatchObject({ claimed: false, status: "COMPLETED", job: { attempts: 1 } });
  });

  it("atomically reuses the winning job when enqueues race", async () => {
    const f = await fixture();
    const jobs = await Promise.all(Array.from({ length: 6 }, () => enqueueRatingRecompute(f.db, {
      placeId: f.target, reason: "CONCURRENT_REQUEST", now: new Date().toISOString(), jobId: crypto.randomUUID(),
    })));
    expect(new Set(jobs.map((job) => job.id)).size).toBe(1);
    expect(await f.db.select().from(ratingRecomputeJobs).where(eq(ratingRecomputeJobs.placeId, f.target))).toHaveLength(1);
  });

  it("persists failure and retries only the observed failed attempt", async () => {
    const f = await fixture();
    const job = await enqueueRatingRecompute(f.db, { placeId: f.target, now: new Date().toISOString(), reason: "TEST" });
    const input = { jobId: job.id, placeId: f.target, configId: job.configId, now: new Date().toISOString() };
    // A real D1 failure proves the stored terminal state, not a mocked processor result.
    await env.DB.exec(`CREATE TRIGGER reject_test_snapshot BEFORE INSERT ON rating_snapshots WHEN NEW.place_id = '${f.target}' BEGIN SELECT RAISE(ABORT, 'fixture-only failure'); END;`);
    try {
      expect(await processRatingJob(f.db, input)).toMatchObject({ claimed: true, status: "FAILED", job: { attempts: 1, errorSummary: "RATING_RECOMPUTE_FAILED" } });
      expect(await processRatingJob(f.db, input)).toMatchObject({ claimed: false, status: "FAILED", job: { attempts: 1 } });
    } finally {
      await env.DB.exec("DROP TRIGGER reject_test_snapshot");
    }
    expect(await processRatingJob(f.db, { ...input, retryFailedAtAttempt: 0 })).toMatchObject({ claimed: false, status: "FAILED" });
    expect(await processRatingJob(f.db, { ...input, retryFailedAtAttempt: 1 })).toMatchObject({ claimed: true, status: "COMPLETED", job: { attempts: 2 } });
    expect(await getRatingJobResult(f.db, f.oldJob.id)).toMatchObject({ status: "PENDING", job: { attempts: 0 } });
  });

  it("rejects changed scope and reports missing jobs without claiming completion", async () => {
    const f = await fixture();
    await expect(processRatingJob(f.db, { jobId: f.oldJob.id, placeId: f.target, configId: f.oldJob.configId, now: new Date().toISOString() })).rejects.toThrow("RATING_JOB_SCOPE_MISMATCH");
    expect(await getRatingJobResult(f.db, f.oldJob.id)).toMatchObject({ status: "PENDING", job: { attempts: 0 } });
    expect(await getRatingJobResult(f.db, "missing-job")).toEqual({ jobId: "missing-job", job: null, status: "UNKNOWN", claimed: false });
  });

  it("does not complete an old configuration job using the active configuration", async () => {
    const f = await fixture();
    const [active] = await f.db.select().from(ratingConfigs).where(eq(ratingConfigs.id, f.oldJob.configId));
    const oldConfigId = `old-${crypto.randomUUID()}`;
    await f.db.insert(ratingConfigs).values({ ...active, id: oldConfigId, algorithmVersion: oldConfigId, activeUntil: "2000-01-01T00:00:00.000Z" });
    await f.db.update(ratingRecomputeJobs).set({ configId: oldConfigId }).where(eq(ratingRecomputeJobs.id, f.oldJob.id));
    expect(await processRatingJob(f.db, { jobId: f.oldJob.id, placeId: f.earlier, configId: oldConfigId, now: new Date().toISOString() })).toMatchObject({ status: "FAILED", job: { errorSummary: "RATING_CONFIG_CHANGED" } });
    expect(await f.db.select().from(ratingSnapshots).where(eq(ratingSnapshots.placeId, f.earlier))).toHaveLength(0);
  });
});

async function controlFixture() {
  const f = await fixture();
  const now = new Date().toISOString();
  const operator = { actorUserId: f.adminId, sessionId: f.sessionId, now };
  await grantAdminAssurance(env.DB, { ...operator, now: new Date(now), method: "PASSWORD" });
  return { ...f, operator };
}

describe("B10 bounded rating job control", () => {
  it("cancels exactly a pending job, preserves snapshots and replays a verified receipt", async () => {
    const f = await controlFixture();
    await recomputePlaceRating(f.db, { placeId: f.earlier, now: f.operator.now });
    const before = await f.db.select().from(ratingSnapshots);
    const preview = await prepareRatingJobAction(env.DB, { ...f.operator, jobId: f.oldJob.id, action: "CANCEL", reason: "중복 대기 작업 취소" });
    expect(await getRatingJobResult(f.db, f.oldJob.id)).toMatchObject({ status: "PENDING" });
    const command = { ...f.operator, operationId: preview.operationId };
    expect(await commitRatingJobAction(env.DB, command)).toMatchObject({ status: "CANCELLED", replayed: false, job: { attempts: 0 } });
    expect(await commitRatingJobAction(env.DB, command)).toMatchObject({ status: "CANCELLED", replayed: true, job: { attempts: 0 } });
    expect(await readRatingJobAction(env.DB, command)).toMatchObject({ status: "COMMITTED", action: "CANCEL" });
    expect(await f.db.select().from(ratingSnapshots)).toEqual(before);
    expect(await processRatingJob(f.db, { jobId: f.oldJob.id, placeId: f.earlier, configId: f.oldJob.configId, now: f.operator.now })).toMatchObject({ status: "CANCELLED", claimed: false });
  });

  it("rejects cancellation after a cron claim without committing an audit receipt", async () => {
    const f = await controlFixture();
    const preview = await prepareRatingJobAction(env.DB, { ...f.operator, jobId: f.oldJob.id, action: "CANCEL", reason: "중복 대기 작업 취소" });
    await processRatingJob(f.db, { jobId: f.oldJob.id, placeId: f.earlier, configId: f.oldJob.configId, now: f.operator.now });
    await expect(commitRatingJobAction(env.DB, { ...f.operator, operationId: preview.operationId })).rejects.toThrow("ADMIN_OPERATION_CONFLICT");
    expect(await env.DB.prepare("SELECT count(*) AS n FROM admin_operation_commits WHERE operation_id=?").bind(preview.operationId).first()).toEqual({ n: 0 });
    expect(await getRatingJobResult(f.db, f.oldJob.id)).toMatchObject({ status: "COMPLETED", job: { attempts: 1 } });
  });

  it("requires recent authentication and rejects cross-session operation use", async () => {
    const f = await controlFixture();
    const preview = await prepareRatingJobAction(env.DB, { ...f.operator, jobId: f.oldJob.id, action: "CANCEL", reason: "중복 대기 작업 취소" });
    await env.DB.prepare("DELETE FROM admin_session_assurances WHERE session_id=?").bind(f.sessionId).run();
    await expect(commitRatingJobAction(env.DB, { ...f.operator, operationId: preview.operationId })).rejects.toThrow("ADMIN_RECENT_AUTH_REQUIRED");
    const otherSession = crypto.randomUUID();
    await f.db.insert(sessions).values({ id: otherSession, userId: f.adminId, expiresAt: "2099-01-01T00:00:00.000Z", createdAt: f.operator.now });
    await expect(readRatingJobAction(env.DB, { ...f.operator, sessionId: otherSession, operationId: preview.operationId })).rejects.toThrow("ADMIN_OPERATION_UNAVAILABLE");
    expect(await getRatingJobResult(f.db, f.oldJob.id)).toMatchObject({ status: "PENDING" });
  });

  it("enforces the attempt ceiling, current configuration and competing job guard", async () => {
    const f = await controlFixture();
    await f.db.update(ratingRecomputeJobs).set({ status: "FAILED", attempts: 3 }).where(eq(ratingRecomputeJobs.id, f.oldJob.id));
    await expect(prepareRatingJobAction(env.DB, { ...f.operator, jobId: f.oldJob.id, action: "RETRY", reason: "실패 원인 확인 후 재시도" })).rejects.toThrow("RATING_JOB_ACTION_UNAVAILABLE");
    await f.db.update(ratingRecomputeJobs).set({ attempts: 1 }).where(eq(ratingRecomputeJobs.id, f.oldJob.id));
    const preview = await prepareRatingJobAction(env.DB, { ...f.operator, jobId: f.oldJob.id, action: "RETRY", reason: "실패 원인 확인 후 재시도" });
    await enqueueRatingRecompute(f.db, { placeId: f.earlier, reason: "NEWER_REQUEST", now: f.operator.now });
    await expect(commitRatingJobAction(env.DB, { ...f.operator, operationId: preview.operationId })).rejects.toThrow("ADMIN_OPERATION_CONFLICT");
    const job = (await getRatingJobResult(f.db, f.oldJob.id)).job!;
    expect(inspectRatingJob(job, f.operator.now, "different-config").allowedActions).toEqual([]);
  });

  it("distinguishes lease expiry from completion and blocks legacy or active runs", async () => {
    const f = await controlFixture();
    const current = { ...f.oldJob, status: "RUNNING" as const, attempts: 1, leaseExpiresAt: null };
    expect(inspectRatingJob(current, f.operator.now).allowedActions).toEqual([]);
    expect(inspectRatingJob({ ...current, leaseExpiresAt: "2099-01-01T00:00:00.000Z" }, f.operator.now).allowedActions).toEqual([]);
    expect(inspectRatingJob({ ...current, leaseExpiresAt: "2000-01-01T00:00:00.000Z" }, f.operator.now)).toMatchObject({ status: "STALE", allowedActions: ["RECOVER"] });
    await f.db.update(ratingRecomputeJobs).set({ status: "RUNNING", attempts: 1 }).where(eq(ratingRecomputeJobs.id, f.oldJob.id));
    await expect(prepareRatingJobAction(env.DB, { ...f.operator, jobId: f.oldJob.id, action: "RECOVER", reason: "정체 작업 소유권 복구" })).rejects.toThrow("RATING_JOB_ACTION_UNAVAILABLE");
  });

  it("fences an old in-flight attempt after recovery before either snapshot write", async () => {
    const f = await controlFixture();
    const read = f.db.query.ratingSnapshots.findFirst.bind(f.db.query.ratingSnapshots);
    let reached!: () => void; let release!: () => void;
    const paused = new Promise<void>((resolve) => { reached = resolve; });
    const resume = new Promise<void>((resolve) => { release = resolve; });
    f.db.query.ratingSnapshots.findFirst = (async (...args: Parameters<typeof read>) => {
      const result = await read(...args); reached(); await resume; return result;
    }) as typeof read;
    const running = processRatingJob(f.db, { jobId: f.oldJob.id, placeId: f.earlier, configId: f.oldJob.configId, now: f.operator.now });
    await paused;
    f.db.query.ratingSnapshots.findFirst = read;
    try {
      await f.db.update(ratingRecomputeJobs).set({ leaseExpiresAt: "2000-01-01T00:00:00.000Z" }).where(eq(ratingRecomputeJobs.id, f.oldJob.id));
      const preview = await prepareRatingJobAction(env.DB, { ...f.operator, jobId: f.oldJob.id, action: "RECOVER", reason: "정체 작업 소유권 복구" });
      expect(await commitRatingJobAction(env.DB, { ...f.operator, operationId: preview.operationId })).toMatchObject({ status: "COMPLETED", job: { attempts: 2 } });
      const snapshots = await f.db.select().from(ratingSnapshots).where(eq(ratingSnapshots.placeId, f.earlier));
      release();
      expect(await running).toMatchObject({ status: "COMPLETED", job: { attempts: 2 } });
      expect(await f.db.select().from(ratingSnapshots).where(eq(ratingSnapshots.placeId, f.earlier))).toEqual(snapshots);
      await markRatingStale(f.db, f.earlier, f.operator.now);
      await expect(recomputePlaceRating(f.db, { placeId: f.earlier, now: f.operator.now, jobOwnership: { jobId: f.oldJob.id, attempt: 1 } })).rejects.toThrow("RATING_JOB_OWNERSHIP_LOST");
      expect((await f.db.select().from(ratingSnapshots).where(eq(ratingSnapshots.placeId, f.earlier)))[0]!.isStale).toBe(true);
    } finally { release(); f.db.query.ratingSnapshots.findFirst = read; await running; }
  });
});
