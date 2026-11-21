import { desc } from "drizzle-orm";
import type { AppDb } from "../../db/client.server";
import { ratingConfigs } from "../../db/schema";
import { getActiveRatingConfig } from "./rating-config.server";
import { RATING_V2_POLICY, RATING_V2_VERSION } from "./rating-v2";

type Config = typeof ratingConfigs.$inferSelect;
const POLICY_FIELDS = [
  ["minimumVisibleSamples", "점수 공개 최소 표본", "REVIEWER_CONSENSUS"],
  ["alphaPrior", "Beta 사전값 α", "METADATA_ONLY"],
  ["betaPrior", "Beta 사전값 β", "METADATA_ONLY"],
  ["reviewerMaxShare", "일반표 존재 시 리뷰어 최대 비중", "METADATA_ONLY"],
] as const;
function state(config: Config, now: string) {
  const start = Date.parse(config.activeFrom), end = config.activeUntil === null ? null : Date.parse(config.activeUntil);
  if (!Number.isFinite(start) || (end !== null && (!Number.isFinite(end) || end <= start))) return "INVALID_TIME" as const;
  if (start > Date.parse(now)) return "FUTURE" as const;
  if (end !== null && end <= Date.parse(now)) return "ENDED" as const;
  return "CURRENT_WINDOW" as const;
}
export async function readAdminRatingConfig(db: AppDb, now: string) {
  if (!Number.isFinite(Date.parse(now))) throw new Error("RATING_CONFIG_TIME_INVALID");
  const [rows, selected] = await Promise.all([
    db.select().from(ratingConfigs).orderBy(desc(ratingConfigs.activeFrom)).limit(51),
    getActiveRatingConfig(db, now).catch((error: unknown) => {
      if (error instanceof Error && error.message === "ACTIVE_RATING_CONFIG_NOT_FOUND") return null;
      throw error;
    }),
  ]);
  const warnings: string[] = [];
  if (!selected) warnings.push("NO_SELECTED_CONFIG");
  if (selected && state(selected, now) === "FUTURE") warnings.push("SELECTED_FUTURE_CONFIG");
  if (selected && state(selected, now) === "INVALID_TIME") warnings.push("SELECTED_INVALID_TIME");
  if (selected && selected.algorithmVersion !== RATING_V2_VERSION) warnings.push("SELECTED_UNSUPPORTED_VERSION");
  const fields = POLICY_FIELDS.map(([key, label, databaseConsumer]) => ({
    key, label, databaseConsumer, runtimeValue: RATING_V2_POLICY[key],
    selectedValue: selected?.[key] ?? null,
    matching: selected ? selected[key] === RATING_V2_POLICY[key] : null,
  }));
  if (fields.some(field => field.matching === false)) warnings.push("SELECTED_POLICY_DIFFERS");
  return {
    checkedAt: now, selectedConfigId: selected?.id ?? null, effectiveVersion: RATING_V2_VERSION,
    effectivePolicy: RATING_V2_POLICY, fields, warnings, truncated: rows.length > 50,
    configs: rows.slice(0, 50).map(config => ({
      id: config.id, algorithmVersion: config.algorithmVersion,
      activeFrom: config.activeFrom, activeUntil: config.activeUntil,
      state: state(config, now), selectedByRuntime: config.id === selected?.id,
      versionSupported: config.algorithmVersion === RATING_V2_VERSION,
      policyMatches: POLICY_FIELDS.every(([key]) => config[key] === RATING_V2_POLICY[key]),
    })),
    activation: "POLICY_REQUIRED" as const,
  };
}
