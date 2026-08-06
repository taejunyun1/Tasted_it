export function buildAutoClassificationReviewUrl(params = new URLSearchParams()) {
  const next = new URLSearchParams(params);
  next.set("autoClassify", "1");
  return `/admin/candidates?${next.toString()}`;
}
