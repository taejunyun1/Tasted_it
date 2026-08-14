import type { AuditArea, AuditFinding, AuditSeverity } from "./record-audit.types";

export { AUDIT_VERSION } from "./record-audit.types";
export type { AuditArea, AuditFinding, AuditSeverity, RecordAuditReport } from "./record-audit.types";

const EMPTY_SUMMARY: Record<AuditSeverity, number> = {
  CRITICAL: 0,
  HIGH: 0,
  MEDIUM: 0,
  LOW: 0,
  INFO: 0,
};

export function maskAuditId(id: string): string {
  return id.length <= 8 ? "[redacted]" : `${id.slice(0, 4)}…${id.slice(-4)}`;
}

export function buildFinding(input: Omit<AuditFinding, "id">): AuditFinding {
  return {
    ...input,
    id: `${input.ruleId}:${input.sampleIds.join(",") || "none"}`,
  };
}

export function summarizeFindings(findings: AuditFinding[]): Record<AuditSeverity, number> {
  return findings.reduce(
    (summary, finding) => ({
      ...summary,
      [finding.severity]: summary[finding.severity] + finding.count,
    }),
    EMPTY_SUMMARY,
  );
}

type VoteEvent = {
  id: string;
  placeId: string;
  userId: string;
  value: number;
  createdAt: string;
};

type CurrentVote = {
  eventId: string;
  placeId: string;
  userId: string;
  value: number;
};

export function checkVoteLedger(input: {
  events: VoteEvent[];
  currentVotes: CurrentVote[];
  invalidatedEventIds: Set<string>;
}): AuditFinding[] {
  const eventsById = new Map(
    input.events
      .filter((event) => !input.invalidatedEventIds.has(event.id))
      .map((event) => [event.id, event]),
  );

  return input.currentVotes.flatMap((currentVote) => {
    const event = eventsById.get(currentVote.eventId);
    const mismatch = !event
      || event.value !== currentVote.value
      || event.placeId !== currentVote.placeId
      || event.userId !== currentVote.userId;

    return mismatch
      ? [
          buildFinding({
            area: "RATING",
            severity: "HIGH",
            ruleId: "RATING_CURRENT_VOTE_VALUE_MISMATCH",
            title: "현재 평가와 마지막 유효 평가 이벤트가 다릅니다.",
            impact: "장소 평가 점수와 추천 신호가 잘못 계산될 수 있습니다.",
            sampleIds: [maskAuditId(currentVote.eventId)],
            count: 1,
            isIncomplete: false,
          }),
        ]
      : [];
  });
}

type ReviewerPhoto = {
  id: string;
  reviewId: string;
  position: number;
  byteSize: number;
  objectKey?: string;
};

export function checkPhotoMetadata(input: {
  reviews: Array<{ id: string; photoCount: number }>;
  photos: ReviewerPhoto[];
}): AuditFinding[] {
  const photosByReview = new Map<string, ReviewerPhoto[]>();
  for (const photo of input.photos) {
    photosByReview.set(photo.reviewId, [...(photosByReview.get(photo.reviewId) ?? []), photo]);
  }

  return input.reviews.flatMap((review) => {
    const photos = photosByReview.get(review.id) ?? [];
    const positions = new Set(photos.map((photo) => photo.position));
    const findings: AuditFinding[] = [];

    if (photos.length !== review.photoCount) {
      findings.push(buildFinding({
        area: "REVIEWER",
        severity: "HIGH",
        ruleId: "REVIEW_PHOTO_COUNT_MISMATCH",
        title: "리뷰 사진 개수가 메타데이터와 다릅니다.",
        impact: "공개 사진 표시가 누락되거나 깨질 수 있습니다.",
        sampleIds: [maskAuditId(review.id)],
        count: 1,
        isIncomplete: false,
      }));
    }

    if (Array.from({ length: review.photoCount }, (_, index) => index).some((position) => !positions.has(position))) {
      findings.push(buildFinding({
        area: "REVIEWER",
        severity: "HIGH",
        ruleId: "REVIEW_PHOTO_POSITION_GAP",
        title: "리뷰 사진 순번이 연속되지 않습니다.",
        impact: "사진 정렬과 공개 경로가 불안정해질 수 있습니다.",
        sampleIds: [maskAuditId(review.id)],
        count: 1,
        isIncomplete: false,
      }));
    }

    return findings;
  });
}

type GoldenPickEvent = {
  id: string;
  placeId: string;
  reviewerUserId: string;
  eventType: "GRANT" | "WITHDRAW" | "EXPIRE";
  previousEventId: string | null;
  expiresAt: string | null;
  effectiveAt: string;
};

export function checkGoldenPickLedger(input: {
  now: string;
  events: GoldenPickEvent[];
}): AuditFinding[] {
  const closedGrantIds = new Set(
    input.events
      .filter((event) => event.eventType !== "GRANT" && event.previousEventId)
      .map((event) => event.previousEventId!),
  );

  return input.events
    .filter((event) => event.eventType === "GRANT")
    .flatMap((grant) => {
      if (!grant.expiresAt || grant.expiresAt > input.now || closedGrantIds.has(grant.id)) return [];
      return [buildFinding({
        area: "RATING",
        severity: "MEDIUM",
        ruleId: "GOLDEN_PICK_EXPIRED_GRANT_UNCLOSED",
        title: "만료된 Golden Pick에 종료 이벤트가 없습니다.",
        impact: "Golden Pick 이력과 운영 상태가 서로 다르게 보일 수 있습니다.",
        sampleIds: [maskAuditId(grant.id)],
        count: 1,
        isIncomplete: false,
      })];
    });
}

export function checkRetention(input: {
  expiredGuestSessionIds: string[];
  expiredProductEventIds: string[];
}): AuditFinding[] {
  const findings: AuditFinding[] = [];
  if (input.expiredGuestSessionIds.length) {
    findings.push(createFinding(
      "RETENTION",
      "HIGH",
      "RETENTION_GUEST_SESSION_EXPIRED",
      "만료된 비회원 취향 세션이 남아 있습니다.",
      "보존기간 정책과 실제 삭제 작업이 어긋났을 수 있습니다.",
      input.expiredGuestSessionIds.slice(0, 3).map(maskAuditId),
      input.expiredGuestSessionIds.length,
    ));
  }
  if (input.expiredProductEventIds.length) {
    findings.push(createFinding(
      "RETENTION",
      "HIGH",
      "RETENTION_PRODUCT_EVENT_EXPIRED",
      "보존기간이 지난 제품 이벤트가 남아 있습니다.",
      "익명 행동 데이터 보존 정책을 위반할 수 있습니다.",
      input.expiredProductEventIds.slice(0, 3).map(maskAuditId),
      input.expiredProductEventIds.length,
    ));
  }
  return findings;
}

export function checkRecommendationEligibility(input: Array<{
  placeId: string;
  status: "VERIFIED" | "MONITORING" | "SUSPECTED" | "HIDDEN";
  recommendationExcluded: boolean;
}>): AuditFinding[] {
  const incorrectlyEligible = input.filter((state) => state.status === "HIDDEN" && !state.recommendationExcluded);
  return incorrectlyEligible.length
    ? [createFinding(
        "RECOMMENDATION",
        "HIGH",
        "RECOMMENDATION_HIDDEN_PLACE_ELIGIBLE",
        "숨김 장소가 추천 후보로 남아 있습니다.",
        "비공개 장소가 홈·코스·맛집 추천에 다시 나타날 수 있습니다.",
        incorrectlyEligible.slice(0, 3).map((state) => maskAuditId(state.placeId)),
        incorrectlyEligible.length,
      )]
    : [];
}

export function createFinding(
  area: AuditArea,
  severity: AuditSeverity,
  ruleId: string,
  title: string,
  impact: string,
  sampleIds: string[],
  count: number,
): AuditFinding {
  return buildFinding({ area, severity, ruleId, title, impact, sampleIds, count, isIncomplete: false });
}
