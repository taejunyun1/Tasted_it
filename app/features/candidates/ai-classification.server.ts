import { and, asc, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import type { AppDb } from "../../db/client.server";
import { aiClassificationRuns, businessLicenses, categories } from "../../db/schema";
import { recordOperationalAlert } from "../operations/alerts.server";
import { validateAiClassification } from "./ai-classification-policy";

export const AI_CLASSIFICATION_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast" as const;
export const AI_CLASSIFICATION_PROMPT = "place-category-v1";
const responseSchema = { type: "object", properties: { categorySlug: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 }, reasons: { type: "array", items: { type: "string" }, maxItems: 3 } }, required: ["categorySlug", "confidence", "reasons"], additionalProperties: false } as const;

async function sha256(value: string) { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }

export async function classifyPendingCandidatesWithAi(db: AppDb, ai: Ai, input: { candidateIds?: string[]; limit?: number; now: string }) {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 100); const dayStart = `${input.now.slice(0, 10)}T00:00:00.000Z`;
  const usedToday = await db.select({ id: aiClassificationRuns.id }).from(aiClassificationRuns).where(gte(aiClassificationRuns.createdAt, dayStart)).limit(500);
  const remaining = Math.max(0, 500 - usedToday.length); if (!remaining) return { processed: 0, succeeded: 0, failed: 0, cached: 0, limited: true };
  const conditions = [eq(businessLicenses.normalizedStatus, "OPEN"), eq(businessLicenses.reviewStatus, "PENDING")];
  if (input.candidateIds?.length) conditions.push(inArray(businessLicenses.id, [...new Set(input.candidateIds)].slice(0, limit)));
  const [candidateRows, categoryRows] = await Promise.all([
    db.select().from(businessLicenses).where(and(...conditions)).orderBy(asc(businessLicenses.updatedAt)).limit(Math.min(limit, remaining)),
    db.select({ slug: categories.slug, name: categories.name }).from(categories).where(and(eq(categories.isActive, true), isNotNull(categories.parentId))).orderBy(asc(categories.sortOrder)),
  ]);
  const allowed = new Set(categoryRows.map((category) => category.slug)); let succeeded = 0; let failed = 0; let cached = 0;
  for (const candidate of candidateRows) {
    const payload = { businessName: candidate.businessName, businessSubtype: candidate.businessSubtype, regionCode: candidate.regionCode, categories: categoryRows };
    const inputHash = await sha256(JSON.stringify(payload)); const cutoff = new Date(new Date(input.now).getTime() - 30 * 86_400_000).toISOString();
    const cachedRun = await db.query.aiClassificationRuns.findFirst({ where: and(eq(aiClassificationRuns.inputHash, inputHash), eq(aiClassificationRuns.status, "SUCCESS"), gte(aiClassificationRuns.createdAt, cutoff)), orderBy: desc(aiClassificationRuns.createdAt) });
    try {
      const result = cachedRun ? { categorySlug: cachedRun.categorySlug, confidence: cachedRun.confidence, reasons: JSON.parse(cachedRun.reasonsJson ?? "[]") } : ((await ai.run(AI_CLASSIFICATION_MODEL, { messages: [{ role: "system", content: "한국 음식점의 대표 세부 카테고리를 허용 목록에서 하나만 선택하세요. 근거는 최대 3개이며 개인정보를 추론하지 마세요." }, { role: "user", content: JSON.stringify(payload) }], response_format: { type: "json_schema", json_schema: responseSchema }, max_tokens: 220, temperature: 0 })) as { response: unknown }).response;
      const parsed = validateAiClassification(result, allowed); const id = crypto.randomUUID();
      await db.insert(aiClassificationRuns).values({ id, candidateId: candidate.id, inputHash, model: AI_CLASSIFICATION_MODEL, promptVersion: AI_CLASSIFICATION_PROMPT, status: "SUCCESS", categorySlug: parsed.categorySlug, confidence: parsed.confidence, reasonsJson: JSON.stringify(parsed.reasons), cachedFromId: cachedRun?.id ?? null, createdAt: input.now });
      succeeded += 1; if (cachedRun) cached += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI_CLASSIFICATION_UNKNOWN";
      await db.insert(aiClassificationRuns).values({ id: crypto.randomUUID(), candidateId: candidate.id, inputHash, model: AI_CLASSIFICATION_MODEL, promptVersion: AI_CLASSIFICATION_PROMPT, status: "FAILED", validationError: message, createdAt: input.now });
      await recordOperationalAlert(db, { alertType: "AI_CLASSIFICATION", sourceId: candidate.id, message, details: { candidateId: candidate.id, promptVersion: AI_CLASSIFICATION_PROMPT }, now: input.now }); failed += 1;
    }
  }
  return { processed: candidateRows.length, succeeded, failed, cached, limited: candidateRows.length >= remaining };
}
