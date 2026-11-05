import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { loadInD1Chunks } from "../../db/d1-query-chunks";
import { adminAuditLogs, businessLicenses, categories, naverLocalCategoryVerifications, placeReviewWorkItems } from "../../db/schema";
import { getTerminalCategoryIds } from "../candidates/category-selection";

/** Deterministic leaf fallback for CATEGORY_CONFIRMATION items that are VERIFIED
 * but carry no leaf category (mapped NULL or non-leaf). Precision order:
 * 1. Naver matched_category_path segments → deepest taxonomy match; a non-leaf
 *    match resolves to its "…일반" leaf child.
 * 2. Public-data business_subtype (licensed classification) → mapped leaf.
 * 3. Place-name keywords → leaf, applied only when layers 1-2 produce nothing.
 * 4. "기타" root leaf — the designed residual bucket; always auditable via basis. */

type CategoryRow = typeof categories.$inferSelect;

export type FallbackBasis = "path" | "subtype" | "name" | "fallback";

const OTHER_CATEGORY_NAME = "기타";

// Licensed subtype → leaf id. Only unambiguous subtypes map directly; the rest
// fall through to name keywords or the residual bucket.
const SUBTYPE_TO_LEAF_ID: Record<string, string> = {
  "한식": "cat-korean-general",
  "중국식": "cat-chinese-general",
  "경양식": "cat-western-general",
  "일식": "cat-japanese-general",
  "식육(숯불구이)": "cat-grill",
  "정종/대포집/소주방": "cat-pocha",
  "호프/통닭": "cat-pub",
  "횟집": "cat-sushi",
  "탕류(보신용)": "cat-stew",
  "외국음식전문점(인도,태국등)": "cat-world-general",
  "김밥(도시락)": "cat-gimbap",
  "냉면집": "cat-korean-general",
  "감자탕": "cat-stew",
  "찌개전문": "cat-stew",
  "커피숍": "cat-cafe-shop",
  "다방": "cat-cafe-shop",
  "제과점": "cat-bakery",
  "도시락": "cat-lunchbox",
};

// Ordered place-name keyword → leaf. Checked only for unmapped/generic subtypes.
const NAME_KEYWORDS: Array<[RegExp, string]> = [
  [/김밥/, "cat-gimbap"],
  [/떡볶이|튀김/, "cat-tteokbokki"],
  [/만두/, "cat-dumpling"],
  [/치킨|통닭/, "cat-chicken"],
  [/마라|훠궈/, "cat-mala"],
  [/양꼬치/, "cat-skewer"],
  [/짜장|짬뽕|중국|중화/, "cat-chinese-general"],
  [/피자/, "cat-pizza"],
  [/파스타|스파게티/, "cat-pasta"],
  [/버거|햄버거/, "cat-burger"],
  [/브런치/, "cat-brunch"],
  [/스테이크/, "cat-steak"],
  [/돈가스|돈까스|까스/, "cat-donkatsu"],
  [/라멘/, "cat-ramen"],
  [/우동|소바/, "cat-udon"],
  [/이자카야/, "cat-izakaya"],
  [/덮밥|카레/, "cat-japan-rice"],
  [/초밥|스시|횟집|회/, "cat-sushi"],
  [/카페|커피|coffee/i, "cat-cafe-shop"],
  [/베이커리|빵집|제과|디저트|케이크/, "cat-bakery"],
  [/빙수|아이스크림/, "cat-ice"],
  [/베트남|쌀국수|포(?![차])/, "cat-vietnamese"],
  [/태국|팟타이/, "cat-thai"],
  [/인도/, "cat-indian"],
  [/멕시코|타코/, "cat-mexican"],
  [/와인/, "cat-wine"],
  [/칵테일/, "cat-cocktail"],
  [/포차/, "cat-pocha"],
  [/호프|펍|맥주/, "cat-pub"],
  [/비건|채식/, "cat-vegan"],
  [/샐러드/, "cat-salad"],
  [/도시락|런치박스/, "cat-lunchbox"],
  [/족발|보쌈/, "cat-jokbal"],
  [/국밥|해장국/, "cat-gukbap"],
  [/백반|가정식|집밥/, "cat-home-meal"],
  [/한정식/, "cat-hanjeongsik"],
  [/고기|구이|갈비|삼겹|곱창|막창/, "cat-grill"],
  [/찌개|전골|삼계탕|백숙|곰탕|설렁탕|감자탕|탕/, "cat-stew"],
  [/해산물|생선|조개|아구/, "cat-seafood-dish"],
  [/일식|돈부리|오마카세/, "cat-japanese-general"],
  [/양식|레스토랑|그릴/, "cat-western-general"],
];

function leafSet(rows: CategoryRow[]) {
  return getTerminalCategoryIds(rows.filter((row) => row.isActive));
}

function normalizeName(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[^0-9a-z가-힣]/gu, "");
}

/** Resolve a Naver-reported path like "음식점>한식>추어탕": take the deepest
 * segment that matches an active category name; leaf → itself, non-leaf → its
 * active "…일반" leaf child. */
function fromMatchedPath(path: string | null, rows: CategoryRow[], leaves: Set<string>) {
  if (!path) return null;
  const byName = new Map<string, CategoryRow>();
  for (const row of rows) if (!byName.has(row.name)) byName.set(row.name, row);
  const segments = path.split(">").map((segment) => segment.trim()).filter(Boolean);
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const hit = byName.get(segments[index]!);
    if (!hit) continue;
    if (leaves.has(hit.id)) return hit;
    const general = rows.find((row) => row.parentId === hit.id && row.isActive && row.name.includes("일반") && leaves.has(row.id));
    if (general) return general;
    return null;
  }
  return null;
}

export function suggestFallbackCategory(input: {
  businessName: string | null | undefined;
  businessSubtype: string | null | undefined;
  matchedCategoryPath: string | null | undefined;
}, rows: CategoryRow[]): { categoryId: string; basis: FallbackBasis } | null {
  const leaves = leafSet(rows);
  const other = rows.find((row) => row.name === OTHER_CATEGORY_NAME && row.parentId === null && leaves.has(row.id));

  const fromPath = fromMatchedPath(input.matchedCategoryPath ?? null, rows, leaves);
  if (fromPath) return { categoryId: fromPath.id, basis: "path" };

  const subtype = (input.businessSubtype ?? "").trim();
  const mapped = SUBTYPE_TO_LEAF_ID[subtype];
  if (mapped && leaves.has(mapped)) return { categoryId: mapped, basis: "subtype" };

  const normalized = normalizeName(input.businessName ?? "");
  for (const [pattern, leafId] of NAME_KEYWORDS) {
    if (pattern.test(normalized) && leaves.has(leafId)) return { categoryId: leafId, basis: "name" };
  }

  // "기타" residual only when some real evidence exists; zero-evidence items
  // stay selectedCategoryId-less for human judgment.
  if (!other) return null;
  const hasEvidence = Boolean(subtype) || Boolean((input.matchedCategoryPath ?? "").trim()) || Boolean(normalized);
  return hasEvidence ? { categoryId: other.id, basis: "fallback" } : null;
}

export async function applyCategoryFallback(db: AppDb, input: {
  limit: number;
  actorUserId: string;
  now: string;
}): Promise<{ changed: string[]; scanned: number; skipped: Array<{ workItemId: string; code: string }> }> {
  const cap = Math.min(Math.max(1, input.limit), 200);
  const [rows, categoryRows] = await Promise.all([
    db.select().from(placeReviewWorkItems)
      .where(and(
        eq(placeReviewWorkItems.stage, "CATEGORY_CONFIRMATION"),
        eq(placeReviewWorkItems.status, "ACTIVE"),
        isNull(placeReviewWorkItems.selectedCategoryId),
      ))
      .orderBy(asc(placeReviewWorkItems.updatedAt))
      .limit(cap),
    db.select().from(categories),
  ]);
  if (!rows.length) return { changed: [], scanned: 0, skipped: [] };

  const licenseIds = [...new Set(rows.map((row) => row.businessLicenseId).filter((id): id is string => Boolean(id)))];
  const [licenses, verifications] = await Promise.all([
    loadInD1Chunks(licenseIds, (ids) => db.select().from(businessLicenses).where(inArray(businessLicenses.id, ids)), { reservedBindings: 10 }),
    loadInD1Chunks(licenseIds, (ids) => db.select().from(naverLocalCategoryVerifications).where(inArray(naverLocalCategoryVerifications.businessLicenseId, ids)), { reservedBindings: 10 }),
  ]);
  const licenseById = new Map(licenses.map((row) => [row.id, row]));
  const verificationByLicenseId = new Map(verifications.map((row) => [row.businessLicenseId, row]));

  const changed: string[] = [];
  const skipped: Array<{ workItemId: string; code: string }> = [];
  for (const workItem of rows) {
    const license = workItem.businessLicenseId ? licenseById.get(workItem.businessLicenseId) : undefined;
    const verification = workItem.businessLicenseId ? verificationByLicenseId.get(workItem.businessLicenseId) : undefined;
    const suggestion = suggestFallbackCategory({
      businessName: license?.businessName,
      businessSubtype: license?.businessSubtype,
      matchedCategoryPath: verification?.matchedCategoryPath,
    }, categoryRows);
    if (!suggestion) { skipped.push({ workItemId: workItem.id, code: "CATEGORY_FALLBACK_NO_MATCH" }); continue; }
    const updated = await db.update(placeReviewWorkItems).set({
      selectedCategoryId: suggestion.categoryId,
      categoryOverrideReason: `fallback:${suggestion.basis}`,
      updatedAt: input.now,
      stageVersion: workItem.stageVersion + 1,
    }).where(and(
      eq(placeReviewWorkItems.id, workItem.id),
      eq(placeReviewWorkItems.stage, "CATEGORY_CONFIRMATION"),
      eq(placeReviewWorkItems.stageVersion, workItem.stageVersion),
      eq(placeReviewWorkItems.status, "ACTIVE"),
      isNull(placeReviewWorkItems.selectedCategoryId),
    )).returning({ id: placeReviewWorkItems.id });
    if (!updated.length) { skipped.push({ workItemId: workItem.id, code: "STALE_WORK_ITEM" }); continue; }
    await db.insert(adminAuditLogs).values({
      id: crypto.randomUUID(), actorUserId: input.actorUserId, action: "PLACE_REVIEW_CATEGORY_FALLBACK",
      targetType: "PLACE_REVIEW_WORK_ITEM", targetId: workItem.id,
      beforeState: JSON.stringify({ selectedCategoryId: null }),
      afterState: JSON.stringify({ selectedCategoryId: suggestion.categoryId, basis: suggestion.basis }),
      createdAt: input.now,
    });
    changed.push(workItem.id);
  }
  return { changed, scanned: rows.length, skipped };
}
