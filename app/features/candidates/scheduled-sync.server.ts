import { and, asc, desc, eq, gt } from "drizzle-orm";
import { createDb } from "../../db/client.server";
import { publicDataSyncRuns } from "../../db/schema";
import { syncPublicDataBatch, type AddressField } from "./sync.server";
import type { PublicDataSource } from "./public-data";
import { assertNaverLocalSearchEnabled, createNaverLocalSearchAdapter } from "./naver-local-search.server";
import { verifyPendingCandidatesWithNaver } from "./naver-pending-candidate-verification.server";
import { runAutoReviewPipeline } from "../places/place-review-auto-pipeline.server";
import { recordOperationalAlert } from "../operations/alerts.server";

const jobs: Array<{ sourceType: PublicDataSource; addressField: AddressField }> = [
  "GENERAL_RESTAURANT", "REST_CAFE", "BAKERY", "ENTERTAINMENT_BAR",
].flatMap((sourceType) => (["ROAD_NM_ADDR", "LOTNO_ADDR"] as AddressField[]).map((addressField) => ({ sourceType: sourceType as PublicDataSource, addressField })));

export async function runScheduledCandidateSync(env: Env & { DATA_GO_KR_SERVICE_KEY?: string; NAVER_API_HUB_KEY_ID?: string; NAVER_API_HUB_KEY?: string }) {
  if (!env.DATA_GO_KR_SERVICE_KEY) return;
  const db = createDb(env.DB);
  const running = await db.query.publicDataSyncRuns.findFirst({ where: eq(publicDataSyncRuns.status, "RUNNING"), orderBy: asc(publicDataSyncRuns.startedAt) });
  if (running && Date.now() - new Date(running.updatedAt).getTime() > 24 * 60 * 60 * 1000) {
    const now = new Date().toISOString();
    await db.update(publicDataSyncRuns).set({ status: "FAILED", errorSummary: "PUBLIC_DATA_SYNC_STALE", finishedAt: now, updatedAt: now }).where(eq(publicDataSyncRuns.id, running.id));
    await recordOperationalAlert(db, {
      alertType: "PUBLIC_DATA_SYNC", severity: "WARNING", sourceId: running.id,
      message: "24시간 이상 RUNNING으로 남은 동기화 실행을 회수했습니다.",
      details: { code: "PUBLIC_DATA_SYNC_STALE", nextPage: running.nextPage }, now,
    });
  }
  const resumable = running && running.status === "RUNNING" && Date.now() - new Date(running.updatedAt).getTime() <= 24 * 60 * 60 * 1000 ? running : null;
  const failed = resumable ? null : await db.query.publicDataSyncRuns.findFirst({
    where: and(eq(publicDataSyncRuns.status, "FAILED"), gt(publicDataSyncRuns.nextPage, 1)),
    orderBy: desc(publicDataSyncRuns.startedAt),
  });
  const resume = resumable ?? failed;
  const job = resume ? {
    sourceType: resume.sourceType as PublicDataSource,
    addressField: resume.addressField as AddressField,
  } : jobs[new Date().getUTCDate() % jobs.length];
  await syncPublicDataBatch(db, { serviceKey: env.DATA_GO_KR_SERVICE_KEY, ...job, maxPages: 5 });
  try {
    const naverEnv = {
      NAVER_LOCAL_SEARCH_ENABLED: env.NAVER_LOCAL_SEARCH_ENABLED,
      NAVER_API_HUB_KEY_ID: env.NAVER_API_HUB_KEY_ID ?? "",
      NAVER_API_HUB_KEY: env.NAVER_API_HUB_KEY ?? "",
    };
    assertNaverLocalSearchEnabled(naverEnv);
    await verifyPendingCandidatesWithNaver(db, {
      limit: 25,
      now: new Date().toISOString(),
      adapter: createNaverLocalSearchAdapter(naverEnv),
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
  if (env.REVIEW_AUTO_PIPELINE_ENABLED === "true") {
    try {
      const naverEnv = {
        NAVER_LOCAL_SEARCH_ENABLED: env.NAVER_LOCAL_SEARCH_ENABLED,
        NAVER_API_HUB_KEY_ID: env.NAVER_API_HUB_KEY_ID ?? "",
        NAVER_API_HUB_KEY: env.NAVER_API_HUB_KEY ?? "",
      };
      await runAutoReviewPipeline(db, {
        now: new Date().toISOString(),
        naverAdapter: env.NAVER_LOCAL_SEARCH_ENABLED === "true" ? createNaverLocalSearchAdapter(naverEnv) : undefined,
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
