import type { PublicDataSource } from "./public-data";
import { classifyCandidate, type ClassificationConfidence } from "./category-suggestion";

type AuditCandidate = {
  sourceType: PublicDataSource;
  businessSubtype?: string | null;
  businessName: string;
};

export type CategoryClassificationAudit = {
  total: number;
  categoryCounts: Record<string, number>;
  confidenceCounts: Record<ClassificationConfidence, number>;
  manualReviewCount: number;
};

export function auditCategoryClassifications(candidates: AuditCandidate[]): CategoryClassificationAudit {
  const categoryCounts = new Map<string, number>();
  const confidenceCounts: Record<ClassificationConfidence, number> = {
    CONFLICT: 0,
    HIGH: 0,
    LOW: 0,
    MEDIUM: 0,
  };

  for (const candidate of candidates) {
    const classification = classifyCandidate(candidate);
    categoryCounts.set(classification.categorySlug, (categoryCounts.get(classification.categorySlug) ?? 0) + 1);
    confidenceCounts[classification.confidence] += 1;
  }

  return {
    total: candidates.length,
    categoryCounts: Object.fromEntries([...categoryCounts.entries()].sort(([left], [right]) => left.localeCompare(right))),
    confidenceCounts,
    manualReviewCount: confidenceCounts.LOW + confidenceCounts.CONFLICT,
  };
}
