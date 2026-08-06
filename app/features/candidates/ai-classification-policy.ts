import { z } from "zod";
import type { ClassificationConfidence } from "./category-suggestion";

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
  const grounded = parsed.evidence.every((token) => {
    const normalizedToken = normalizeEvidence(token);
    return normalizedToken.length >= 2 && normalizedSource.includes(normalizedToken);
  });
  if (!grounded) throw new Error("AI_EVIDENCE_UNGROUNDED");
  return parsed;
}

export function reconcileAiClassification(input: { ruleSlug: string; ruleConfidence: ClassificationConfidence; ai: AiClassification | null }) {
  if (!input.ai) return { categorySlug: input.ruleSlug, confidence: input.ruleConfidence === "CONFLICT" ? "CONFLICT" as const : "MEDIUM" as const, eligible: false, reasons: ["AI 분류 없음 또는 실패"] };
  if (input.ai.categorySlug !== input.ruleSlug) return { categorySlug: input.ai.categorySlug, confidence: "CONFLICT" as const, eligible: false, reasons: ["규칙 분류와 AI 분류 불일치", ...input.ai.reasons] };
  if (input.ai.confidence < 0.85) return { categorySlug: input.ai.categorySlug, confidence: "MEDIUM" as const, eligible: false, reasons: [`AI 신뢰도 ${Math.round(input.ai.confidence * 100)}%`, ...input.ai.reasons] };
  if (input.ruleConfidence !== "HIGH") return { categorySlug: input.ai.categorySlug, confidence: "MEDIUM" as const, eligible: false, reasons: ["규칙 분류 신뢰도가 자동 승인 기준 미만", ...input.ai.reasons] };
  return { categorySlug: input.ai.categorySlug, confidence: "HIGH" as const, eligible: true, reasons: [`AI·규칙 일치 ${Math.round(input.ai.confidence * 100)}%`, ...input.ai.reasons] };
}
