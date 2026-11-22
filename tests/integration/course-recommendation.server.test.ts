import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { recommendCourses } from "../../app/features/courses/course-recommendation.server";

describe("course recommendation service", () => {
  it("keeps a published meal and cafe course across missing, failed, and recovered parking reads", async () => {
    const key = crypto.randomUUID();
    const mealId = `course-meal-${key}`;
    const cafeId = `course-cafe-${key}`;
    const excludedCafeId = `course-excluded-cafe-${key}`;
    const hiddenId = `course-hidden-${key}`;
    const now = "2026-08-08T06:00:00.000Z";
    const insert = `INSERT INTO places (id, slug, name, status, address, neighborhood, latitude, longitude, search_text, created_at, updated_at) VALUES (?, ?, ?, ?, '광주광역시 동구', '동명동', ?, ?, ?, ?, ?)`;
    await env.DB.prepare(insert).bind(mealId, mealId, "코스 한끼", "PUBLISHED", 35.1500, 126.8500, "코스 한끼", now, now).run();
    await env.DB.prepare(insert).bind(cafeId, cafeId, "코스 카페", "PUBLISHED", 35.1510, 126.8500, "코스 카페", now, now).run();
    await env.DB.prepare(insert).bind(excludedCafeId, excludedCafeId, "추천 제외 카페", "PUBLISHED", 35.1520, 126.8500, "추천 제외 카페", now, now).run();
    await env.DB.prepare(insert).bind(hiddenId, hiddenId, "숨김 카페", "HIDDEN", 35.1510, 126.8500, "숨김 카페", now, now).run();
    await env.DB.prepare("INSERT INTO place_categories (place_id, category_id, is_primary) VALUES (?, 'cat-grill', 1), (?, 'cat-cafe-shop', 1), (?, 'cat-cafe-shop', 1), (?, 'cat-cafe-shop', 1)").bind(mealId, cafeId, excludedCafeId, hiddenId).run();
    await env.DB.prepare(
      "INSERT INTO place_liveness_states (place_id, status, recommendation_excluded, updated_at) VALUES (?, 'SUSPECTED', 1, ?)",
    ).bind(excludedCafeId, now).run();

    const db = createDb(env.DB);
    const input = {
      options: { time: "auto", mealCategories: ["grill"], second: "cafe", radiusKm: 3, parkingMode: "auto", ev: "none", weather: "normal", child: false },
      context: { latitude: 35.15, longitude: 126.85, locationSource: "USER", resolvedTime: "afternoon" },
      now: new Date(now),
    } satisfies Parameters<typeof recommendCourses>[1];
    const result = await recommendCourses(db, input);
    expect(result.courses[0]?.first.id).toBe(mealId);
    expect(result.courses[0]?.second.id).toBe(cafeId);
    expect(result.courses[0]?.parking.status).toBe("PARKING_DATA_UNAVAILABLE");
    expect(result.courses.some((course) => course.first.id === excludedCafeId || course.second.id === excludedCafeId)).toBe(false);
    expect(result.courses.some((course) => course.second.id === hiddenId)).toBe(false);

    const snapshotId = `course-parking-${key}`;
    const facilityId = `course-lot-${key}`;
    await env.DB.prepare(`INSERT INTO parking_data_snapshots (id, source, status, row_count, activated_at, created_at, updated_at)
      VALUES (?, 'PARKING', 'ACTIVE', 1, ?, ?, ?)`).bind(snapshotId, now, now, now).run();
    await env.DB.prepare(`INSERT INTO parking_facilities
      (id, snapshot_id, source_management_no, name, ownership_type, facility_type, region_code, latitude, longitude,
       weekday_open, weekday_close, saturday_open, saturday_close, holiday_open, holiday_close,
       fee_status, public_access_status, reliability_grade, reference_date, raw_payload, created_at, updated_at)
      VALUES (?, ?, ?, '합성 주차장', 'PUBLIC', 'OFF_STREET', 'GWANGJU', 35.15, 126.85,
       '00:00', '23:59', '00:00', '23:59', '00:00', '23:59',
       'FREE', 'PUBLIC', 'A', '2026-08-08', '{}', ?, ?)`).bind(facilityId, snapshotId, facilityId, now, now).run();

    // The worker pool supplies a disposable local D1. Fail the real EV join,
    // leaving the primary place rows and the active parking snapshot readable.
    await env.DB.prepare("ALTER TABLE parking_ev_links RENAME TO parking_ev_links_unavailable").run();
    try {
      const failed = await recommendCourses(db, input);
      expect(failed.courses.map(({ first, second, score }) => [first.id, second.id, score])).toEqual(
        result.courses.map(({ first, second, score }) => [first.id, second.id, score]),
      );
      expect(failed.courses[0]?.parking).toMatchObject({
        status: "PARKING_READ_FAILED", shared: null, separate: null, recommendedMode: null,
      });
    } finally {
      await env.DB.prepare("ALTER TABLE parking_ev_links_unavailable RENAME TO parking_ev_links").run();
    }

    const recovered = await recommendCourses(db, input);
    expect(recovered.courses[0]?.parking).toMatchObject({
      status: "READY", shared: { parking: { id: facilityId } },
    });
    const noEligible = await recommendCourses(db, { ...input, options: { ...input.options, ev: "required" } });
    expect(noEligible.courses[0]?.parking.status).toBe("NO_ELIGIBLE_PARKING");
  });

  it("uses contextual v2 safely when no verified hours exist", async () => {
    const result = await recommendCourses(createDb(env.DB), {
      options: { time: "dinner", mealCategories: [], second: "cafe", radiusKm: 3, parkingMode: "auto", ev: "none", weather: "normal", child: false },
      context: { latitude: 35.15, longitude: 126.85, locationSource: "USER", resolvedTime: "dinner" },
      now: new Date("2026-08-08T09:00:00.000Z"),
      useContextV2: true,
    });
    expect(result.algorithmVersion).toBe("course-context-v2");
    expect(result.courses.every((course) => course.badges.length <= 2)).toBe(true);
  });
});
