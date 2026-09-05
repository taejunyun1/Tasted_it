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
  confidenceScore: number;
  neighborhood: string | null;
  reasons: string[];
}

export type CandidateClassificationInput = {
  sourceType: PublicDataSource;
  businessSubtype?: string | null;
  businessName: string;
  address?: string | null;
};

type SignalOrigin = "NAME" | "SUBTYPE" | "SOURCE";
type EvidenceTier = 1 | 2 | 3 | 4 | 5;
type Signal = CategoryRule & { baseScore: number; score: number; origin: SignalOrigin; evidenceTier: EvidenceTier };
type RankedCandidate = {
  slug: string;
  group: CategoryGroup;
  score: number;
  evidenceTier: EvidenceTier;
  signals: Signal[];
};

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

const baseSignalScores: Record<SignalOrigin, Partial<Record<SignalKind, number>>> = {
  NAME: { FOOD: 80, VENUE: 74 },
  SUBTYPE: { FOOD: 65, VENUE: 45, CUISINE: 35 },
  SOURCE: { DEFAULT: 15 },
};

function signalScore(origin: SignalOrigin, kind: SignalKind, priority = 0) {
  const baseScore = baseSignalScores[origin][kind] ?? 0;
  const priorityBonus = Math.min(10, Math.max(0, Math.round(priority / 4)));
  return { baseScore, score: baseScore + priorityBonus };
}

function clampScore(score: number) {
  return Math.min(100, Math.max(0, Math.round(score)));
}

export function confidenceFromScore(score: number, evidenceTier?: EvidenceTier) {
  if (evidenceTier != null && evidenceTier <= 2 && score >= 65) return "HIGH" as const;
  if (score >= 78) return "HIGH" as const;
  if (score >= 50) return "MEDIUM" as const;
  return "LOW" as const;
}

function evidenceTierFor(rule: CategoryRule, origin: SignalOrigin): EvidenceTier {
  if (rule.evidenceTier) return rule.evidenceTier;
  if (origin === "SOURCE") return 5;
  if (origin === "SUBTYPE") return rule.kind === "FOOD" ? 2 : 4;
  if (rule.kind === "FOOD") return 1;
  return 3;
}

function compareSignals(left: Signal, right: Signal) {
  return left.evidenceTier - right.evidenceTier || right.score - left.score;
}

function collectSignals(input: { sourceType: PublicDataSource; businessSubtype?: string | null; businessName: string }) {
  const normalizedName = normalizeBusinessName(input.businessName);
  const subtype = input.businessSubtype?.normalize("NFKC").trim() ?? "";
  const signals: Signal[] = [
    ...nameCategoryRules.filter((rule) => rule.pattern.test(normalizedName) && !rule.excludePattern?.test(normalizedName)).map((rule) => ({ ...rule, origin: "NAME" as const, evidenceTier: evidenceTierFor(rule, "NAME"), ...signalScore("NAME", rule.kind, rule.priority) })),
    ...subtypeCategoryRules.filter((rule) => rule.pattern.test(subtype) && !rule.excludePattern?.test(subtype)).map((rule) => ({ ...rule, origin: "SUBTYPE" as const, evidenceTier: evidenceTierFor(rule, "SUBTYPE"), ...signalScore("SUBTYPE", rule.kind, rule.priority) })),
  ];
  const fallback = defaults[input.sourceType];
  const sourceScore = signalScore("SOURCE", "DEFAULT");
  signals.push({ pattern: /(?:)/, slug: fallback.slug, group: fallback.group, label: "공공데이터 종류의 기본 분류", kind: "DEFAULT", origin: "SOURCE", evidenceTier: 5, ...sourceScore });
  return signals;
}

function strongestSignalsBySlug(signals: Signal[]) {
  const bySlug = new Map<string, Signal>();
  for (const signal of signals) {
    const current = bySlug.get(signal.slug);
    if (!current || compareSignals(signal, current) < 0) bySlug.set(signal.slug, signal);
  }
  return [...bySlug.values()].sort(compareSignals);
}

function rankCandidates(signals: Signal[]): RankedCandidate[] {
  const bySlug = new Map<string, Signal[]>();
  for (const signal of signals) {
    const current = bySlug.get(signal.slug) ?? [];
    current.push(signal);
    bySlug.set(signal.slug, current);
  }
  return [...bySlug.entries()].map(([slug, candidateSignals]) => {
    const ordered = [...candidateSignals].sort(compareSignals);
    const evidenceScore = ordered.reduce((total, signal, index) => total + (index === 0 ? signal.score : Math.round(signal.baseScore * 0.3)), 0);
    const group = ordered[0].group;
    const cuisineSupport = signals.some((signal) => signal.origin === "SUBTYPE" && signal.kind === "CUISINE" && signal.group === group && signal.slug !== slug) ? 6 : 0;
    return { slug, group, score: clampScore(evidenceScore + cuisineSupport), evidenceTier: ordered[0].evidenceTier, signals: ordered };
  }).sort((left, right) => left.evidenceTier - right.evidenceTier || right.score - left.score);
}

export function classifyCandidate(input: CandidateClassificationInput): CandidateClassification {
  const signals = collectSignals(input);
  const ranked = rankCandidates(signals);
  const primary = ranked[0];
  const neighborhood = extractNeighborhood(input.address);
  const concreteFoodSignals = strongestSignalsBySlug(signals.filter((signal) => signal.origin !== "SOURCE" && signal.kind === "FOOD"));
  const hasExplicitPriorityWinner = concreteFoodSignals.length > 1
    && concreteFoodSignals[0].evidenceTier === concreteFoodSignals[1].evidenceTier
    && (concreteFoodSignals[0].priority ?? 0) > (concreteFoodSignals[1].priority ?? 0);
  const hasFoodConflict = concreteFoodSignals.length > 1
    && concreteFoodSignals[0].evidenceTier === concreteFoodSignals[1].evidenceTier
    && concreteFoodSignals[0].score >= 65
    && concreteFoodSignals[1].score >= 65
    && concreteFoodSignals[0].score - concreteFoodSignals[1].score <= 20
    && !hasExplicitPriorityWinner;
  const confidence: ClassificationConfidence = hasFoodConflict ? "CONFLICT" : confidenceFromScore(primary.score, primary.evidenceTier);
  const reasons = signals
    .filter((signal) => signal.slug === primary.slug || (hasFoodConflict && signal.kind === "FOOD" && signal.origin !== "SOURCE"))
    .sort(compareSignals)
    .map((signal) => `${signal.label} (${signal.score}점)`);
  if (hasFoodConflict) reasons.push("상호에 서로 다른 구체 음식 신호가 함께 있음");
  if (primary.signals.some((signal) => signal.kind === "FOOD") && signals.some((signal) => signal.kind === "VENUE" && signal.slug !== primary.slug && signal.score < primary.score)) reasons.push("구체 음식 신호를 영업 형태보다 우선 적용");
  reasons.push(`최종 규칙 점수 ${primary.score}점`);
  return {
    categorySlug: primary.slug,
    candidateSlugs: ranked.slice(0, 4).map((candidate) => candidate.slug),
    confidence,
    confidenceScore: primary.score,
    neighborhood,
    reasons,
  };
}

/**
 * Concrete source subtypes are an authoritative guardrail for automated output only
 * when they agree with the final rule category. A more specific business-name
 * food signal (for example, 라멘 under the broad 한식 subtype) still wins.
 */
export function getAuthoritativeSubtypeCategorySlug(
  input: CandidateClassificationInput,
  classification: CandidateClassification = classifyCandidate(input),
) {
  const subtype = input.businessSubtype?.normalize("NFKC").trim() ?? "";
  if (!subtype || classification.confidence === "CONFLICT") return null;
  const matchesFinalCategory = subtypeCategoryRules.some((rule) =>
    (rule.kind === "FOOD" || rule.kind === "VENUE") && rule.slug === classification.categorySlug
    && rule.pattern.test(subtype)
    && !rule.excludePattern?.test(subtype),
  );
  return matchesFinalCategory ? classification.categorySlug : null;
}

/**
 * Returns a concrete food signal found in the business name only.  Broad
 * cuisine and venue wording intentionally do not become an authority here:
 * they are useful context, but should not overturn a verified provider or
 * source-subtype result on their own.
 */
export function getStrongestNameFoodCategorySlug(input: CandidateClassificationInput) {
  const candidates = strongestSignalsBySlug(
    collectSignals(input).filter((signal) => signal.origin === "NAME" && signal.kind === "FOOD"),
  );
  const primary = candidates[0];
  const runnerUp = candidates[1];
  if (!primary) return null;
  if (runnerUp && primary.evidenceTier === runnerUp.evidenceTier && primary.score - runnerUp.score <= 20) return null;
  return primary.slug;
}

export function suggestCategorySlugs(sourceType: PublicDataSource, subtype: string | null | undefined) {
  return classifyCandidate({ sourceType, businessSubtype: subtype, businessName: "" }).candidateSlugs;
}
