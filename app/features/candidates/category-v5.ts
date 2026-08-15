import { classifyFoodVenue } from "../places/food-venue-policy";
import { categoryV5NameRules, categoryV5SubtypeRules, sourceFallbackV5, type CategoryV5Rule } from "./category-v5-taxonomy";
import type { CategoryEvidenceV5, CategoryV5State, PlaceCategoryProfileV5, PlaceCategoryV5Input, PlaceTrait } from "./category-v5.types";

const SOURCE_SCORE = 10;
const LEVEL_SCORES = { 1: 80, 2: 65, 3: 45, 4: 25, 5: SOURCE_SCORE } as const;

function normalize(value: string | null | undefined) {
  return value?.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[\s·.,()_\-&]/g, "") ?? "";
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function evidenceFor(text: string, rules: CategoryV5Rule[], origin: CategoryEvidenceV5["origin"]) {
  return rules.filter((rule) => rule.pattern.test(text)).map((rule) => ({
    code: rule.code,
    slug: rule.slug,
    level: rule.level,
    origin,
    score: LEVEL_SCORES[rule.level],
  } satisfies CategoryEvidenceV5));
}

function traitsFor(evidence: CategoryEvidenceV5[], name: string, subtype: string) {
  const allRules = [...categoryV5NameRules, ...categoryV5SubtypeRules];
  return unique(evidence.flatMap((item) => {
    const rule = allRules.find((candidate) => candidate.code === item.code);
    return rule?.traits ?? [];
  })).sort() as PlaceTrait[];
}

function candidateScore(evidence: CategoryEvidenceV5[], slug: string) {
  const own = evidence.filter((item) => item.slug === slug).sort((left, right) => left.level - right.level || right.score - left.score);
  if (!own.length) return 0;
  const primary = own[0];
  return Math.min(100, primary.score + own.slice(1).reduce((total, item) => total + Math.round(item.score * 0.3), 0));
}

function foodPlaceScore(evidence: CategoryEvidenceV5[], sourceType: PlaceCategoryV5Input["sourceType"]) {
  const strongest = evidence.filter((item) => item.origin !== "SOURCE").sort((left, right) => left.level - right.level || right.score - left.score)[0];
  const sourceBase = sourceType === "REST_CAFE" || sourceType === "BAKERY" ? 25 : 15;
  if (!strongest) return sourceBase;
  const context = strongest.level === 1 ? 18 : strongest.level === 2 ? 14 : strongest.level === 3 ? 8 : 4;
  return Math.max(0, Math.min(100, strongest.score + context));
}

function stateFor(primary: CategoryEvidenceV5 | undefined, foodScore: number, runnerUpScore: number, primaryScore: number): CategoryV5State {
  if (!primary || foodScore < 25) return "RED";
  if (primary.level <= 2 && primaryScore >= 65 && primaryScore - runnerUpScore >= 15) return "GREEN";
  if (primary.level <= 3 && primaryScore >= 45) return "YELLOW";
  return "ORANGE";
}

export function classifyPlaceCategoryV5(input: PlaceCategoryV5Input): PlaceCategoryProfileV5 {
  const venue = classifyFoodVenue({ businessName: input.businessName, businessSubtype: input.businessSubtype ?? null });
  if (venue.decision === "EXCLUDE" && input.exclusionStatus !== "OVERRIDDEN") {
    return {
      algorithmVersion: "place-category-v5",
      primarySlug: "category-unresolved",
      secondarySlugs: [],
      traits: [],
      foodPlaceScore: 0,
      state: "RED",
      decision: "EXCLUDE",
      evidence: [],
      reasonCodes: [venue.matchedRule],
    };
  }

  const name = normalize(input.businessName);
  const subtype = normalize(input.businessSubtype);
  const evidence = [
    ...evidenceFor(name, categoryV5NameRules, "NAME"),
    ...evidenceFor(subtype, categoryV5SubtypeRules, "SUBTYPE"),
    { code: "SOURCE_FALLBACK", slug: sourceFallbackV5[input.sourceType], level: 5 as const, origin: "SOURCE" as const, score: SOURCE_SCORE },
  ];
  const candidates = unique(evidence.map((item) => item.slug)).map((slug) => ({
    slug,
    score: candidateScore(evidence, slug),
    strongest: evidence.filter((item) => item.slug === slug).sort((left, right) => left.level - right.level || right.score - left.score)[0],
  })).sort((left, right) => left.strongest.level - right.strongest.level || right.score - left.score || left.slug.localeCompare(right.slug));
  const primary = candidates[0];
  const runnerUp = candidates[1];
  const score = foodPlaceScore(evidence, input.sourceType);
  const state = stateFor(primary?.strongest, score, runnerUp?.score ?? 0, primary?.score ?? 0);
  const decision = state === "GREEN" || state === "YELLOW" ? "AUTO" : "MANUAL";
  return {
    algorithmVersion: "place-category-v5",
    primarySlug: primary?.slug ?? "category-unresolved",
    secondarySlugs: candidates.slice(1, 5).map((item) => item.slug),
    traits: traitsFor(evidence, name, subtype),
    foodPlaceScore: score,
    state,
    decision,
    evidence: evidence.sort((left, right) => left.level - right.level || right.score - left.score || left.code.localeCompare(right.code)),
    reasonCodes: unique(evidence.filter((item) => item.slug === primary?.slug).map((item) => item.code)),
  };
}
