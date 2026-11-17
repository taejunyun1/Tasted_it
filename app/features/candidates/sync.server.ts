import { and, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "../../db/client.server";
import { publicDataSyncGuards, publicDataSyncRuns } from "../../db/schema";
import { prepareBusinessLicenseUpsert } from "./candidate.server";
import { recordOperationalAlert } from "../operations/alerts.server";
import { LAUNCH_PUBLIC_DATA_ADDRESS_PREFIX } from "../regions/region-pack";
import { buildPublicDataUrl, normalizePublicDataItem, parsePublicDataResponse, publicDataSources, type PublicDataSource } from "./public-data";

export const PUBLIC_SYNC_MAX_PAGES = 5;
export const PUBLIC_SYNC_MAX_FAILURES = 3;
export const PUBLIC_SYNC_LEASE_MS = 120_000;
export const publicSyncScope = z.object({
  sourceType: z.enum(["GENERAL_RESTAURANT", "REST_CAFE", "BAKERY", "ENTERTAINMENT_BAR"]),
  addressField: z.enum(["ROAD_NM_ADDR", "LOTNO_ADDR"]),
});
export type AddressField = z.infer<typeof publicSyncScope>["addressField"];
export type PublicSyncRun = typeof publicDataSyncRuns.$inferSelect;
const syncRegion = "GWANGJU_JEONNAM";
const resumable = ["PENDING", "RUNNING", "FAILED"] as const;

export async function findResumablePublicSync(db: AppDb, scope: z.infer<typeof publicSyncScope>) {
  return db.query.publicDataSyncRuns.findFirst({ where: and(
    eq(publicDataSyncRuns.sourceType, scope.sourceType), eq(publicDataSyncRuns.addressField, scope.addressField),
    eq(publicDataSyncRuns.regionCode, syncRegion), inArray(publicDataSyncRuns.status, [...resumable]),
  ), orderBy: [desc(publicDataSyncRuns.startedAt), desc(publicDataSyncRuns.id)] });
}

export function describePublicSync(run: PublicSyncRun, now: string) {
  const unmanaged = run.status === "RUNNING" && !run.leaseId;
  const active = run.status === "RUNNING" && Boolean(run.leaseId && run.leaseExpiresAt && run.leaseExpiresAt > now);
  const interrupted = run.status === "RUNNING" && !active;
  return { ...run, status: unmanaged ? "UNKNOWN" as const : run.status, unmanaged, leaseId: undefined, errorSummary: run.errorSummary ? safeError(new Error(run.errorSummary)) : null, active, interrupted,
    canResume: !unmanaged && !active && resumable.includes(run.status as typeof resumable[number]) && run.retryCount + (interrupted && run.leaseId ? 1 : 0) < PUBLIC_SYNC_MAX_FAILURES,
    canCancel: !unmanaged && resumable.includes(run.status as typeof resumable[number]),
    failureLimit: PUBLIC_SYNC_MAX_FAILURES };
}

function safeError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return /^PUBLIC_DATA_HTTP_\d{3}$/.test(code) ? code
    : code === "PUBLIC_DATA_RESPONSE_INVALID" ? code : "PUBLIC_DATA_SYNC_FAILED";
}

/** Every page, including derived writes, commits under the same attempt fence. */
export async function syncPublicDataBatch(db: AppDb, input: {
  serviceKey: string; sourceType: PublicDataSource; regionCode?: "GWANGJU_JEONNAM"; addressField: AddressField;
  fetcher?: typeof fetch; maxPages?: number; now?: string; runId?: string; expectedAttempts?: number;
}) {
  const scope = publicSyncScope.parse(input);
  if (!input.serviceKey.trim()) throw new Error("DATA_GO_KR_SERVICE_KEY_REQUIRED");
  const maxPages = z.number().int().min(1).max(PUBLIC_SYNC_MAX_PAGES).parse(input.maxPages ?? PUBLIC_SYNC_MAX_PAGES);
  const clock = () => input.now ?? new Date().toISOString();
  let run = input.runId ? await db.query.publicDataSyncRuns.findFirst({ where: eq(publicDataSyncRuns.id, input.runId) }) : await findResumablePublicSync(db, scope);
  if (input.runId && (!run || run.sourceType !== scope.sourceType || run.addressField !== scope.addressField || run.regionCode !== syncRegion)) throw new Error("PUBLIC_SYNC_SCOPE_CHANGED");
  if (!run) {
    const id = crypto.randomUUID(), now = clock();
    await db.run(sql`insert into public_data_sync_runs(id,source_type,region_code,address_field,status,started_at,created_at,updated_at)
      select ${id},${scope.sourceType},${syncRegion},${scope.addressField},'PENDING',${now},${now},${now}
      where not exists(select 1 from public_data_sync_runs where source_type=${scope.sourceType} and address_field=${scope.addressField}
        and region_code=${syncRegion} and status in ('PENDING','RUNNING','FAILED'))
      and not exists(select 1 from public_data_sync_runs legacy where legacy.status='RUNNING' and legacy.lease_id is null)`);
    run = await db.query.publicDataSyncRuns.findFirst({ where: eq(publicDataSyncRuns.id, id) }) ?? await findResumablePublicSync(db, scope);
  }
  if (!run) throw new Error("PUBLIC_SYNC_UNAVAILABLE");
  const runId = run.id, leaseId = crypto.randomUUID(), started = clock();
  const observedAttempts = input.expectedAttempts ?? run.attempts;
  const [claimed] = await db.update(publicDataSyncRuns).set({ status: "RUNNING", attempts: sql`${publicDataSyncRuns.attempts}+1`,
    retryCount: sql`${publicDataSyncRuns.retryCount}+case when ${publicDataSyncRuns.status}='RUNNING' and ${publicDataSyncRuns.leaseId} is not null then 1 else 0 end`,
    leaseId, leaseExpiresAt: new Date(Date.parse(started) + PUBLIC_SYNC_LEASE_MS).toISOString(),
    finishedAt: null, errorSummary: null, updatedAt: started,
  }).where(and(eq(publicDataSyncRuns.id, runId), eq(publicDataSyncRuns.attempts, observedAttempts),
    inArray(publicDataSyncRuns.status, [...resumable]), isNull(publicDataSyncRuns.cancelRequestedAt),
    sql`(${publicDataSyncRuns.status}<>'RUNNING' or ${publicDataSyncRuns.leaseId} is not null)`,
    sql`${publicDataSyncRuns.retryCount} + case when ${publicDataSyncRuns.status}='RUNNING' and ${publicDataSyncRuns.leaseId} is not null then 1 else 0 end < ${PUBLIC_SYNC_MAX_FAILURES}`,
    or(isNull(publicDataSyncRuns.leaseId), lte(publicDataSyncRuns.leaseExpiresAt, started)),
    sql`not exists(select 1 from public_data_sync_runs legacy where legacy.status='RUNNING' and legacy.lease_id is null)`,
    sql`not exists(select 1 from public_data_sync_runs other where other.id<>${runId} and other.source_type=${scope.sourceType}
      and other.address_field=${scope.addressField} and other.region_code=${syncRegion} and other.status in ('PENDING','RUNNING'))`,
  )).returning();
  let fetched = 0, inserted = 0, updated = 0, skipped = 0, excluded = 0;
  const result = async () => {
    const current = await db.query.publicDataSyncRuns.findFirst({ where: eq(publicDataSyncRuns.id, runId) });
    return { runId, completed: current?.status === "COMPLETED", nextPage: current?.nextPage ?? run!.nextPage,
      totalCount: current?.totalCount ?? run!.totalCount, fetched, inserted, updated, skipped, excluded,
      run: current ? describePublicSync(current, clock()) : null, claimed: Boolean(claimed) };
  };
  if (!claimed) return result();
  const owned = (now: string) => and(eq(publicDataSyncRuns.id, runId), eq(publicDataSyncRuns.status, "RUNNING"),
    eq(publicDataSyncRuns.attempts, claimed.attempts), eq(publicDataSyncRuns.leaseId, leaseId),
    isNull(publicDataSyncRuns.cancelRequestedAt), sql`${publicDataSyncRuns.leaseExpiresAt}>${now}`)!;
  let page = claimed.nextPage;
  try {
    for (let offset = 0; offset < maxPages; offset += 1) {
      let response: Response | undefined;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const now = clock();
        // Grant records an outbound attempt. Cancellation prevents later grants;
        // an already granted GET may finish but cannot commit its page afterward.
        const [grant] = await db.update(publicDataSyncRuns).set({ requestCount: sql`${publicDataSyncRuns.requestCount}+1`,
          leaseExpiresAt: new Date(Date.parse(now) + PUBLIC_SYNC_LEASE_MS).toISOString(), updatedAt: now,
        }).where(owned(now)).returning({ id: publicDataSyncRuns.id });
        if (!grant) return result();
        try {
          response = await (input.fetcher ?? fetch)(buildPublicDataUrl({ baseUrl: publicDataSources[scope.sourceType], serviceKey: input.serviceKey,
            pageNo: page, numOfRows: 100, addressField: scope.addressField, addressPrefix: LAUNCH_PUBLIC_DATA_ADDRESS_PREFIX }),
          { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
          if (response.ok || response.status < 500 || attempt === 2) break;
        } catch { if (attempt === 2) throw new Error("PUBLIC_DATA_SYNC_FAILED"); }
      }
      if (!response?.ok) throw new Error(`PUBLIC_DATA_HTTP_${response?.status ?? 503}`);
      const parsed = parsePublicDataResponse(await response.json());
      if (parsed.items.length > 100) throw new Error("PUBLIC_DATA_RESPONSE_INVALID");
      const now = clock(), plans = [], seen = new Set<string>();
      let pageSkipped = 0;
      for (const raw of parsed.items) {
        const item = normalizePublicDataItem(scope.sourceType, raw);
        if (!item || seen.has(item.sourceManagementNo)) { pageSkipped += 1; continue; }
        seen.add(item.sourceManagementNo);
        plans.push(await prepareBusinessLicenseUpsert(db, item, now));
      }
      const complete = (page * 100 >= parsed.totalCount) || parsed.items.length === 0;
      const additions = { inserted: plans.filter((p) => p.inserted).length, updated: plans.filter((p) => !p.inserted).length, excluded: plans.filter((p) => p.excluded).length };
      const guardId = crypto.randomUUID();
      await db.batch([
        db.insert(publicDataSyncGuards).values({ id: `${guardId}:run`,
          passed: sql`case when exists(select 1 from public_data_sync_runs where ${owned(now)} and next_page=${page}) then 1 else 0 end`,
        }),
        // Keep each statement below D1's binding limit even for a full page.
        ...plans.map((plan, index) => db.insert(publicDataSyncGuards).values({ id: `${guardId}:${index}`,
          passed: sql`case when ${plan.unchanged} then 1 else 0 end`,
        })),
        ...plans.flatMap((p) => p.statements),
        db.update(publicDataSyncRuns).set({ nextPage: page + 1, totalCount: parsed.totalCount,
          fetchedCount: sql`${publicDataSyncRuns.fetchedCount}+${parsed.items.length}`,
          insertedCount: sql`${publicDataSyncRuns.insertedCount}+${additions.inserted}`,
          updatedCount: sql`${publicDataSyncRuns.updatedCount}+${additions.updated}`,
          skippedCount: sql`${publicDataSyncRuns.skippedCount}+${pageSkipped}`,
          status: complete ? "COMPLETED" : "RUNNING", finishedAt: complete ? now : null,
          ...(complete ? { leaseId: null, leaseExpiresAt: null } : {}), updatedAt: now,
        }).where(owned(now)),
        db.delete(publicDataSyncGuards).where(sql`${publicDataSyncGuards.id} like ${`${guardId}:%`}`),
      ] as never);
      fetched += parsed.items.length; inserted += additions.inserted; updated += additions.updated; skipped += pageSkipped; excluded += additions.excluded;
      page += 1;
      if (complete) return result();
    }
    const now = clock();
    await db.update(publicDataSyncRuns).set({ status: "PENDING", leaseId: null, leaseExpiresAt: null, updatedAt: now }).where(owned(now));
    return result();
  } catch (error) {
    const now = clock();
    const [failed] = await db.update(publicDataSyncRuns).set({ status: "FAILED", errorSummary: safeError(error),
      retryCount: sql`${publicDataSyncRuns.retryCount}+1`, finishedAt: now, updatedAt: now, leaseId: null, leaseExpiresAt: null,
    }).where(owned(now)).returning({ id: publicDataSyncRuns.id });
    if (!failed) return result();
    await recordOperationalAlert(db, { alertType: "PUBLIC_DATA_SYNC", sourceId: runId, message: "공공데이터 동기화 실패",
      details: { code: safeError(error), sourceType: scope.sourceType, addressField: scope.addressField, page }, now });
    throw new Error(safeError(error));
  }
}

export function listSyncRuns(db: AppDb) {
  return db.select().from(publicDataSyncRuns).orderBy(desc(publicDataSyncRuns.startedAt), desc(publicDataSyncRuns.id)).limit(50);
}

export async function listPublicSyncStates(db: AppDb, now: string) {
  const [runs, activeScopes, legacyRows] = await Promise.all([listSyncRuns(db), db.select({
    sourceType: publicDataSyncRuns.sourceType, addressField: publicDataSyncRuns.addressField, regionCode: publicDataSyncRuns.regionCode,
    count: sql<number>`count(*)`,
  }).from(publicDataSyncRuns).where(inArray(publicDataSyncRuns.status, ["PENDING", "RUNNING"]))
    .groupBy(publicDataSyncRuns.sourceType, publicDataSyncRuns.addressField, publicDataSyncRuns.regionCode),
    db.select({ count: sql<number>`count(*)` }).from(publicDataSyncRuns).where(and(eq(publicDataSyncRuns.status,"RUNNING"),isNull(publicDataSyncRuns.leaseId)))]);
  const blockedByLegacyRun = Number(legacyRows[0]?.count ?? 0) > 0;
  return runs.map((run) => {
    const activeCount = Number(activeScopes.find((scope) => scope.sourceType === run.sourceType && scope.addressField === run.addressField && scope.regionCode === run.regionCode)?.count ?? 0);
    const blockedByOtherRun = activeCount > (["PENDING", "RUNNING"].includes(run.status) ? 1 : 0);
    const state = describePublicSync(run, now);
    return { ...state, blockedByOtherRun, blockedByLegacyRun, canResume: state.canResume && !blockedByOtherRun && !blockedByLegacyRun };
  });
}
