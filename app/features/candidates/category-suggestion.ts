import type { PublicDataSource } from "./public-data";
import {
  nameCategoryRules,
  subtypeCategoryRules,
  type CategoryGroup,
  type CategoryRule,
  type SignalKind,
} from "./category-taxonomy";

export type ClassificationConfidence = "HIGH" | "MEDIUM" | "LOW" | "CONFLICT";

export interface CandidateClassification {
  categorySlug: string;
  candidateSlugs: string[];
  confidence: ClassificationConfidence;
  neighborhood: string | null;
  reasons: string[];
}

type SignalOrigin = "NAME" | "SUBTYPE" | "SOURCE";
type Signal = CategoryRule & { score: number; origin: SignalOrigin };

const defaults: Record<PublicDataSource, { slug: string; group: CategoryGroup }> = {
  GENERAL_RESTAURANT: { slug: "home-meal", group: "korean" },
  REST_CAFE: { slug: "cafe", group: "cafe" },
  BAKERY: { slug: "bakery-detail", group: "cafe" },
  ENTERTAINMENT_BAR: { slug: "pub", group: "bar" },
};

export function extractNeighborhood(address: string | null | undefined) {
  if (!address) return null;
  const isNeighborhood = (token: string) => /(?:동|읍|면|리)$/.test(token);
  const parenthesized = [...address.matchAll(/\(([^)]*)\)/g)].flatMap((match) => match[1].split(/[·,\s]+/)).find(isNeighborhood);
  if (parenthesized) return parenthesized;
  const tokens = address.split(/[·,()\s]+/).filter(isNeighborhood);
  return tokens.find((token) => token.endsWith("리")) ?? tokens.at(-1) ?? null;
}

export function normalizeBusinessName(value: string) {
  return value.normalize("NFKC").replace(/[\s·.,()\-_&]/g, "").replaceAll("육계장", "육개장").replaceAll("타코야키", "타코야끼");
}

function signalScore(origin: SignalOrigin, kind: SignalKind, priority = 0) {
  if (origin === "NAME") return (kind === "FOOD" ? 100 : 55) + priority;
  if (origin === "SUBTYPE") return (kind === "FOOD" ? 70 : kind === "CUISINE" ? 30 : 20) + priority;
  return 5;
}

function collectSignals(input: { sourceType: PublicDataSource; businessSubtype?: string | null; businessName: string }) {
  const normalizedName = normalizeBusinessName(input.businessName);
  const subtype = input.businessSubtype?.normalize("NFKC").trim() ?? "";
  const signals: Signal[] = [
    ...nameCategoryRules.filter((rule) => rule.pattern.test(normalizedName) && !rule.excludePattern?.test(normalizedName)).map((rule) => ({ ...rule, origin: "NAME" as const, score: signalScore("NAME", rule.kind, rule.priority) })),
    ...subtypeCategoryRules.filter((rule) => rule.pattern.test(subtype) && !rule.excludePattern?.test(subtype)).map((rule) => ({ ...rule, origin: "SUBTYPE" as const, score: signalScore("SUBTYPE", rule.kind, rule.priority) })),
  ];
  const fallback = defaults[input.sourceType];
  signals.push({ pattern: /(?:)/, slug: fallback.slug, group: fallback.group, label: "공공데이터 종류의 기본 분류", kind: "DEFAULT", origin: "SOURCE", score: 5 });
  return signals;
}

function rankSignals(signals: Signal[]) {
  const bySlug = new Map<string, Signal>();
  for (const signal of signals) {
    const current = bySlug.get(signal.slug);
    if (!current || signal.score > current.score) bySlug.set(signal.slug, signal);
  }
  return [...bySlug.values()].sort((left, right) => right.score - left.score);
}

export function classifyCandidate(input: {
  sourceType: PublicDataSource;
  businessSubtype?: string | null;
  businessName: string;
  address?: string | null;
}): CandidateClassification {
  const signals = collectSignals(input);
  const ranked = rankSignals(signals);
  const primary = ranked[0];
  const neighborhood = extractNeighborhood(input.address);
  const nameFoodSignals = rankSignals(signals.filter((signal) => signal.origin === "NAME" && signal.kind === "FOOD"));
  const subtypeCuisine = signals.find((signal) => signal.origin === "SUBTYPE" && signal.kind === "CUISINE");
  const hasFoodConflict = nameFoodSignals.length > 1 && nameFoodSignals[0].score === nameFoodSignals[1].score;
  const isCrossCuisineSeafood = primary.group === "seafood";
  const hasCuisineConflict = primary.origin === "NAME" && primary.kind === "FOOD" && subtypeCuisine != null && subtypeCuisine.group !== primary.group && !isCrossCuisineSeafood;
  const hasSubtypeSupport = signals.some((signal) => signal.origin === "SUBTYPE" && signal.group === primary.group && signal.kind !== "DEFAULT")
    || (isCrossCuisineSeafood && subtypeCuisine != null);
  const confidence: ClassificationConfidence = hasFoodConflict || hasCuisineConflict
    ? "CONFLICT"
    : primary.score <= 5
      ? "LOW"
      : primary.origin === "NAME" && hasSubtypeSupport
        ? "HIGH"
        : "MEDIUM";
  const reasons = signals
    .filter((signal) => signal.slug === primary.slug || (hasFoodConflict && signal.origin === "NAME" && signal.kind === "FOOD"))
    .sort((left, right) => right.score - left.score)
    .map((signal) => `${signal.label} (${signal.score}점)`);
  if (hasFoodConflict) reasons.push("상호에 서로 다른 구체 음식 신호가 함께 있음");
  if (hasCuisineConflict) reasons.push(`구체 음식 신호가 원천 업태(${input.businessSubtype})와 불일치`);
  if (primary.kind === "FOOD" && ranked.some((signal) => signal.kind === "VENUE" && signal.score < primary.score)) reasons.push("구체 음식 신호를 영업 형태보다 우선 적용");
  return {
    categorySlug: primary.slug,
    candidateSlugs: ranked.slice(0, 4).map((signal) => signal.slug),
    confidence,
    neighborhood,
    reasons,
  };
}

export function suggestCategorySlugs(sourceType: PublicDataSource, subtype: string | null | undefined) {
  return classifyCandidate({ sourceType, businessSubtype: subtype, businessName: "" }).candidateSlugs;
}
