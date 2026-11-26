import { env } from "cloudflare:workers";
import { data, Form, Link, redirect, useNavigation } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/admin-student-review-photos";
import { createDb } from "../db/client.server";
import { requireAdminAssurance } from "../features/auth/admin-assurance.server";
import { requireAdminSession } from "../features/auth/session.server";
import { readBoundedBody } from "../features/http/bounded-body";
import { isSameOriginMutation } from "../features/http/same-origin";
import { decidePilotPhoto, listPilotPhotosForAdmin, lookupPilotPhoto, matchesPilotPhotoObject, PilotPhotoError } from "../features/ratings/student-review-pilot-photo.server";
import "../styles/reviewer-moderation.css";

const PATH = "/admin/student-review-photos";
const PRIVATE = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Robots-Tag": "noindex, nofollow" };
const decisionBase = {
  photoId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  reason: z.string().trim().min(3).max(300),
};
const requestSchema = z.discriminatedUnion("decision", [
  z.strictObject({
    ...decisionBase,
    decision: z.literal("APPROVE"),
    visitVerified: z.literal("on"),
    placeVerified: z.literal("on"),
    rightsVerified: z.literal("on"),
    privacyVerified: z.literal("on"),
  }),
  z.strictObject({ ...decisionBase, decision: z.literal("RETIRE") }),
]);

export const headers = () => PRIVATE;
export const meta = () => [{ title: "직접인증 사진 검수 — Re:Taste Admin" }];

function failure(error: string, status: number, headers: Record<string, string> = PRIVATE) {
  return data({ ok: false as const, error }, { status, headers });
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdminSession(request);
  if (!env.STUDENT_REVIEW_PILOT_PHOTOS) throw new Response("직접인증 사진 검수가 연결되지 않았습니다.", { status: 404, headers: PRIVATE });
  try {
    return data({ photos: await listPilotPhotosForAdmin(createDb(env.DB)) }, { headers: PRIVATE });
  } catch {
    throw new Response("직접인증 사진을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", { status: 503, headers: PRIVATE });
  }
}

export async function action({ request }: Route.ActionArgs) {
  const { user, sessionId } = await requireAdminSession(request);
  if (request.method !== "POST") return failure("지원하지 않는 요청입니다.", 405, { ...PRIVATE, Allow: "POST" });
  if (!isSameOriginMutation(request)) return failure("요청 출처를 확인할 수 없습니다.", 403);
  const bucket = env.STUDENT_REVIEW_PILOT_PHOTOS;
  if (!bucket) return failure("직접인증 사진 검수가 연결되지 않았습니다.", 404);
  if (request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "application/x-www-form-urlencoded") {
    return failure("지원하지 않는 입력 형식입니다.", 415);
  }

  try {
    const form = new URLSearchParams(new TextDecoder().decode(await readBoundedBody(request, 16_384)));
    if (new Set(form.keys()).size !== [...form.keys()].length) return failure("검수 항목을 확인해 주세요.", 400);
    const input = requestSchema.safeParse(Object.fromEntries(form));
    if (!input.success) return failure("검수 사유와 공개 확인 항목을 확인해 주세요.", 400);

    const now = new Date();
    await requireAdminAssurance(env.DB, { actorUserId: user.id, sessionId, now });
    const db = createDb(env.DB);
    if (input.data.decision === "APPROVE") {
      const photo = await lookupPilotPhoto(db, { photoId: input.data.photoId, previewForUserId: user.id, previewSessionId: sessionId });
      const object = photo ? await bucket.head(photo.objectKey) : null;
      if (!photo || !matchesPilotPhotoObject(object, { photoId: input.data.photoId, byteSize: photo.byteSize })) {
        return failure("사진 파일을 확인하지 못했습니다. 다시 조회해 주세요.", 409);
      }
    }
    await decidePilotPhoto(db, {
      photoId: input.data.photoId,
      adminUserId: user.id,
      sessionId,
      decision: input.data.decision,
      reason: input.data.reason,
      now: now.toISOString(),
    });
    const message = input.data.decision === "APPROVE" ? "사진 공개 결정을 저장했습니다." : "사진을 회수했습니다.";
    return data({ ok: true as const, message }, { headers: PRIVATE });
  } catch (error) {
    if (error instanceof Error && error.message === "ADMIN_REAUTH_REQUIRED") {
      return redirect(`/admin/reauth?${new URLSearchParams({ returnTo: PATH })}`, { headers: PRIVATE });
    }
    if (error instanceof Response && error.status === 413) return failure("입력 내용이 너무 깁니다.", 413);
    if (error instanceof PilotPhotoError && error.status < 500) return failure("사진 또는 방문 리뷰 상태가 바뀌었습니다. 공개 자격을 다시 확인해 주세요.", error.status);
    return failure("검수 결과를 확인하지 못했습니다. 잠시 후 상태를 다시 확인해 주세요.", 503);
  }
}

export default function AdminStudentReviewPhotos({ loaderData: { photos }, actionData }: Route.ComponentProps) {
  const pending = useNavigation().state !== "idle";
  return <main id="main" className="reviewer-moderation-shell">
    <Link className="inline-flex min-h-11 items-center underline" to="/admin/reviewer-visits">방문 리뷰 검수로</Link>
    <h1>직접인증 사진 검수</h1>
    <p className="reviewer-moderation-notice">연결된 방문 리뷰를 먼저 승인해 주세요. 사진 공개와 회수에는 관리자 재인증이 필요합니다.</p>
    {actionData?.ok === false && <p role="alert">{actionData.error}</p>}
    {actionData?.ok && <p role="status">{actionData.message}</p>}
    {photos.length === 0 && <p role="status">검수할 직접인증 사진이 없습니다.</p>}

    {photos.map((photo) => <article key={photo.id} className="grid gap-4 border-t border-neutral-300 py-5">
      <div>
        <h2 className="text-lg font-semibold">{photo.placeName}</h2>
        <p className="text-sm">{photo.reviewerDisplayName} · {photo.status === "APPROVED" ? "공개 승인" : "검수 대기"}</p>
      </div>
      <img
        src={`/student-review-photos/${encodeURIComponent(photo.id)}?preview=1`}
        alt="검수용 직접인증 사진"
        loading="lazy"
        className="max-h-80 max-w-full rounded-md border border-neutral-300 object-contain"
      />
      <dl className="grid gap-2 break-words">
        <div><dt className="font-semibold">촬영일</dt><dd><time dateTime={photo.takenOn}>{photo.takenOn}</time></dd></div>
        <div><dt className="font-semibold">사진 설명</dt><dd>{photo.caption}</dd></div>
      </dl>

      {photo.mayApprove && <Form method="post" className="grid max-w-xl gap-3">
        <input type="hidden" name="photoId" value={photo.id} />
        <input type="hidden" name="decision" value="APPROVE" />
        <fieldset className="grid gap-1">
          <legend className="font-semibold">공개 검수</legend>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="visitVerified" required /> 방문 근거 확인</label>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="placeVerified" required /> 장소 일치 확인</label>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="rightsVerified" required /> 직접 촬영 및 공개 권리 확인</label>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="privacyVerified" required /> 개인정보 노출 여부 확인</label>
        </fieldset>
        <label className="grid gap-1">공개 사유
          <textarea name="reason" rows={2} minLength={3} maxLength={300} required className="w-full rounded-md border border-neutral-500 p-2" />
        </label>
        <button type="submit" disabled={pending} className="min-h-11 justify-self-start rounded-md bg-neutral-900 px-4 py-2 text-white disabled:opacity-50">
          공개 승인
        </button>
      </Form>}
      {photo.status === "PENDING" && !photo.mayApprove && <p>방문 리뷰 승인과 장소의 공개 상태를 확인해 주세요.</p>}

      <details className="max-w-xl">
        <summary className="min-h-11 cursor-pointer py-2 underline">사진 회수</summary>
        <Form method="post" className="grid gap-3">
          <input type="hidden" name="photoId" value={photo.id} />
          <input type="hidden" name="decision" value="RETIRE" />
          <label className="grid gap-1">회수 사유
            <textarea name="reason" rows={2} minLength={3} maxLength={300} required className="w-full rounded-md border border-neutral-500 p-2" />
          </label>
          <button type="submit" disabled={pending} className="min-h-11 justify-self-start rounded-md border border-neutral-700 px-4 py-2 disabled:opacity-50">
            회수 확정
          </button>
        </Form>
      </details>
    </article>)}
  </main>;
}
