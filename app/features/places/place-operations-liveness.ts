export type LivenessFilter = "SUSPECTED" | "HIDDEN" | "ERROR";
export type LivenessProviderStatus = "MATCHED" | "AMBIGUOUS" | "NOT_FOUND" | "ERROR" | "SKIPPED";
export type LivenessStatus = "VERIFIED" | "MONITORING" | "SUSPECTED" | "HIDDEN";

type EvidenceScore = { name: number | null; address: number | null; distance: number | null; phone: number | null; total: number | null };
type ActivityEvidence = { active: boolean; at: string | null };

export type LivenessEvidence = {
  source: string | null;
  score: EvidenceScore;
  reviewer: ActivityEvidence;
  member: ActivityEvidence;
  openSource: ActivityEvidence;
};

export type LivenessStateRow = {
  placeId: string;
  placeName: string;
  status: LivenessStatus;
  kakaoStatus: LivenessProviderStatus;
  naverStatus: LivenessProviderStatus;
  naverMatchScore: number | null;
  naverEvidenceCodesJson: string;
  matchScore: number | null;
  consecutiveNotFound: number;
  protectedUntil: string | null;
  evidenceJson: string;
};

export type LivenessRow = {
  caseId: string | null;
  placeId: string;
  placeName: string;
  reasonType: string;
  status: LivenessStatus | null;
  kakaoStatus: LivenessProviderStatus;
  naverStatus: LivenessProviderStatus;
  naverMatchScore: number | null;
  naverEvidenceCodes: string[];
  matchScore: number | null;
  consecutiveNotFound: number;
  protectedUntil: string | null;
  evidence: LivenessEvidence;
};

export function parseLivenessFilter(value: string | null): LivenessFilter | null {
  return value === "SUSPECTED" || value === "HIDDEN" || value === "ERROR" ? value : null;
}

export function isAttentionState(state: Pick<LivenessStateRow, "status" | "naverStatus">) {
  return state.status === "SUSPECTED" || state.status === "HIDDEN" || state.naverStatus === "ERROR";
}

export function matchesLivenessFilter(row: LivenessRow, filter: LivenessFilter | null) {
  if (!filter) return true;
  return filter === "ERROR" ? row.naverStatus === "ERROR" : row.status === filter;
}

export function buildLivenessRow(input: {
  caseId: string | null;
  placeId: string;
  placeName: string;
  reasonType: string;
  caseEvidenceJson: string | null;
  state: LivenessStateRow | undefined;
}): LivenessRow {
  const evidence = parseLivenessEvidence(input.state?.evidenceJson ?? input.caseEvidenceJson ?? "{}");
  return {
    caseId: input.caseId,
    placeId: input.placeId,
    placeName: input.placeName,
    reasonType: input.reasonType,
    status: input.state?.status ?? null,
    kakaoStatus: input.state?.kakaoStatus ?? "SKIPPED",
    naverStatus: input.state?.naverStatus ?? "SKIPPED",
    naverMatchScore: input.state?.naverMatchScore ?? null,
    naverEvidenceCodes: parseEvidenceCodes(input.state?.naverEvidenceCodesJson),
    matchScore: input.state?.matchScore ?? evidence.score.total,
    consecutiveNotFound: input.state?.consecutiveNotFound ?? 0,
    protectedUntil: input.state?.protectedUntil ?? null,
    evidence,
  };
}

export function formatReasonType(value: string) {
  return ({
    CLOSED: "폐업 신고",
    TEMPORARILY_CLOSED: "임시 휴업",
    UNKNOWN: "운영 미확인",
    SOURCE_CONFLICT: "출처 충돌",
    STALE_90D: "90일 재확인",
    LIVENESS_STATE: "자동 검증",
  } as Record<string, string>)[value] ?? "영업 검증";
}

export function formatLivenessStatus(value: LivenessRow["status"]) {
  return ({ VERIFIED: "정상", MONITORING: "관찰", SUSPECTED: "운영 의심", HIDDEN: "임시 숨김" } as Record<string, string>)[value ?? ""] ?? "검수 대기";
}

export function formatNaverStatus(value: LivenessProviderStatus) {
  return ({ MATCHED: "일치", AMBIGUOUS: "모호", NOT_FOUND: "미검색", ERROR: "공급자 오류", SKIPPED: "미확인" } as Record<string, string>)[value];
}

export function latestTimestamp(...values: Array<string | null>) {
  return values.filter((value): value is string => value !== null).sort().at(-1) ?? null;
}

function parseEvidenceCodes(value: string | undefined) {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}

function parseLivenessEvidence(value: string): LivenessEvidence {
  const parsed = parseObject(value);
  const nestedEvidence = parseObject(parsed.evidence);
  const evidence = Object.keys(nestedEvidence).length ? nestedEvidence : parsed;
  return {
    source: sourceLabel(parsed.source),
    score: parseScore(evidence.score),
    reviewer: parseActivity(evidence.recentReviewerActivity),
    member: parseActivity(evidence.recentMemberActivity),
    openSource: parseActivity(evidence.recentOpenSource),
  };
}

function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { return parseObject(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseScore(value: unknown): EvidenceScore {
  const score = parseObject(value);
  return {
    name: boundedNumber(score.name),
    address: boundedNumber(score.address),
    distance: boundedNumber(score.distance),
    phone: boundedNumber(score.phone),
    total: boundedNumber(score.total),
  };
}

function parseActivity(value: unknown): ActivityEvidence {
  const activity = parseObject(value);
  return { active: activity.active === true, at: timestamp(activity.at) };
}

function boundedNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

function timestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function sourceLabel(value: unknown) {
  return value === "PLACE_LIVENESS_VERIFICATION" ? "자동 영업검증" : null;
}

export function parseCorrectionChanges(raw: string) {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const rows: Array<{ label: string; value: string }> = [];
    for (const [key, label] of [
      ["name", "상호"],
      ["address", "주소"],
      ["neighborhood", "동네"],
      ["phone", "전화"],
      ["parkingSummary", "주차"],
      ["status", "상태"],
    ] as const) {
      if (typeof parsed[key] === "string" || parsed[key] === null) {
        rows.push({ label, value: parsed[key] == null ? "비움" : String(parsed[key]) });
      }
    }
    return rows.slice(0, 8);
  } catch {
    return [];
  }
}
