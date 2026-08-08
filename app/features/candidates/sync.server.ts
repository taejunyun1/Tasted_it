import { and, desc, eq } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { publicDataSyncRuns } from "../../db/schema";
import { upsertBusinessLicense } from "./candidate.server";
import { recordOperationalAlert } from "../operations/alerts.server";
import {
  buildPublicDataUrl,
  normalizePublicDataItem,
  parsePublicDataResponse,
  publicDataSources,
  type PublicDataSource,
} from "./public-data";

export type AddressField = "ROAD_NM_ADDR" | "LOTNO_ADDR";

export async function syncPublicDataBatch(db: AppDb, input: {
  serviceKey: string;
  sourceType: PublicDataSource;
  regionCode?: "GWANGJU_JEONNAM";
  addressField: AddressField;
  fetcher?: typeof fetch;
  maxPages?: number;
  now?: string;
}) {
  if (!input.serviceKey.trim()) throw new Error("DATA_GO_KR_SERVICE_KEY_REQUIRED");
  const now = input.now ?? new Date().toISOString();
  const fetcher = input.fetcher ?? fetch;
  const syncRegion = "GWANGJU_JEONNAM";
  const existing = await db.query.publicDataSyncRuns.findFirst({
    where: and(
      eq(publicDataSyncRuns.sourceType, input.sourceType),
      eq(publicDataSyncRuns.regionCode, syncRegion),
      eq(publicDataSyncRuns.addressField, input.addressField),
      eq(publicDataSyncRuns.status, "RUNNING"),
    ),
    orderBy: desc(publicDataSyncRuns.startedAt),
  });
  const runId = existing?.id ?? crypto.randomUUID();
  let page = existing?.nextPage ?? 1;
  let fetched = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let excluded = 0;
  let totalCount = existing?.totalCount ?? 0;
  if (!existing) {
    await db.insert(publicDataSyncRuns).values({
      id: runId, sourceType: input.sourceType, regionCode: syncRegion,
      addressField: input.addressField, status: "RUNNING", nextPage: 1,
      startedAt: now, createdAt: now, updatedAt: now,
    });
  }

  try {
    for (let offset = 0; offset < (input.maxPages ?? 5); offset += 1) {
      const url = buildPublicDataUrl({
        baseUrl: publicDataSources[input.sourceType], serviceKey: input.serviceKey,
        pageNo: page, numOfRows: 100, addressField: input.addressField,
        addressPrefix: "전남광주통합특별시",
      });
      const response = await fetcher(url, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`PUBLIC_DATA_HTTP_${response.status}`);
      const parsed = parsePublicDataResponse(await response.json());
      totalCount = parsed.totalCount;
      for (const raw of parsed.items) {
        fetched += 1;
        const item = normalizePublicDataItem(input.sourceType, raw);
        if (!item) { skipped += 1; continue; }
        const result = await upsertBusinessLicense(db, item, now);
        if (result.excluded) excluded += 1;
        if (result.inserted) inserted += 1; else updated += 1;
      }
      page += 1;
      if ((page - 1) * 100 >= totalCount || parsed.items.length === 0) break;
    }
    const completed = (page - 1) * 100 >= totalCount || totalCount === 0;
    await db.update(publicDataSyncRuns).set({
      status: completed ? "COMPLETED" : "RUNNING", nextPage: page, totalCount,
      fetchedCount: (existing?.fetchedCount ?? 0) + fetched,
      insertedCount: (existing?.insertedCount ?? 0) + inserted,
      updatedCount: (existing?.updatedCount ?? 0) + updated,
      skippedCount: (existing?.skippedCount ?? 0) + skipped,
      finishedAt: completed ? now : null, updatedAt: now, errorSummary: null,
    }).where(eq(publicDataSyncRuns.id, runId));
    return { runId, completed, nextPage: page, totalCount, fetched, inserted, updated, skipped, excluded };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    await db.update(publicDataSyncRuns).set({ status: "FAILED", errorSummary: message, finishedAt: now, updatedAt: now }).where(eq(publicDataSyncRuns.id, runId));
    await recordOperationalAlert(db, { alertType: "PUBLIC_DATA_SYNC", sourceId: runId, message, details: { sourceType: input.sourceType, addressField: input.addressField, page }, now });
    throw error;
  }
}

export function listSyncRuns(db: AppDb) {
  return db.select().from(publicDataSyncRuns).orderBy(desc(publicDataSyncRuns.startedAt)).limit(50);
}
