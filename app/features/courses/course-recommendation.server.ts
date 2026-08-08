import type { AppDb } from "../../db/client.server";
import { recommendParkingForCourse } from "../parking/parking-recommendation.server";
import { listPlaces, listPublicCategoryGroups } from "../places/place.server";
import type { CourseContext, CourseOptions } from "./course-options";
import { rankCoursePairs } from "./course-score";

function boundingBox(context: CourseContext, radiusKm: number): [number, number, number, number] {
  const latitudeDelta = radiusKm / 90;
  const longitudeDelta = radiusKm / 80;
  return [context.longitude - longitudeDelta, context.latitude - latitudeDelta, context.longitude + longitudeDelta, context.latitude + latitudeDelta];
}

function startAt(now: Date, time: CourseContext["resolvedTime"]) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = { lunch: 12, afternoon: 15, dinner: 18, late: 21 }[time];
  return `${values.year}-${values.month}-${values.day}T${String(hour).padStart(2, "0")}:00:00+09:00`;
}

export async function recommendCourses(db: AppDb, input: { options: CourseOptions; context: CourseContext; now: Date }) {
  const [places, groups] = await Promise.all([
    listPlaces(db, { bbox: boundingBox(input.context, input.options.radiusKm), limit: 100 }),
    listPublicCategoryGroups(db),
  ]);
  const pairs = rankCoursePairs({
    places,
    center: { latitude: input.context.latitude, longitude: input.context.longitude },
    mealCategories: input.options.mealCategories,
    second: input.options.second,
    radiusKm: input.options.radiusKm,
    limit: 3,
  });
  const courses = await Promise.all(pairs.map(async (pair) => ({
    ...pair,
    parking: await recommendParkingForCourse(db, {
      first: { id: pair.first.id, latitude: pair.first.latitude, longitude: pair.first.longitude },
      second: { id: pair.second.id, latitude: pair.second.latitude, longitude: pair.second.longitude },
      startsAt: startAt(input.now, input.context.resolvedTime),
      firstStayMinutes: 70,
      secondStayMinutes: 60,
      weather: input.options.weather === "rain" ? "RAIN" : "NORMAL",
      childAccompanied: input.options.child,
      evRequirement: input.options.ev === "required" ? "REQUIRED" : input.options.ev === "preferred" ? "PREFERRED" : "NONE",
      parkingMode: input.options.parkingMode,
    }),
  })));
  return {
    algorithmVersion: "course-parking-v1" as const,
    categories: groups.filter((group) => group.slug !== "cafe-dessert").flatMap((group) => group.children),
    courses,
  };
}
