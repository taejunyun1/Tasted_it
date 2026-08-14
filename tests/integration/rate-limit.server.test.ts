import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import {
  consumeMailRateLimit,
  hashMailRateLimitBucket,
  MAIL_RATE_LIMIT,
} from "../../app/features/security/rate-limit.server";

const now = new Date("2026-08-14T12:10:00.000Z");

describe("consumeMailRateLimit", () => {
  it("allows three email attempts and rejects the fourth with Retry-After", async () => {
    const db = createDb(env.DB);
    const email = `limit-${crypto.randomUUID()}@example.com`;

    await expect(consumeMailRateLimit(db, { route: "SIGNUP", email, ip: "203.0.113.10", now })).resolves.toEqual({ ok: true });
    await expect(consumeMailRateLimit(db, { route: "SIGNUP", email, ip: "203.0.113.10", now })).resolves.toEqual({ ok: true });
    await expect(consumeMailRateLimit(db, { route: "SIGNUP", email, ip: "203.0.113.10", now })).resolves.toEqual({ ok: true });
    await expect(consumeMailRateLimit(db, { route: "SIGNUP", email, ip: "203.0.113.10", now })).resolves.toEqual({
      ok: false,
      retryAfterSeconds: 3_000,
    });
  });

  it("keeps routes and emails independent and never stores the raw address", async () => {
    const db = createDb(env.DB);
    const email = `isolate-${crypto.randomUUID()}@example.com`;

    await consumeMailRateLimit(db, { route: "SIGNUP", email, now });
    await consumeMailRateLimit(db, { route: "SIGNUP", email, now });
    await consumeMailRateLimit(db, { route: "SIGNUP", email, now });

    await expect(consumeMailRateLimit(db, { route: "RESET_PASSWORD", email, now })).resolves.toEqual({ ok: true });
    await expect(consumeMailRateLimit(db, {
      route: "SIGNUP",
      email: `other-${crypto.randomUUID()}@example.com`,
      now,
    })).resolves.toEqual({ ok: true });

    const stored = await env.DB.prepare("SELECT bucket_hash AS bucketHash FROM rate_limit_windows").all<{ bucketHash: string }>();
    expect(stored.results.some((row) => row.bucketHash.includes("@") || row.bucketHash.includes(email))).toBe(false);
    expect(stored.results.map((row) => row.bucketHash)).toContain(
      await hashMailRateLimitBucket("email", "SIGNUP", email),
    );
  });

  it("rejects a shared IP after ten attempts across distinct emails", async () => {
    const db = createDb(env.DB);
    const ip = `198.51.100.${crypto.randomUUID().slice(0, 2)}`;

    for (let index = 0; index < MAIL_RATE_LIMIT.ipMax; index += 1) {
      await expect(consumeMailRateLimit(db, {
        route: "PLACE_CORRECTION",
        email: `ip-${index}-${crypto.randomUUID()}@example.com`,
        ip,
        now,
      })).resolves.toEqual({ ok: true });
    }

    await expect(consumeMailRateLimit(db, {
      route: "PLACE_CORRECTION",
      email: `ip-over-${crypto.randomUUID()}@example.com`,
      ip,
      now,
    })).resolves.toEqual({ ok: false, retryAfterSeconds: 3_000 });
  });
});
