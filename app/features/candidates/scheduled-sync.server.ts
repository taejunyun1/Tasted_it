import { asc, eq } from "drizzle-orm";
import { createDb } from "../../db/client.server";
import { publicDataSyncRuns } from "../../db/schema";
import { syncPublicDataBatch, type AddressField } from "./sync.server";
import type { PublicDataSource } from "./public-data";

const jobs: Array<{ sourceType: PublicDataSource; addressField: AddressField }> = [
  "GENERAL_RESTAURANT", "REST_CAFE", "BAKERY", "ENTERTAINMENT_BAR",
].flatMap((sourceType) => (["ROAD_NM_ADDR", "LOTNO_ADDR"] as AddressField[]).map((addressField) => ({ sourceType: sourceType as PublicDataSource, addressField })));

export async function runScheduledCandidateSync(env: Env & { DATA_GO_KR_SERVICE_KEY?: string }) {
  if (!env.DATA_GO_KR_SERVICE_KEY) return;
  const db = createDb(env.DB);
  const running = await db.query.publicDataSyncRuns.findFirst({ where: eq(publicDataSyncRuns.status, "RUNNING"), orderBy: asc(publicDataSyncRuns.startedAt) });
  const job = running ? {
    sourceType: running.sourceType as PublicDataSource,
    addressField: running.addressField as AddressField,
  } : jobs[new Date().getUTCDate() % jobs.length];
  await syncPublicDataBatch(db, { serviceKey: env.DATA_GO_KR_SERVICE_KEY, ...job, maxPages: 5 });
}
