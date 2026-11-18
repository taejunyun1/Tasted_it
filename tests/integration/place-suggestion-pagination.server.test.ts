import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { placeSuggestions, users } from "../../app/db/schema";
import { listReviewablePlaceSuggestions } from "../../app/features/places/place-suggestion.server";

describe("member suggestion review pagination", () => {
  it("counts only reviewable suggestions and reaches the 201st without an unbounded response", async () => {
    const db = createDb(env.DB);
    const prefix = `suggestion-pages-${crypto.randomUUID()}`;
    const now = "2026-11-18T00:00:00.000Z";
    const category = await db.query.categories.findFirst();
    if (!category) throw new Error("category fixture missing");
    expect(await listReviewablePlaceSuggestions(db, 9)).toEqual({ rows: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 } });
    await db.insert(users).values({ id: prefix, email: `${prefix}@example.com`, displayName: "합성 제안자", role: "USER", emailVerifiedAt: now, createdAt: now, updatedAt: now });
    for (let index = 0; index < 202; index += 1) {
      const suffix = String(index).padStart(3, "0");
      await db.insert(placeSuggestions).values({
        id: `${prefix}-${suffix}`, userId: prefix, name: `합성 제안 ${suffix}`, normalizedName: `합성제안${suffix}`,
        address: "광주광역시 동구 합성로 1", normalizedAddress: "광주광역시동구합성로1", neighborhood: "합성동",
        categoryId: category.id, status: index === 201 ? "REJECTED" : index % 3 === 0 ? "NEEDS_INFO" : index % 3 === 1 ? "REVIEWING" : "SUBMITTED",
        createdAt: now, updatedAt: now,
      });
    }
    const first = await listReviewablePlaceSuggestions(db, 1);
    const last = await listReviewablePlaceSuggestions(db, 9);
    expect(first.pagination).toEqual({ page: 1, pageSize: 25, total: 201, totalPages: 9 });
    expect(first.rows).toHaveLength(25);
    expect(last.pagination).toEqual({ page: 9, pageSize: 25, total: 201, totalPages: 9 });
    expect(last.rows.map(row => row.id)).toEqual([`${prefix}-200`]);
    expect(last.rows[0]).not.toHaveProperty("userId");
    expect(last.rows[0]).not.toHaveProperty("phone");
    const oversized = await listReviewablePlaceSuggestions(db, Number.MAX_SAFE_INTEGER);
    expect(oversized.pagination.page).toBe(9);
    expect(oversized.rows.map(row => row.id)).toEqual([`${prefix}-200`]);
    expect((await listReviewablePlaceSuggestions(db, NaN)).pagination.page).toBe(1);
  });
});
