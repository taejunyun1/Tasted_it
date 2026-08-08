export const manualExclusionCategories = [
  "BUSINESS_TYPE",
  "NOT_RESTAURANT",
  "BAD_OR_DUPLICATE_DATA",
  "POLICY",
  "OTHER",
] as const;

export type ManualExclusionCategory = (typeof manualExclusionCategories)[number];

export function validateManualExclusion(category: string, note: string, candidateIds: string[]) {
  if (!manualExclusionCategories.includes(category as ManualExclusionCategory)) {
    throw new Error("EXCLUSION_CATEGORY_INVALID");
  }
  const uniqueCandidateIds = [...new Set(candidateIds.filter(Boolean))];
  if (uniqueCandidateIds.length === 0) throw new Error("CANDIDATE_SELECTION_REQUIRED");
  if (uniqueCandidateIds.length > 25) throw new Error("BULK_LIMIT_EXCEEDED");
  const normalizedNote = note.trim();
  if (category === "OTHER" && !normalizedNote) throw new Error("EXCLUSION_NOTE_REQUIRED");
  return {
    category: category as ManualExclusionCategory,
    note: normalizedNote || null,
    candidateIds: uniqueCandidateIds,
  };
}
