import { useEffect, useRef, useState } from "react";
import { Form, useFetcher } from "react-router";

import type { loader as recommendationLoader } from "../../routes/place-recommendations-resource";
import {
  defaultOnboardingLocation,
  readOnboardingLocation,
  requestOnboardingLocation,
  type OnboardingLocation,
} from "../../features/onboarding/location.client";
import { onboardingProgress, toggleOnboardingBadge, type OnboardingStep } from "../../features/onboarding/onboarding";
import type { TasteBadgeDefinition } from "../../features/members/profile-taste-badges";
import { PlaceCard } from "../places/PlaceCard";

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

export function onboardingRecommendationPath(location: Pick<OnboardingLocation, "bbox">) {
  const search = new URLSearchParams({ bbox: location.bbox.join(",") });
  return `/resources/place-recommendations?${search}`;
}

export function onboardingPlacesDestination(
  returnTo: string,
  location: Pick<OnboardingLocation, "bbox">,
) {
  const destination = new URL(returnTo, "https://retaste.invalid");
  destination.searchParams.set("bbox", location.bbox.join(","));
  return `${destination.pathname}${destination.search}${destination.hash}`;
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
  const recommendationFetcher = useFetcher<typeof recommendationLoader>();
  const [locationMode, setLocationMode] = useState(initialState.locationMode);
  const [foodBadgeIds, setFoodBadgeIds] = useState(initialState.foodBadgeIds);
  const [styleBadgeIds, setStyleBadgeIds] = useState(initialState.styleBadgeIds);
  const [limitMessage, setLimitMessage] = useState("");
  const returnToInput = useRef<HTMLInputElement>(null);
  const stepInput = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previewLocation = useRef<OnboardingLocation | null>(null);
  const announcedStep = useRef(initialState.step);
  const step = initialState.step;
  const progress = onboardingProgress(step);
  const stepIndex = STEPS.indexOf(step);

  useEffect(() => {
    if (announcedStep.current !== step) headingRef.current?.focus();
    announcedStep.current = step;
  }, [step]);

  const loadPreviewRecommendations = () => {
    const location = readOnboardingLocation() ?? defaultOnboardingLocation();
    previewLocation.current = location;
    recommendationFetcher.load(onboardingRecommendationPath(location));
  };

  useEffect(() => {
    if (step === "PREVIEW") loadPreviewRecommendations();
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
    if (!returnToInput.current) return;
    const location = previewLocation.current
      ?? readOnboardingLocation()
      ?? defaultOnboardingLocation();
    returnToInput.current.value = onboardingPlacesDestination(returnTo, location);
  };
  const previewPlaces = recommendationFetcher.data?.ok
    ? recommendationFetcher.data.recommendations.personal.slice(0, 8)
    : [];
  const previewError = recommendationFetcher.data && !recommendationFetcher.data.ok
    ? recommendationFetcher.data.message
    : null;

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
          {recommendationFetcher.state !== "idle" && <p role="status">추천을 불러오는 중이에요.</p>}
          {previewError && <div role="status">
            <p>{previewError}</p>
            <button type="button" className="taste-onboarding__secondary" onClick={loadPreviewRecommendations}>
              다시 불러오기
            </button>
          </div>}
          {previewPlaces.length > 0 && <div className="place-grid">
            {previewPlaces.map((place) => <PlaceCard key={place.id} place={place} variant="personal" />)}
          </div>}
        </div>}

        <div className="taste-onboarding__actions">
          {stepIndex > 0 && <button type="submit" name="intent" value="SAVE_STEP" className="taste-onboarding__secondary" onClick={preparePreviousStep}>이전</button>}
          {step !== "PREVIEW"
            ? <button type="submit" name="intent" value="SAVE_STEP" className="taste-onboarding__primary">계속</button>
            : <button type="submit" name="intent" value="COMPLETE" className="taste-onboarding__primary" onClick={prepareRecommendationRequest}>추천 보러가기</button>}
        </div>
        <button type="submit" name="intent" value="SKIP" className="taste-onboarding__skip">나중에 할게요</button>
      </Form>
    </section>
  </main>;
}
