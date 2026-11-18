import { env } from "cloudflare:workers";
import { data, isRouteErrorResponse } from "react-router";
import type { Route } from "./+types/correction-places-resource";
import { createDb } from "../db/client.server";
import { CorrectionPlaceSearchInputError, parseCorrectionPlaceSearch, type CorrectionPlaceResponse } from "../features/places/correction-place-search";
import { listCorrectionPlacePage } from "../features/places/correction-place-search.server";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
function requestKey(request: Request) {
  const key = new URL(request.url).searchParams.get("requestKey") ?? "";
  return /^[A-Za-z0-9_-]{0,80}$/.test(key) ? key : "";
}
export async function loader({ request }: Route.LoaderArgs) {
  try {
    const input = parseCorrectionPlaceSearch(new URL(request.url).searchParams);
    return data<CorrectionPlaceResponse>({ ok: true, requestKey: input.requestKey, page: await listCorrectionPlacePage(createDb(env.DB), input) }, { headers });
  } catch (error) {
    const invalid = error instanceof CorrectionPlaceSearchInputError;
    return data<CorrectionPlaceResponse>({ ok: false, requestKey: requestKey(request), message: invalid ? "검색 결과가 변경되었어요. 장소 찾기로 처음부터 다시 검색해 주세요." : "장소를 불러오지 못했어요. 입력 내용은 유지됩니다. 잠시 후 다시 시도해 주세요." }, { status: invalid ? 400 : 503, headers });
  }
}
export async function clientLoader({ request, serverLoader }: Route.ClientLoaderArgs): Promise<CorrectionPlaceResponse> {
  try { return await serverLoader() as CorrectionPlaceResponse; }
  catch (error) {
    const status = error instanceof Response || isRouteErrorResponse(error) ? error.status : 503;
    if (status >= 300 && status < 400) throw error;
    return { ok: false, requestKey: requestKey(request), message: "장소를 불러오지 못했어요. 입력 내용은 유지됩니다. 연결을 확인한 뒤 다시 시도해 주세요." };
  }
}
export function action() { return new Response(null, { status: 405, headers: { ...headers, Allow: "GET, HEAD" } }); }
