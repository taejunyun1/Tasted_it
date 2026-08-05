import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { places, ratingRecomputeJobs } from "../../app/db/schema";
import { enqueueRatingRecompute } from "../../app/features/ratings/recompute.server";
import { runScheduledRatingMaintenance } from "../../app/features/ratings/scheduled-rating.server";

describe("rating scheduler", () => {
  it("processes pending jobs in a bounded maintenance run", async () => {
    const db = createDb(env.DB); const id = `scheduler-place-${crypto.randomUUID()}`; const now = "2026-08-06T12:00:00.000Z";
    await db.insert(places).values({ id, slug: id, name: id, status: "PUBLISHED", address: "광주", neighborhood: "동명동", latitude: 35.1, longitude: 126.9, searchText: id, createdAt: now, updatedAt: now });
    await enqueueRatingRecompute(db, { placeId: id, reason: "TEST", now });
    const result = await runScheduledRatingMaintenance(env, { now, jobLimit: 10 });
    expect(result.jobs).toEqual({ processed: 1, completed: 1, failed: 0 });
    expect((await db.select().from(ratingRecomputeJobs)).find((job) => job.placeId === id)?.status).toBe("COMPLETED");
  });
});
