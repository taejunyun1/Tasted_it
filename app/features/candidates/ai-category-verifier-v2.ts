import { z } from "zod";

export const AI_CATEGORY_VERIFIER_V2_VERSION = "ai-category-verifier-v2" as const;
const verdictSchema = z.enum(["SUPPORTED", "WEAK", "CONFLICT", "NOT_FOOD", "UNKNOWN"]);
const outputSchema = z.object({
  verdict: verdictSchema,
  candidateSlug: z.string().min(1).max(80).nullable(),
  evidenceCodes: z.array(z.string().regex(/^[A-Z0-9_-]{2,80}$/)).max(5),
}).strict();

export type AiCategoryVerifierV2Output = z.infer<typeof outputSchema>;

export function validateAiCategoryVerifierV2(raw: unknown, candidateSlugs: string[], allowedEvidenceCodes: Set<string>) {
  const parsed = outputSchema.safeParse(raw);
  if (!parsed.success) throw new Error("AI_V2_OUTPUT_INVALID");
  if (parsed.data.candidateSlug != null && !candidateSlugs.includes(parsed.data.candidateSlug)) throw new Error("AI_V2_CANDIDATE_OUTSIDE_SET");
  if (parsed.data.evidenceCodes.some((code) => !allowedEvidenceCodes.has(code))) throw new Error("AI_V2_EVIDENCE_UNGROUNDED");
  if ((parsed.data.verdict === "SUPPORTED" || parsed.data.verdict === "WEAK") && parsed.data.candidateSlug == null) throw new Error("AI_V2_CANDIDATE_REQUIRED");
  if ((parsed.data.verdict === "CONFLICT" || parsed.data.verdict === "NOT_FOOD") && parsed.data.candidateSlug != null) throw new Error("AI_V2_CANDIDATE_FORBIDDEN");
  return parsed.data;
}

/** AI can block an automatic change but never creates a public classification by itself. */
export function reconcileAiCategoryVerifierV2(input: { ruleDecision: "AUTO" | "MANUAL" | "EXCLUDE"; verifier: AiCategoryVerifierV2Output | null }) {
  if (!input.verifier) return input.ruleDecision;
  return input.verifier.verdict === "CONFLICT" || input.verifier.verdict === "NOT_FOOD"
    ? "MANUAL" as const
    : input.ruleDecision;
}
