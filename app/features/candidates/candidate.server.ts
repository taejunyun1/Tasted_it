import { and, asc, desc, eq, inArray, isNotNull, isNull, like, notExists, or } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { AppDb } from "../../db/client.server";
import {
  adminAuditLogs,
  businessLicenseExclusions,
  businessLicenses,
  categories,
  placeCategories,
  placeRevalidationCases,
  places,
  placeSourceLinks,
} from "../../db/schema";
import type { NormalizedLicense, PublicDataSource, RegionCode } from "./public-data";
import { slugifyPlaceName } from "../places/place-slug";
import { extractNeighborhood } from "./category-suggestion";
import { getTerminalCategoryIds } from "./category-selection";
import { classifyAutomaticExclusion } from "./exclusion-policy";

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
  reasons?: Array<"CHAIN_STORE" | "ADULT_ENTERTAINMENT" | "ADMIN_EXCEPTION">,
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

export async function upsertBusinessLicense(db: AppDb, input: NormalizedLicense, now: string) {
  const existing = await db.query.businessLicenses.findFirst({
    where: and(eq(businessLicenses.sourceType, input.sourceType), eq(businessLicenses.sourceManagementNo, input.sourceManagementNo)),
  });
  const id = existing?.id ?? crypto.randomUUID();
  await db.insert(businessLicenses).values({
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
  });

  const match = classifyAutomaticExclusion({
    businessName: input.businessName,
    businessSubtype: input.businessSubtype,
  });
  const exclusion = await db.query.businessLicenseExclusions.findFirst({ where: eq(businessLicenseExclusions.businessLicenseId, id) });
  const canExclude = input.normalizedStatus === "OPEN" && (existing?.reviewStatus ?? "PENDING") === "PENDING";
  let excluded = false;
  if (match && canExclude && exclusion?.status !== "OVERRIDDEN") {
    await db.insert(businessLicenseExclusions).values({
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
    });
    if (exclusion?.status !== "ACTIVE") await db.insert(adminAuditLogs).values({ id: crypto.randomUUID(), actorUserId: null, action: match.reason === "CHAIN_STORE" ? "AUTO_EXCLUDE_CHAIN_STORE" : "AUTO_EXCLUDE_ADULT_ENTERTAINMENT", targetType: "BUSINESS_LICENSE", targetId: id, beforeState: exclusion?.status ?? "PENDING", afterState: "EXCLUDED", createdAt: now });
    excluded = true;
  } else if (!match && exclusion?.status === "ACTIVE" && exclusion.reason !== "ADMIN_EXCEPTION") {
    await db.batch([
      db.update(businessLicenseExclusions).set({ status: "CLEARED", updatedAt: now }).where(eq(businessLicenseExclusions.businessLicenseId, id)),
      db.insert(adminAuditLogs).values({ id: crypto.randomUUID(), actorUserId: null, action: "AUTO_CLEAR_CANDIDATE_EXCLUSION", targetType: "BUSINESS_LICENSE", targetId: id, beforeState: "EXCLUDED", afterState: "PENDING", createdAt: now }),
    ]);
  }

  if (input.normalizedStatus !== "OPEN") {
    const link = await db.query.placeSourceLinks.findFirst({ where: eq(placeSourceLinks.businessLicenseId, id) });
    if (link) {
      const reasonType = input.normalizedStatus === "CLOSED" ? "CLOSED" as const : input.normalizedStatus === "TEMPORARILY_CLOSED" ? "TEMPORARILY_CLOSED" as const : "UNKNOWN" as const;
      const openCase = await db.query.placeRevalidationCases.findFirst({ where: and(eq(placeRevalidationCases.placeId, link.placeId), eq(placeRevalidationCases.reasonType, reasonType), inArray(placeRevalidationCases.status, ["OPEN", "REVIEWING"])) });
      const statements: BatchItem<"sqlite">[] = [
        db.insert(adminAuditLogs).values({
          id: crypto.randomUUID(), actorUserId: null, action: "AUTO_HIDE_SOURCE_STATUS",
          targetType: "PLACE", targetId: link.placeId,
          beforeState: "PUBLISHED", afterState: input.normalizedStatus, createdAt: now,
        }),
      ];
      if (input.normalizedStatus === "CLOSED") statements.unshift(db.update(places).set({ status: "HIDDEN", closedAt: now, updatedAt: now }).where(eq(places.id, link.placeId)));
      if (!openCase) statements.push(db.insert(placeRevalidationCases).values({ id: crypto.randomUUID(), placeId: link.placeId, reasonType, status: "OPEN", evidenceJson: JSON.stringify({ businessLicenseId: id, normalizedStatus: input.normalizedStatus, salesStatusName: input.salesStatusName }), createdAt: now, updatedAt: now }));
      const [first, ...rest] = statements; if (first) await db.batch([first, ...rest]);
    }
  }
  return { id, inserted: !existing, excluded };
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
  const baseSlug = slugifyPlaceName(input.name);
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
