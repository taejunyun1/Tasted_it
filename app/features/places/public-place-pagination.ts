export const PUBLIC_PLACE_PAGE_SIZE = 100;

export function parsePublicPlacePage(search: string): number | null {
  const values = new URLSearchParams(search).getAll("page");
  if (!values.length) return 1;
  if (values.length !== 1 || !/^[1-9]\d{0,15}$/.test(values[0])) return null;
  const page = Number(values[0]);
  return Number.isSafeInteger(page) ? page : null;
}

export function publicPlacePageHref(search: string, page: number) {
  if (!Number.isSafeInteger(page) || page < 1) throw new Error("PUBLIC_PLACE_PAGE_INVALID");
  const params = new URLSearchParams(search);
  params.delete("page");
  params.delete("place");
  params.delete("selected");
  if (page > 1) params.set("page", String(page));
  return `/places${params.size ? `?${params}` : ""}`;
}
