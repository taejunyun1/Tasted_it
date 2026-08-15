import { asc } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { places } from "../../db/schema";
import { classifyChainStore } from "../candidates/chain-store-policy";
import { mergePlaces } from "./place-merge.server";
import { normalizePlaceName } from "./place-name-groups";

const MAX_MATCH_DISTANCE_METERS = 100;

export type SameNameMergePlace = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  status: "DRAFT" | "PUBLISHED" | "HIDDEN";
  createdAt: string;
};

export type SafeSameNameMergeGroup = {
  id: string;
  label: string;
  count: number;
  targetPlaceId: string;
  sourcePlaceIds: string[];
  placeIds: string[];
};

function normalizeAddress(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[^0-9a-z가-힣]/gu, "");
}

function distanceMeters(left: SameNameMergePlace, right: SameNameMergePlace) {
  const radians = Math.PI / 180;
  const latitudeDelta = (right.latitude - left.latitude) * radians;
  const longitudeDelta = (right.longitude - left.longitude) * radians;
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(left.latitude * radians) * Math.cos(right.latitude * radians) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isSameLocation(left: SameNameMergePlace, right: SameNameMergePlace) {
  const leftAddress = normalizeAddress(left.address);
  const rightAddress = normalizeAddress(right.address);
  if (leftAddress && leftAddress === rightAddress) return true;
  return Number.isFinite(left.latitude)
    && Number.isFinite(left.longitude)
    && Number.isFinite(right.latitude)
    && Number.isFinite(right.longitude)
    && distanceMeters(left, right) <= MAX_MATCH_DISTANCE_METERS;
}

function canonicalOrder(left: SameNameMergePlace, right: SameNameMergePlace) {
  const statusRank = (place: SameNameMergePlace) => place.status === "PUBLISHED" ? 0 : place.status === "HIDDEN" ? 1 : 2;
  return statusRank(left) - statusRank(right)
    || left.createdAt.localeCompare(right.createdAt)
    || left.id.localeCompare(right.id);
}

/**
 * Finds only safe merge candidates. A shared name alone does not make two
 * branches the same place: each proposed group must also share an address or
 * sit within 100 metres. Known franchises (including local chains) are never
 * returned here.
 */
export function buildSafeSameNameMergeGroups(rows: SameNameMergePlace[]): SafeSameNameMergeGroup[] {
  const byName = new Map<string, SameNameMergePlace[]>();
  for (const place of rows) {
    if (classifyChainStore(place.name)) continue;
    const normalizedName = normalizePlaceName(place.name);
    if (!normalizedName) continue;
    byName.set(normalizedName, [...(byName.get(normalizedName) ?? []), place]);
  }

  const groups: SafeSameNameMergeGroup[] = [];
  for (const [normalizedName, sameNamePlaces] of byName) {
    const remaining = [...sameNamePlaces].sort(canonicalOrder);
    while (remaining.length) {
      const target = remaining.shift()!;
      const matched = remaining.filter((place) => isSameLocation(target, place));
      if (!matched.length) continue;
      const matchedIds = new Set(matched.map((place) => place.id));
      for (let index = remaining.length - 1; index >= 0; index -= 1) {
        if (matchedIds.has(remaining[index]!.id)) remaining.splice(index, 1);
      }
      const placeIds = [target.id, ...matched.map((place) => place.id)];
      groups.push({
        id: `${normalizedName}:${placeIds.join(":")}`,
        label: target.name,
        count: placeIds.length,
        targetPlaceId: target.id,
        sourcePlaceIds: matched.map((place) => place.id),
        placeIds,
      });
    }
  }
  return groups.sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "ko-KR"));
}

export async function mergeSafeSameNamePlaces(db: AppDb, input: { actorUserId: string; now: string; reason: string }) {
  const reason = input.reason.trim();
  if (!reason) throw new Error("MERGE_REASON_REQUIRED");
  const rows = await db.select({
    id: places.id,
    name: places.name,
    address: places.address,
    latitude: places.latitude,
    longitude: places.longitude,
    status: places.status,
    createdAt: places.createdAt,
  }).from(places).orderBy(asc(places.createdAt));
  const groups = buildSafeSameNameMergeGroups(rows);
  let merged = 0;
  for (const group of groups) {
    for (const sourcePlaceId of group.sourcePlaceIds) {
      await mergePlaces(db, {
        targetPlaceId: group.targetPlaceId,
        sourcePlaceId,
        actorUserId: input.actorUserId,
        reason: `${reason} · 동일 상호·동일 위치 병합`,
        now: input.now,
      });
      merged += 1;
    }
  }
  return { groups: groups.length, merged };
}
