import { Link } from "react-router";

import type { ReviewStepNumber } from "../../features/places/place-review-pagination";
import type { PlaceReviewStageCounts } from "../../features/places/place-review-query.server";

const steps: Array<{ step: ReviewStepNumber; label: string; description: string }> = [
  { step: 1, label: "원천 검수", description: "주소·좌표·원천 확인" },
  { step: 2, label: "NAVER 검증", description: "상호·주소·위치 근거" },
  { step: 3, label: "카테고리 확정", description: "최종 추천 카테고리" },
  { step: 4, label: "중복 검토", description: "중복·프랜차이즈 판단" },
  { step: 5, label: "승인·공개", description: "선택한 장소만 공개" },
];

export function PlaceReviewStepNav({ currentStep, counts }: { currentStep: ReviewStepNumber; counts: PlaceReviewStageCounts }) {
  return <nav className="place-review-steps" aria-label="장소 검수 단계">
    {steps.map((item) => {
      const current = item.step === currentStep;
      const complete = item.step < currentStep;
      return <Link
        key={item.step}
        to={`/admin/place-operations?flow=review&step=${item.step}`}
        aria-current={current ? "step" : undefined}
        className={current ? "is-current" : complete ? "is-complete" : undefined}
      >
        <span className="place-review-step-number">{complete ? "✓" : String(item.step).padStart(2, "0")}</span>
        <span><strong>{item.label}</strong><small>{item.description}</small></span>
        <b>{counts[item.step]}</b>
      </Link>;
    })}
  </nav>;
}
