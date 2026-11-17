import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { createDb } from "../../app/db/client.server";
import { places } from "../../app/db/schema";
import { getActiveRatingConfig } from "../../app/features/ratings/rating-config.server";
import { CURRENT_RATING_CONFIG_ID_SQL } from "../../app/features/ratings/rating-config-eligibility";
import { enqueueRatingRecompute, processRatingJob, processRatingJobs, recomputePlaceRating, getLatestRatingSnapshot, getRatingJobResult } from "../../app/features/ratings/recompute.server";

const now = "2026-11-18T00:00:00.000Z";
async function place() {
  const id = `eligibility-${crypto.randomUUID()}`;
  await createDb(env.DB).insert(places).values({ id, slug: id, name: "합성 현재 설정", status: "PUBLISHED", address: "합성 주소", neighborhood: "합성", latitude: 35.1, longitude: 126.9, searchText: id, createdAt: now, updatedAt: now });
  return id;
}
async function extraConfig() {
  const id = `unsupported-${crypto.randomUUID()}`;
  await env.DB.prepare("INSERT INTO rating_configs(id,algorithm_version,minimum_visible_samples,alpha_prior,beta_prior,reviewer_max_share,settings_json,active_from,created_at,updated_at) VALUES(?,?,8,2,2,0.3,'{}','2090-01-01T00:00:00.000Z',?,?)").bind(id, id, now, now).run();
  return id;
}
async function restoreConfig() {
  await env.DB.prepare("UPDATE rating_configs SET algorithm_version='rating-v2.0',active_from='2026-08-06T00:00:00.000Z',active_until=NULL WHERE id='rating-config-v2'").run();
}

describe("current rating config eligibility", () => {
  it("selects the seeded current version consistently and excludes future/ended/unknown versions", async () => {
    const db = createDb(env.DB), unknown = await extraConfig();
    try {
      expect((await getActiveRatingConfig(db, now)).id).toBe("rating-config-v2");
      expect(await env.DB.prepare(`SELECT ${CURRENT_RATING_CONFIG_ID_SQL} id`).bind(now).first("id")).toBe("rating-config-v2");
      for (const [field, value] of [["active_from", "2090-01-01T00:00:00.000Z"], ["active_from", "not-a-date"], ["active_until", "2026-11-17T00:00:00.000Z"], ["algorithm_version", "unapproved-version"]] as const) {
        await env.DB.prepare(`UPDATE rating_configs SET ${field}=? WHERE id='rating-config-v2'`).bind(value).run();
        await expect(getActiveRatingConfig(db, now)).rejects.toThrow("ACTIVE_RATING_CONFIG_NOT_FOUND");
        expect(await env.DB.prepare(`SELECT ${CURRENT_RATING_CONFIG_ID_SQL} id`).bind(now).first("id")).toBeNull();
        await restoreConfig();
      }
      expect((await getActiveRatingConfig(db, "2026-08-06T00:00:00.000Z")).id).toBe("rating-config-v2");
      await expect(getActiveRatingConfig(db, "2026-08-05T23:59:59.999Z")).rejects.toThrow("ACTIVE_RATING_CONFIG_NOT_FOUND");
    } finally { await restoreConfig(); await env.DB.prepare("DELETE FROM rating_configs WHERE id=?").bind(unknown).run(); }
  });

  it("does not enqueue or expose a fresh snapshot when no current config is eligible", async () => {
    const db = createDb(env.DB), id = await place();
    await recomputePlaceRating(db, { placeId: id, now });
    expect(await getLatestRatingSnapshot(db, id, now)).toBeDefined();
    await env.DB.prepare("UPDATE rating_configs SET active_from='2090-01-01T00:00:00.000Z' WHERE id='rating-config-v2'").run();
    try {
      await expect(enqueueRatingRecompute(db, { placeId: id, reason: "TEST", now })).rejects.toThrow("ACTIVE_RATING_CONFIG_NOT_FOUND");
      expect(await getLatestRatingSnapshot(db, id, now)).toBeUndefined();
      await expect(processRatingJobs(db, { now, limit: 1 })).rejects.toThrow("ACTIVE_RATING_CONFIG_NOT_FOUND");
      expect(await env.DB.prepare("SELECT count(*) n FROM rating_recompute_jobs WHERE place_id=?").bind(id).first("n")).toBe(0);
    } finally { await restoreConfig(); }
  });

  it("refuses an unsupported old job without claiming it and processes the current job beyond it", async () => {
    const db = createDb(env.DB), id = await place(), unsupported = await extraConfig(), old = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO rating_recompute_jobs(id,place_id,config_id,scope,status,reason,attempts,created_at,updated_at) VALUES(?,?,?,'PLACE','PENDING','TEST',0,'2000-01-01T00:00:00Z',?)").bind(old, id, unsupported, now).run();
    expect(await processRatingJob(db, { jobId: old, placeId: id, configId: unsupported, now })).toMatchObject({ claimed: false, status: "FAILED", job: { attempts: 0, errorSummary: "RATING_CONFIG_CHANGED" } });
    const active = await enqueueRatingRecompute(db, { placeId: id, reason: "TEST", now });
    expect(await processRatingJobs(db, { now, limit: 1 })).toMatchObject({ processed: 1, completed: 1, failed: 0 });
    expect(await env.DB.prepare("SELECT status FROM rating_recompute_jobs WHERE id=?").bind(active.id).first("status")).toBe("COMPLETED");
  });
  it("refills current ratings when only an unsupported fresh snapshot and pending job exist", async () => {
    const db = createDb(env.DB), id = await place(), unsupported = await extraConfig();
    await recomputePlaceRating(db, { placeId: id, now });
    await env.DB.prepare("UPDATE rating_snapshots SET config_id=? WHERE place_id=?").bind(unsupported, id).run();
    await env.DB.prepare("INSERT INTO rating_recompute_jobs(id,place_id,config_id,scope,status,reason,attempts,created_at,updated_at) VALUES(?,?,?,'PLACE','PENDING','TEST',0,'2000-01-01T00:00:00Z',?)").bind(crypto.randomUUID(), id, unsupported, now).run();
    expect(await getLatestRatingSnapshot(db, id, now)).toBeUndefined();
    expect(await processRatingJobs(db, { now, limit: 1 })).toMatchObject({ processed: 1, completed: 1, failed: 0 });
    expect(await getLatestRatingSnapshot(db, id, now)).toMatchObject({ configId: "rating-config-v2" });
  });

  it("records config loss during stale snapshot reuse as failure rather than leaving a running owner", async () => {
    const db = createDb(env.DB), id = await place();
    await recomputePlaceRating(db, { placeId: id, now });
    await env.DB.prepare("UPDATE rating_snapshots SET is_stale=1 WHERE place_id=?").bind(id).run();
    const job = await enqueueRatingRecompute(db, { placeId: id, reason: "TEST", now });
    const original = db.query.ratingSnapshots.findFirst.bind(db.query.ratingSnapshots);
    const spy = vi.spyOn(db.query.ratingSnapshots, "findFirst").mockImplementation((async (...args: Parameters<typeof original>) => {
      const snapshot = await original(...args);
      await env.DB.prepare("UPDATE rating_configs SET active_from='2090-01-01T00:00:00.000Z' WHERE id='rating-config-v2'").run();
      return snapshot;
    }) as never);
    try {
      expect(await processRatingJob(db, { jobId: job.id, placeId: id, configId: job.configId, now })).toMatchObject({ claimed: true, status: "FAILED", job: { attempts: 1, errorSummary: "ACTIVE_RATING_CONFIG_NOT_FOUND" } });
      expect(await env.DB.prepare("SELECT is_stale FROM rating_snapshots WHERE place_id=?").bind(id).first("is_stale")).toBe(1);
      expect(await getLatestRatingSnapshot(db, id, now)).toBeUndefined();
    } finally { spy.mockRestore(); await restoreConfig(); }
  });

  it("preserves completed history but never replays an unsupported job as current success", async () => {
    const db = createDb(env.DB), id = await place(), unsupported = await extraConfig(), jobId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO rating_recompute_jobs(id,place_id,config_id,scope,status,reason,attempts,created_at,updated_at,finished_at) VALUES(?,?,?,'PLACE','COMPLETED','TEST',1,?,?,?)").bind(jobId, id, unsupported, now, now, now).run();
    expect(await processRatingJob(db, { jobId, placeId: id, configId: unsupported, now })).toMatchObject({ status: "NONCURRENT", claimed: false, job: { status: "COMPLETED", attempts: 1 } });
    expect(await getRatingJobResult(db, jobId, now)).toMatchObject({ status: "NONCURRENT", job: { status: "COMPLETED" } });
    expect(await env.DB.prepare("SELECT status,attempts FROM rating_recompute_jobs WHERE id=?").bind(jobId).first()).toEqual({ status: "COMPLETED", attempts: 1 });
    expect(await env.DB.prepare("SELECT count(*) n FROM rating_snapshots WHERE place_id=?").bind(id).first("n")).toBe(0);
  });

});
