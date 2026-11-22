import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { listPlaceCourseContexts } from "../../app/features/courses/place-course-context.server";

const now = "2026-08-15T03:00:00.000Z"; // Saturday noon in KST
const placeId = "course-context-place";

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM place_operating_hours WHERE place_id = ?").bind(placeId),
    env.DB.prepare("DELETE FROM place_course_contexts WHERE place_id = ?").bind(placeId),
    env.DB.prepare("DELETE FROM place_category_v5_profiles WHERE place_id = ?").bind(placeId),
    env.DB.prepare("DELETE FROM places WHERE id = ?").bind(placeId),
    env.DB.prepare("INSERT INTO places (id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES (?,?,'문맥 식당','PUBLISHED','광주광역시 동구','동구',35.15,126.85,'문맥 식당',?,?)").bind(placeId, placeId, now, now),
    env.DB.prepare("INSERT INTO place_categories (place_id,category_id,is_primary) VALUES (?,'cat-grill',1)").bind(placeId),
  ]);
});

describe("place course context", () => {
  it("uses admin-verified KST hours and constrained manual traits", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO place_operating_hours (id,place_id,weekday,opens_at,closes_at,is_closed,last_verified_at,created_at,updated_at) VALUES ('context-hours',?,6,'11:00','22:00',0,?,?,?)").bind(placeId, now, now, now),
      env.DB.prepare("INSERT INTO place_course_contexts (place_id,traits_json,source,algorithm_version,created_at,updated_at) VALUES (?,'[\"soloFriendly\",\"not-stored\"]','MANUAL','course-context-v2',?,?)").bind(placeId, now, now),
    ]);
    const contexts = await listPlaceCourseContexts(createDb(env.DB), [{ id: placeId, primaryCategory: { slug: "grill" } }], new Date(now));
    expect(contexts.get(placeId)).toMatchObject({ primaryCategorySlug: "grill", availability: "OPEN", traits: ["soloFriendly"] });
  });

  it.each([
    { label: "an undated opening interval", rows: [["11:00", "22:00", 0, ""]] },
    { label: "a malformed closing record", rows: [[null, null, 1, "2026-02-30"]] },
    { label: "mixed verification dates for one weekday", rows: [["11:00", "14:00", 0, now], ["18:00", "22:00", 0, "unknown"]] },
  ])("keeps availability unknown with $label", async ({ rows }) => {
    await env.DB.batch(rows.map(([open, close, isClosed, verifiedAt], index) =>
      env.DB.prepare(`INSERT INTO place_operating_hours (id,place_id,weekday,opens_at,closes_at,is_closed,last_verified_at,created_at,updated_at)
        VALUES (?,?,6,?,?,?,?,?,?)`).bind(`unverified-hours-${index}`, placeId, open, close, isClosed, verifiedAt, now, now),
    ));
    const contexts = await listPlaceCourseContexts(createDb(env.DB), [{ id: placeId, primaryCategory: { slug: "grill" } }], new Date(now));
    expect(contexts.get(placeId)?.availability).toBe("UNKNOWN");
  });

  it.each([101, 250])("loads the full context for %i candidates", async (count) => {
    const ids = Array.from({ length: count }, (_, index) => `course-context-${count}-${index}`);
    ids[0] += "'\\";
    const idsJson = JSON.stringify(ids);
    const defaultId = ids.at(-1)!;
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO places (id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at)
        SELECT value,value,'문맥 검증 장소','PUBLISHED','광주광역시 동구','동구',35.15,126.85,'문맥 검증 장소',?,? FROM json_each(?)`).bind(now, now, idsJson),
      env.DB.prepare(`INSERT INTO place_category_v5_profiles (place_id,primary_category_slug,secondary_category_slugs_json,traits_json,food_place_score,state,decision,algorithm_version,last_classified_at,created_at,updated_at)
        SELECT value,'ramen-detail','["sushi"]','["date"]',90,'GREEN','AUTO','category-v5',?,?,? FROM json_each(?) WHERE value <> ?`).bind(now, now, now, idsJson, defaultId),
      env.DB.prepare(`INSERT INTO place_course_contexts (place_id,traits_json,source,algorithm_version,created_at,updated_at)
        SELECT value,'["family"]','MANUAL','course-context-v2',?,? FROM json_each(?) WHERE value <> ?`).bind(now, now, idsJson, defaultId),
      env.DB.prepare(`INSERT INTO place_operating_hours (id,place_id,weekday,opens_at,closes_at,is_closed,last_verified_at,created_at,updated_at)
        SELECT 'hours-' || value,value,6,'11:00','22:00',0,?,?,? FROM json_each(?) WHERE value <> ?`).bind(now, now, now, idsJson, defaultId),
    ]);

    const candidates = ids.toReversed().map((id) => ({ id, primaryCategory: { slug: "grill" } }));
    const contexts = await listPlaceCourseContexts(createDb(env.DB), candidates, new Date(now));

    expect([...contexts.keys()]).toEqual(candidates.map(({ id }) => id));
    expect(contexts.get(defaultId)).toEqual({
      primaryCategorySlug: "grill", secondaryCategorySlugs: [], traits: [], availability: "UNKNOWN",
    });
    for (const id of ids.slice(0, -1)) {
      expect(contexts.get(id)).toEqual({
        primaryCategorySlug: "ramen-detail", secondaryCategorySlugs: ["sushi"], traits: ["family"], availability: "OPEN",
      });
    }
  });
});
