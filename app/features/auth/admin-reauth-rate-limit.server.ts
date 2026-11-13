import { sha256Hex } from "./google-oauth.server";
import type { AdminSession } from "./admin-assurance.server";

export async function consumeAdminReauthRateLimit(database: D1Database, input: AdminSession & {
  kind: "SEND" | "VERIFY"; ip: string | null; now: Date;
}) {
  const windowMs = input.kind === "SEND" ? 60 * 60 * 1000 : 15 * 60 * 1000;
  const maximum = input.kind === "SEND" ? 3 : 10;
  const started = new Date(Math.floor(input.now.getTime() / windowMs) * windowMs).toISOString();
  for (const value of [`actor:${input.actorUserId}`, ...(input.ip ? [`ip:${input.ip}`] : [])]) {
    const hash = await sha256Hex(`admin-reauth:${input.kind}:${value}`);
    const row = await database.prepare(`INSERT INTO rate_limit_windows (bucket_hash, window_started_at, attempt_count)
      VALUES (?, ?, 1) ON CONFLICT(bucket_hash, window_started_at)
      DO UPDATE SET attempt_count = attempt_count + 1 RETURNING attempt_count AS count`)
      .bind(hash, started).first<{ count: number }>();
    if (!row || row.count > maximum) return false;
  }
  return true;
}
