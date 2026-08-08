import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { recommendCourses } from "../../app/features/courses/course-recommendation.server";

describe("course recommendation service", () => {
  it("keeps a published meal and cafe course when parking data is unavailable", async () => {
    const key = crypto.randomUUID();
    const mealId = `course-meal-${key}`;
    const cafeId = `course-cafe-${key}`;
    const hiddenId = `course-hidden-${key}`;
    const now = "2026-08-08T06:00:00.000Z";
    const insert = `INSERT INTO places (id, slug, name, status, address, neighborhood, latitude, longitude, search_text, created_at, updated_at) VALUES (?, ?, ?, ?, '광주광역시 동구', '동명동', ?, ?, ?, ?, ?)`;
    await env.DB.prepare(insert).bind(mealId, mealId, "코스 한끼", "PUBLISHED", 35.1500, 126.8500, "코스 한끼", now, now).run();
    await env.DB.prepare(insert).bind(cafeId, cafeId, "코스 카페", "PUBLISHED", 35.1510, 126.8500, "코스 카페", now, now).run();
    await env.DB.prepare(insert).bind(hiddenId, hiddenId, "숨김 카페", "HIDDEN", 35.1510, 126.8500, "숨김 카페", now, now).run();
    await env.DB.prepare("INSERT INTO place_categories (place_id, category_id, is_primary) VALUES (?, 'cat-grill', 1), (?, 'cat-cafe-shop', 1), (?, 'cat-cafe-shop', 1)").bind(mealId, cafeId, hiddenId).run();

    const result = await recommendCourses(createDb(env.DB), {
      options: { time: "auto", mealCategories: ["grill"], second: "cafe", radiusKm: 3, parkingMode: "auto", ev: "none", weather: "normal", child: false },
      context: { latitude: 35.15, longitude: 126.85, locationSource: "USER", resolvedTime: "afternoon" },
      now: new Date(now),
    });
    expect(result.courses[0]?.first.id).toBe(mealId);
    expect(result.courses[0]?.second.id).toBe(cafeId);
    expect(result.courses[0]?.parking.status).toBe("PARKING_DATA_UNAVAILABLE");
    expect(result.courses.some((course) => course.second.id === hiddenId)).toBe(false);
  });
});
