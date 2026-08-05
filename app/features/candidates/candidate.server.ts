import { and, asc, desc, eq, inArray, isNotNull, isNull, like, or } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import {
  adminAuditLogs,
  businessLicenses,
  categories,
  placeCategories,
  places,
  placeSourceLinks,
} from "../../db/schema";
import type { NormalizedLicense, PublicDataSource, RegionCode } from "./public-data";

export async function listPendingCandidates(db: AppDb, filters: {
  query?: string;
  sourceType?: PublicDataSource;
  regionCode?: RegionCode;
  businessSubtype?: string;
  coordinates?: "present" | "missing";
  sort?: "updated" | "name" | "source" | "region";
} = {}) {
  const conditions = [
    eq(businessLicenses.normalizedStatus, "OPEN"),
    eq(businessLicenses.reviewStatus, "PENDING"),
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

  if (input.normalizedStatus !== "OPEN") {
    const link = await db.query.placeSourceLinks.findFirst({ where: eq(placeSourceLinks.businessLicenseId, id) });
    if (link) {
      await db.batch([
        db.update(places).set({ status: "HIDDEN", updatedAt: now }).where(eq(places.id, link.placeId)),
        db.insert(adminAuditLogs).values({
          id: crypto.randomUUID(), actorUserId: null, action: "AUTO_HIDE_SOURCE_STATUS",
          targetType: "PLACE", targetId: link.placeId,
          beforeState: "PUBLISHED", afterState: input.normalizedStatus, createdAt: now,
        }),
      ]);
    }
  }
  return { id, inserted: !existing };
}

export async function approveCandidate(db: AppDb, input: {
  candidateId: string;
  actorUserId: string;
  categoryId: string;
  secondaryCategoryIds?: string[];
  slug: string;
  name: string;
  address: string;
  neighborhood: string;
  latitude: number;
  longitude: number;
  now: string;
}) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)) throw new Error("INVALID_PLACE_SLUG");
  if (!input.name || !input.address || !input.neighborhood) throw new Error("PLACE_REQUIRED_FIELD_MISSING");
  if (!Number.isFinite(input.latitude) || input.latitude < 33 || input.latitude > 39 || !Number.isFinite(input.longitude) || input.longitude < 124 || input.longitude > 132) throw new Error("INVALID_PLACE_COORDINATES");
  const candidate = await db.query.businessLicenses.findFirst({ where: eq(businessLicenses.id, input.candidateId) });
  if (!candidate || candidate.normalizedStatus !== "OPEN" || candidate.reviewStatus !== "PENDING") throw new Error("CANDIDATE_NOT_APPROVABLE");
  const categoryIds = [...new Set([input.categoryId, ...(input.secondaryCategoryIds ?? [])].filter(Boolean))];
  const categoryRows = await db.select().from(categories).where(and(inArray(categories.id, categoryIds), eq(categories.isActive, true)));
  if (categoryRows.length !== categoryIds.length || categoryRows.some((category) => !category.parentId)) throw new Error("CATEGORY_NOT_FOUND");
  const category = categoryRows.find((row) => row.id === input.categoryId)!;
  const placeId = crypto.randomUUID();
  await db.batch([
    db.insert(places).values({
      id: placeId, slug: input.slug, name: input.name, status: "PUBLISHED", address: input.address,
      neighborhood: input.neighborhood, latitude: input.latitude, longitude: input.longitude,
      phone: candidate.phone, parkingSummary: null, heroImageUrl: null, kakaoPlaceId: null,
      searchText: `${input.name} ${input.address} ${input.neighborhood} ${category.name}`.toLocaleLowerCase("ko-KR"),
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
