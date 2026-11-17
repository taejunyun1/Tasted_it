import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { places, users } from "../../app/db/schema";
import { seedApprovedReviewerVote } from "./reviewer-public-fixtures";

const NOW = "2026-11-18T01:00:00.000Z";
const NEXT = "2026-11-18T01:01:00.000Z";
const ERROR_CODE = "ACTIVE_RATING_CONFIG_NOT_FOUND";
const upgrades = () => env.TEST_MIGRATIONS.filter(migration => migration.name.startsWith("0060"));

async function beforeUpgrade() {
  const database = (env as unknown as { MIGRATION_DB: D1Database }).MIGRATION_DB;
  await applyD1Migrations(database, env.TEST_MIGRATIONS.filter(migration => migration.name < "0060"));
  // Workers storage persists between cases in this file; reset only shared fixture policy/alerts.
  await database.prepare("UPDATE rating_configs SET algorithm_version='rating-v2.0',active_from='2026-08-06T00:00:00.000Z',active_until=NULL WHERE id='rating-config-v2'").run();
  await database.prepare("DELETE FROM operational_alerts WHERE source_id=?").bind(ERROR_CODE).run();
  return database;
}

async function approvedReview(database: D1Database, id: string) {
  const db = createDb(database);
  await db.insert(users).values({ id, email: `${id}@example.test`, displayName: "합성 리뷰어", role: "REVIEWER", createdAt: NOW, updatedAt: NOW });
  await db.insert(places).values({ id, slug: id, name: "합성 식당", status: "PUBLISHED", address: "합성 주소", neighborhood: "합성", latitude: 35.1, longitude: 126.9, searchText: id, createdAt: NOW, updatedAt: NOW });
  const { reviewId } = await seedApprovedReviewerVote(db, { reviewerId: id, placeId: id, eventId: id, value: 1, now: NOW, projectVote: false });
  await database.prepare(`INSERT INTO rating_snapshots(id,place_id,config_id,input_hash,overall_score,user_score,reviewer_score,overall_sample_count,user_sample_count,reviewer_sample_count,reviewer_raw_weight,reviewer_combined_weight,reviewer_weight_share,reasons_json,computed_at,created_at,updated_at)
    VALUES (?,?,'rating-config-v2',?,83,NULL,83,8,0,8,8,8,1,'[]',?,?,?)`).bind(`snapshot-${id}`, id, `hash-${id}`, NOW, NOW, NOW).run();
  return reviewId;
}

async function fire(database: D1Database, reviewId: string, now = NOW) {
  await database.prepare("UPDATE reviewer_visit_reviews SET content_version=content_version+1,updated_at=? WHERE id=?").bind(now, reviewId).run();
}

async function otherConfig(database: D1Database, id: string, from: string, until: string | null = null) {
  await database.prepare(`INSERT INTO rating_configs(id,algorithm_version,minimum_visible_samples,alpha_prior,beta_prior,reviewer_max_share,settings_json,active_from,active_until,created_at,updated_at)
    VALUES (?,?,8,2,2,0.3,'{}',?,?,?,?)`).bind(id, id, from, until, NOW, NOW).run();
}

describe("0060 rating config eligibility trigger upgrade", () => {
  it("preserves populated rows, rowids and foreign keys while replacing only the publication trigger", async () => {
    const database = await beforeUpgrade();
    await approvedReview(database, "upgrade-preserved");
    await database.prepare("INSERT INTO rating_recompute_jobs(rowid,id,place_id,config_id,scope,status,reason,attempts,created_at,updated_at) VALUES(707,'preserved-job','upgrade-preserved','rating-config-v2','PLACE','RUNNING','PRESERVE',2,?,?)").bind(NOW, NOW).run();
    await database.prepare("INSERT INTO operational_alerts(id,alert_type,severity,status,source_id,message,details_json,first_occurred_at,last_occurred_at) VALUES('preserved-alert','RATING_RECOMPUTE','WARNING','OPEN','other','PRESERVE','{}',?,?)").bind(NOW, NOW).run();
    const tables = ["users", "places", "rating_configs", "rating_snapshots", "rating_recompute_jobs", "reviewer_visit_reviews", "operational_alerts"];
    const snapshot = () => Promise.all(tables.map(async table => (await database.prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`).all()).results));
    const before = await snapshot();
    const triggerBefore = await database.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='reviewer_publication_recompute'").first("sql");
    await applyD1Migrations(database, upgrades());
    expect(await snapshot()).toEqual(before);
    expect((await database.prepare("PRAGMA foreign_key_check").all()).results).toHaveLength(0);
    expect(await database.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='reviewer_publication_recompute'").first("sql")).not.toEqual(triggerBefore);
    expect(upgrades()).toHaveLength(1);
  });

  it("ignores unsupported, future and ended metadata and queues the actual seeded v2 config once", async () => {
    const database = await beforeUpgrade();
    const reviewId = await approvedReview(database, "eligible-seed");
    await otherConfig(database, "rating-v9-current", "2026-11-17T00:00:00.000Z");
    await otherConfig(database, "rating-v10-future", "2099-01-01T00:00:00.000Z");
    await otherConfig(database, "rating-v11-ended", "2026-11-18T00:00:00.000Z", NOW);
    // Same instant in a different offset: eligibility is chronological, not lexical.
    await database.prepare("UPDATE rating_configs SET active_from='2026-11-18T10:00:00+09:00' WHERE id='rating-config-v2'").run();
    await applyD1Migrations(database, upgrades());
    await fire(database, reviewId);
    await fire(database, reviewId, NEXT);
    expect((await database.prepare("SELECT config_id,status,reason FROM rating_recompute_jobs WHERE place_id='eligible-seed'").all()).results).toEqual([{ config_id: "rating-config-v2", status: "PENDING", reason: "REVIEW_MODERATION" }]);
    expect(await database.prepare("SELECT is_stale FROM rating_snapshots WHERE place_id='eligible-seed'").first("is_stale")).toBe(1);
    expect(await database.prepare("SELECT count(*) FROM operational_alerts WHERE source_id=?").bind(ERROR_CODE).first("count(*)")).toBe(0);
  });

  it.each([
    ["future", "2099-01-01T00:00:00.000Z", null, "rating-v2.0"],
    ["invalid", "not-a-date", null, "rating-v2.0"],
    ["ended", "2026-08-06T00:00:00.000Z", NOW, "rating-v2.0"],
    ["unsupported", "2026-08-06T00:00:00.000Z", null, "rating-v99"],
  ])("keeps withdrawal available and marks old snapshots stale when the only config is %s", async (label, from, until, version) => {
    const database = await beforeUpgrade();
    const reviewId = await approvedReview(database, `no-config-${label}`);
    await database.prepare("UPDATE rating_configs SET active_from=?,active_until=?,algorithm_version=? WHERE id='rating-config-v2'").bind(from, until, version).run();
    await applyD1Migrations(database, upgrades());
    await database.prepare("UPDATE reviewer_visit_reviews SET status='WITHDRAWN',updated_at=? WHERE id=?").bind(NOW, reviewId).run();
    expect(await database.prepare("SELECT status FROM reviewer_visit_reviews WHERE id=?").bind(reviewId).first("status")).toBe("WITHDRAWN");
    expect(await database.prepare("SELECT is_stale FROM rating_snapshots WHERE place_id=?").bind(`no-config-${label}`).first("is_stale")).toBe(1);
    expect(await database.prepare("SELECT count(*) FROM rating_recompute_jobs WHERE place_id=?").bind(`no-config-${label}`).first("count(*)")).toBe(0);
    const alerts = (await database.prepare("SELECT alert_type,severity,status,source_id,message,details_json,occurrence_count FROM operational_alerts WHERE source_id=?").bind(ERROR_CODE).all()).results;
    expect(alerts).toEqual([{ alert_type: "RATING_RECOMPUTE", severity: "ERROR", status: "OPEN", source_id: ERROR_CODE, message: ERROR_CODE, details_json: JSON.stringify({ code: ERROR_CODE }), occurrence_count: 1 }]);
  });

  it("deduplicates the missing-config alert globally and increments its last occurrence", async () => {
    const database = await beforeUpgrade();
    const first = await approvedReview(database, "alert-first");
    const second = await approvedReview(database, "alert-second");
    await database.prepare("UPDATE rating_configs SET active_from='2099-01-01T00:00:00.000Z' WHERE id='rating-config-v2'").run();
    await applyD1Migrations(database, upgrades());
    await fire(database, first);
    await fire(database, second, NEXT);
    expect((await database.prepare("SELECT source_id,occurrence_count,first_occurred_at,last_occurred_at FROM operational_alerts WHERE source_id=?").bind(ERROR_CODE).all()).results).toEqual([{ source_id: ERROR_CODE, occurrence_count: 2, first_occurred_at: NOW, last_occurred_at: NEXT }]);
    expect(await database.prepare("SELECT count(*) FROM rating_recompute_jobs WHERE place_id IN('alert-first','alert-second')").first("count(*)")).toBe(0);
  });

  it.each(["PENDING", "RUNNING"])("does not enqueue another config when the selected config already has a %s job", async status => {
    const database = await beforeUpgrade();
    const reviewId = await approvedReview(database, `existing-${status}`);
    // A different version must never become a fallback merely because the selected job exists.
    await otherConfig(database, `older-unsupported-${status}`, "2026-08-01T00:00:00.000Z");
    await database.prepare("INSERT INTO rating_recompute_jobs(id,place_id,config_id,scope,status,reason,created_at,updated_at) VALUES(?,?,'rating-config-v2','PLACE',?,'EXISTING',?,?)").bind(`job-${status}`, `existing-${status}`, status, NOW, NOW).run();
    await applyD1Migrations(database, upgrades());
    await fire(database, reviewId);
    expect((await database.prepare("SELECT id,config_id,status FROM rating_recompute_jobs WHERE place_id=?").bind(`existing-${status}`).all()).results).toEqual([{ id: `job-${status}`, config_id: "rating-config-v2", status }]);
    expect(await database.prepare("SELECT count(*) FROM operational_alerts WHERE source_id=?").bind(ERROR_CODE).first("count(*)")).toBe(0);
  });
});
