import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { savePlaceCategoryV5Profile } from "../../app/features/candidates/category-v5-profile.server";

const now = "2026-08-15T04:00:00.000Z";

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM place_category_v5_profiles WHERE place_id = 'v5-profile-place'"),
    env.DB.prepare("DELETE FROM places WHERE id = 'v5-profile-place'"),
    env.DB.prepare("INSERT INTO places (id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES ('v5-profile-place','v5-profile-place','신 돼지세끼','PUBLISHED','광주광역시 서구 화정동 1','화정동',35.15,126.92,'신 돼지세끼',?,?)").bind(now, now),
  ]);
});

describe("place category v5 profile", () => {
  it("persists only a derived shadow profile without mutating public categories", async () => {
    const db = createDb(env.DB);
    await savePlaceCategoryV5Profile(db, {
      placeId: "v5-profile-place",
      businessName: "신 돼지세끼",
      businessSubtype: "식육(숯불구이)",
      sourceType: "GENERAL_RESTAURANT",
      now,
      mode: "SHADOW",
    });
    const stored = await env.DB.prepare("SELECT primary_category_slug, state, decision, algorithm_version, evidence_codes_json FROM place_category_v5_profiles WHERE place_id = 'v5-profile-place'").first<Record<string, string>>();
    expect(stored).toMatchObject({ primary_category_slug: "grill", state: "GREEN", decision: "AUTO", algorithm_version: "place-category-v5" });
    expect(stored?.evidence_codes_json).not.toContain("신 돼지세끼");
  });

  it("keeps the most recent v5 profile idempotently", async () => {
    const db = createDb(env.DB);
    await savePlaceCategoryV5Profile(db, { placeId: "v5-profile-place", businessName: "신 돼지세끼", businessSubtype: "식육(숯불구이)", sourceType: "GENERAL_RESTAURANT", now, mode: "SHADOW" });
    await savePlaceCategoryV5Profile(db, { placeId: "v5-profile-place", businessName: "신 돼지세끼", businessSubtype: "식육(숯불구이)", sourceType: "GENERAL_RESTAURANT", now: "2026-08-15T05:00:00.000Z", mode: "SHADOW" });
    const count = await env.DB.prepare("SELECT count(*) AS count FROM place_category_v5_profiles WHERE place_id = 'v5-profile-place'").first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it("persists bounded NAVER evidence without persisting provider content", async () => {
    const db = createDb(env.DB);
    await savePlaceCategoryV5Profile(db, {
      placeId: "v5-profile-place", businessName: "신 돼지세끼", businessSubtype: "식육(숯불구이)", sourceType: "GENERAL_RESTAURANT", now, mode: "SHADOW",
      verification: {
        naver: { status: "VERIFIED", categorySlug: "grill", categoryVerification: "SPECIFIC", placeType: "FOOD", matchKind: "NAME_ADDRESS", distanceMeters: 0, evidenceCodes: ["NAVER_EXACT_ADDRESS"] },
        ai: null,
      },
    });
    const stored = await env.DB.prepare("SELECT reason_codes_json FROM place_category_v5_profiles WHERE place_id = 'v5-profile-place'").first<{ reason_codes_json: string }>();
    expect(stored?.reason_codes_json).toContain("NAVER_V2_SPECIFIC_MATCH");
    expect(stored?.reason_codes_json).not.toContain("광주광역시");
  });
});
