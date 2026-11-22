import { sql } from "drizzle-orm";
import type { AppDb } from "../../db/client.server";
import { placeCategoryV5Profiles, placeCourseContexts, placeOperatingHours } from "../../db/schema";
import { informationDate, type RecordedOperatingHours } from "../places/public-information";
import { normalizedCourseContext, type CoursePlaceContextV2 } from "./course-context-v2";
import { operatingAvailabilityAt } from "./operating-hours";

const allowedTraits = new Set(["soloFriendly", "groupFriendly", "lateNight", "family", "date", "quickMeal", "alcoholFriendly", "dessert", "parkingFriendly"]);

function parseStringList(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}

function parseTraits(value: string) {
  return parseStringList(value).filter((item) => allowedTraits.has(item));
}

export async function listPlaceCourseContexts(
  db: AppDb,
  places: Array<{ id: string; primaryCategory: { slug: string } }>,
  now: Date,
) {
  if (!places.length) return new Map<string, CoursePlaceContextV2>();
  // Course v2 reads up to 250 candidates. Bind their IDs as one JSON array
  // per query so D1 can look up the indexed place IDs within its variable limit.
  const candidatePlaceIds = sql`(select value from json_each(${JSON.stringify(places.map((place) => place.id))}))`;
  const [profiles, contexts, hours] = await Promise.all([
    db.select().from(placeCategoryV5Profiles).where(sql`${placeCategoryV5Profiles.placeId} in ${candidatePlaceIds}`),
    db.select().from(placeCourseContexts).where(sql`${placeCourseContexts.placeId} in ${candidatePlaceIds}`),
    db.select().from(placeOperatingHours).where(sql`${placeOperatingHours.placeId} in ${candidatePlaceIds}`),
  ]);
  const profileById = new Map(profiles.map((item) => [item.placeId, item]));
  const contextById = new Map(contexts.map((item) => [item.placeId, item]));
  const hoursById = new Map<string, RecordedOperatingHours[]>();
  const verificationDates = new Map([...new Set(hours.map((hour) => hour.lastVerifiedAt))]
    .map((date) => [date, informationDate(date)]));
  for (const hour of hours) {
    const list = hoursById.get(hour.placeId) ?? [];
    list.push(hour);
    hoursById.set(hour.placeId, list);
  }
  return new Map(places.map((place) => {
    const profile = profileById.get(place.id);
    const manual = contextById.get(place.id);
    const secondary = profile ? parseStringList(profile.secondaryCategorySlugsJson) : [];
    const derivedTraits = profile ? parseTraits(profile.traitsJson) : [];
    const traits = manual ? parseTraits(manual.traitsJson) : derivedTraits;
    const recordedHours = hoursById.get(place.id) ?? [];
    // Match the public place detail: one unverified interval leaves that weekday unknown.
    const unverifiedWeekdays = new Set(recordedHours
      .filter((hour) => !verificationDates.get(hour.lastVerifiedAt))
      .map((hour) => hour.weekday));
    const verifiedHours = recordedHours.filter((hour) => !unverifiedWeekdays.has(hour.weekday));
    return [place.id, normalizedCourseContext({
      primaryCategorySlug: profile?.primaryCategorySlug ?? place.primaryCategory.slug,
      secondaryCategorySlugs: secondary,
      traits,
      availability: operatingAvailabilityAt(verifiedHours, now),
    })];
  }));
}
