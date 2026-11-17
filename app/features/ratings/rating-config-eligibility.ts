import { sql } from "drizzle-orm";
import { RATING_V2_VERSION } from "./rating-v2";

// One scalar selection for ORM predicates and raw D1 CAS. Version is a compiled
// allowlist, never a request/config value. A non-NULL end retains retired status.
const prefix = `(SELECT id FROM rating_configs WHERE active_until IS NULL AND algorithm_version='${RATING_V2_VERSION}' AND julianday(active_from)<=julianday(`;
const suffix = ") ORDER BY julianday(active_from) DESC,id ASC LIMIT 1)";
export const CURRENT_RATING_CONFIG_ID_SQL = `${prefix}?${suffix}`;
export function currentRatingConfigIdSql(now: string) {
  const parsed = new Date(now);
  if (!Number.isFinite(parsed.getTime())) throw new Error("RATING_CONFIG_TIME_INVALID");
  return sql`${sql.raw(prefix)}${parsed.toISOString()}${sql.raw(suffix)}`;
}
