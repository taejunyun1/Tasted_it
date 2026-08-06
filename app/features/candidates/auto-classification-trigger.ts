type FetcherState = "idle" | "loading" | "submitting";
type ClassificationSource = "AI_RULE" | "AI_FAILED" | "RULE_ONLY";

export function shouldAutoClassify(params: URLSearchParams, fetcherState: FetcherState, started: boolean) {
  return params.get("autoClassify") === "1" && fetcherState === "idle" && !started;
}

export function removeAutoClassificationParam(params: URLSearchParams) {
  const next = new URLSearchParams(params);
  next.delete("autoClassify");
  return `/admin/candidates${next.size ? `?${next.toString()}` : ""}`;
}

export function getAiClassificationBadge(source: ClassificationSource) {
  if (source === "AI_FAILED") return { label: "AI 확인 실패", tone: "error" as const };
  if (source === "AI_RULE") return { label: "AI 분류 완료", tone: "success" as const };
  return null;
}
