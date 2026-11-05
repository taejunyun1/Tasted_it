import { and, eq, inArray } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { loadInD1Chunks } from "../../db/d1-query-chunks";
import { adminAuditLogs, businessLicenses, placeReviewDuplicateResolutions, placeReviewWorkItems, places } from "../../db/schema";
import { classifyChainStore } from "../candidates/chain-store-policy";
import { REVIEW_BATCH_MAX } from "./place-review-io";
import { normalizePlaceName } from "./place-name-groups";

const MAX_MATCH_DISTANCE_METERS = 100;

export type ReviewDuplicateCandidate = {
  workItemId: string;
  candidatePlaceId: string;
  name: string;
  address: string;
  distanceMeters: number | null;
  reason: "SAME_ADDRESS" | "WITHIN_100_METERS";
  decision: "LINK_EXISTING" | "MERGE" | "DISTINCT" | null;
};

function normalizeAddress(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[^0-9a-z가-힣]/gu, "");
}

function distanceMeters(left: { latitude: number; longitude: number }, right: { latitude: number; longitude: number }) {
  const radians = Math.PI / 180;
  const latitudeDelta = (right.latitude - left.latitude) * radians;
  const longitudeDelta = (right.longitude - left.longitude) * radians;
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(left.latitude * radians) * Math.cos(right.latitude * radians) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function uniqueIds(ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length > REVIEW_BATCH_MAX) throw new Error("PLACE_REVIEW_BATCH_LIMIT_EXCEEDED");
  return unique;
}

/**
 * Finds only conservative candidates: same normalized name and same address or
 * within 100m. Known franchise/chain stores are deliberately excluded because
 * identical brands at separate branches are not merge candidates.
 */
export async function listReviewDuplicateCandidates(db: AppDb, workItemIds: string[]) {
  const ids = uniqueIds(workItemIds);
  if (!ids.length) return [] as ReviewDuplicateCandidate[];
  const [items, candidatePlaces, resolutions] = await Promise.all([
    db.select({ workItem: placeReviewWorkItems, license: businessLicenses, place: places })
      .from(placeReviewWorkItems)
      .leftJoin(businessLicenses, eq(businessLicenses.id, placeReviewWorkItems.businessLicenseId))
      .leftJoin(places, eq(places.id, placeReviewWorkItems.placeId))
      .where(inArray(placeReviewWorkItems.id, ids)),
    db.select({ id: places.id, name: places.name, address: places.address, latitude: places.latitude, longitude: places.longitude })
      .from(places),
    db.select().from(placeReviewDuplicateResolutions).where(inArray(placeReviewDuplicateResolutions.workItemId, ids)),
  ]);
  const resolutionByPair = new Map(resolutions.map((row) => [`${row.workItemId}|${row.candidatePlaceId}`, row.decision]));
  const candidates: ReviewDuplicateCandidate[] = [];

  for (const { workItem, license, place } of items) {
    const name = license?.businessName ?? place?.name ?? "";
    const address = license?.roadAddress ?? license?.lotAddress ?? place?.address ?? "";
    const latitude = license?.latitude ?? place?.latitude ?? null;
    const longitude = license?.longitude ?? place?.longitude ?? null;
    if (!name || !address || latitude == null || longitude == null || classifyChainStore(name)) continue;
    const normalizedName = normalizePlaceName(name);
    if (!normalizedName) continue;

    for (const candidate of candidatePlaces) {
      if (candidate.id === workItem.placeId || classifyChainStore(candidate.name) || normalizePlaceName(candidate.name) !== normalizedName) continue;
      const sameAddress = normalizeAddress(address) === normalizeAddress(candidate.address);
      const meters = distanceMeters({ latitude, longitude }, candidate);
      if (!sameAddress && meters > MAX_MATCH_DISTANCE_METERS) continue;
      candidates.push({
        workItemId: workItem.id,
        candidatePlaceId: candidate.id,
        name: candidate.name,
        address: candidate.address,
        distanceMeters: Math.round(meters),
        reason: sameAddress ? "SAME_ADDRESS" : "WITHIN_100_METERS",
        decision: resolutionByPair.get(`${workItem.id}|${candidate.id}`) ?? null,
      });
    }
  }
  return candidates;
}

export async function openReviewDuplicateCount(db: AppDb, workItem: typeof placeReviewWorkItems.$inferSelect) {
  const candidates = await listReviewDuplicateCandidates(db, [workItem.id]);
  return candidates.filter((candidate) => !candidate.decision).length;
}

/**
 * Same undecided-candidate counts as `openReviewDuplicateCount` for many items
 * at once, without the per-item O(items x places) nested scan: candidate places
 * are indexed by normalized name once, then each item checks only its bucket.
 * Internal caller (sweep) passes up to REVIEW_SWEEP_MAX ids; the public batch
 * cap on listReviewDuplicateCandidates does not apply here.
 */
export async function openReviewDuplicateCounts(db: AppDb, workItemIds: string[]) {
  const ids = [...new Set(workItemIds.filter(Boolean))];
  const counts = new Map<string, number>();
  if (!ids.length) return counts;
  const [items, candidatePlaces, resolutions] = await Promise.all([
    loadInD1Chunks(ids, (chunk) => db.select({ workItem: placeReviewWorkItems, license: businessLicenses, place: places })
      .from(placeReviewWorkItems)
      .leftJoin(businessLicenses, eq(businessLicenses.id, placeReviewWorkItems.businessLicenseId))
      .leftJoin(places, eq(places.id, placeReviewWorkItems.placeId))
      .where(inArray(placeReviewWorkItems.id, chunk)), { reservedBindings: 10 }),
    db.select({ id: places.id, name: places.name, address: places.address, latitude: places.latitude, longitude: places.longitude })
      .from(places),
    loadInD1Chunks(ids, (chunk) => db.select().from(placeReviewDuplicateResolutions).where(inArray(placeReviewDuplicateResolutions.workItemId, chunk)), { reservedBindings: 10 }),
  ]);
  const resolutionByPair = new Map(resolutions.map((row) => [`${row.workItemId}|${row.candidatePlaceId}`, row.decision]));
  const placesByNormalizedName = new Map<string, typeof candidatePlaces>();
  for (const candidate of candidatePlaces) {
    if (classifyChainStore(candidate.name)) continue;
    const normalized = normalizePlaceName(candidate.name);
    if (!normalized) continue;
    const bucket = placesByNormalizedName.get(normalized) ?? [];
    bucket.push(candidate);
    placesByNormalizedName.set(normalized, bucket);
  }
  for (const { workItem, license, place } of items) {
    const name = license?.businessName ?? place?.name ?? "";
    const address = license?.roadAddress ?? license?.lotAddress ?? place?.address ?? "";
    const latitude = license?.latitude ?? place?.latitude ?? null;
    const longitude = license?.longitude ?? place?.longitude ?? null;
    let count = 0;
    if (name && address && latitude != null && longitude != null && !classifyChainStore(name)) {
      const normalizedName = normalizePlaceName(name);
      const normalizedAddress = normalizeAddress(address);
      for (const candidate of placesByNormalizedName.get(normalizedName) ?? []) {
        if (candidate.id === workItem.placeId) continue;
        const sameAddress = normalizedAddress === normalizeAddress(candidate.address);
        const meters = distanceMeters({ latitude, longitude }, candidate);
        if (!sameAddress && meters > MAX_MATCH_DISTANCE_METERS) continue;
        if (!resolutionByPair.get(`${workItem.id}|${candidate.id}`)) count += 1;
      }
    }
    counts.set(workItem.id, count);
  }
  return counts;
}

export async function resolveReviewDuplicates(db: AppDb, input: {
  resolutions: Array<{ workItemId: string; candidatePlaceId: string; decision: "LINK_EXISTING" | "MERGE" | "DISTINCT"; reason: string }>;
  actorUserId: string;
  now: string;
}) {
  if (input.resolutions.length > REVIEW_BATCH_MAX * 5) throw new Error("PLACE_REVIEW_DUPLICATE_BATCH_LIMIT_EXCEEDED");
  const accepted: string[] = [];
  const skipped: Array<{ candidatePlaceId: string; code: string }> = [];
  const byWorkItem = new Map<string, string[]>();
  for (const resolution of input.resolutions) byWorkItem.set(resolution.workItemId, [...(byWorkItem.get(resolution.workItemId) ?? []), resolution.candidatePlaceId]);

  for (const resolution of input.resolutions) {
    const reason = resolution.reason.trim();
    if (reason.length < 10) {
      skipped.push({ candidatePlaceId: resolution.candidatePlaceId, code: "DUPLICATE_REASON_REQUIRED" });
      continue;
    }
    const current = await listReviewDuplicateCandidates(db, [resolution.workItemId]);
    if (!current.some((candidate) => candidate.candidatePlaceId === resolution.candidatePlaceId)) {
      skipped.push({ candidatePlaceId: resolution.candidatePlaceId, code: "DUPLICATE_CANDIDATE_STALE" });
      continue;
    }
    await db.insert(placeReviewDuplicateResolutions).values({
      id: crypto.randomUUID(), workItemId: resolution.workItemId, candidatePlaceId: resolution.candidatePlaceId,
      decision: resolution.decision, reason, reviewedBy: input.actorUserId, reviewedAt: input.now,
      createdAt: input.now, updatedAt: input.now,
    }).onConflictDoUpdate({
      target: [placeReviewDuplicateResolutions.workItemId, placeReviewDuplicateResolutions.candidatePlaceId],
      set: { decision: resolution.decision, reason, reviewedBy: input.actorUserId, reviewedAt: input.now, updatedAt: input.now },
    });
    await db.insert(adminAuditLogs).values({
      id: crypto.randomUUID(), actorUserId: input.actorUserId, action: "PLACE_REVIEW_DUPLICATE_DECISION",
      targetType: "PLACE_REVIEW_WORK_ITEM", targetId: resolution.workItemId,
      beforeState: null, afterState: JSON.stringify({ candidatePlaceId: resolution.candidatePlaceId, decision: resolution.decision, reason }), createdAt: input.now,
    });
    accepted.push(`${resolution.workItemId}|${resolution.candidatePlaceId}`);
  }
  return { accepted, skipped };
}
