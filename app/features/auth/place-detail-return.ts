import { readBoundedBody } from "../http/bounded-body";
import { safePlaceDetailRequestPath, safePlaceDetailSearchPath } from "../places/place-detail-path";
import { safeReturnTo } from "./login";

const PLACE_PATH_PREFIX = "/places/";
const DENIED_FORM_MAX_BYTES = 8 * 1024;

export async function readPlaceMutationBrowseReturn(request: Request, placeSlug: string) {
  const mediaType = request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/x-www-form-urlencoded") return null;
  try {
    const body = new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedBody(request, DENIED_FORM_MAX_BYTES));
    decodeURIComponent(body);
    const values = new URLSearchParams(body).getAll("browseReturnTo");
    return values.length === 1 ? safePlaceMutationBrowseReturn(values[0]!, request.url, placeSlug) : null;
  } catch {
    return null;
  }
}

export function safePlaceMutationBrowseReturn(value: string | null, requestUrl: string, placeSlug: string) {
  const browseReturnTo = safeReturnTo(value);
  const request = new URL(requestUrl);
  const browse = new URL(browseReturnTo, request.origin);
  const browsePath = browse.pathname.replace(/\/$/, "") || "/";
  const isBrowse = browsePath === "/" || browsePath === "/places" || /^\/maps\/[^/]+$/.test(browsePath);
  if (!isBrowse || browse.searchParams.getAll("place").length !== 1 || !request.pathname.startsWith(PLACE_PATH_PREFIX)) return null;

  const nestedPath = safePlaceDetailSearchPath(browse.searchParams.get("place"));
  if (!nestedPath) return null;
  const nested = new URL(nestedPath, request.origin);
  let routeSlug: string;
  try {
    routeSlug = decodeURIComponent(request.pathname.slice(PLACE_PATH_PREFIX.length));
  } catch {
    return null;
  }
  if (routeSlug === `${placeSlug}.data` && request.pathname.endsWith(".data")) {
    request.pathname = request.pathname.slice(0, -".data".length);
    routeSlug = placeSlug;
    const markers = request.searchParams.getAll("_routes");
    if (markers.length === 1 && markers[0] === "routes/place-detail") request.searchParams.delete("_routes");
  }
  const targetPath = safePlaceDetailRequestPath(`${request.pathname}${request.search}`);
  return targetPath && routeSlug === placeSlug
    && decodeURIComponent(nested.pathname.slice(PLACE_PATH_PREFIX.length)) === placeSlug
    && nested.search === request.search ? browseReturnTo : null;
}
