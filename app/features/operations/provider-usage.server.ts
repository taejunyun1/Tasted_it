import { z } from "zod";
import { LAUNCH_NAVER_DAILY_BUDGET_TOTAL, getRegionPack, type RegionCode } from "../regions/region-pack";

export type NaverAttemptSource = "PENDING_VERIFICATION" | "CATEGORY_REVERIFICATION" | "PLACE_LIVENESS" | "TEMP_GEOCODE" | "CATEGORY_V2";
export type NaverAttemptContext = { source: NaverAttemptSource; runId?: string };
export type ProviderEnv = { NAVER_LOCAL_SEARCH_DAILY_LIMIT?: string; NAVER_LOCAL_SEARCH_ENABLED?: string; NAVER_API_HUB_KEY_ID?: string; NAVER_API_HUB_KEY?: string };
const provider = "NAVER_LOCAL_SEARCH";
const sourceSchema = z.enum(["PENDING_VERIFICATION", "CATEGORY_REVERIFICATION", "PLACE_LIVENESS", "TEMP_GEOCODE", "CATEGORY_V2"]);
export class NaverAccountingError extends Error {
  constructor(readonly code: "NAVER_LOCAL_SEARCH_QUOTA" | "NAVER_ACCOUNTING_UNAVAILABLE") { super(code); }
}
export function effectiveNaverGlobalLimit(env: ProviderEnv) {
  const value = env.NAVER_LOCAL_SEARCH_DAILY_LIMIT;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) return null;
  return Math.min(Number(value), LAUNCH_NAVER_DAILY_BUDGET_TOTAL);
}
export function utcDay(value: string) {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new NaverAccountingError("NAVER_ACCOUNTING_UNAVAILABLE");
  return value.slice(0, 10);
}
export async function reserveNaverAttempt(database: D1Database, input: { regionCode: RegionCode; context: NaverAttemptContext; now: string; env: ProviderEnv; regionalLimit?: number }) {
  const day = utcDay(input.now), limit = effectiveNaverGlobalLimit(input.env);
  if (!limit || !["GWANGJU", "JEONNAM"].includes(input.regionCode) || !sourceSchema.safeParse(input.context?.source).success
    || input.context.runId !== undefined && (typeof input.context.runId !== "string" || !input.context.runId || input.context.runId.length > 128)) throw new NaverAccountingError("NAVER_ACCOUNTING_UNAVAILABLE");
  const regionLimit = Math.min(input.regionalLimit ?? getRegionPack(input.regionCode).naverDailyBudget, getRegionPack(input.regionCode).naverDailyBudget);
  if (!Number.isSafeInteger(regionLimit) || regionLimit < 1) throw new NaverAccountingError("NAVER_ACCOUNTING_UNAVAILABLE");
  const id = crypto.randomUUID(), regionalColumn = input.regionCode === "GWANGJU" ? "gwangju" : "jeonnam";
  try {
    const result = await database.batch([
      database.prepare(`INSERT INTO provider_daily_quotas(provider,utc_day,baseline_at,baseline_source,cutover_state,created_at,updated_at)
        SELECT ?,?,?,'EMPTY_NEW_DAY','READY',?,? WHERE EXISTS(SELECT 1 FROM provider_daily_quotas WHERE provider=? AND is_cutover_anchor=1 AND cutover_receipt_ref IS NOT NULL AND length(trim(cutover_receipt_ref)) BETWEEN 1 AND 512 AND cutover_verified_at<=? AND ready_after_utc_day<=?) ON CONFLICT DO NOTHING`)
        .bind(provider, day, input.now, input.now, input.now, provider, input.now, day),
      database.prepare(`UPDATE provider_daily_quotas SET reserved_total=reserved_total+1,reserved_${regionalColumn}=reserved_${regionalColumn}+1,last_reservation_id=?,updated_at=?
        WHERE provider=? AND utc_day=? AND cutover_state='READY' AND legacy_total+reserved_total<? AND legacy_${regionalColumn}+reserved_${regionalColumn}<?
        AND EXISTS(SELECT 1 FROM provider_daily_quotas WHERE provider=? AND is_cutover_anchor=1 AND cutover_receipt_ref IS NOT NULL AND length(trim(cutover_receipt_ref)) BETWEEN 1 AND 512 AND cutover_verified_at<=? AND ready_after_utc_day<=?)`)
        .bind(id, input.now, provider, day, limit, regionLimit, provider, input.now, day),
      database.prepare(`INSERT INTO provider_call_attempts(id,provider,utc_day,region_code,source,run_id,reserved_at)
        SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM provider_daily_quotas WHERE provider=? AND utc_day=? AND last_reservation_id=?)`)
        .bind(id, provider, day, input.regionCode, input.context.source, input.context.runId ?? null, input.now, provider, day, id),
    ]);
    if (result[2]!.meta.changes !== 1) throw new NaverAccountingError("NAVER_LOCAL_SEARCH_QUOTA");
  } catch (error) {
    if (error instanceof NaverAccountingError) throw error;
    throw new NaverAccountingError("NAVER_ACCOUNTING_UNAVAILABLE");
  }
  return { id, utcDay: day };
}
export async function markNaverDispatch(database: D1Database, id: string, now: string) {
  try {
    const result = await database.prepare("UPDATE provider_call_attempts SET dispatch_started_at=? WHERE id=? AND utc_day=? AND outcome='PENDING' AND dispatch_started_at IS NULL")
      .bind(now, id, utcDay(now)).run();
    if (result.meta.changes !== 1) throw new Error("dispatch unavailable");
  } catch { throw new NaverAccountingError("NAVER_ACCOUNTING_UNAVAILABLE"); }
}
export async function settleNaverAttempt(database: D1Database, input: { id: string; now: string; outcome: "SUCCEEDED" | "FAILED" | "UNKNOWN"; failureCode?: string }) {
  const safeCodes = ["NAVER_LOCAL_SEARCH_TIMEOUT", "NAVER_LOCAL_SEARCH_QUOTA", "NAVER_LOCAL_SEARCH_REJECTED", "NAVER_LOCAL_SEARCH_UNAVAILABLE", "NAVER_LOCAL_SEARCH_RESPONSE_INVALID", "UTC_DAY_CHANGED"];
  utcDay(input.now);
  if (input.failureCode && !safeCodes.includes(input.failureCode)) throw new NaverAccountingError("NAVER_ACCOUNTING_UNAVAILABLE");
  try {
    await database.prepare("UPDATE provider_call_attempts SET outcome=?,finished_at=?,failure_code=? WHERE id=? AND outcome='PENDING'")
      .bind(input.outcome, input.now, input.failureCode ?? null, input.id).run();
  } catch { throw new NaverAccountingError("NAVER_ACCOUNTING_UNAVAILABLE"); }
}
export async function countNaverDispatches(database: D1Database, runId: string) {
  const row = await database.prepare("SELECT count(*) AS n FROM provider_call_attempts WHERE run_id=? AND dispatch_started_at IS NOT NULL").bind(runId).first<{ n: number }>();
  return row?.n ?? 0;
}
export async function readProviderUsage(database: D1Database, input: { now: string; env: ProviderEnv }) {
  const day = utcDay(input.now), global = effectiveNaverGlobalLimit(input.env);
  const [row, anchor, counts] = await Promise.all([
    database.prepare("SELECT * FROM provider_daily_quotas WHERE provider=? AND utc_day=?").bind(provider, day).first<Record<string, number | string | null>>(),
    database.prepare("SELECT cutover_verified_at,ready_after_utc_day,cutover_receipt_ref FROM provider_daily_quotas WHERE provider=? AND is_cutover_anchor=1").bind(provider).first<{ cutover_verified_at: string | null; ready_after_utc_day: string | null; cutover_receipt_ref: string | null }>(),
    database.prepare(`SELECT count(*) FILTER(WHERE dispatch_started_at IS NOT NULL) AS dispatched,count(*) FILTER(WHERE outcome='SUCCEEDED') AS succeeded,count(*) FILTER(WHERE outcome='FAILED') AS failed,count(*) FILTER(WHERE outcome='UNKNOWN') AS unknown,count(*) FILTER(WHERE outcome='PENDING') AS pending FROM provider_call_attempts WHERE provider=? AND utc_day=?`)
      .bind(provider, day).first<{ dispatched: number; succeeded: number; failed: number; unknown: number; pending: number }>(),
  ]);
  const triple = (prefix: string) => ({ global: Number(row?.[`${prefix}_total`] ?? 0), GWANGJU: Number(row?.[`${prefix}_gwangju`] ?? 0), JEONNAM: Number(row?.[`${prefix}_jeonnam`] ?? 0) });
  const legacy = triple("legacy"), reserved = triple("reserved");
  const used = { global: legacy.global + reserved.global, GWANGJU: legacy.GWANGJU + reserved.GWANGJU, JEONNAM: legacy.JEONNAM + reserved.JEONNAM };
  const limits = { global, GWANGJU: getRegionPack("GWANGJU").naverDailyBudget, JEONNAM: getRegionPack("JEONNAM").naverDailyBudget };
  const proofValid = Boolean(anchor?.cutover_receipt_ref && anchor.cutover_receipt_ref.trim().length > 0 && anchor.cutover_receipt_ref.trim().length <= 512);
  const verified = Boolean(proofValid && anchor?.cutover_verified_at && anchor.cutover_verified_at <= input.now && anchor.ready_after_utc_day && anchor.ready_after_utc_day <= day);
  return { utcDay: day, queriedAt: input.now, naver: { cutoverState: verified && (!row || row.cutover_state === "READY") ? "READY" as const : "HOLD" as const,
    cutoverVerified: Boolean(proofValid && anchor?.cutover_verified_at), readyAfterUtcDay: anchor?.ready_after_utc_day ?? null,
    limits, legacy, reserved, used, remaining: { global: global === null ? null : Math.max(0, global - used.global), GWANGJU: Math.max(0, limits.GWANGJU - used.GWANGJU), JEONNAM: Math.max(0, limits.JEONNAM - used.JEONNAM) },
    attempts: counts ?? { dispatched: 0, succeeded: 0, failed: 0, unknown: 0, pending: 0 }, configured: Boolean(input.env.NAVER_API_HUB_KEY?.trim() && input.env.NAVER_API_HUB_KEY_ID?.trim()), enabled: input.env.NAVER_LOCAL_SEARCH_ENABLED === "true", configValid: global !== null } };
}
