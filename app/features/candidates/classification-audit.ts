import type { ClassificationConfidence } from "./category-suggestion";

type ClassificationAuditRow = {
  categorySlug: string;
  confidence: ClassificationConfidence;
};

export type ClassificationAudit = {
  total: number;
  byCategory: Record<string, number>;
  byConfidence: Record<ClassificationConfidence, number>;
  unknownCategoryCount: number;
  lowOrConflictCount: number;
};

export function auditClassifications(
  rows: ReadonlyArray<ClassificationAuditRow>,
  activeSlugs: ReadonlySet<string>,
): ClassificationAudit {
  const byCategory: Record<string, number> = {};
  const byConfidence: Record<ClassificationConfidence, number> = {
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    CONFLICT: 0,
  };
  let unknownCategoryCount = 0;
  let lowOrConflictCount = 0;

  for (const row of rows) {
    byCategory[row.categorySlug] = (byCategory[row.categorySlug] ?? 0) + 1;
    byConfidence[row.confidence] += 1;
    if (!activeSlugs.has(row.categorySlug)) unknownCategoryCount += 1;
    if (row.confidence === "LOW" || row.confidence === "CONFLICT") lowOrConflictCount += 1;
  }

  return { total: rows.length, byCategory, byConfidence, unknownCategoryCount, lowOrConflictCount };
}
