import { inArray } from "drizzle-orm";
import type { AppDb } from "../../db/client.server";
import { placeCategoryV5Profiles, placeCourseContexts, placeOperatingHours } from "../../db/schema";
import { normalizedCourseContext, type CoursePlaceContextV2 } from "./course-context-v2";
import { operatingAvailabilityAt, type OperatingHoursInterval } from "./operating-hours";

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
  const ids = places.map((place) => place.id);
  const [profiles, contexts, hours] = await Promise.all([
    db.select().from(placeCategoryV5Profiles).where(inArray(placeCategoryV5Profiles.placeId, ids)),
    db.select().from(placeCourseContexts).where(inArray(placeCourseContexts.placeId, ids)),
    db.select().from(placeOperatingHours).where(inArray(placeOperatingHours.placeId, ids)),
  ]);
  const profileById = new Map(profiles.map((item) => [item.placeId, item]));
  const contextById = new Map(contexts.map((item) => [item.placeId, item]));
  const hoursById = new Map<string, OperatingHoursInterval[]>();
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
    return [place.id, normalizedCourseContext({
      primaryCategorySlug: profile?.primaryCategorySlug ?? place.primaryCategory.slug,
      secondaryCategorySlugs: secondary,
      traits,
      availability: operatingAvailabilityAt(hoursById.get(place.id) ?? [], now),
    })];
  }));
}
