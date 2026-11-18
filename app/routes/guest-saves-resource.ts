import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Route } from "./+types/guest-saves-resource";
import { createDb } from "../db/client.server";
import { guestTasteSessions, places } from "../db/schema";
import { getOptionalUser } from "../features/auth/session.server";
import { isSameOriginMutation } from "../features/http/same-origin";
import { getSaved, setSavedAndRefreshTaste } from "../features/saves/save.server";
import { getPlaceBySlug } from "../features/places/place.server";
import { mergeGuestTasteSessionFromRequest } from "../features/onboarding/guest-merge.server";
import { getOrCreateGuestSession, readGuestSessionId } from "../features/onboarding/guest-session.server";
import { activeGuestChoiceSession, consumeGuestSaveWriteLimit, getGuestSavedPlace, setGuestSavedPlace } from "../features/onboarding/guest-saves.server";

const PRIVATE_HEADERS = { "Cache-Control": "no-store, private", Vary: "Cookie", "Referrer-Policy": "same-origin" };
const saveSchema = z.object({ intent: z.literal("save"), placeId: z.string().min(1).max(120), saved: z.enum(["true", "false"]) }).strict();
const mergeSchema = z.object({ intent: z.literal("merge") }).strict();
function json(value: unknown, status = 200, cookie?: string | null) {
  const headers = new Headers(PRIVATE_HEADERS);
  if (cookie) headers.append("Set-Cookie", cookie);
  return Response.json(value, { status, headers });
}
function rejected(message: string, status: number) {
  return json({ ok: false, outcome: "REJECTED", message }, status);
}
export function headers() { return PRIVATE_HEADERS; }
export async function readGuestSaveForm(request: Request) {
  if (!isSameOriginMutation(request)) throw new Response(null, { status: 403 });
  if (!request.headers.get("Content-Type")?.startsWith("application/x-www-form-urlencoded")) throw new Response(null, { status: 415 });
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  if (reader) while (true) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > 1024) { await reader.cancel(); throw new Response(null, { status: 413 }); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const values: Record<string, string> = Object.create(null);
  for (const [key, value] of new URLSearchParams(new TextDecoder().decode(bytes))) {
    if (Object.hasOwn(values, key)) throw new Response(null, { status: 400 });
    values[key] = value;
  }
  return values;
}
async function assertPublicPlace(db: ReturnType<typeof createDb>, placeId: string) {
  const place = await db.query.places.findFirst({ where: eq(places.id, placeId), columns: { slug: true } });
  if (!place) throw new Response(null, { status: 404 });
  await getPlaceBySlug(db, place.slug);
}
export async function loader({ request }: Route.LoaderArgs) {
  if (env.ONBOARDING_ENABLED !== "true") return json({ ok: false, message: "임시 저장을 현재 사용할 수 없습니다." }, 404);
  try {
    const placeId = new URL(request.url).searchParams.get("placeId");
    if (!placeId || placeId.length > 120) return json({ ok: false, message: "장소를 확인해 주세요." }, 400);
    const db = createDb(env.DB); const now = new Date().toISOString();
    await assertPublicPlace(db, placeId);
    const user = await getOptionalUser(request);
    if (user) return json({ ok: true, saved: await getSaved(db, { userId: user.id, placeId }), signedIn: true, expired: false });
    const sessionId = readGuestSessionId(request);
    const active = sessionId ? await db.query.guestTasteSessions.findFirst({ where: activeGuestChoiceSession(sessionId, now) }) : null;
    return json({ ok: true, saved: active ? await getGuestSavedPlace(db, { sessionId: active.id, placeId, now }) : false, signedIn: false, expired: Boolean(sessionId && !active), expiresAt: active?.expiresAt ?? null });
  } catch {
    return json({ ok: false, message: "저장 상태를 확인하지 못했습니다. 다시 시도해 주세요." }, 503);
  }
}
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return rejected("지원하지 않는 요청입니다.", 405);
  if (env.ONBOARDING_ENABLED !== "true") return rejected("임시 저장을 현재 사용할 수 없습니다.", 404);
  let choiceWriteStarted = false;
  try {
    const form = await readGuestSaveForm(request);
    const valid = form.intent === "merge" ? mergeSchema.safeParse(form) : saveSchema.safeParse(form);
    if (!valid.success) return rejected("요청 내용을 확인해 주세요.", 400);
    const db = createDb(env.DB); const now = new Date().toISOString();
    const user = await getOptionalUser(request);
    await consumeGuestSaveWriteLimit(db, request.headers.get("CF-Connecting-IP"), now);
    if (form.intent === "merge") {
      if (!mergeSchema.safeParse(form).success) return rejected("요청 내용을 확인해 주세요.", 400);
      if (!user) return rejected("로그인한 뒤 다시 연결해 주세요.", 401);
      choiceWriteStarted = true;
      const result = await mergeGuestTasteSessionFromRequest(db, request, user.id, now);
      return json({ ok: true, merged: result.merged, message: result.merged ? "임시 저장과 취향을 계정에 연결했습니다." : "연결할 유효한 임시 자료가 없습니다." }, 200, result.expireCookie);
    }
    const parsed = saveSchema.safeParse(form);
    if (!parsed.success) return rejected("요청 내용을 확인해 주세요.", 400);
    const { placeId } = parsed.data; const saved = parsed.data.saved === "true";
    await assertPublicPlace(db, placeId);
    if (user) {
      choiceWriteStarted = true;
      await setSavedAndRefreshTaste(db, { userId: user.id, placeId, saved, now });
      return json({ ok: true, saved, signedIn: true, expired: false });
    }
    const { session, setCookie } = await getOrCreateGuestSession(db, request, now);
    choiceWriteStarted = true;
    await setGuestSavedPlace(db, { sessionId: session.id, placeId, saved, now });
    return json({ ok: true, saved, signedIn: false, expired: false, expiresAt: session.expiresAt }, 200, setCookie);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const status = error instanceof Response ? error.status : code === "GUEST_SAVE_RATE_LIMIT" ? 429 : code === "GUEST_SAVE_LIMIT" ? 409 : code === "GUEST_SESSION_UNAVAILABLE" ? 409 : 503;
    const message = code === "GUEST_SAVE_RATE_LIMIT" ? "저장 요청이 많습니다. 잠시 후 다시 시도해 주세요." : code === "GUEST_SAVE_LIMIT" ? "임시 저장은 최대 50곳입니다. 기존 저장을 해제한 뒤 다시 시도해 주세요."
      : code === "GUEST_SESSION_UNAVAILABLE" ? "임시 자료가 만료되었거나 연결되었습니다. 새로고침한 뒤 다시 시도해 주세요."
      : status === 403 ? "현재 서비스에서 다시 요청해 주세요."
      : status === 404 ? "공개된 장소를 찾을 수 없습니다."
      : status < 500 ? "요청 내용을 확인한 뒤 다시 시도해 주세요."
      : "저장·연결 결과를 확인하지 못했습니다. 새로고침해 현재 상태를 확인한 뒤 필요하면 다시 시도해 주세요.";
    return json({ ok: false, outcome: !choiceWriteStarted && status < 500 ? "REJECTED" : "UNKNOWN", message }, status);
  }
}

// A response can be lost after a committed write; keep retry UI without claiming rollback.
export async function clientAction({ serverAction }: Route.ClientActionArgs) {
  try { return await serverAction(); }
  catch { return { ok: false, outcome: "UNKNOWN", message: "저장·연결 결과를 확인하지 못했습니다. 저장 상태를 다시 확인한 뒤 필요하면 다시 시도해 주세요." }; }
}
export async function clientLoader({ serverLoader }: Route.ClientLoaderArgs) {
  try { return await serverLoader(); }
  catch { return { ok: false, message: "저장 상태를 확인하지 못했습니다. 다시 시도해 주세요." }; }
}
