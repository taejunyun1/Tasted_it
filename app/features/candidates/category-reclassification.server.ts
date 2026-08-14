import { and, asc, eq, gt } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import {
  adminAuditLogs,
  businessLicenseExclusions,
  businessLicenses,
  categories,
  placeCategories,
  places,
  placeSourceLinks,
} from "../../db/schema";
import { classifyCandidate } from "./category-suggestion";
import { getTerminalCategoryIds } from "./category-selection";
import { classifyFoodVenue } from "../places/food-venue-policy";

const MAX_PAGE_SIZE = 100;

export type ReclassificationDecision = "CHANGE" | "KEEP" | "EXCLUDE" | "CONFLICT";

export type ReclassificationChange = {
  placeId: string;
  fromSlug: string;
  toSlug: string | null;
  decision: ReclassificationDecision;
  reason: string;
};

export type ReclassificationPage = {
  scanned: number;
  changed: number;
  excluded: number;
  conflicts: number;
  nextAfterPlaceId: string | null;
  changes: ReclassificationChange[];
};

type ReclassificationWorkItem = ReclassificationChange & {
  fromCategoryId: string;
  toCategoryId: string | null;
  businessLicenseId: string;
  exclusionCategory: "ADULT_ENTERTAINMENT" | "NOT_RESTAURANT" | null;
  matchedRule: string | null;
};

function pageSize(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) throw new Error("RECLASSIFICATION_LIMIT_INVALID");
  return limit;
}

async function getReclassificationWork(db: AppDb, input: { afterPlaceId: string | null; limit: number }) {
  const limit = pageSize(input.limit);
  const conditions = [
    eq(places.status, "PUBLISHED"),
    eq(placeCategories.isPrimary, true),
    eq(placeSourceLinks.isPrimary, true),
  ];
  if (input.afterPlaceId) conditions.push(gt(places.id, input.afterPlaceId));
  const [rows, categoryRows] = await Promise.all([
    db.select({
      placeId: places.id,
      placeName: places.name,
      address: places.address,
      businessLicenseId: businessLicenses.id,
      fromCategoryId: placeCategories.categoryId,
      fromSlug: categories.slug,
      sourceType: businessLicenses.sourceType,
      businessName: businessLicenses.businessName,
      businessSubtype: businessLicenses.businessSubtype,
      exclusionStatus: businessLicenseExclusions.status,
    }).from(places)
      .innerJoin(placeCategories, eq(placeCategories.placeId, places.id))
      .innerJoin(categories, eq(categories.id, placeCategories.categoryId))
      .innerJoin(placeSourceLinks, eq(placeSourceLinks.placeId, places.id))
      .innerJoin(businessLicenses, eq(businessLicenses.id, placeSourceLinks.businessLicenseId))
      .leftJoin(businessLicenseExclusions, eq(businessLicenseExclusions.businessLicenseId, businessLicenses.id))
      .where(and(...conditions))
      .orderBy(asc(places.id))
      .limit(limit + 1),
    db.select().from(categories).where(eq(categories.isActive, true)),
  ]);
  const pageRows = rows.slice(0, limit);
  const categoryBySlug = new Map(categoryRows.map((category) => [category.slug, category]));
  const terminalCategoryIds = getTerminalCategoryIds(categoryRows);
  const items: ReclassificationWorkItem[] = pageRows.map((row) => {
    const venue = classifyFoodVenue({ businessName: row.businessName, businessSubtype: row.businessSubtype });
    const overridden = row.exclusionStatus === "OVERRIDDEN";
    if (venue.decision === "EXCLUDE" && !overridden) {
      if (row.exclusionStatus === "ACTIVE") {
        return {
          placeId: row.placeId,
          businessLicenseId: row.businessLicenseId,
          fromCategoryId: row.fromCategoryId,
          fromSlug: row.fromSlug,
          toSlug: null,
          toCategoryId: null,
          exclusionCategory: venue.category,
          matchedRule: venue.matchedRule,
          decision: "KEEP",
          reason: "이미 자동 제외됨",
        };
      }
      return {
        placeId: row.placeId,
        businessLicenseId: row.businessLicenseId,
        fromCategoryId: row.fromCategoryId,
        fromSlug: row.fromSlug,
        toSlug: null,
        toCategoryId: null,
        exclusionCategory: venue.category,
        matchedRule: venue.matchedRule,
        decision: "EXCLUDE",
        reason: `${venue.matchedRule} · 음식점 아닌 시설`,
      };
    }
    const classification = classifyCandidate({
      sourceType: row.sourceType as Parameters<typeof classifyCandidate>[0]["sourceType"],
      businessSubtype: row.businessSubtype,
      businessName: row.businessName,
      address: row.address,
    });
    const toCategory = categoryBySlug.get(classification.categorySlug);
    if (classification.confidence === "CONFLICT" || !toCategory || !terminalCategoryIds.has(toCategory.id)) {
      return {
        placeId: row.placeId,
        businessLicenseId: row.businessLicenseId,
        fromCategoryId: row.fromCategoryId,
        fromSlug: row.fromSlug,
        toSlug: classification.categorySlug,
        toCategoryId: toCategory?.id ?? null,
        exclusionCategory: null,
        matchedRule: null,
        decision: "CONFLICT",
        reason: classification.reasons[0] ?? "자동 분류 근거가 충분하지 않음",
      };
    }
    if (row.fromSlug === classification.categorySlug) {
      return {
        placeId: row.placeId,
        businessLicenseId: row.businessLicenseId,
        fromCategoryId: row.fromCategoryId,
        fromSlug: row.fromSlug,
        toSlug: classification.categorySlug,
        toCategoryId: toCategory.id,
        exclusionCategory: null,
        matchedRule: null,
        decision: "KEEP",
        reason: classification.reasons[0] ?? "현재 카테고리와 일치",
      };
    }
    return {
      placeId: row.placeId,
      businessLicenseId: row.businessLicenseId,
      fromCategoryId: row.fromCategoryId,
      fromSlug: row.fromSlug,
      toSlug: classification.categorySlug,
      toCategoryId: toCategory.id,
      exclusionCategory: null,
      matchedRule: null,
      decision: "CHANGE",
      reason: classification.reasons[0] ?? "새 분류 규칙 적용",
    };
  });
  return {
    items,
    hasNext: rows.length > limit,
    nextAfterPlaceId: pageRows.at(-1)?.placeId ?? null,
  };
}

function toPage(work: Awaited<ReturnType<typeof getReclassificationWork>>): ReclassificationPage {
  const changes = work.items.map(({
    fromCategoryId: _fromCategoryId,
    toCategoryId: _toCategoryId,
    businessLicenseId: _businessLicenseId,
    exclusionCategory: _exclusionCategory,
    matchedRule: _matchedRule,
    ...change
  }) => change);
  return {
    scanned: changes.length,
    changed: changes.filter((change) => change.decision === "CHANGE").length,
    excluded: changes.filter((change) => change.decision === "EXCLUDE").length,
    conflicts: changes.filter((change) => change.decision === "CONFLICT").length,
    nextAfterPlaceId: work.hasNext ? work.nextAfterPlaceId : null,
    changes,
  };
}

export async function previewCategoryReclassification(db: AppDb, input: { afterPlaceId: string | null; limit: number }): Promise<ReclassificationPage> {
  return toPage(await getReclassificationWork(db, input));
}

export async function applyCategoryReclassification(db: AppDb, input: {
  actorUserId: string;
  afterPlaceId: string | null;
  limit: number;
  now: string;
}): Promise<ReclassificationPage> {
  const work = await getReclassificationWork(db, input);
  for (const item of work.items.filter((candidate) => candidate.decision === "CHANGE" && candidate.toCategoryId && candidate.toSlug)) {
    const target = await db.query.placeCategories.findFirst({ where: and(
      eq(placeCategories.placeId, item.placeId),
      eq(placeCategories.categoryId, item.toCategoryId!),
    ) });
    const audit = db.insert(adminAuditLogs).values({
      id: crypto.randomUUID(), actorUserId: input.actorUserId, action: "RECLASSIFY_PLACE_CATEGORY",
      targetType: "PLACE", targetId: item.placeId,
      beforeState: JSON.stringify({ categorySlug: item.fromSlug }),
      afterState: JSON.stringify({ categorySlug: item.toSlug, reason: item.reason }), createdAt: input.now,
    });
    if (target) {
      await db.batch([
        db.update(placeCategories).set({ isPrimary: false }).where(and(eq(placeCategories.placeId, item.placeId), eq(placeCategories.isPrimary, true))),
        db.update(placeCategories).set({ isPrimary: true }).where(and(eq(placeCategories.placeId, item.placeId), eq(placeCategories.categoryId, item.toCategoryId!))),
        audit,
      ]);
    } else {
      await db.batch([
        db.update(placeCategories).set({ categoryId: item.toCategoryId! }).where(and(
          eq(placeCategories.placeId, item.placeId),
          eq(placeCategories.categoryId, item.fromCategoryId),
          eq(placeCategories.isPrimary, true),
        )),
        audit,
      ]);
    }
  }
  for (const item of work.items) {
    if (item.decision !== "EXCLUDE" || !item.exclusionCategory || !item.matchedRule) continue;
    const exclusionCategory = item.exclusionCategory;
    const matchedRule = item.matchedRule;
    const action = exclusionCategory === "ADULT_ENTERTAINMENT"
      ? "AUTO_EXCLUDE_ADULT_ENTERTAINMENT"
      : "AUTO_EXCLUDE_NOT_RESTAURANT";
    await db.batch([
      db.insert(businessLicenseExclusions).values({
        businessLicenseId: item.businessLicenseId,
        reason: exclusionCategory,
        exclusionCategory,
        matchedRule,
        chainName: null,
        matchedTerm: null,
        matchedBrand: null,
        matchedAlias: null,
        chainScope: null,
        matchMethod: "RECLASSIFICATION_RULE",
        matchConfidence: 1,
        note: null,
        excludedBy: null,
        status: "ACTIVE",
        excludedAt: input.now,
        overriddenBy: null,
        overriddenAt: null,
        createdAt: input.now,
        updatedAt: input.now,
      }).onConflictDoUpdate({
        target: businessLicenseExclusions.businessLicenseId,
        set: {
          reason: exclusionCategory,
          exclusionCategory,
          matchedRule,
          chainName: null,
          matchedTerm: null,
          matchedBrand: null,
          matchedAlias: null,
          chainScope: null,
          matchMethod: "RECLASSIFICATION_RULE",
          matchConfidence: 1,
          note: null,
          excludedBy: null,
          status: "ACTIVE",
          overriddenBy: null,
          overriddenAt: null,
          updatedAt: input.now,
        },
      }),
      db.insert(adminAuditLogs).values({
        id: crypto.randomUUID(),
        actorUserId: input.actorUserId,
        action,
        targetType: "BUSINESS_LICENSE",
        targetId: item.businessLicenseId,
        beforeState: "PUBLISHED",
        afterState: JSON.stringify({ status: "ACTIVE", category: exclusionCategory, matchedRule }),
        createdAt: input.now,
      }),
    ]);
  }
  return toPage(work);
}
