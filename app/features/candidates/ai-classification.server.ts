import { and, asc, desc, eq, gte, inArray, lt, notExists, sql } from "drizzle-orm";
import type { AppDb } from "../../db/client.server";
import { aiClassificationRuns, businessLicenses, categories } from "../../db/schema";
import { recordOperationalAlert } from "../operations/alerts.server";
import { validateGroundedAiClassification } from "./ai-classification-policy";
import { AI_DAILY_BLOCK_NEURONS, estimateNeurons, getAiQuotaState, type AiTokenUsage } from "./ai-usage-policy";
import { classifyCandidate } from "./category-suggestion";
import { getTerminalCategoryIds } from "./category-selection";
import { mapWithConcurrency } from "../../lib/concurrency";

export const AI_CLASSIFICATION_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast" as const;
export const AI_CLASSIFICATION_PROMPT = "place-category-v4";
export const AI_CLASSIFICATION_SYSTEM_PROMPT = "한국 음식점의 대표 카테고리를 제공된 후보에서만 선택하세요. 사용자가 실제로 찾는 구체 음식이 영업 형태와 넓은 행정 업태보다 우선합니다. 예: 호프/통닭·치킨호프는 치킨, 해장국·순대국·돼지국밥·설렁탕·곰탕은 국밥입니다. 연어·장어·크랩·대게·회처럼 생선과 해산물 음식이 분명하면 해산물 후보를 우선합니다. 라이브카페·음악주점처럼 공연과 주점 문맥이 함께 있으면 단순 카페가 아니라 주점 후보를 우선합니다. 사과·망고·딸기 같은 과일 이름만으로는 음식점 카테고리를 추론하지 마세요. evidence에는 반드시 입력 상호명 또는 원천 업태에 실제로 있는 한국어 문자열을 그대로 복사하세요. 근거가 없거나 후보가 맞지 않으면 낮은 confidence를 사용하세요. 개인정보를 추론하지 마세요.";
export const AI_CLASSIFICATION_BATCH_SIZE = 10;
const responseSchema = { type: "object", properties: { categorySlug: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 }, evidence: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 }, reasons: { type: "array", items: { type: "string" }, maxItems: 3 } }, required: ["categorySlug", "confidence", "evidence", "reasons"], additionalProperties: false } as const;

type AiRunResponse = { response?: unknown; usage?: AiTokenUsage };
type UsageTotal = { inputTokens: number; outputTokens: number; estimatedNeurons: number; attempts: number };

async function sha256(value: string) { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }

function utcDayRange(now: string) {
  const dayStart = `${now.slice(0, 10)}T00:00:00.000Z`;
  const dayEnd = new Date(new Date(dayStart).getTime() + 86_400_000).toISOString();
  return { dayStart, dayEnd };
}

export async function getDailyAiQuota(db: AppDb, now: string) {
  const { dayStart, dayEnd } = utcDayRange(now);
  const [row] = await db.select({ used: sql<number>`coalesce(sum(${aiClassificationRuns.estimatedNeurons}), 0)` })
    .from(aiClassificationRuns)
    .where(and(gte(aiClassificationRuns.createdAt, dayStart), lt(aiClassificationRuns.createdAt, dayEnd)));
  return getAiQuotaState(Number(row?.used ?? 0));
}

function addUsage(total: UsageTotal, usage: AiTokenUsage | undefined) {
  total.inputTokens += Math.max(0, usage?.prompt_tokens ?? 0);
  total.outputTokens += Math.max(0, usage?.completion_tokens ?? 0);
  total.estimatedNeurons += estimateNeurons(usage);
  total.attempts += 1;
}

export async function classifyPendingCandidatesWithAi(db: AppDb, ai: Ai, input: { candidateIds?: string[]; limit?: number; now: string }) {
  const limit = Math.min(Math.max(input.limit ?? AI_CLASSIFICATION_BATCH_SIZE, 1), AI_CLASSIFICATION_BATCH_SIZE);
  let quota = await getDailyAiQuota(db, input.now);
  if (quota.blocked) return { processed: 0, succeeded: 0, failed: 0, cached: 0, limited: true, quota };

  const conditions = [eq(businessLicenses.normalizedStatus, "OPEN"), eq(businessLicenses.reviewStatus, "PENDING")];
  if (input.candidateIds?.length) conditions.push(inArray(businessLicenses.id, [...new Set(input.candidateIds)].slice(0, limit)));
  else conditions.push(notExists(db.select({ id: aiClassificationRuns.id }).from(aiClassificationRuns).where(and(
    eq(aiClassificationRuns.candidateId, businessLicenses.id),
    eq(aiClassificationRuns.status, "SUCCESS"),
    eq(aiClassificationRuns.promptVersion, AI_CLASSIFICATION_PROMPT),
  ))));
  const [candidateRows, categoryRows] = await Promise.all([
    db.select().from(businessLicenses).where(and(...conditions)).orderBy(asc(businessLicenses.updatedAt)).limit(limit),
    db.select({ id: categories.id, parentId: categories.parentId, slug: categories.slug, name: categories.name }).from(categories).where(eq(categories.isActive, true)).orderBy(asc(categories.sortOrder)),
  ]);
  const allowed = new Set(categoryRows.map((category) => category.slug));
  const terminalIds = getTerminalCategoryIds(categoryRows);
  const terminalSlugs = new Set(categoryRows.filter((category) => terminalIds.has(category.id)).map((category) => category.slug));
  let processed = 0; let succeeded = 0; let failed = 0; let cached = 0; let ruleCompleted = 0;

  await mapWithConcurrency(candidateRows, 3, async (candidate) => {
    const rule = classifyCandidate({ sourceType: candidate.sourceType, businessSubtype: candidate.businessSubtype, businessName: candidate.businessName, address: candidate.roadAddress ?? candidate.lotAddress });
    const candidateSlugSet = new Set(rule.candidateSlugs);
    const candidateCategories = categoryRows.filter((category) => candidateSlugSet.has(category.slug));
    const evidenceText = `${candidate.businessName} ${candidate.businessSubtype ?? ""}`;
    const payload = {
      promptVersion: AI_CLASSIFICATION_PROMPT,
      businessName: candidate.businessName,
      businessSubtype: candidate.businessSubtype,
      regionCode: candidate.regionCode,
      ruleCategorySlug: rule.categorySlug,
      ruleConfidence: rule.confidence,
      ruleReasons: rule.reasons,
      categories: candidateCategories,
    };
    const inputHash = await sha256(JSON.stringify(payload));
    processed += 1;
    if (rule.confidence === "HIGH" && terminalSlugs.has(rule.categorySlug)) {
      await db.insert(aiClassificationRuns).values({
        id: crypto.randomUUID(), candidateId: candidate.id, inputHash, model: "RULE_ONLY",
        promptVersion: AI_CLASSIFICATION_PROMPT, status: "SUCCESS", categorySlug: rule.categorySlug,
        confidence: 1, reasonsJson: JSON.stringify(rule.reasons), inputTokens: 0, outputTokens: 0,
        estimatedNeurons: 0, attemptCount: 1, createdAt: input.now,
      });
      succeeded += 1;
      ruleCompleted += 1;
      return;
    }
    const cutoff = new Date(new Date(input.now).getTime() - 30 * 86_400_000).toISOString();
    const cachedRun = await db.query.aiClassificationRuns.findFirst({ where: and(eq(aiClassificationRuns.inputHash, inputHash), eq(aiClassificationRuns.status, "SUCCESS"), gte(aiClassificationRuns.createdAt, cutoff)), orderBy: desc(aiClassificationRuns.createdAt) });
    const usage: UsageTotal = { inputTokens: 0, outputTokens: 0, estimatedNeurons: 0, attempts: 0 };
    try {
      let parsed;
      if (cachedRun) {
        const storedReasons = JSON.parse(cachedRun.reasonsJson ?? "[]") as string[];
        parsed = validateGroundedAiClassification({ categorySlug: cachedRun.categorySlug, confidence: cachedRun.confidence, evidence: storedReasons.filter((reason) => reason.startsWith("근거:")).map((reason) => reason.slice(3)), reasons: storedReasons.filter((reason) => !reason.startsWith("근거:")) }, allowed, evidenceText);
      } else {
        let validationError: unknown;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const result = await ai.run(AI_CLASSIFICATION_MODEL, { messages: [{ role: "system", content: AI_CLASSIFICATION_SYSTEM_PROMPT }, { role: "user", content: JSON.stringify(payload) }], response_format: { type: "json_schema", json_schema: responseSchema }, max_tokens: 260, temperature: 0 }) as AiRunResponse;
          addUsage(usage, result.usage);
          try {
            parsed = validateGroundedAiClassification(result.response, allowed, evidenceText);
            if (!candidateSlugSet.has(parsed.categorySlug)) throw new Error("AI_CATEGORY_OUTSIDE_CANDIDATES");
            validationError = undefined;
            break;
          }
          catch (error) { validationError = error; }
        }
        if (validationError || !parsed) throw validationError ?? new Error("AI_OUTPUT_INVALID");
      }

      const id = crypto.randomUUID();
      await db.insert(aiClassificationRuns).values({ id, candidateId: candidate.id, inputHash, model: AI_CLASSIFICATION_MODEL, promptVersion: AI_CLASSIFICATION_PROMPT, status: "SUCCESS", categorySlug: parsed.categorySlug, confidence: parsed.confidence, reasonsJson: JSON.stringify([...parsed.reasons, ...(parsed.evidence ?? []).map((token) => `근거:${token}`)]), cachedFromId: cachedRun?.id ?? null, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, estimatedNeurons: usage.estimatedNeurons, attemptCount: Math.max(1, usage.attempts), createdAt: input.now });
      succeeded += 1; if (cachedRun) cached += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI_CLASSIFICATION_UNKNOWN";
      await db.insert(aiClassificationRuns).values({ id: crypto.randomUUID(), candidateId: candidate.id, inputHash, model: AI_CLASSIFICATION_MODEL, promptVersion: AI_CLASSIFICATION_PROMPT, status: "FAILED", validationError: message, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, estimatedNeurons: usage.estimatedNeurons, attemptCount: Math.max(1, usage.attempts), createdAt: input.now });
      await recordOperationalAlert(db, { alertType: "AI_CLASSIFICATION", sourceId: candidate.id, message, details: { candidateId: candidate.id, promptVersion: AI_CLASSIFICATION_PROMPT }, now: input.now });
      failed += 1;
    }
  });
  quota = await getDailyAiQuota(db, input.now);
  return { processed, succeeded, failed, cached, ruleCompleted, limited: quota.blocked || candidateRows.length >= limit, quota };
}
