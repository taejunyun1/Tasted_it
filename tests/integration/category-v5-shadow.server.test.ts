import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { runCategoryV5Shadow } from "../../app/features/candidates/category-v5-shadow.server";

describe("v5 shadow classification", () => {
  it("stores up to 100 derived profiles without changing the public category", async () => {
    const id = `v5-shadow-${crypto.randomUUID()}`;
    const now = "2026-08-15T04:00:00.000Z";
    await env.DB.batch([
      env.DB.prepare("INSERT INTO places (id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES (?,?,?,'PUBLISHED','광주광역시 서구 화정동','화정동',35.15,126.85,?,?,?)").bind(id, id, "그림자 숯불구이", "그림자 숯불구이", now, now),
      env.DB.prepare("INSERT INTO business_licenses (id,source_type,source_management_no,region_code,business_name,business_subtype,normalized_status,raw_payload,review_status,first_seen_at,last_seen_at,created_at,updated_at) VALUES (?,'GENERAL_RESTAURANT',?,'GWANGJU','그림자 숯불구이','식육(숯불구이)','OPEN','{}','APPROVED',?,?,?,?)").bind(`${id}-source`, `${id}-management`, now, now, now, now),
      env.DB.prepare("INSERT INTO place_source_links (id,place_id,business_license_id,is_primary,created_at) VALUES (?,?,?,1,?)").bind(`${id}-link`, id, `${id}-source`, now),
      env.DB.prepare("INSERT INTO place_categories (place_id,category_id,is_primary) VALUES (?,'cat-home-meal',1)").bind(id),
    ]);
    const result = await runCategoryV5Shadow(createDb(env.DB), { placeIds: [id], limit: 1, now });
    expect(result.scannedCount).toBe(1);
    const profile = await env.DB.prepare("SELECT primary_category_slug FROM place_category_v5_profiles WHERE place_id = ?").bind(id).first<{ primary_category_slug: string }>();
    const category = await env.DB.prepare("SELECT category_id FROM place_categories WHERE place_id = ? AND is_primary = 1").bind(id).first<{ category_id: string }>();
    expect(profile?.primary_category_slug).toBe("grill");
    expect(category?.category_id).toBe("cat-home-meal");
  });
});
