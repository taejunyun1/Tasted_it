export function setCandidateCategory(
  current: Record<string, string>,
  candidateId: string,
  categoryId: string,
) {
  return { ...current, [candidateId]: categoryId };
}

export function listSelectableCategories<T extends { id: string; parentId: string | null }>(categories: T[]) {
  const parentIds = new Set(categories.flatMap((category) => category.parentId ? [category.parentId] : []));
  return categories.filter((category) => category.parentId != null || !parentIds.has(category.id));
}
