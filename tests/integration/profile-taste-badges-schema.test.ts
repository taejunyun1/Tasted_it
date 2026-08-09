import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { TASTE_BADGE_CATALOG } from "../../app/features/members/profile-taste-badges";

describe("profile taste badge migration", () => {
  it("seeds the three badge categories and representative definitions", async () => {
    const result = await env.DB.prepare(
      "SELECT id, category, label FROM taste_badges WHERE id IN ('food-gukbap','taste-spicy','style-old-school') ORDER BY id",
    ).all<{ id: string; category: string; label: string }>();
    expect(result.results).toEqual([
      { id: "food-gukbap", category: "FOOD", label: "국밥러" },
      { id: "style-old-school", category: "STYLE", label: "노포파" },
      { id: "taste-spicy", category: "TASTE", label: "맵부심" },
    ]);
  });

  it("keeps the migration catalog aligned with the application catalog", async () => {
    const result = await env.DB.prepare("SELECT id FROM taste_badges ORDER BY id").all<{ id: string }>();
    expect(result.results.map((row) => row.id)).toEqual(TASTE_BADGE_CATALOG.map((badge) => badge.id).sort());
  });

  it("stores the same badge from independent sources with a constrained score", async () => {
    const now = "2026-08-09T00:00:00Z";
    await env.DB.prepare(
      "INSERT OR IGNORE INTO users (id,email,display_name,role,created_at,updated_at) VALUES ('taste-schema-user','taste-schema@example.com','취향 테스트','USER',?,?)",
    ).bind(now, now).run();
    await env.DB.prepare(
      "INSERT INTO user_taste_badges (user_id,badge_id,source,score,evidence_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?),(?,?,?,?,?,?,?)",
    ).bind(
      "taste-schema-user", "food-gukbap", "USER", 0.9, "{}", now, now,
      "taste-schema-user", "food-gukbap", "INFERRED", 0.7, "{}", now, now,
    ).run();
    const result = await env.DB.prepare(
      "SELECT source, score FROM user_taste_badges WHERE user_id = 'taste-schema-user' ORDER BY source",
    ).all<{ source: string; score: number }>();
    expect(result.results).toEqual([{ source: "INFERRED", score: 0.7 }, { source: "USER", score: 0.9 }]);
    await expect(env.DB.prepare(
      "INSERT INTO user_taste_badges (user_id,badge_id,source,score,evidence_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    ).bind("taste-schema-user", "food-gukbap", "GOOGLE", 1.2, "{}", now, now).run()).rejects.toThrow();
  });
});
