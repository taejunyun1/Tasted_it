import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { data } from "react-router";
import type { Route } from "./+types/reviewer-places-resource";
import { createDb } from "../db/client.server";
import { reviewerProfiles } from "../db/schema";
import { requireUser } from "../features/auth/session.server";
import { parseReviewerPlaceSearch, ReviewerPlaceSearchInputError, type ReviewerPlaceResponse } from "../features/ratings/reviewer-place-search";
import { listReviewerPlacePage } from "../features/ratings/reviewer-place-search.server";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export async function loader({ request }: Route.LoaderArgs) {
  let user;
  try { user = await requireUser(request); }
  catch (error) { if (error instanceof Response) { for (const [key, value] of Object.entries(headers)) error.headers.set(key, value); } throw error; }
  const candidateKey = new URL(request.url).searchParams.get("requestKey") ?? "";
  let requestKey = /^[A-Za-z0-9_-]{0,80}$/.test(candidateKey) ? candidateKey : "";
  try {
    const db = createDb(env.DB);
    const profile = user.role === "REVIEWER" ? await db.query.reviewerProfiles.findFirst({ where: eq(reviewerProfiles.userId, user.id) }) : null;
    if (!profile || profile.status !== "ACTIVE") return data<ReviewerPlaceResponse>({ ok: false, requestKey, message: "활동 중인 리뷰어만 장소를 검색할 수 있습니다. 페이지를 새로고침해 권한을 확인해 주세요." }, { status: 403, headers });
    const input = parseReviewerPlaceSearch(new URL(request.url).searchParams);
    requestKey = input.requestKey;
    return data<ReviewerPlaceResponse>({ ok: true, requestKey, ...await listReviewerPlacePage(db, user.id, input) }, { headers });
  } catch (error) {
    return data<ReviewerPlaceResponse>({ ok: false, requestKey, message: error instanceof ReviewerPlaceSearchInputError ? "검색 조건이 변경되었어요. 검색을 처음부터 다시 실행해 주세요." : "장소를 불러오지 못했어요. 잠시 후 다시 시도해 주세요." }, { status: error instanceof ReviewerPlaceSearchInputError ? 400 : 503, headers });
  }
}
export async function clientLoader({ request, serverLoader }: Route.ClientLoaderArgs): Promise<ReviewerPlaceResponse> {
  try { return await serverLoader() as ReviewerPlaceResponse; }
  catch {
    const key = new URL(request.url).searchParams.get("requestKey") ?? "";
    return { ok: false, requestKey: /^[A-Za-z0-9_-]{0,80}$/.test(key) ? key : "", message: "장소를 불러오지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요." };
  }
}
export function action() { return new Response(null, { status: 405, headers: { ...headers, Allow: "GET, HEAD" } }); }
