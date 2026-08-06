export function reconcileCandidateSelection(
  selected: ReadonlySet<string>,
  eligibleIds: readonly string[],
) {
  const eligible = new Set(eligibleIds);
  return new Set([...selected].filter((id) => eligible.has(id)));
}

export function selectCurrentPageCandidates(eligibleIds: readonly string[], limit = 25) {
  return new Set(eligibleIds.slice(0, Math.max(0, limit)));
}
