import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { placeRevalidationCases, places } from "../../app/db/schema";
import { runScheduledPlaceMaintenance } from "../../app/features/places/scheduled-place.server";

describe("place maintenance scheduler", () => {
  it("queues stale published places without exposing hidden places", async () => {
    const db = createDb(env.DB); const now = "2026-08-06T12:00:00.000Z";
    await db.insert(places).values({ id: "stale-scheduled", slug: "stale-scheduled", name: "오래된 공개 장소", status: "PUBLISHED", address: "광주", neighborhood: "동명동", latitude: 35.1, longitude: 126.9, searchText: "오래된 공개 장소", lastVerifiedAt: "2026-01-01T00:00:00.000Z", createdAt: now, updatedAt: now });
    const result = await runScheduledPlaceMaintenance(env, { now });
    expect(result).toMatchObject({ scanned: 1, created: 1 });
    expect((await db.select().from(placeRevalidationCases)).some((item) => item.placeId === "stale-scheduled")).toBe(true);
  });
});
