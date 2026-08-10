import { useEffect, useRef, useState } from "react";
import { Form } from "react-router";

import { readOnboardingLocation, requestOnboardingLocation } from "../../features/onboarding/location.client";
import { onboardingProgress, toggleOnboardingBadge, type OnboardingStep } from "../../features/onboarding/onboarding";
import type { TasteBadgeDefinition } from "../../features/members/profile-taste-badges";

type InitialState = {
  step: OnboardingStep;
  locationMode: "DEVICE" | "DEFAULT";
  foodBadgeIds: string[];
  styleBadgeIds: string[];
};

type Props = {
  initialState: InitialState;
  foodBadges: TasteBadgeDefinition[];
  styleBadges: TasteBadgeDefinition[];
  returnTo: string;
};

const STEPS: OnboardingStep[] = ["LOCATION", "FOOD", "STYLE", "PREVIEW"];

export function nextOnboardingStep(step: OnboardingStep): OnboardingStep {
  const index = STEPS.indexOf(step);
  return STEPS[Math.min(index + 1, STEPS.length - 1)];
}

function BadgeButton({ badge, selected, onToggle }: {
  badge: TasteBadgeDefinition;
  selected: string[];
  onToggle: (badgeId: string) => void;
}) {
  return <button
    type="button"
    className="taste-onboarding__badge"
    aria-pressed={selected.includes(badge.id)}
    onClick={() => onToggle(badge.id)}
    style={{ minHeight: "44px" }}
  >
    <span aria-hidden="true">{selected.includes(badge.id) ? "✓" : "+"}</span>
    {badge.label}
  </button>;
}

export function TasteOnboarding({ initialState, foodBadges, styleBadges, returnTo }: Props) {
  const [locationMode, setLocationMode] = useState(initialState.locationMode);
  const [foodBadgeIds, setFoodBadgeIds] = useState(initialState.foodBadgeIds);
  const [styleBadgeIds, setStyleBadgeIds] = useState(initialState.styleBadgeIds);
  const [limitMessage, setLimitMessage] = useState("");
  const returnToInput = useRef<HTMLInputElement>(null);
  const stepInput = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const announcedStep = useRef(initialState.step);
  const step = initialState.step;
  const progress = onboardingProgress(step);
  const stepIndex = STEPS.indexOf(step);

  useEffect(() => {
    if (announcedStep.current !== step) headingRef.current?.focus();
    announcedStep.current = step;
  }, [step]);

  const toggleFood = (badgeId: string) => {
    const result = toggleOnboardingBadge({ selected: foodBadgeIds, badgeId, maximum: 5 });
    setFoodBadgeIds(result.selected);
  };
  const toggleStyle = (badgeId: string) => {
    const result = toggleOnboardingBadge({ selected: styleBadgeIds, badgeId, maximum: 3 });
    setStyleBadgeIds(result.selected);
    setLimitMessage(result.limitReached ? "최대 3개까지 선택할 수 있어요." : "");
  };
  const useDeviceLocation = async () => {
    const location = await requestOnboardingLocation();
    setLocationMode(location.mode);
  };
  const nextStep = nextOnboardingStep(step);
  const preparePreviousStep = () => {
    if (stepInput.current && stepIndex > 0) stepInput.current.value = STEPS[stepIndex - 1];
  };
  const prepareRecommendationRequest = () => {
    if (locationMode !== "DEVICE") return;
    const location = readOnboardingLocation();
    if (!location || !returnToInput.current) return;
    const destination = new URL(returnTo, window.location.origin);
    destination.searchParams.set("bbox", location.bbox.join(","));
    returnToInput.current.value = `${destination.pathname}${destination.search}${destination.hash}`;
  };

  return <main id="main" className="taste-onboarding">
    <section className="taste-onboarding__card" aria-labelledby="taste-onboarding-title">
      <header className="taste-onboarding__header">
        <p className="eyebrow">TASTE SETUP · {progress}/4</p>
        <div
          className="taste-onboarding__progress"
          role="progressbar"
          aria-label="취향 설정 진행"
          aria-valuemin={1}
          aria-valuemax={4}
          aria-valuenow={progress}
          aria-valuetext={`${progress}/4 진행`}
        >
          <span style={{ width: `${progress * 25}%` }} />
        </div>
        <h1 ref={headingRef} id="taste-onboarding-title" tabIndex={-1}>
          {step === "LOCATION" && "지금 가까운 한 끼부터 볼까요?"}
          {step === "FOOD" && "자주 생각나는 메뉴를 골라주세요."}
          {step === "STYLE" && "좋아하는 맛과 식당 분위기는요?"}
          {step === "PREVIEW" && "이 취향으로 추천을 시작할게요."}
        </h1>
      </header>

      <Form method="post" className="taste-onboarding__form">
        <input ref={stepInput} type="hidden" name="step" value={nextStep} />
        <input type="hidden" name="locationMode" value={locationMode} />
        <input ref={returnToInput} type="hidden" name="returnTo" defaultValue={returnTo} />
        {foodBadgeIds.map((id) => <input key={id} type="hidden" name="foodBadgeId" value={id} />)}
        {styleBadgeIds.map((id) => <input key={id} type="hidden" name="styleBadgeId" value={id} />)}

        {step === "LOCATION" && <div className="taste-onboarding__location">
          <p>위치는 이 브라우저에서만 사용하고 서버에는 저장하지 않아요.</p>
          <button type="button" className="taste-onboarding__location-button" onClick={useDeviceLocation}>
            {locationMode === "DEVICE" ? "현재 위치를 사용 중이에요" : "현재 위치 사용하기"}
          </button>
          <p className="taste-onboarding__selection">{locationMode === "DEVICE" ? "내 주변" : "광주 중심"}에서 추천</p>
        </div>}

        {step === "FOOD" && <div>
          <p className="taste-onboarding__selection">{foodBadgeIds.length}/5 선택</p>
          <div className="taste-onboarding__badges">{foodBadges.map((badge) =>
            <BadgeButton key={badge.id} badge={badge} selected={foodBadgeIds} onToggle={toggleFood} />
          )}</div>
        </div>}

        {step === "STYLE" && <div>
          <p className="taste-onboarding__selection">{styleBadgeIds.length}/3 선택</p>
          <div className="taste-onboarding__badges">{styleBadges.map((badge) =>
            <BadgeButton key={badge.id} badge={badge} selected={styleBadgeIds} onToggle={toggleStyle} />
          )}</div>
          {limitMessage && <p className="taste-onboarding__status" role="status">{limitMessage}</p>}
        </div>}

        {step === "PREVIEW" && <div className="taste-onboarding__preview">
          <p>좋아하는 메뉴 <strong>{foodBadgeIds.length}개</strong></p>
          <p>맛과 스타일 <strong>{styleBadgeIds.length}개</strong></p>
          <p>{locationMode === "DEVICE" ? "내 주변" : "광주 중심"} 추천을 준비했어요.</p>
        </div>}

        <div className="taste-onboarding__actions">
          {stepIndex > 0 && <button type="submit" name="intent" value="SAVE_STEP" className="taste-onboarding__secondary" onClick={preparePreviousStep}>이전</button>}
          {step !== "PREVIEW"
            ? <button type="submit" name="intent" value="SAVE_STEP" className="taste-onboarding__primary">계속</button>
            : <button type="submit" name="intent" value="COMPLETE" className="taste-onboarding__primary" onClick={prepareRecommendationRequest}>추천 보러 가기</button>}
        </div>
        <button type="submit" name="intent" value="SKIP" className="taste-onboarding__skip">나중에 할게요</button>
      </Form>
    </section>
  </main>;
}
