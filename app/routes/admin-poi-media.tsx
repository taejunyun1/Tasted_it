import { env } from "cloudflare:workers";
import { data, Form, Link, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/admin-poi-media";
import { createDb } from "../db/client.server";
import { requireAdminAssurance } from "../features/auth/admin-assurance.server";
import { requireAdminSession } from "../features/auth/session.server";
import { readBoundedBody } from "../features/http/bounded-body";
import { isSameOriginMutation } from "../features/http/same-origin";
import { applyPoiMediaAdminTransition, getAdminPoiMedia, poiMediaAdminTransitionSchema } from "../features/poi-media/poi-media-admin.server";
import { poiMediaIdSchema } from "../features/poi-media/poi-media";
import "../styles/admin-home.css";

const PATH = "/admin/poi-media";
const PRIVATE = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Robots-Tag": "noindex, nofollow" };
const STATE_LABELS = { STAGED: "검수 대기", PUBLISHED: "공개 승인", WITHDRAWN: "회수" };
const RIGHTS_LABELS = { OWN_WORK: "직접 촬영", MERCHANT_PERMISSION: "업소 제공·이용허락", KOGL_1: "공공누리 제1유형", OPEN_LICENSE: "공개 라이선스" };
const FAILURES = {
  INVALID_INPUT: [400, "사진 참조와 변경 사유를 확인해 주세요."],
  NOT_FOUND: [404, "대상 사진을 찾을 수 없습니다."],
  STALE: [409, "대상 상태나 장소 정보가 바뀌었습니다. 현재 정보로 새로 검토해 주세요."],
  INELIGIBLE: [409, "현재 공개 자격을 충족하지 않습니다."],
  ASSET_UNVERIFIED: [409, "등록된 JPEG의 크기·형식·해시가 확인되지 않았습니다."],
  FORBIDDEN: [403, "현재 관리자 권한 또는 재인증이 필요합니다."],
} as const;

export const headers = () => PRIVATE;
export const meta = () => [{ title: "장소 사진 관리 — Re:Taste Admin" }];

function photoPath(id: string) {
  return `${PATH}?${new URLSearchParams({ photo: id })}`;
}

function failure(error: string, status: number) {
  return data({ ok: false as const, error }, { status, headers: PRIVATE });
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdminSession(request);
  const id = new URL(request.url).searchParams.get("photo");
  const publicEnabled = env.POI_MEDIA_PUBLIC_ENABLED === "true";
  if (id === null) return data({ id, photo: null, error: null, publicEnabled }, { headers: PRIVATE });
  if (!poiMediaIdSchema.safeParse(id).success) {
    return data({ id: null, photo: null, error: "사진 ID 형식을 확인해 주세요.", publicEnabled }, { status: 400, headers: PRIVATE });
  }
  try {
    const photo = await getAdminPoiMedia(createDb(env.DB), id);
    return data({ id, photo, error: photo ? null : "준비된 사진을 찾을 수 없습니다.", publicEnabled }, { status: photo ? 200 : 404, headers: PRIVATE });
  } catch {
    return data({ id, photo: null, error: "사진 정보를 불러올 수 없습니다.", publicEnabled }, { status: 503, headers: PRIVATE });
  }
}

export async function action({ request }: Route.ActionArgs) {
  const { user, sessionId } = await requireAdminSession(request);
  if (request.method !== "POST") return data({ ok: false as const, error: "지원하지 않는 작업 방식입니다." }, { status: 405, headers: { ...PRIVATE, Allow: "POST" } });
  if (!isSameOriginMutation(request)) return failure("요청 출처를 확인할 수 없습니다.", 403);
  if (request.headers.get("Content-Type")?.split(";", 1)[0]?.toLowerCase() !== "application/x-www-form-urlencoded") {
    return failure("지원하지 않는 입력 형식입니다.", 415);
  }
  let form: URLSearchParams;
  try {
    form = new URLSearchParams(new TextDecoder().decode(await readBoundedBody(request, 16_384)));
  } catch (error) {
    if (error instanceof Response && error.status === 413) return failure("입력 내용이 너무 깁니다.", 413);
    return failure("입력 내용을 확인할 수 없습니다.", 400);
  }
  const allowed = ["id", "expectedSha256", "expectedState", "intent", "reason", "expectedPlaceName", "expectedPlaceAddress"];
  const keys = [...form.keys()];
  if (new Set(keys).size !== keys.length || keys.some((key) => !allowed.includes(key))) {
    return failure("입력 항목을 확인해 주세요.", 400);
  }
  const values = {
    id: form.get("id"),
    expectedSha256: form.get("expectedSha256"),
    expectedState: form.get("expectedState"),
    intent: form.get("intent"),
    reason: form.get("reason"),
  };
  const input = poiMediaAdminTransitionSchema.safeParse(values.intent === "PUBLISH" ? {
    ...values, expectedPlaceName: form.get("expectedPlaceName"), expectedPlaceAddress: form.get("expectedPlaceAddress"),
  } : values);
  if (!input.success) return failure(FAILURES.INVALID_INPUT[1], FAILURES.INVALID_INPUT[0]);
  const now = new Date();
  try {
    await requireAdminAssurance(env.DB, { actorUserId: user.id, sessionId, now });
    const result = await applyPoiMediaAdminTransition(createDb(env.DB), env.REVIEW_PHOTOS, {
      ...input.data, actorUserId: user.id, sessionId, now: now.toISOString(),
    });
    if (!result.ok) {
      const [status, message] = FAILURES[result.code];
      return failure(message, status);
    }
    return data({ ok: true as const, state: result.state, changed: result.changed }, { headers: PRIVATE });
  } catch (error) {
    if (error instanceof Error && error.message === "ADMIN_REAUTH_REQUIRED") {
      return redirect(`/admin/reauth?${new URLSearchParams({ returnTo: photoPath(input.data.id) })}`, { headers: PRIVATE });
    }
    return failure("처리 결과를 확인할 수 없습니다. 사진 상태를 다시 조회해 주세요.", 503);
  }
}

export default function AdminPoiMedia({ loaderData, actionData }: Route.ComponentProps) {
  const { photo, id, error, publicEnabled } = loaderData;
  const pending = useNavigation().state !== "idle";
  return <main id="main" className="admin-home">
    <header className="admin-home__header">
      <div><h1>장소 사진 관리</h1><p>준비된 사진의 출처와 대상을 확인한 뒤 공개하거나 회수합니다.</p></div>
      <Link to="/admin/places">장소 관리로 돌아가기</Link>
    </header>
    <Form method="get" className="grid gap-2 border-t border-neutral-300 pt-4">
      <label htmlFor="poi-photo-id" className="font-semibold">사진 ID</label>
      <div className="flex flex-wrap gap-2">
        <input id="poi-photo-id" name="photo" defaultValue={id ?? ""} key={id ?? ""} maxLength={36} autoCapitalize="none" spellCheck={false} required className="min-h-11 w-full max-w-96 rounded-md border border-neutral-500 px-3 font-mono text-sm" />
        <button type="submit" disabled={pending} className="min-h-11 rounded-md border border-neutral-700 px-4 font-semibold disabled:opacity-50">사진 조회</button>
      </div>
    </Form>
    {error && <p role="alert">{error}</p>}
    {actionData && "error" in actionData && <p role="alert">{actionData.error}</p>}
    {actionData && "state" in actionData && <p role="status">{actionData.changed ? "변경했습니다." : "이미 반영된 상태입니다."} 현재 상태 {STATE_LABELS[actionData.state]}</p>}
    {photo && <section aria-labelledby="poi-photo-heading" className="mt-8 grid gap-5 border-t border-neutral-300 pt-6">
      <div>
        <h2 id="poi-photo-heading" className="text-2xl font-semibold">{photo.placeName}</h2>
        <p>{photo.placeAddress}</p>
        <p>사진 상태 <strong>{STATE_LABELS[photo.state]}</strong> · 서비스 사진 표시 {publicEnabled ? "켜짐" : "꺼짐"}</p>
      </div>
      {photo.state !== "WITHDRAWN" && <img src={`${PATH}/${photo.id}/preview`} alt="등록 사진 검수 미리보기" className="max-h-80 max-w-full rounded-md border border-neutral-300 object-contain" />}
      <dl className="grid min-w-0 gap-2 [overflow-wrap:anywhere]">
        <div><dt className="font-semibold">사진 제공</dt><dd>{photo.attribution}</dd></div>
        <div><dt className="font-semibold">출처</dt><dd>{photo.sourceUrl ? <a className="underline" href={photo.sourceUrl} target="_blank" rel="noopener noreferrer">원본 페이지 보기</a> : "출처 주소 확인 필요"}</dd></div>
        <div><dt className="font-semibold">이용 근거</dt><dd>{RIGHTS_LABELS[photo.rightsBasis]}</dd></div>
        <div><dt className="font-semibold">검수 기록 (내부)</dt><dd>{photo.rightsEvidence}</dd></div>
        <div><dt className="font-semibold">사진 ID</dt><dd><code className="break-all">{photo.id}</code></dd></div>
      </dl>
      {photo.state === "STAGED" && !photo.eligibleForPublication && <p role="status">이 장소는 현재 사진 공개 조건을 충족하지 않습니다.</p>}
      {photo.state !== "WITHDRAWN" && <Form method="post" className="grid w-full max-w-xl gap-3">
        <input type="hidden" name="id" value={photo.id} />
        <input type="hidden" name="expectedSha256" value={photo.sha256} />
        <input type="hidden" name="expectedState" value={photo.state} />
        <input type="hidden" name="expectedPlaceName" value={photo.placeName} />
        <input type="hidden" name="expectedPlaceAddress" value={photo.placeAddress} />
        <label htmlFor="poi-change-reason" className="font-semibold">변경 사유</label>
        <textarea id="poi-change-reason" name="reason" rows={3} className="w-full rounded-md border border-neutral-400 p-2" minLength={3} maxLength={200} required />
        <p className="text-sm">상태 변경에는 최근 관리자 재인증이 필요합니다. 회수 뒤에는 새 사진 ID로 다시 준비하세요.</p>
        <div className="flex flex-wrap gap-3">
          {photo.state === "STAGED" && photo.eligibleForPublication && <button name="intent" value="PUBLISH" className="rounded-md bg-neutral-900 px-4 py-3 text-white disabled:opacity-50" disabled={pending}>공개 확정</button>}
          <button name="intent" value="WITHDRAW" className="rounded-md border border-neutral-700 px-4 py-3 disabled:opacity-50" disabled={pending}>회수 확정</button>
        </div>
      </Form>}
    </section>}
  </main>;
}
