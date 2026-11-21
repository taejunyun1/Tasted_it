import { env } from "cloudflare:workers"; import { data, Form, Link, useFormAction, useNavigation, useRouteLoaderData } from "react-router"; import type { Route } from "./+types/place-correction";
import { useEffect, useRef, useState } from "react";
import type { ShouldRevalidateFunction } from "react-router";
import { createDb } from "../db/client.server"; import { sendAccountEmail } from "../features/auth/email.server"; import { getOptionalUser } from "../features/auth/session.server"; import { createPlaceCorrectionRequest } from "../features/places/place-correction.server";
import { CorrectionPlacePicker } from "../components/places/CorrectionPlacePicker";
import { listCorrectionPlacePage, readCorrectionPlaceTarget } from "../features/places/correction-place-search.server";
import type { CorrectionPlaceOption } from "../features/places/correction-place-search";
import { safeReturnTo } from "../features/auth/login";
import { accountActionUrl } from "../features/auth/token-link";
import { consumeMailRateLimit, MAIL_RATE_LIMIT_MESSAGE } from "../features/security/rate-limit.server";
import { isSameOriginMutation } from "../features/http/same-origin";
import { retainedCorrectionValues } from "../features/places/submission-feedback";
const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export const headers: Route.HeadersFunction = ({ actionHeaders }) => {
  const result = new Headers(actionHeaders);
  for (const [name, value] of Object.entries(privateHeaders)) result.set(name, value);
  return result;
};
export const shouldRevalidate: ShouldRevalidateFunction = ({ actionResult, formMethod, defaultShouldRevalidate }) => {
  if (formMethod?.toLowerCase() === "post" && actionResult && typeof actionResult === "object" && "code" in actionResult && actionResult.code === "CORRECTION_TARGET_UNAVAILABLE") return false;
  return defaultShouldRevalidate;
};
export async function loader({ request }: Route.LoaderArgs) {
  const db = createDb(env.DB);
  const url = new URL(request.url);
  const ids = url.searchParams.getAll("placeId");
  if (ids.length > 1) throw new Response("Invalid place", { status: 400 });
  const target = ids.length === 1 ? await readCorrectionPlaceTarget(db, ids[0]) : null;
  const page = await listCorrectionPlacePage(db, { query: "", requestKey: "initial" });
  return { ...page, selectedPlace: target, selectedPlaceId: target?.id ?? "", returnTo: safeReturnTo(url.searchParams.get("returnTo")) };
}
export async function action({ request }: Route.ActionArgs) {
  if (!isSameOriginMutation(request)) throw new Response("이 요청은 현재 서비스에서 다시 실행해 주세요.", { status: 403, statusText: "FORBIDDEN" });
  const form = await request.formData();
  const db = createDb(env.DB);
  const ids = form.getAll("placeId");
  if (ids.length > 1) throw new Response("Invalid place", { status: 400 });
  const values = retainedCorrectionValues(form);
  let target: CorrectionPlaceOption | null = null;
  try { target = ids.length === 1 && ids[0] !== "" ? await readCorrectionPlaceTarget(db, ids[0]) : null; }
  catch (error) {
    if (!(error instanceof Response) || error.status !== 404) throw error;
    return data({ ok: false, code: "CORRECTION_TARGET_UNAVAILABLE", error: "선택한 장소는 더 이상 정정할 수 없습니다. 입력 내용을 유지했으니 장소를 다시 선택해 주세요.", values, selectedPlace: null }, { status: 404, headers: privateHeaders });
  }
  const user = await getOptionalUser(request);
  const requesterEmail = String(form.get("email") ?? user?.email ?? "");
  const limited = await consumeMailRateLimit(db, {
    route: "PLACE_CORRECTION",
    email: requesterEmail,
    ip: request.headers.get("CF-Connecting-IP"),
    now: new Date(),
  });
  if (!limited.ok) {
    return data({ ok: false, error: MAIL_RATE_LIMIT_MESSAGE, values, selectedPlace: target }, {
      status: 429,
      headers: { ...privateHeaders, "Retry-After": String(limited.retryAfterSeconds) },
    });
  }
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    return data({ ok: false, error: "지금은 확인 메일을 보낼 수 없습니다. 잠시 후 다시 시도해 주세요.", values, selectedPlace: target }, { status: 503, headers: privateHeaders });
  }
  try {
    const result = await createPlaceCorrectionRequest(db, { id: crypto.randomUUID(), placeId: target?.id ?? null, requesterUserId: user?.id ?? null, requesterEmail, requesterRelation: String(form.get("relation") ?? ""), requestType: String(form.get("requestType") ?? "OTHER") as "INFORMATION" | "MOVED" | "TEMPORARILY_CLOSED" | "CLOSED" | "RIGHTS" | "OTHER", requestedChanges: { name: String(form.get("name") ?? "") || undefined, address: String(form.get("address") ?? "") || undefined, phone: String(form.get("phone") ?? "") || undefined, status: form.get("requestType") === "CLOSED" ? "HIDDEN" : undefined }, evidenceNote: String(form.get("evidenceNote") ?? "") || null, now: new Date() });
    const baseUrl = env.APP_BASE_URL || new URL(request.url).origin;
    await sendAccountEmail({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM_EMAIL, to: result.email, purpose: "VERIFY_CORRECTION", url: accountActionUrl(baseUrl, "/corrections/verify", result.token) });
    return { ok: true, message: "이메일 확인 링크를 보냈습니다." };
  } catch {
    return data({ ok: false, error: "요청을 접수하지 못했습니다. 입력 내용을 확인해 주세요.", values, selectedPlace: target }, { status: 400, headers: privateHeaders });
  }
}
export default function PlaceCorrection({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation(), action = useFormAction();
  const pending = navigation.state !== "idle" && navigation.formMethod?.toLowerCase() === "post"
    && Boolean(navigation.formAction) && new URL(navigation.formAction!, "https://retaste.invalid").pathname === new URL(action, "https://retaste.invalid").pathname;
  const account = useRouteLoaderData<{ user: { email: string } | null }>("root")?.user;
  const values = actionData && "values" in actionData ? actionData.values as ReturnType<typeof retainedCorrectionValues> : undefined;
  const error = actionData && "error" in actionData ? actionData.error : undefined;
  const [selectedPlace, setSelectedPlace] = useState<CorrectionPlaceOption | null>(() => actionData && "selectedPlace" in actionData ? actionData.selectedPlace : loaderData.selectedPlace);
  const [needsTargetChoice, setNeedsTargetChoice] = useState(Boolean(actionData && "code" in actionData && actionData.code === "CORRECTION_TARGET_UNAVAILABLE"));
  const entryPlaceId = useRef(loaderData.selectedPlaceId);
  const summary = useRef<HTMLParagraphElement>(null), form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (entryPlaceId.current === loaderData.selectedPlaceId) return;
    entryPlaceId.current = loaderData.selectedPlaceId;
    setSelectedPlace(loaderData.selectedPlace);
    setNeedsTargetChoice(false);
  }, [loaderData.selectedPlaceId, loaderData.selectedPlace]);
  useEffect(() => {
    if (actionData && "selectedPlace" in actionData) setSelectedPlace(actionData.selectedPlace);
    if (actionData && "code" in actionData && actionData.code === "CORRECTION_TARGET_UNAVAILABLE") setNeedsTargetChoice(true);
  }, [actionData]);
  useEffect(() => {
    if (!pending && error) (form.current?.querySelector<HTMLElement>("input:invalid,textarea:invalid,select:invalid") ?? summary.current)?.focus();
  }, [pending, error]);
  return <main id="main" className="operation-form shell"><p className="eyebrow">PUBLIC / CORRECTION</p><h1>장소 정보 정정·이의 제기</h1><p>이메일 링크 확인 후 접수되며 공개 정보는 관리자 검토 전 바뀌지 않습니다.</p>
    {!pending && error && <p ref={summary} id="correction-error" className="operation-error" role="alert" tabIndex={-1}>{error}</p>}
    {actionData && "message" in actionData && actionData.message && <p className="operation-success" role="status">{actionData.message}</p>}
    <Form ref={form} method="post" aria-busy={pending} onSubmit={(event) => { if (pending || needsTargetChoice) event.preventDefault(); }}>
      <input type="hidden" name="placeId" value={selectedPlace?.id ?? ""}/>
      <input type="hidden" name="returnTo" value={loaderData.returnTo}/>
      <CorrectionPlacePicker initialPage={{ query: loaderData.query, places: loaderData.places, nextCursor: loaderData.nextCursor }} selectedPlace={selectedPlace} onChoose={place => { setSelectedPlace(place); setNeedsTargetChoice(false); }} disabled={pending}/>
      <label>요청 유형<select name="requestType" defaultValue={values?.requestType || "INFORMATION"}><option value="INFORMATION">정보 정정</option><option value="MOVED">이전</option><option value="TEMPORARILY_CLOSED">임시휴업</option><option value="CLOSED">폐업</option><option value="RIGHTS">권리 침해</option><option value="OTHER">기타</option></select></label>
      <label>요청자 관계<input name="relation" placeholder="업주, 직원, 방문자" required defaultValue={values?.relation}/></label>
      <label>확인 이메일<input name="email" type="email" autoComplete="email" required defaultValue={values?.email ?? account?.email ?? ""} aria-describedby="correction-email-help"/></label>
      <p id="correction-email-help" className="text-sm text-neutral-600">입력한 이메일로 확인 링크를 보냅니다. 로그인한 경우에도 링크 확인이 필요합니다.</p>
      <label>변경 상호<input name="name" defaultValue={values?.name}/></label>
      <label>변경 주소<input name="address" defaultValue={values?.address}/></label>
      <label>변경 전화<input name="phone" type="tel" defaultValue={values?.phone}/></label>
      <label>근거 설명<textarea name="evidenceNote" rows={5} required defaultValue={values?.evidenceNote}/></label>
      <button type="submit" disabled={pending || needsTargetChoice}>{pending ? "확인 메일 요청 중…" : "확인 이메일 보내기"}</button>
      <p role="status" className="sr-only">{pending ? "확인 메일을 요청하고 있습니다." : ""}</p>
    </Form>
    {loaderData.returnTo !== "/" && <Link to={loaderData.returnTo}>이전 화면으로 돌아가기</Link>}
  </main>;
}
