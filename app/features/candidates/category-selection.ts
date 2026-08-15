export function setCandidateCategory(
  current: Record<string, string>,
  candidateId: string,
  categoryId: string,
) {
  return { ...current, [candidateId]: categoryId };
}

export function setCandidateCategories(
  current: Record<string, string>,
  candidateIds: ReadonlySet<string>,
  categoryId: string,
) {
  return Object.fromEntries(Object.entries(current).map(([candidateId, currentCategoryId]) => [
    candidateId,
    candidateIds.has(candidateId) ? categoryId : currentCategoryId,
  ]));
}

export function listSelectableCategories<T extends { id: string; parentId: string | null }>(categories: T[]) {
  const terminalIds = getTerminalCategoryIds(categories);
  return categories.filter((category) => terminalIds.has(category.id));
}

export function getTerminalCategoryIds<T extends { id: string; parentId: string | null }>(categories: T[]) {
  const parentIds = new Set(categories.flatMap((category) => category.parentId ? [category.parentId] : []));
  return new Set(categories.filter((category) => !parentIds.has(category.id)).map((category) => category.id));
}
