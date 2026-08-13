import { createDb } from "../../db/client.server";
import { decidePlaceLiveness, type LivenessDecision, type LivenessMode } from "./place-liveness";
import {
  applyPlaceLivenessDecision,
  claimDuePlaceLivenessTargets,
  loadPlaceLivenessEvidence,
  type LivenessTarget,
} from "./place-liveness.server";
import { enqueueStalePlaceRevalidations } from "./place-revalidation.server";
import { KakaoLocalError, searchKakaoPlaces } from "./kakao-local.server";

const TARGET_LIMIT = 25;
const EXTERNAL_CALL_LIMIT = 50;

type SchedulerDependencies = {
  createDb: typeof createDb;
  enqueueStale: typeof enqueueStalePlaceRevalidations;
  claimDuePlaceLivenessTargets: typeof claimDuePlaceLivenessTargets;
  loadPlaceLivenessEvidence: typeof loadPlaceLivenessEvidence;
  applyPlaceLivenessDecision: typeof applyPlaceLivenessDecision;
  searchKakaoPlaces: typeof searchKakaoPlaces;
  log: (event: string, details: { claimed: number; checked: number; errors: number; hidden: number; errorKinds: string[] }) => void;
};

type SchedulerOptions = {
  now?: string;
  dependencies?: Partial<SchedulerDependencies>;
};

const defaultDependencies: SchedulerDependencies = {
  createDb,
  enqueueStale: enqueueStalePlaceRevalidations,
  claimDuePlaceLivenessTargets,
  loadPlaceLivenessEvidence,
  applyPlaceLivenessDecision,
  searchKakaoPlaces,
  log(event, details) {
    console.warn(event, details);
  },
};

export async function runScheduledPlaceMaintenance(env: Env, options: SchedulerOptions = {}) {
  const dependencies = { ...defaultDependencies, ...options.dependencies };
  const now = options.now ?? new Date().toISOString();
  const db = dependencies.createDb(env.DB);
  const staleRevalidation = await dependencies.enqueueStale(db, { now });
  const liveness = await runLivenessMaintenance(env, db, now, dependencies);
  return { staleRevalidation, liveness };
}

async function runLivenessMaintenance(
  env: Env,
  db: ReturnType<typeof createDb>,
  now: string,
  dependencies: SchedulerDependencies,
) {
  const livenessEnv = env as Env & Partial<{
    KAKAO_PLACE_VERIFICATION_ENABLED: string;
    KAKAO_PLACE_VERIFICATION_MODE: string;
    KAKAO_REST_API_KEY: string;
  }>;
  const disabled = livenessEnv.KAKAO_PLACE_VERIFICATION_ENABLED !== "true";
  if (disabled) return { status: "DISABLED" as const, claimed: 0, checked: 0, errors: 0, hidden: 0 };

  const mode = livenessMode(livenessEnv.KAKAO_PLACE_VERIFICATION_MODE);
  const apiKey = livenessEnv.KAKAO_REST_API_KEY?.trim();
  if (!apiKey) {
    dependencies.log("PLACE_LIVENESS_SCHEDULED_STOPPED", { claimed: 0, checked: 0, errors: 1, hidden: 0, errorKinds: ["KAKAO_AUTH_FAILED"] });
    return { status: "STOPPED" as const, claimed: 0, checked: 0, errors: 1, hidden: 0 };
  }

  const leaseToken = crypto.randomUUID();
  let targets: LivenessTarget[];
  try {
    targets = (await dependencies.claimDuePlaceLivenessTargets(db, { now, limit: TARGET_LIMIT, leaseToken })).slice(0, TARGET_LIMIT);
  } catch {
    dependencies.log("PLACE_LIVENESS_SCHEDULED_STOPPED", { claimed: 0, checked: 0, errors: 1, hidden: 0, errorKinds: ["PLACE_LIVENESS_CLAIM_FAILED"] });
    return { status: "STOPPED" as const, claimed: 0, checked: 0, errors: 1, hidden: 0 };
  }

  let checked = 0;
  let errors = 0;
  let authErrors = 0;
  let providerErrors = 0;
  let externalCalls = 0;
  let stopped = false;
  const errorKinds = new Set<string>();
  const decisions: Array<{ target: LivenessTarget; decision: LivenessDecision }> = [];

  for (const target of targets) {
    if (externalCalls >= EXTERNAL_CALL_LIMIT) {
      stopped = true;
      errorKinds.add("KAKAO_CALL_LIMIT_REACHED");
      break;
    }
    checked += 1;
    let searchError = false;
    let candidates: Awaited<ReturnType<typeof searchKakaoPlaces>>["documents"] = [];
    try {
      const result = await searchWithRetry(target, apiKey, dependencies, () => { externalCalls += 1; });
      candidates = result.documents;
    } catch (error) {
      searchError = true;
      errors += 1;
      providerErrors += 1;
      const kind = errorKind(error);
      errorKinds.add(kind);
      if (kind === "KAKAO_AUTH_FAILED") authErrors += 1;
    }

    try {
      const evidence = await dependencies.loadPlaceLivenessEvidence(db, { placeId: target.placeId, now });
      decisions.push({
        target,
        decision: decidePlaceLiveness({
          now,
          mode,
          currentStatus: target.status,
          currentRecommendationExcluded: target.recommendationExcluded,
          consecutiveNotFound: target.consecutiveNotFound,
          firstNotFoundAt: target.firstNotFoundAt,
          lastCheckedAt: target.lastCheckedAt,
          protectedUntil: target.protectedUntil,
          place: target.place,
          candidates,
          searchError,
          recentReviewerActivityAt: evidence.recentReviewerActivityAt,
          recentMemberActivityAt: evidence.recentMemberActivityAt,
          recentOpenSourceAt: evidence.recentOpenSourceAt,
        }),
      });
    } catch {
      errors += 1;
      errorKinds.add("PLACE_LIVENESS_EVIDENCE_FAILED");
    }

    if (authErrors >= 3 || errors * 2 >= checked) {
      stopped = true;
      break;
    }
  }

  const providerErrorHeavy = checked > 0 && providerErrors * 2 >= checked;
  let hidden = 0;
  for (const item of decisions) {
    const decision = providerErrorHeavy && item.decision.shouldHide
      ? { ...item.decision, status: "SUSPECTED" as const, shouldHide: false }
      : item.decision;
    try {
      const result = await dependencies.applyPlaceLivenessDecision(db, { target: item.target, decision, leaseToken, now });
      if (result === "APPLIED" && decision.shouldHide) hidden += 1;
    } catch {
      errors += 1;
      errorKinds.add("PLACE_LIVENESS_APPLY_FAILED");
      stopped = true;
      break;
    }
  }

  const status = stopped ? "STOPPED" as const : "COMPLETED" as const;
  if (errors > 0 || stopped) {
    dependencies.log(`PLACE_LIVENESS_SCHEDULED_${status}`, { claimed: targets.length, checked, errors, hidden, errorKinds: [...errorKinds].sort() });
  }
  return { status, claimed: targets.length, checked, errors, hidden };
}

async function searchWithRetry(
  target: LivenessTarget,
  apiKey: string,
  dependencies: SchedulerDependencies,
  onCall: () => void,
) {
  if (typeof target.place.longitude !== "number" || typeof target.place.latitude !== "number"
    || !Number.isFinite(target.place.longitude) || !Number.isFinite(target.place.latitude)) {
    throw new KakaoLocalError("KAKAO_REQUEST_INVALID");
  }
  const longitude = target.place.longitude;
  const latitude = target.place.latitude;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    onCall();
    try {
      return await dependencies.searchKakaoPlaces({
        apiKey,
        query: `${target.place.name} ${target.place.address}`,
        longitude,
        latitude,
      });
    } catch (error) {
      if (!(error instanceof KakaoLocalError) || !error.retryable || attempt === 1) throw error;
    }
  }
  throw new KakaoLocalError("KAKAO_REQUEST_FAILED");
}

function livenessMode(value: string | undefined): LivenessMode {
  return value === "RECOMMEND" || value === "HIDE" ? value : "OBSERVE";
}

function errorKind(error: unknown) {
  return error instanceof KakaoLocalError ? error.code : "KAKAO_REQUEST_FAILED";
}
