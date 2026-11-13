import { env } from "cloudflare:workers"; import { and, eq, isNull } from "drizzle-orm"; import { data, Form } from "react-router"; import type { Route } from "./+types/place-correction";
import { createDb } from "../db/client.server"; import { places } from "../db/schema"; import { sendAccountEmail } from "../features/auth/email.server"; import { getOptionalUser } from "../features/auth/session.server"; import { createPlaceCorrectionRequest } from "../features/places/place-correction.server";
import { z } from "zod";
import { getPlaceBySlug, listCorrectionPlaces } from "../features/places/place.server";
import { accountActionUrl } from "../features/auth/token-link";
import { consumeMailRateLimit, MAIL_RATE_LIMIT_MESSAGE } from "../features/security/rate-limit.server";
import { isSameOriginMutation } from "../features/http/same-origin";
const targetSchema = z.string().min(1).max(128).refine(value => value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value));
async function correctionTarget(db: ReturnType<typeof createDb>, rawId: unknown) {
  const parsed = targetSchema.safeParse(rawId);
  if (!parsed.success) throw new Response("Invalid place", { status: 400 });
  const [row] = await db.select({ slug: places.slug }).from(places)
    .where(and(eq(places.id, parsed.data), eq(places.status, "PUBLISHED"), isNull(places.closedAt))).limit(1);
  if (!row) throw new Response("Place not found", { status: 404 });
  const place = await getPlaceBySlug(db, row.slug);
  return { id: place.id, name: place.name, address: place.address };
}
export async function loader({ request }: Route.LoaderArgs) {
  const db = createDb(env.DB);
  const ids = new URL(request.url).searchParams.getAll("placeId");
  if (ids.length > 1) throw new Response("Invalid place", { status: 400 });
  const target = ids.length === 1 ? await correctionTarget(db, ids[0]) : null;
  const options = await listCorrectionPlaces(db);
  if (target && !options.some(place => place.id === target.id)) options.unshift(target);
  return { places: options, selectedPlaceId: target?.id ?? "" };
}
export async function action({ request }: Route.ActionArgs) {
  if (!isSameOriginMutation(request)) throw new Response("이 요청은 현재 서비스에서 다시 실행해 주세요.", { status: 403, statusText: "FORBIDDEN" });
  const form = await request.formData();
  const db = createDb(env.DB);
  const ids = form.getAll("placeId");
  if (ids.length > 1) throw new Response("Invalid place", { status: 400 });
  const target = ids.length === 1 && ids[0] !== "" ? await correctionTarget(db, ids[0]) : null;
  const user = await getOptionalUser(request);
  const requesterEmail = String(form.get("email") ?? user?.email ?? "");
  const limited = await consumeMailRateLimit(db, {
    route: "PLACE_CORRECTION",
    email: requesterEmail,
    ip: request.headers.get("CF-Connecting-IP"),
    now: new Date(),
  });
  if (!limited.ok) {
    return data({ ok: false, error: MAIL_RATE_LIMIT_MESSAGE }, {
      status: 429,
      headers: { "Retry-After": String(limited.retryAfterSeconds) },
    });
  }
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    return data({ ok: false, error: "지금은 확인 메일을 보낼 수 없습니다. 잠시 후 다시 시도해 주세요." }, { status: 503 });
  }
  try {
    const result = await createPlaceCorrectionRequest(db, { id: crypto.randomUUID(), placeId: target?.id ?? null, requesterUserId: user?.id ?? null, requesterEmail, requesterRelation: String(form.get("relation") ?? ""), requestType: String(form.get("requestType") ?? "OTHER") as "INFORMATION" | "MOVED" | "TEMPORARILY_CLOSED" | "CLOSED" | "RIGHTS" | "OTHER", requestedChanges: { name: String(form.get("name") ?? "") || undefined, address: String(form.get("address") ?? "") || undefined, phone: String(form.get("phone") ?? "") || undefined, status: form.get("requestType") === "CLOSED" ? "HIDDEN" : undefined }, evidenceNote: String(form.get("evidenceNote") ?? "") || null, now: new Date() });
    const baseUrl = env.APP_BASE_URL || new URL(request.url).origin;
    await sendAccountEmail({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM_EMAIL, to: result.email, purpose: "VERIFY_CORRECTION", url: accountActionUrl(baseUrl, "/corrections/verify", result.token) });
    return { ok: true, message: "이메일 확인 링크를 보냈습니다." };
  } catch {
    return data({ ok: false, error: "요청을 접수하지 못했습니다. 입력 내용을 확인해 주세요." }, { status: 400 });
  }
}
export default function PlaceCorrection({ loaderData, actionData }: Route.ComponentProps) { return <main id="main" className="operation-form shell"><p className="eyebrow">PUBLIC / CORRECTION</p><h1>장소 정보 정정·이의 제기</h1><p>이메일 링크 확인 후 접수되며 공개 정보는 관리자 검토 전 바뀌지 않습니다.</p>{actionData && "error" in actionData && actionData.error && <p className="operation-error">{actionData.error}</p>}{actionData && "message" in actionData && actionData.message && <p className="operation-success">{actionData.message}</p>}<Form method="post"><label>장소<select name="placeId" defaultValue={loaderData.selectedPlaceId}><option value="">목록에 없는 장소</option>{loaderData.places.map((place) => <option key={place.id} value={place.id}>{place.name} · {place.address}</option>)}</select></label><label>요청 유형<select name="requestType"><option value="INFORMATION">정보 정정</option><option value="MOVED">이전</option><option value="TEMPORARILY_CLOSED">임시휴업</option><option value="CLOSED">폐업</option><option value="RIGHTS">권리 침해</option><option value="OTHER">기타</option></select></label><label>요청자 관계<input name="relation" placeholder="업주, 직원, 방문자" required/></label><label>확인 이메일<input name="email" type="email" required/></label><label>변경 상호<input name="name"/></label><label>변경 주소<input name="address"/></label><label>변경 전화<input name="phone"/></label><label>근거 설명<textarea name="evidenceNote" rows={5} required/></label><button>확인 이메일 보내기</button></Form></main>; }
