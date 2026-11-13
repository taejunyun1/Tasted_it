import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "../../app/db/client.server";
import { places, ratingConfigs, ratingRecomputeJobs, ratingSnapshots, sessions, users } from "../../app/db/schema";
import { enqueueRatingRecompute, getRatingJobResult, processRatingJob } from "../../app/features/ratings/recompute.server";
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
