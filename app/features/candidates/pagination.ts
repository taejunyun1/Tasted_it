export function buildCandidatePageHref(params: URLSearchParams, page: number) {
  const next = new URLSearchParams(params);
  next.delete("autoClassify");
  next.set("page", String(page));
  return `?${next.toString()}`;
}
