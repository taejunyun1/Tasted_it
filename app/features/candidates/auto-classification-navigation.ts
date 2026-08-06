export function buildAutoClassificationReviewUrl(params = new URLSearchParams()) {
  const next = new URLSearchParams(params);
  next.set("autoClassify", "1");
  return `/admin/candidates?${next.toString()}`;
}

export function buildSourceAutoClassificationReviewUrl(sourceType: string) {
  return buildAutoClassificationReviewUrl(new URLSearchParams({ source: sourceType, sort: "updated" }));
}
