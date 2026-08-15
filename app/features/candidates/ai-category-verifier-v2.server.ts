import {
  AI_CATEGORY_VERIFIER_V2_VERSION,
  validateAiCategoryVerifierV2,
  type AiCategoryVerifierV2Output,
} from "./ai-category-verifier-v2";

const MODEL = "@cf/meta/llama-3.1-8b-instruct-fast" as const;
const SYSTEM_PROMPT = "주어진 음식점 분류 후보를 검증하세요. 후보 밖의 카테고리를 만들지 마세요. 상호와 원천 업태에 직접 근거가 없으면 WEAK 또는 UNKNOWN을 고르세요. CONFLICT 또는 NOT_FOOD는 자동 변경을 막기 위한 판단입니다. 응답은 지정 JSON만 반환하세요.";
const responseSchema = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["SUPPORTED", "WEAK", "CONFLICT", "NOT_FOOD", "UNKNOWN"] },
    candidateSlug: { type: ["string", "null"] },
    evidenceCodes: { type: "array", items: { type: "string" }, maxItems: 5 },
  },
  required: ["verdict", "candidateSlug", "evidenceCodes"],
  additionalProperties: false,
} as const;

type AiRunResponse = { response?: unknown };

/**
 * No raw AI response is persisted or returned.  This is intentionally a
 * verifier: callers may downgrade an automatic rule result, never create a
 * public category from this result alone.
 */
export async function verifyAiCategoryV2(input: {
  ai: Ai;
  businessName: string;
  businessSubtype: string | null;
  candidateSlugs: string[];
  evidenceCodes: string[];
}): Promise<AiCategoryVerifierV2Output | null> {
  const candidateSlugs = [...new Set(input.candidateSlugs)].slice(0, 5);
  const evidenceCodes = [...new Set(input.evidenceCodes)].slice(0, 5);
  if (!candidateSlugs.length) return null;
  const payload = {
    promptVersion: AI_CATEGORY_VERIFIER_V2_VERSION,
    businessName: input.businessName.slice(0, 120),
    businessSubtype: input.businessSubtype?.slice(0, 120) ?? null,
    candidateSlugs,
    evidenceCodes,
  };
  try {
    const result = await input.ai.run(MODEL, {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(payload) },
      ],
      response_format: { type: "json_schema", json_schema: responseSchema },
      max_tokens: 160,
      temperature: 0,
    }) as AiRunResponse;
    return validateAiCategoryVerifierV2(result.response, candidateSlugs, new Set(evidenceCodes));
  } catch {
    return null;
  }
}
