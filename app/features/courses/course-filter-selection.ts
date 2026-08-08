export function toggleMealCategorySelection(current: string[], value: string) {
  if (current.includes(value)) return { values: current.filter((item) => item !== value), limitReached: false };
  if (current.length >= 2) return { values: current, limitReached: true };
  return { values: [...current, value], limitReached: false };
}
