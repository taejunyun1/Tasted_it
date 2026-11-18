import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { categories, placeDailyMetrics, ratingSnapshots } from "../../app/db/schema";
import { getHiddenGemStatus } from "../../app/features/ratings/rating-badges.server";
import { publicationSnapshotStamp } from "./reviewer-public-fixtures";

const now = "2026-11-18T12:00:00.000Z";

async function seedPeers(count: number) {
  const db = createDb(env.DB);
  const prefix = `gem-${crypto.randomUUID()}-'quoted-`;
  const categoryId = `${prefix}category`;
  await db.insert(categories).values({ id: categoryId, slug: categoryId, name: "합성 분류", emoji: "", sortOrder: 1, createdAt: now, updatedAt: now });
  await env.DB.prepare(`
    WITH RECURSIVE numbers(n) AS (
      SELECT 0 UNION ALL SELECT n + 1 FROM numbers WHERE n + 1 < ?
    ), fixture(prefix) AS (SELECT ?)
    INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at)
    SELECT prefix || printf('%04d',n), prefix || printf('%04d',n), '합성 장소 ' || n,
      'PUBLISHED', '합성 주소', prefix, 35.1, 126.9, prefix, ?, ?
    FROM numbers CROSS JOIN fixture
  `).bind(count, prefix, now, now).run();
  await env.DB.prepare(`INSERT INTO place_categories(place_id,category_id,is_primary)
    SELECT id,?,1 FROM places WHERE neighborhood=?`).bind(categoryId, prefix).run();
  await env.DB.prepare(`INSERT INTO place_daily_metrics(place_id,metric_date,detail_views,direction_clicks,save_actions)
    SELECT id,'2026-11-18',CAST(substr(id,length(?) + 1) AS INTEGER) + 1,0,0 FROM places WHERE neighborhood=?`)
    .bind(prefix, prefix).run();
  const placeId = `${prefix}0000`;
  await db.insert(ratingSnapshots).values({
    ...(await publicationSnapshotStamp(db, placeId)), id: `${prefix}snapshot`, placeId,
    configId: "rating-config-v2", inputHash: prefix, overallScore: 80, userScore: 78, reviewerScore: 85,
    overallSampleCount: 10, userSampleCount: 7, reviewerSampleCount: 3,
    reviewerRawWeight: 3, reviewerCombinedWeight: 3, reviewerWeightShare: 0.3,
    reasonsJson: "{}", isStale: false, computedAt: now, createdAt: now, updatedAt: now,
  });
  return { db, placeId, prefix };
}

it("evaluates 100 quoted peer IDs without exceeding D1 bindings and preserves the median threshold", async () => {
  const { db, placeId } = await seedPeers(100);
  expect(await getHiddenGemStatus(db, { placeId, now })).toEqual({
    eligible: true, reasons: [], detailViews90d: 1, categoryRegionMedianViews90d: 50.5,
  });
  await db.update(placeDailyMetrics).set({ detailViews: 1_000 }).where(eq(placeDailyMetrics.placeId, placeId));
  expect(await getHiddenGemStatus(db, { placeId, now })).toEqual({
    eligible: false, reasons: ["EXPOSURE_ABOVE_MEDIAN"], detailViews90d: 1_000, categoryRegionMedianViews90d: 51.5,
  });
});

it("keeps all 1000 peers, inclusive 90-day metrics and zero-view peers in the median", async () => {
  const { db, placeId, prefix } = await seedPeers(1_000);
  await env.DB.prepare(`INSERT INTO place_daily_metrics(place_id,metric_date,detail_views,direction_clicks,save_actions)
    SELECT id,'2026-08-20',2,0,0 FROM places WHERE neighborhood=?`).bind(prefix).run();
  await env.DB.prepare(`INSERT INTO place_daily_metrics(place_id,metric_date,detail_views,direction_clicks,save_actions)
    SELECT id,'2026-08-19',1000000,0,0 FROM places WHERE neighborhood=?`).bind(prefix).run();
  await db.delete(placeDailyMetrics).where(eq(placeDailyMetrics.placeId, `${prefix}0999`));
  expect(await getHiddenGemStatus(db, { placeId, now })).toEqual({
    eligible: true, reasons: [], detailViews90d: 3, categoryRegionMedianViews90d: 501.5,
  });
});

it("retains the missing exposure result when the target does not exist", async () => {
  const result = await getHiddenGemStatus(createDb(env.DB), { placeId: "missing-synthetic-target", now });
  expect(result).toMatchObject({ eligible: false, detailViews90d: null, categoryRegionMedianViews90d: null });
  expect(result.reasons).toContain("EXPOSURE_DATA_MISSING");
});
