import { z } from "zod";
import { confidenceFromScore, type ClassificationConfidence } from "./category-suggestion";

const outputSchema = z.object({
  categorySlug: z.string().min(1).max(80),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string().min(1).max(80)).min(1).max(3).optional(),
  reasons: z.array(z.string().min(1).max(160)).max(3),
}).strict();

export type AiClassification = z.infer<typeof outputSchema>;

export function validateAiClassification(raw: unknown, allowedSlugs: Set<string>): AiClassification {
  const parsed = outputSchema.safeParse(raw);
  if (!parsed.success) throw new Error("AI_OUTPUT_INVALID");
  if (!allowedSlugs.has(parsed.data.categorySlug)) throw new Error("AI_CATEGORY_UNKNOWN");
  return parsed.data;
}

function normalizeEvidence(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[^0-9a-z가-힣]/g, "").replaceAll("육계장", "육개장").replaceAll("타코야키", "타코야끼");
}

export function validateGroundedAiClassification(raw: unknown, allowedSlugs: Set<string>, evidenceText: string): AiClassification {
  const parsed = validateAiClassification(raw, allowedSlugs);
  if (!parsed.evidence?.length) throw new Error("AI_EVIDENCE_MISSING");
  const normalizedSource = normalizeEvidence(evidenceText);
  const groundedEvidence = parsed.evidence.filter((token) => {
    const normalizedToken = normalizeEvidence(token);
    return normalizedToken.length >= 2 && normalizedSource.includes(normalizedToken);
  });
  if (!groundedEvidence.length) throw new Error("AI_EVIDENCE_UNGROUNDED");
  return { ...parsed, evidence: groundedEvidence };
}

function clampScore(score: number) {
  return Math.min(100, Math.max(0, Math.round(score)));
}

export function reconcileAiClassification(input: {
  ruleSlug: string;
  ruleConfidence: ClassificationConfidence;
  ruleScore: number;
  ai: AiClassification | null;
}) {
  const ruleScore = clampScore(input.ruleScore);
  if (input.ruleConfidence === "CONFLICT") return {
    categorySlug: input.ruleSlug,
    confidence: "CONFLICT" as const,
    confidenceScore: ruleScore,
    eligible: false,
    reasons: ["규칙의 구체 음식 신호 충돌 유지", ...(input.ai?.reasons ?? [])],
  };
  if (!input.ai) return {
    categorySlug: input.ruleSlug,
    confidence: input.ruleConfidence,
    confidenceScore: ruleScore,
    eligible: false,
    reasons: ["AI 분류 없음 또는 실패"],
  };
  if (input.ai.categorySlug !== input.ruleSlug) {
    if (input.ai.confidence >= 0.85) return {
      categorySlug: input.ruleSlug,
      confidence: "CONFLICT" as const,
      confidenceScore: ruleScore,
      eligible: false,
      reasons: ["규칙 분류와 고신뢰 AI 분류 불일치", ...input.ai.reasons],
    };
    const adjustedScore = clampScore(ruleScore - 10);
    return {
      categorySlug: input.ruleSlug,
      confidence: confidenceFromScore(adjustedScore),
      confidenceScore: adjustedScore,
      eligible: false,
      reasons: [`낮은 신뢰도의 AI 불일치로 10점 감산 (${Math.round(input.ai.confidence * 100)}%)`, ...input.ai.reasons],
    };
  }
  const adjustedScore = clampScore(ruleScore + Math.round(input.ai.confidence * 10));
  const confidence = confidenceFromScore(adjustedScore);
  const eligible = input.ai.confidence >= 0.85 && confidence === "HIGH";
  return {
    categorySlug: input.ruleSlug,
    confidence,
    confidenceScore: adjustedScore,
    eligible,
    reasons: [`AI·규칙 일치 ${Math.round(input.ai.confidence * 100)}%`, ...input.ai.reasons],
  };
}
