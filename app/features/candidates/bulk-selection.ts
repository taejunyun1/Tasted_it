export function reconcileCandidateSelection(
  selected: ReadonlySet<string>,
  eligibleIds: readonly string[],
) {
  const eligible = new Set(eligibleIds);
  return new Set([...selected].filter((id) => eligible.has(id)));
}
