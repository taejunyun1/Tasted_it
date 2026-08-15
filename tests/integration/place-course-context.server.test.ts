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
});
