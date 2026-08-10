export type OnboardingStep = "LOCATION" | "FOOD" | "STYLE" | "PREVIEW";

export function toggleOnboardingBadge(input: {
  selected: string[];
  badgeId: string;
  maximum: number;
}) {
  if (input.selected.includes(input.badgeId)) {
    return { selected: input.selected.filter((id) => id !== input.badgeId), limitReached: false };
  }
  if (input.selected.length >= input.maximum) return { selected: input.selected, limitReached: true };
  return { selected: [...input.selected, input.badgeId], limitReached: false };
}

export function onboardingProgress(step: OnboardingStep) {
  return ({ LOCATION: 1, FOOD: 2, STYLE: 3, PREVIEW: 4 } as const)[step];
}
