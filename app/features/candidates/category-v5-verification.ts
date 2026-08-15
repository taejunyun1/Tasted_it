import { reconcileAiCategoryVerifierV2, type AiCategoryVerifierV2Output } from "./ai-category-verifier-v2";
import type { NaverV2Verification } from "./naver-local-category-v2";
import type { PlaceCategoryProfileV5 } from "./category-v5.types";

/** Provider and AI results only change a derived v5 profile, never v4 public data. */
export function reconcileCategoryV5Verification(
  profile: PlaceCategoryProfileV5,
  verification: { naver: NaverV2Verification | null; ai: AiCategoryVerifierV2Output | null },
): PlaceCategoryProfileV5 {
  if (profile.decision === "EXCLUDE") return profile;
  let primarySlug = profile.primarySlug;
  let secondarySlugs = profile.secondarySlugs;
  const reasonCodes = [...profile.reasonCodes];
  const naver = verification.naver;

  // Provider data may select one specific rule candidate, but cannot create a
  // new category on its own. This keeps the external response advisory.
  if (naver?.status === "VERIFIED" && naver.categoryVerification === "SPECIFIC" && naver.categorySlug
    && [profile.primarySlug, ...profile.secondarySlugs].includes(naver.categorySlug)) {
    primarySlug = naver.categorySlug;
    secondarySlugs = [profile.primarySlug, ...profile.secondarySlugs]
      .filter((slug) => slug !== primarySlug)
      .slice(0, 4);
    reasonCodes.push("NAVER_V2_SPECIFIC_MATCH");
  } else if (naver?.status === "BROAD") {
    reasonCodes.push("NAVER_V2_BROAD_NO_DETAIL");
  } else if (naver?.status === "UNAVAILABLE") {
    reasonCodes.push("NAVER_V2_UNAVAILABLE");
  }

  return {
    ...profile,
    primarySlug,
    secondarySlugs,
    decision: reconcileAiCategoryVerifierV2({ ruleDecision: profile.decision, verifier: verification.ai }),
    reasonCodes: [...new Set(reasonCodes)],
  };
}
