import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { userTasteBadges, users } from "../../app/db/schema";
import { getMemberTasteProfile } from "../../app/features/members/profile-taste.server";

describe("member taste profile", () => {
  it("combines stored user signals with current activity inference", async () => {
    const db = createDb(env.DB);
    const suffix = crypto.randomUUID();
    const userId = `taste-profile-${suffix}`;
    const now = "2026-08-09T00:00:00Z";
    await db.insert(users).values({
      id: userId,
      email: `${suffix}@example.com`,
      displayName: "태준",
      role: "USER",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(userTasteBadges).values({
      userId,
      badgeId: "style-old-school",
      source: "USER",
      score: 0.91,
      evidenceJson: JSON.stringify({ selected: true }),
      createdAt: now,
      updatedAt: now,
    });

    const profile = await getMemberTasteProfile(db, {
      userId,
      displayName: "태준",
      saved: [{ name: "시장 국밥", categoryName: "국밥·해장국" }],
      rated: [{ name: "시장 국밥", categoryName: "국밥·해장국", value: 1 }],
      tasteGraph: { status: "LEARNING", placeCount: 0, dimensions: [] },
    });

    expect(profile.headline).toBe("오래된 식당에서 국밥을 찾는 태준");
    expect(profile.badges.map((badge) => badge.label)).toEqual(expect.arrayContaining(["노포파", "국밥러", "시장맛집파"]));
    expect(profile.vector.find((badge) => badge.id === "style-old-school")?.sources).toEqual(["USER"]);
  });
});
