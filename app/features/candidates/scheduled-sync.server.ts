import { asc, eq } from "drizzle-orm";
import { createDb } from "../../db/client.server";
import { publicDataSyncRuns } from "../../db/schema";
import { syncPublicDataBatch, type AddressField } from "./sync.server";
import type { PublicDataSource } from "./public-data";
import { assertNaverLocalSearchEnabled, createNaverLocalSearchAdapter } from "./naver-local-search.server";
import { verifyPendingCandidatesWithNaver } from "./naver-pending-candidate-verification.server";
import { recordOperationalAlert } from "../operations/alerts.server";

const jobs: Array<{ sourceType: PublicDataSource; addressField: AddressField }> = [
  "GENERAL_RESTAURANT", "REST_CAFE", "BAKERY", "ENTERTAINMENT_BAR",
].flatMap((sourceType) => (["ROAD_NM_ADDR", "LOTNO_ADDR"] as AddressField[]).map((addressField) => ({ sourceType: sourceType as PublicDataSource, addressField })));

export async function runScheduledCandidateSync(env: Env & { DATA_GO_KR_SERVICE_KEY?: string; NAVER_API_HUB_KEY_ID?: string; NAVER_API_HUB_KEY?: string }) {
  if (!env.DATA_GO_KR_SERVICE_KEY) return;
  const db = createDb(env.DB);
  const running = await db.query.publicDataSyncRuns.findFirst({ where: eq(publicDataSyncRuns.status, "RUNNING"), orderBy: asc(publicDataSyncRuns.startedAt) });
  const job = running ? {
    sourceType: running.sourceType as PublicDataSource,
    addressField: running.addressField as AddressField,
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
}
