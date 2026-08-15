import type { ResolvedCourseTime } from "./course-options";

export type OperatingAvailability = "OPEN" | "CLOSED" | "UNKNOWN";

export interface CoursePlaceContextV2 {
  primaryCategorySlug: string;
  secondaryCategorySlugs: string[];
  traits: string[];
  availability: OperatingAvailability;
}

export const courseTimeLabels: Record<ResolvedCourseTime, string> = {
  morning: "아침",
  lunch: "점심",
  afternoon: "오후",
  dinner: "저녁",
  night: "밤",
  lateNight: "심야",
};

export function timeFitScore(availability: OperatingAvailability, requestedTime: ResolvedCourseTime, options: { auto: boolean }) {
  if (availability === "CLOSED") return 0;
  const availabilityScore = availability === "OPEN" ? 1 : 0.45;
  return availabilityScore * (options.auto ? 0.8 : 1);
}

export function allowsCourseCandidate(context: CoursePlaceContextV2) {
  return context.availability !== "CLOSED";
}

export function normalizedCourseContext(input: Partial<CoursePlaceContextV2> & { primaryCategorySlug: string }): CoursePlaceContextV2 {
  return {
    primaryCategorySlug: input.primaryCategorySlug,
    secondaryCategorySlugs: [...new Set(input.secondaryCategorySlugs ?? [])].slice(0, 4),
    traits: [...new Set(input.traits ?? [])],
    availability: input.availability ?? "UNKNOWN",
  };
}
