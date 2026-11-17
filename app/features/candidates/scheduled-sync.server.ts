import { asc, inArray } from "drizzle-orm";
import { createDb } from "../../db/client.server";
import { publicDataSyncRuns } from "../../db/schema";
import { describePublicSync, syncPublicDataBatch, type AddressField } from "./sync.server";
import type { PublicDataSource } from "./public-data";
import { assertNaverLocalSearchEnabled, createNaverLocalSearchAdapter } from "./naver-local-search.server";
import { verifyPendingCandidatesWithNaver } from "./naver-pending-candidate-verification.server";
import { runAutoReviewPipeline } from "../places/place-review-auto-pipeline.server";
import { recordOperationalAlert } from "../operations/alerts.server";
import { isAutoReviewEnabled } from "../operations/admin-feature-stop.server";

const jobs: Array<{ sourceType: PublicDataSource; addressField: AddressField }> = [
  "GENERAL_RESTAURANT", "REST_CAFE", "BAKERY", "ENTERTAINMENT_BAR",
].flatMap((sourceType) => (["ROAD_NM_ADDR", "LOTNO_ADDR"] as AddressField[]).map((addressField) => ({ sourceType: sourceType as PublicDataSource, addressField })));

export async function runScheduledCandidateSync(env: Env & { DATA_GO_KR_SERVICE_KEY?: string; NAVER_API_HUB_KEY_ID?: string; NAVER_API_HUB_KEY?: string }) {
  if (!env.DATA_GO_KR_SERVICE_KEY) return;
  const db = createDb(env.DB);
  const pending = await db.select().from(publicDataSyncRuns)
    .where(inArray(publicDataSyncRuns.status, ["PENDING", "RUNNING", "FAILED"]))
    .orderBy(asc(publicDataSyncRuns.startedAt)).limit(50);
  const now = new Date().toISOString();
  if (pending.some((run) => run.leaseId && run.leaseExpiresAt && run.leaseExpiresAt > now)) return;
  const resume = pending.find((run) => describePublicSync(run, now).canResume);
  const job = resume ? { sourceType: resume.sourceType as PublicDataSource, addressField: resume.addressField as AddressField }
    : jobs[new Date().getUTCDate() % jobs.length];
  const result = await syncPublicDataBatch(db, { serviceKey: env.DATA_GO_KR_SERVICE_KEY, ...job,
    ...(resume ? { runId: resume.id } : {}), maxPages: 5 });
  // Only a claimed, non-cancelled public-data batch reaches these follow-ups.
  // NAVER verification and automatic review have separate controls; cancelling
  // a public-data run after its lease is released does not cancel those jobs.
  if (!result.claimed || result.run?.status === "CANCELLED" || result.run?.status === "FAILED") return;
  try {
    const naverEnv = {
      NAVER_LOCAL_SEARCH_ENABLED: env.NAVER_LOCAL_SEARCH_ENABLED,
      NAVER_LOCAL_SEARCH_DAILY_LIMIT: env.NAVER_LOCAL_SEARCH_DAILY_LIMIT,
      NAVER_API_HUB_KEY_ID: env.NAVER_API_HUB_KEY_ID ?? "",
      NAVER_API_HUB_KEY: env.NAVER_API_HUB_KEY ?? "",
    };
    assertNaverLocalSearchEnabled(naverEnv);
    await verifyPendingCandidatesWithNaver(db, {
      limit: 25,
      now: new Date().toISOString(),
      adapter: createNaverLocalSearchAdapter(naverEnv, { database: env.DB }),
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "NAVER_LOCAL_SEARCH_UNAVAILABLE";
    if (code === "NAVER_LOCAL_SEARCH_DISABLED") return;
    await recordOperationalAlert(db, {
      alertType: "NAVER_LOCAL_SEARCH",
      severity: "WARNING",
      sourceId: null,
      message: "동기화 후 NAVER 후보 검증을 완료하지 못했습니다.",
      details: { code },
      now: new Date().toISOString(),
    });
  }
  if (await isAutoReviewEnabled(env.DB,env.REVIEW_AUTO_PIPELINE_ENABLED)) {
    try {
      const naverEnv = {
        NAVER_LOCAL_SEARCH_ENABLED: env.NAVER_LOCAL_SEARCH_ENABLED,
        NAVER_LOCAL_SEARCH_DAILY_LIMIT: env.NAVER_LOCAL_SEARCH_DAILY_LIMIT,
        NAVER_API_HUB_KEY_ID: env.NAVER_API_HUB_KEY_ID ?? "",
        NAVER_API_HUB_KEY: env.NAVER_API_HUB_KEY ?? "",
      };
      await runAutoReviewPipeline(db, {
        now: new Date().toISOString(),
        naverAdapter: env.NAVER_LOCAL_SEARCH_ENABLED === "true" ? createNaverLocalSearchAdapter(naverEnv, { database: env.DB }) : undefined,
        confidentAdvanceEnabled: env.REVIEW_CONFIDENT_ADVANCE_ENABLED === "true",
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "REVIEW_AUTO_PIPELINE_ERROR";
      await recordOperationalAlert(db, {
        alertType: "PUBLIC_DATA_SYNC",
        severity: "WARNING",
        sourceId: "review-auto-pipeline",
        message: "동기화 후 검수 파이프라인 자동 진행을 완료하지 못했습니다.",
        details: { code },
        now: new Date().toISOString(),
      });
    }
  }
}
