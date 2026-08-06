export const AI_DAILY_FREE_NEURONS = 10_000;
export const AI_DAILY_BLOCK_NEURONS = 9_000;

// Conservative Llama 3.1 8B rates. Round each request upward so small calls are never lost.
const INPUT_NEURONS_PER_MILLION_TOKENS = 25_608;
const OUTPUT_NEURONS_PER_MILLION_TOKENS = 75_147;

export type AiTokenUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
};

export function estimateNeurons(usage: AiTokenUsage | undefined) {
  if (!usage) return 0;
  const input = Math.max(0, usage.prompt_tokens ?? 0) * INPUT_NEURONS_PER_MILLION_TOKENS;
  const output = Math.max(0, usage.completion_tokens ?? 0) * OUTPUT_NEURONS_PER_MILLION_TOKENS;
  return Math.ceil((input + output) / 1_000_000);
}

export function getAiQuotaState(usedNeurons: number) {
  const used = Math.max(0, Math.ceil(usedNeurons));
  const percent = Math.min(100, Math.round((used / AI_DAILY_FREE_NEURONS) * 100));
  const blocked = used >= AI_DAILY_BLOCK_NEURONS;
  return {
    used,
    limit: AI_DAILY_FREE_NEURONS,
    blockAt: AI_DAILY_BLOCK_NEURONS,
    remainingUntilBlock: Math.max(0, AI_DAILY_BLOCK_NEURONS - used),
    percent,
    warning: blocked,
    blocked,
    basis: "APP_ESTIMATE" as const,
  };
}

