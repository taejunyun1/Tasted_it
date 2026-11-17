import { and, asc, desc, eq, inArray, isNotNull, isNull, like, notExists, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { AppDb } from "../../db/client.server";
import { loadInD1Chunks } from "../../db/d1-query-chunks";
import {
  adminAuditLogs,
  businessLicenseExclusions,
  businessLicenses,
  categories,
  placeCategories,
  placeRevalidationCases,
  places,
  placeSourceLinks,
  placeReviewWorkItems,
} from "../../db/schema";
import type { NormalizedLicense, PublicDataSource, RegionCode } from "./public-data";
import { slugifyPlaceNameForAddress } from "../places/place-slug";
import { extractNeighborhood } from "./category-suggestion";
import { getTerminalCategoryIds } from "./category-selection";
import { classifyAutomaticExclusion } from "./exclusion-policy";
import { validateManualExclusion } from "./manual-exclusion";
import { createReviewWorkItem, newReviewWorkItemValues } from "../places/place-review-work-items.server";
import { classifyLocalDining, diningReasonLabels } from "../places/local-dining-policy";

export interface CandidateFilters {
  query?: string;
  sourceType?: PublicDataSource;
  regionCode?: RegionCode;
  businessSubtype?: string;
  coordinates?: "present" | "missing";
  sort?: "updated" | "name" | "source" | "region";
}

export async function listPendingCandidates(db: AppDb, filters: CandidateFilters = {}) {
  const conditions = [
    eq(businessLicenses.normalizedStatus, "OPEN"),
    eq(businessLicenses.reviewStatus, "PENDING"),
    notExists(db.select({ id: businessLicenseExclusions.businessLicenseId }).from(businessLicenseExclusions).where(and(
      eq(businessLicenseExclusions.businessLicenseId, businessLicenses.id),
      eq(businessLicenseExclusions.status, "ACTIVE"),
    ))),
  ];
  if (filters.sourceType) conditions.push(eq(businessLicenses.sourceType, filters.sourceType));
  if (filters.regionCode) conditions.push(eq(businessLicenses.regionCode, filters.regionCode));
  if (filters.businessSubtype) conditions.push(eq(businessLicenses.businessSubtype, filters.businessSubtype));
  if (filters.coordinates === "present") conditions.push(isNotNull(businessLicenses.latitude));
  if (filters.coordinates === "missing") conditions.push(isNull(businessLicenses.latitude));
  if (filters.query?.trim()) {
    const value = `%${filters.query.trim()}%`;
    conditions.push(or(like(businessLicenses.businessName, value), like(businessLicenses.roadAddress, value), like(businessLicenses.lotAddress, value))!);
  }
  const order = filters.sort === "updated" ? [desc(businessLicenses.sourceUpdatedAt), asc(businessLicenses.businessName)]
    : filters.sort === "source" ? [asc(businessLicenses.sourceType), asc(businessLicenses.businessSubtype), asc(businessLicenses.businessName)]
    : filters.sort === "region" ? [asc(businessLicenses.regionCode), asc(businessLicenses.businessName)]
    : [asc(businessLicenses.businessName)];
  return db.select().from(businessLicenses).where(and(...conditions)).orderBy(...order).limit(300);
}

export async function listCandidateSubtypes(db: AppDb) {
  const rows = await db.selectDistinct({ value: businessLicenses.businessSubtype }).from(businessLicenses)
    .where(and(eq(businessLicenses.normalizedStatus, "OPEN"), eq(businessLicenses.reviewStatus, "PENDING")))
    .orderBy(asc(businessLicenses.businessSubtype));
  return rows.flatMap((row) => row.value ? [row.value] : []);
}

export async function listExcludedCandidates(
  db: AppDb,
  filters: CandidateFilters = {},
  reasons?: Array<"CHAIN_STORE" | "ADULT_ENTERTAINMENT" | "NOT_RESTAURANT" | "ADMIN_EXCEPTION">,
) {
  const conditions = [
    eq(businessLicenses.normalizedStatus, "OPEN"),
    eq(businessLicenses.reviewStatus, "PENDING"),
    eq(businessLicenseExclusions.status, "ACTIVE"),
  ];
  if (reasons?.length) conditions.push(inArray(businessLicenseExclusions.reason, reasons));
  if (filters.sourceType) conditions.push(eq(businessLicenses.sourceType, filters.sourceType));
  if (filters.regionCode) conditions.push(eq(businessLicenses.regionCode, filters.regionCode));
  if (filters.businessSubtype) conditions.push(eq(businessLicenses.businessSubtype, filters.businessSubtype));
  if (filters.coordinates === "present") conditions.push(isNotNull(businessLicenses.latitude));
  if (filters.coordinates === "missing") conditions.push(isNull(businessLicenses.latitude));
  if (filters.query?.trim()) {
    const value = `%${filters.query.trim()}%`;
    conditions.push(or(like(businessLicenses.businessName, value), like(businessLicenses.roadAddress, value), like(businessLicenses.lotAddress, value))!);
  }
  return db.select({
    id: businessLicenses.id,
    businessName: businessLicenses.businessName,
    businessSubtype: businessLicenses.businessSubtype,
    sourceType: businessLicenses.sourceType,
    regionCode: businessLicenses.regionCode,
    roadAddress: businessLicenses.roadAddress,
    lotAddress: businessLicenses.lotAddress,
    latitude: businessLicenses.latitude,
    longitude: businessLicenses.longitude,
    exclusionReason: businessLicenseExclusions.reason,
    exclusionCategory: businessLicenseExclusions.exclusionCategory,
    matchedRule: businessLicenseExclusions.matchedRule,
    chainName: businessLicenseExclusions.chainName,
    matchedTerm: businessLicenseExclusions.matchedTerm,
    matchedBrand: businessLicenseExclusions.matchedBrand,
    matchedAlias: businessLicenseExclusions.matchedAlias,
    chainScope: businessLicenseExclusions.chainScope,
    matchMethod: businessLicenseExclusions.matchMethod,
    matchConfidence: businessLicenseExclusions.matchConfidence,
    note: businessLicenseExclusions.note,
    excludedBy: businessLicenseExclusions.excludedBy,
    excludedAt: businessLicenseExclusions.excludedAt,
  }).from(businessLicenses)
    .innerJoin(businessLicenseExclusions, eq(businessLicenseExclusions.businessLicenseId, businessLicenses.id))
    .where(and(...conditions))
    .orderBy(asc(businessLicenseExclusions.reason), asc(businessLicenses.businessName))
    .limit(300);
}

export async function restoreExcludedCandidate(db: AppDb, input: { candidateId: string; actorUserId: string; now: string }) {
  const exclusion = await db.query.businessLicenseExclusions.findFirst({ where: and(
    eq(businessLicenseExclusions.businessLicenseId, input.candidateId),
    eq(businessLicenseExclusions.status, "ACTIVE"),
  ) });
  if (!exclusion) throw new Error("CANDIDATE_EXCLUSION_NOT_ACTIVE");
  await db.batch([
    db.update(businessLicenseExclusions).set({ status: "OVERRIDDEN", overriddenBy: input.actorUserId, overriddenAt: input.now, updatedAt: input.now })
      .where(and(eq(businessLicenseExclusions.businessLicenseId, input.candidateId), eq(businessLicenseExclusions.status, "ACTIVE"))),
    db.insert(adminAuditLogs).values({ id: crypto.randomUUID(), actorUserId: input.actorUserId, action: "RESTORE_CANDIDATE_EXCLUSION", targetType: "BUSINESS_LICENSE", targetId: input.candidateId, beforeState: "EXCLUDED", afterState: "PENDING", createdAt: input.now }),
  ]);
}

export async function excludeCandidates(db: AppDb, input: {
  candidateIds: string[];
  category: string;
  note: string;
  actorUserId: string;
  now: string;
}) {
  const validated = validateManualExclusion(input.category, input.note, input.candidateIds);
  const [candidates, activeExclusions] = await Promise.all([
    db.select({ id: businessLicenses.id }).from(businessLicenses).where(and(
      inArray(businessLicenses.id, validated.candidateIds),
      eq(businessLicenses.normalizedStatus, "OPEN"),
      eq(businessLicenses.reviewStatus, "PENDING"),
    )),
    db.select({ id: businessLicenseExclusions.businessLicenseId }).from(businessLicenseExclusions).where(and(
      inArray(businessLicenseExclusions.businessLicenseId, validated.candidateIds),
      eq(businessLicenseExclusions.status, "ACTIVE"),
    )),
  ]);
  const candidateSet = new Set(candidates.map((candidate) => candidate.id));
  const activeSet = new Set(activeExclusions.map((exclusion) => exclusion.id));
  const excludedIds = validated.candidateIds.filter((id) => candidateSet.has(id) && !activeSet.has(id));
  const skippedIds = validated.candidateIds.filter((id) => !excludedIds.includes(id));

  for (const candidateId of excludedIds) {
    await db.batch([
      db.insert(businessLicenseExclusions).values({
        businessLicenseId: candidateId,
        reason: "ADMIN_EXCEPTION",
        exclusionCategory: validated.category,
        matchedRule: "ADMIN_SELECTED",
        chainName: null,
        matchedTerm: null,
        matchedBrand: null,
        matchedAlias: null,
        chainScope: null,
        matchMethod: "ADMIN_SELECTED",
        matchConfidence: 1,
        note: validated.note,
        excludedBy: input.actorUserId,
        status: "ACTIVE",
        excludedAt: input.now,
        overriddenBy: null,
        overriddenAt: null,
        createdAt: input.now,
        updatedAt: input.now,
      }).onConflictDoUpdate({
        target: businessLicenseExclusions.businessLicenseId,
        set: {
          reason: "ADMIN_EXCEPTION",
          exclusionCategory: validated.category,
          matchedRule: "ADMIN_SELECTED",
          chainName: null,
          matchedTerm: null,
          matchedBrand: null,
          matchedAlias: null,
          chainScope: null,
          matchMethod: "ADMIN_SELECTED",
          matchConfidence: 1,
          note: validated.note,
          excludedBy: input.actorUserId,
          status: "ACTIVE",
          excludedAt: input.now,
          overriddenBy: null,
          overriddenAt: null,
          updatedAt: input.now,
        },
      }),
      db.insert(adminAuditLogs).values({
        id: crypto.randomUUID(),
        actorUserId: input.actorUserId,
        action: "ADMIN_EXCLUDE_CANDIDATE",
        targetType: "BUSINESS_LICENSE",
        targetId: candidateId,
        beforeState: "PENDING",
        afterState: `EXCLUDED:${validated.category}`,
        createdAt: input.now,
      }),
    ]);
  }

  return { excludedIds, skippedIds };
}

export type BusinessLicenseUpsertContext = {
  existing: Pick<typeof businessLicenses.$inferSelect, "id" | "sourceManagementNo" | "reviewStatus" | "reviewReason" | "reviewedBy" | "reviewedAt" | "firstSeenAt" | "createdAt" | "updatedAt"> | undefined;
  exclusion: Pick<typeof businessLicenseExclusions.$inferSelect, "businessLicenseId" | "status" | "reason" | "excludedAt" | "createdAt" | "updatedAt"> | undefined;
  link: Pick<typeof placeSourceLinks.$inferSelect, "businessLicenseId" | "placeId"> | undefined;
  openCase: Pick<typeof placeRevalidationCases.$inferSelect, "placeId" | "reasonType"> | undefined;
};

/** Load one public-data page without spending a D1 request on every record. */
export async function loadBusinessLicenseUpsertContexts(db: AppDb, inputs: NormalizedLicense[]) {
  const contexts = new Map<string, BusinessLicenseUpsertContext>();
  if (!inputs.length) return contexts;
  const sourceType = inputs[0]!.sourceType;
  if (inputs.some(input => input.sourceType !== sourceType)) throw new Error("PUBLIC_SYNC_SCOPE_CHANGED");
  const existingRows = await loadInD1Chunks([...new Set(inputs.map(input => input.sourceManagementNo))],
    ids => db.select({id:businessLicenses.id,sourceManagementNo:businessLicenses.sourceManagementNo,reviewStatus:businessLicenses.reviewStatus,
      reviewReason:businessLicenses.reviewReason,reviewedBy:businessLicenses.reviewedBy,reviewedAt:businessLicenses.reviewedAt,
      firstSeenAt:businessLicenses.firstSeenAt,createdAt:businessLicenses.createdAt,updatedAt:businessLicenses.updatedAt})
      .from(businessLicenses).where(and(eq(businessLicenses.sourceType,sourceType),inArray(businessLicenses.sourceManagementNo,ids))),
    {reservedBindings:1});
  const existingByNumber = new Map(existingRows.map(row => [row.sourceManagementNo,row]));
  const closedIds = inputs.filter(input => input.normalizedStatus !== "OPEN")
    .flatMap(input => { const row=existingByNumber.get(input.sourceManagementNo); return row ? [row.id] : []; });
  const [exclusions,links] = await Promise.all([
    loadInD1Chunks(existingRows.map(row=>row.id),ids=>db.select({businessLicenseId:businessLicenseExclusions.businessLicenseId,status:businessLicenseExclusions.status,
      reason:businessLicenseExclusions.reason,excludedAt:businessLicenseExclusions.excludedAt,createdAt:businessLicenseExclusions.createdAt,updatedAt:businessLicenseExclusions.updatedAt})
      .from(businessLicenseExclusions).where(inArray(businessLicenseExclusions.businessLicenseId,ids))),
    loadInD1Chunks([...new Set(closedIds)],ids=>db.select({businessLicenseId:placeSourceLinks.businessLicenseId,placeId:placeSourceLinks.placeId}).from(placeSourceLinks).where(inArray(placeSourceLinks.businessLicenseId,ids))),
  ]);
  const cases = await loadInD1Chunks([...new Set(links.map(row=>row.placeId))],
    ids=>db.selectDistinct({placeId:placeRevalidationCases.placeId,reasonType:placeRevalidationCases.reasonType}).from(placeRevalidationCases).where(and(inArray(placeRevalidationCases.placeId,ids),inArray(placeRevalidationCases.status,["OPEN","REVIEWING"]))),
    {reservedBindings:2});
  const exclusionById=new Map(exclusions.map(row=>[row.businessLicenseId,row]));
  const linkById=new Map(links.map(row=>[row.businessLicenseId,row]));
  for(const input of inputs){
    const existing=existingByNumber.get(input.sourceManagementNo),link=existing?linkById.get(existing.id):undefined;
    const reasonType=input.normalizedStatus === "CLOSED" ? "CLOSED" : input.normalizedStatus === "TEMPORARILY_CLOSED" ? "TEMPORARILY_CLOSED" : "UNKNOWN";
    contexts.set(input.sourceManagementNo,{existing,link,exclusion:existing?exclusionById.get(existing.id):undefined,
      openCase:link?cases.find(row=>row.placeId===link.placeId && row.reasonType===reasonType):undefined});
  }
  return contexts;
}

export async function prepareBusinessLicenseUpsert(db: AppDb, input: NormalizedLicense, now: string, context?: BusinessLicenseUpsertContext) {
  const existing = context ? context.existing : await db.query.businessLicenses.findFirst({
    where: and(eq(businessLicenses.sourceType, input.sourceType), eq(businessLicenses.sourceManagementNo, input.sourceManagementNo)),
  });
  const id = existing?.id ?? crypto.randomUUID();
  const statements: BatchItem<"sqlite">[] = [];
  statements.push(db.insert(businessLicenses).values({
    id,
    ...input,
    reviewStatus: existing?.reviewStatus ?? "PENDING",
    reviewReason: existing?.reviewReason ?? null,
    reviewedBy: existing?.reviewedBy ?? null,
    reviewedAt: existing?.reviewedAt ?? null,
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSeenAt: now,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [businessLicenses.sourceType, businessLicenses.sourceManagementNo],
    set: {
      businessName: input.businessName,
      businessSubtype: input.businessSubtype,
      salesStatusCode: input.salesStatusCode,
      salesStatusName: input.salesStatusName,
      detailStatusCode: input.detailStatusCode,
      detailStatusName: input.detailStatusName,
      normalizedStatus: input.normalizedStatus,
      lotAddress: input.lotAddress,
      roadAddress: input.roadAddress,
      phone: input.phone,
      sourceX: input.sourceX,
      sourceY: input.sourceY,
      latitude: input.latitude,
      longitude: input.longitude,
      sourceUpdatedAt: input.sourceUpdatedAt,
      rawPayload: input.rawPayload,
      lastSeenAt: now,
      updatedAt: now,
    },
  }));

  const match = classifyAutomaticExclusion({
    businessName: input.businessName,
    businessSubtype: input.businessSubtype,
    sourceType: input.sourceType,
  });
  const exclusion = context ? context.exclusion : await db.query.businessLicenseExclusions.findFirst({ where: eq(businessLicenseExclusions.businessLicenseId, id) });
  const canExclude = input.normalizedStatus === "OPEN" && (existing?.reviewStatus ?? "PENDING") === "PENDING";
  let excluded = false;
  if (match && canExclude && exclusion?.status !== "OVERRIDDEN") {
    statements.push(db.insert(businessLicenseExclusions).values({
      businessLicenseId: id,
      reason: match.reason,
      exclusionCategory: match.exclusionCategory,
      matchedRule: match.matchedRule,
      chainName: match.matchedBrand,
      matchedTerm: match.matchedAlias ?? match.matchedBrand,
      matchedBrand: match.matchedBrand,
      matchedAlias: match.matchedAlias,
      chainScope: match.chainScope,
      matchMethod: match.matchMethod,
      matchConfidence: match.confidence,
      note: null,
      excludedBy: null,
      status: "ACTIVE",
      excludedAt: exclusion?.excludedAt ?? now,
      overriddenBy: null,
      overriddenAt: null,
      createdAt: exclusion?.createdAt ?? now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: businessLicenseExclusions.businessLicenseId,
      set: {
        reason: match.reason,
        exclusionCategory: match.exclusionCategory,
        matchedRule: match.matchedRule,
        chainName: match.matchedBrand,
        matchedTerm: match.matchedAlias ?? match.matchedBrand,
        matchedBrand: match.matchedBrand,
        matchedAlias: match.matchedAlias,
        chainScope: match.chainScope,
        matchMethod: match.matchMethod,
        matchConfidence: match.confidence,
        note: null,
        excludedBy: null,
        status: "ACTIVE",
        updatedAt: now,
      },
    }));
    if (exclusion?.status !== "ACTIVE") statements.push(db.insert(adminAuditLogs).values({ id: crypto.randomUUID(), actorUserId: null, action: match.reason === "CHAIN_STORE" ? "AUTO_EXCLUDE_CHAIN_STORE" : match.reason === "ADULT_ENTERTAINMENT" ? "AUTO_EXCLUDE_ADULT_ENTERTAINMENT" : "AUTO_EXCLUDE_NOT_RESTAURANT", targetType: "BUSINESS_LICENSE", targetId: id, beforeState: exclusion?.status ?? "PENDING", afterState: "EXCLUDED", createdAt: now }));
    excluded = true;
  } else if (!match && exclusion?.status === "ACTIVE" && exclusion.reason !== "ADMIN_EXCEPTION") {
    statements.push(
      db.update(businessLicenseExclusions).set({ status: "CLEARED", updatedAt: now }).where(eq(businessLicenseExclusions.businessLicenseId, id)),
      db.insert(adminAuditLogs).values({ id: crypto.randomUUID(), actorUserId: null, action: "AUTO_CLEAR_CANDIDATE_EXCLUSION", targetType: "BUSINESS_LICENSE", targetId: id, beforeState: "EXCLUDED", afterState: "PENDING", createdAt: now }),
    );
  }

  if (input.normalizedStatus !== "OPEN") {
    const link = context ? context.link : await db.query.placeSourceLinks.findFirst({ where: eq(placeSourceLinks.businessLicenseId, id) });
    if (link) {
      const reasonType = input.normalizedStatus === "CLOSED" ? "CLOSED" as const : input.normalizedStatus === "TEMPORARILY_CLOSED" ? "TEMPORARILY_CLOSED" as const : "UNKNOWN" as const;
      const openCase = context ? context.openCase : await db.query.placeRevalidationCases.findFirst({ where: and(eq(placeRevalidationCases.placeId, link.placeId), eq(placeRevalidationCases.reasonType, reasonType), inArray(placeRevalidationCases.status, ["OPEN", "REVIEWING"])) });
      const linkedStatements: BatchItem<"sqlite">[] = [
        db.insert(adminAuditLogs).values({
          id: crypto.randomUUID(), actorUserId: null, action: "AUTO_HIDE_SOURCE_STATUS",
          targetType: "PLACE", targetId: link.placeId,
          beforeState: "PUBLISHED", afterState: input.normalizedStatus, createdAt: now,
        }),
      ];
      if (input.normalizedStatus === "CLOSED") linkedStatements.unshift(db.update(places).set({ status: "HIDDEN", closedAt: now, updatedAt: now }).where(eq(places.id, link.placeId)));
      if (!openCase) linkedStatements.push(db.insert(placeRevalidationCases).values({ id: crypto.randomUUID(), placeId: link.placeId, reasonType, status: "OPEN", evidenceJson: JSON.stringify({ businessLicenseId: id, normalizedStatus: input.normalizedStatus, salesStatusName: input.salesStatusName }), createdAt: now, updatedAt: now }));
      statements.push(...linkedStatements);
    }
  }
  if (!existing && input.normalizedStatus === "OPEN") {
    const item = newReviewWorkItemValues({ businessLicenseId: id, sourceKind: "PUBLIC_DATA", now });
    const decision = classifyLocalDining(input);
    statements.push(db.insert(placeReviewWorkItems).values({ ...item,
      ...(decision.decision === "EXCLUDE" ? { status: "EXCLUDED" as const,
        holdCode: "AUTO_LOCAL_DINING_EXCLUSION", stageVersion: 1, lastTransitionAt: now,
        holdNote: [...decision.reasons.map((reason) => diningReasonLabels[reason]), ...decision.matchedRules].join(" · ") } : {}),
    }).onConflictDoNothing());
    if (decision.decision === "EXCLUDE") statements.push(db.insert(adminAuditLogs).values({
      id: crypto.randomUUID(), actorUserId: null, action: "PLACE_REVIEW_AUTO_EXCLUDE_LOCAL_DINING",
      targetType: "PLACE_REVIEW_WORK_ITEM", targetId: item.id,
      beforeState: JSON.stringify({ stage: item.stage, status: "ACTIVE" }),
      afterState: JSON.stringify({ status: "EXCLUDED", ...decision }), createdAt: now,
    }));
  }
  const unchanged = existing
    ? sql`exists(select 1 from business_licenses where id=${id} and updated_at=${existing.updatedAt} and review_status=${existing.reviewStatus})`
    : sql`not exists(select 1 from business_licenses where source_type=${input.sourceType} and source_management_no=${input.sourceManagementNo})`;
  const exclusionUnchanged = exclusion
    ? sql`exists(select 1 from business_license_exclusions where business_license_id=${id} and status=${exclusion.status} and updated_at=${exclusion.updatedAt})`
    : sql`not exists(select 1 from business_license_exclusions where business_license_id=${id})`;
  return { id, inserted: !existing, excluded, statements, unchanged: sql`${unchanged} and ${exclusionUnchanged}` };
}

export async function upsertBusinessLicense(db: AppDb, input: NormalizedLicense, now: string) {
  const plan = await prepareBusinessLicenseUpsert(db, input, now);
  const [first, ...rest] = plan.statements;
  if (first) await db.batch([first, ...rest]);
  return { id: plan.id, inserted: plan.inserted, excluded: plan.excluded };
}

export async function approveCandidate(db: AppDb, input: {
  candidateId: string;
  actorUserId: string;
  categoryId: string;
  slug?: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  now: string;
}) {
  if (!input.name || !input.address) throw new Error("PLACE_REQUIRED_FIELD_MISSING");
  const neighborhood = extractNeighborhood(input.address);
  if (!neighborhood) throw new Error("PLACE_NEIGHBORHOOD_NOT_FOUND");
  if (!Number.isFinite(input.latitude) || input.latitude < 33 || input.latitude > 39 || !Number.isFinite(input.longitude) || input.longitude < 124 || input.longitude > 132) throw new Error("INVALID_PLACE_COORDINATES");
  const [candidate, activeExclusion] = await Promise.all([
    db.query.businessLicenses.findFirst({ where: eq(businessLicenses.id, input.candidateId) }),
    db.query.businessLicenseExclusions.findFirst({ where: and(
      eq(businessLicenseExclusions.businessLicenseId, input.candidateId),
      eq(businessLicenseExclusions.status, "ACTIVE"),
    ) }),
  ]);
  if (!candidate || activeExclusion || candidate.normalizedStatus !== "OPEN" || candidate.reviewStatus !== "PENDING") throw new Error("CANDIDATE_NOT_APPROVABLE");
  const categoryIds = [input.categoryId];
  const categoryRows = await db.select().from(categories).where(eq(categories.isActive, true));
  if (!getTerminalCategoryIds(categoryRows).has(input.categoryId)) throw new Error("CATEGORY_NOT_FOUND");
  const category = categoryRows.find((row) => row.id === input.categoryId)!;
  const baseSlug = slugifyPlaceNameForAddress(input.name, input.address);
  let slug = baseSlug;
  for (let suffix = 2; await db.query.places.findFirst({ where: eq(places.slug, slug) }); suffix += 1) slug = `${baseSlug}-${suffix}`;
  const placeId = crypto.randomUUID();
  await db.batch([
    db.insert(places).values({
      id: placeId, slug, name: input.name, status: "PUBLISHED", address: input.address,
      neighborhood, latitude: input.latitude, longitude: input.longitude,
      phone: candidate.phone, parkingSummary: null, heroImageUrl: null, kakaoPlaceId: null,
      searchText: `${input.name} ${input.address} ${neighborhood} ${category.name}`.toLocaleLowerCase("ko-KR"),
      createdAt: input.now, updatedAt: input.now,
    }),
    db.insert(placeCategories).values(categoryIds.map((categoryId) => ({ placeId, categoryId, isPrimary: categoryId === input.categoryId }))),
    db.insert(placeSourceLinks).values({ id: crypto.randomUUID(), placeId, businessLicenseId: candidate.id, isPrimary: true, createdAt: input.now }),
    db.update(businessLicenses).set({ reviewStatus: "APPROVED", reviewedBy: input.actorUserId, reviewedAt: input.now, updatedAt: input.now }).where(and(eq(businessLicenses.id, candidate.id), eq(businessLicenses.reviewStatus, "PENDING"), eq(businessLicenses.normalizedStatus, "OPEN"))),
    db.insert(adminAuditLogs).values({ id: crypto.randomUUID(), actorUserId: input.actorUserId, action: "APPROVE_CANDIDATE", targetType: "BUSINESS_LICENSE", targetId: candidate.id, beforeState: "PENDING", afterState: "APPROVED", createdAt: input.now }),
  ]);
  return { placeId };
}

export async function rejectCandidate(db: AppDb, input: { candidateId: string; actorUserId: string; reason: string; now: string }) {
  if (!input.reason.trim()) throw new Error("REVIEW_REASON_REQUIRED");
  await db.batch([
    db.update(businessLicenses).set({ reviewStatus: "REJECTED", reviewReason: input.reason.trim(), reviewedBy: input.actorUserId, reviewedAt: input.now, updatedAt: input.now }).where(and(eq(businessLicenses.id, input.candidateId), eq(businessLicenses.reviewStatus, "PENDING"))),
    db.insert(adminAuditLogs).values({ id: crypto.randomUUID(), actorUserId: input.actorUserId, action: "REJECT_CANDIDATE", targetType: "BUSINESS_LICENSE", targetId: input.candidateId, beforeState: "PENDING", afterState: "REJECTED", createdAt: input.now }),
  ]);
}
