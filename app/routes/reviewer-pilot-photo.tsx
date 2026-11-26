import { env } from "cloudflare:workers";
import { useState, type FormEvent } from "react";
import { data, Form, Link, useNavigation, useSubmit } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/reviewer-pilot-photo";
import { createDb } from "../db/client.server";
import { readSessionId, requireUser } from "../features/auth/session.server";
import { readBoundedBody } from "../features/http/bounded-body";
import { isSameOriginMutation } from "../features/http/same-origin";
import { prepareReviewerPhotoFiles, reviewerPhotoErrorMessage, ReviewerPhotoPreparationError } from "../features/ratings/reviewer-photo.client";
import { MAX_REVIEWER_PHOTO_BYTES, parseReviewerPhotoFiles, ReviewerPhotoValidationError } from "../features/ratings/reviewer-photo";
import { getOwnedPilotPhotoReview, PilotPhotoError, submitPilotPhoto, withdrawPilotPhoto } from "../features/ratings/student-review-pilot-photo.server";
import "../styles/reviewer-moderation.css";

const PRIVATE = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Robots-Tag": "noindex, nofollow" };
const PHOTO_FORM_LIMIT = MAX_REVIEWER_PHOTO_BYTES + 16_384;
const recordId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const uploadSchema = z.strictObject({
  intent: z.literal("upload"),
  expectedContentVersion: z.string().regex(/^[1-9][0-9]*$/).transform(Number).pipe(z.number().int().positive()),
  caption: z.string().trim().min(1).max(240),
  takenOn: z.iso.date(),
  ownWork: z.literal("on"),
  privacyChecked: z.literal("on"),
  photos: z.instanceof(File),
});
const withdrawSchema = z.strictObject({
  intent: z.literal("withdraw"),
  photoId: recordId,
});
const LABELS = { UPLOADING: "업로드 중", PENDING: "검수 대기", APPROVED: "공개 승인", RETIRED: "철회" };

export const headers = () => PRIVATE;
export const meta = () => [{ title: "직접인증 방문 사진 — Re:Taste" }];

function failure(error: string, status: number, headers: Record<string, string> = PRIVATE) {
  return data({ ok: false as const, error }, { status, headers });
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);
  if (!env.STUDENT_REVIEW_PILOT_PHOTOS || !recordId.safeParse(params.reviewId).success) {
    throw new Response("사진을 첨부할 방문 리뷰를 찾을 수 없습니다.", { status: 404, headers: PRIVATE });
  }
  let review;
  try {
    review = await getOwnedPilotPhotoReview(createDb(env.DB), {
      userId: user.id,
      reviewId: params.reviewId,
      now: new Date().toISOString(),
      seats: env.STUDENT_WORKSPACE_ENABLED === "true" ? env.STUDENT_REVIEW_PILOT_SEATS : undefined,
    });
  } catch {
    throw new Response("방문 리뷰를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", { status: 503, headers: PRIVATE });
  }
  if (!review) throw new Response("사진을 첨부할 방문 리뷰를 찾을 수 없습니다.", { status: 404, headers: PRIVATE });
  return data({ review }, { headers: PRIVATE });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request);
  if (request.method !== "POST") return failure("지원하지 않는 요청입니다.", 405, { ...PRIVATE, Allow: "POST" });
  if (!isSameOriginMutation(request)) return failure("요청 출처를 확인할 수 없습니다.", 403);

  const bucket = env.STUDENT_REVIEW_PILOT_PHOTOS;
  if (!bucket || !recordId.safeParse(params.reviewId).success) return failure("방문 리뷰를 찾을 수 없습니다.", 404);
  const contentType = request.headers.get("Content-Type") ?? "";
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "multipart/form-data" && mediaType !== "application/x-www-form-urlencoded") {
    return failure("지원하지 않는 입력 형식입니다.", 415);
  }

  const sessionId = readSessionId(request);
  if (!sessionId) return failure("로그인한 뒤 다시 시도해 주세요.", 401);
  const db = createDb(env.DB);
  try {
    const review = await getOwnedPilotPhotoReview(db, {
      userId: user.id,
      reviewId: params.reviewId,
      now: new Date().toISOString(),
      seats: env.STUDENT_WORKSPACE_ENABLED === "true" ? env.STUDENT_REVIEW_PILOT_SEATS : undefined,
    });
    if (!review) return failure("방문 리뷰를 찾을 수 없습니다.", 404);

    if (mediaType === "multipart/form-data") {
      if (!review.mayUpload) return failure("현재 이 리뷰에는 사진을 첨부할 수 없습니다.", 409);
      const bytes = await readBoundedBody(request, PHOTO_FORM_LIMIT);
      let form: FormData;
      try {
        form = await new Response(bytes.slice().buffer, { headers: { "Content-Type": contentType } }).formData();
      } catch {
        return failure("사진 입력 형식을 확인해 주세요.", 400);
      }
      if (new Set(form.keys()).size !== [...form.keys()].length) return failure("사진 입력 항목을 확인해 주세요.", 400);
      const parsed = uploadSchema.safeParse(Object.fromEntries(form));
      if (!parsed.success) return failure("사진 한 장과 촬영일, 설명, 직접 촬영 및 개인정보 확인을 모두 입력해 주세요.", 400);

      const photos = await parseReviewerPhotoFiles(form);
      if (photos.length !== 1) return failure("사진을 한 장 선택해 주세요.", 400);
      await submitPilotPhoto(db, bucket, {
        userId: user.id,
        sessionId,
        reviewId: review.id,
        expectedContentVersion: parsed.data.expectedContentVersion,
        seats: env.STUDENT_WORKSPACE_ENABLED === "true" ? env.STUDENT_REVIEW_PILOT_SEATS : undefined,
        now: new Date().toISOString(),
        photo: photos[0],
        caption: parsed.data.caption,
        takenOn: parsed.data.takenOn,
      });
      return data({ ok: true as const, message: "사진을 접수했습니다. 검수 상태는 이 화면에서 확인할 수 있어요." }, { headers: PRIVATE });
    }

    const body = new TextDecoder().decode(await readBoundedBody(request, 4_096));
    const form = new URLSearchParams(body);
    if (new Set(form.keys()).size !== [...form.keys()].length) return failure("철회 입력 항목을 확인해 주세요.", 400);
    const parsed = withdrawSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return failure("철회할 사진을 확인해 주세요.", 400);
    if (!review.photos.some((photo) => photo.id === parsed.data.photoId)) return failure("철회할 사진을 찾을 수 없습니다.", 404);
    await withdrawPilotPhoto(db, { photoId: parsed.data.photoId, userId: user.id, sessionId, now: new Date().toISOString() });
    return data({ ok: true as const, message: "사진을 철회했습니다." }, { headers: PRIVATE });
  } catch (error) {
    if (error instanceof ReviewerPhotoValidationError) return failure(reviewerPhotoErrorMessage(error.code), 400);
    if (error instanceof Response && error.status === 413) return failure("사진 또는 입력 용량이 너무 큽니다.", 413);
    if (error instanceof PilotPhotoError && error.status < 500) return failure("사진 또는 리뷰 상태가 바뀌었습니다. 현재 상태를 확인해 주세요.", error.status);
    return failure("사진 처리 결과를 확인하지 못했습니다. 잠시 후 상태를 다시 확인해 주세요.", 503);
  }
}

export default function ReviewerPilotPhoto({ loaderData: { review }, actionData }: Route.ComponentProps) {
  const submit = useSubmit();
  const pending = useNavigation().state !== "idle";
  const [preparing, setPreparing] = useState(false);
  const [preparationError, setPreparationError] = useState<string | null>(null);

  async function prepareUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || preparing) return;
    const form = new FormData(event.currentTarget);
    const selected = form.get("photos");
    if (!(selected instanceof File) || selected.size === 0) {
      setPreparationError("사진을 한 장 선택해 주세요.");
      return;
    }
    setPreparationError(null);
    setPreparing(true);
    try {
      const [prepared] = await prepareReviewerPhotoFiles([selected]);
      form.set("photos", prepared.file);
      void submit(form, { method: "post", encType: "multipart/form-data" });
    } catch (error) {
      setPreparationError(error instanceof ReviewerPhotoPreparationError
        ? reviewerPhotoErrorMessage(error.code) : "사진을 준비하지 못했어요. 다른 사진으로 다시 선택해 주세요.");
    } finally {
      setPreparing(false);
    }
  }

  return <main id="main" className="reviewer-moderation-shell">
    <Link className="inline-flex min-h-11 items-center underline" to="/reviewer/ratings">방문 리뷰 기록으로</Link>
    <h1>직접인증 방문 사진</h1>
    <p className="reviewer-moderation-notice">{review.placeName} 방문 리뷰에 연결된 사진입니다. 방문 리뷰와 사진이 모두 승인되면 장소 상세에 표시됩니다.</p>
    {actionData?.ok === false && !preparationError && <p role="alert">{actionData.error}</p>}
    {actionData?.ok && !preparationError && <p role="status">{actionData.message}</p>}
    {preparationError && <p role="alert">{preparationError}</p>}

    {review.photos.map((photo) => <article key={photo.id} className="grid gap-3 border-t border-neutral-300 py-5">
      <h2 className="text-lg font-semibold">{LABELS[photo.status]}</h2>
      {photo.status !== "UPLOADING" && <img
        src={`/student-review-photos/${encodeURIComponent(photo.id)}?preview=1`}
        alt="내가 제출한 방문 리뷰 사진"
        className="max-h-72 max-w-full rounded-md border border-neutral-300 object-contain"
      />}
      <p className="break-words">{photo.caption}</p>
      <p className="text-sm">촬영일 <time dateTime={photo.takenOn}>{photo.takenOn}</time></p>
      <Form method="post">
        <input type="hidden" name="intent" value="withdraw" />
        <input type="hidden" name="photoId" value={photo.id} />
        <button type="submit" disabled={pending || preparing}
          className="min-h-11 rounded-md border border-neutral-700 px-4 disabled:opacity-50">사진 철회</button>
      </Form>
    </article>)}

    {review.mayUpload ? <section aria-labelledby="pilot-upload-heading" className="max-w-xl border-t border-neutral-300 py-5">
      <h2 id="pilot-upload-heading" className="text-lg font-semibold">사진 한 장 첨부</h2>
      <Form method="post" encType="multipart/form-data" onSubmit={prepareUpload} className="mt-3 grid gap-4">
        <input type="hidden" name="intent" value="upload" />
        <input type="hidden" name="expectedContentVersion" value={review.contentVersion} />
        <label className="grid gap-2">
          직접 촬영한 사진
          <input name="photos" type="file" accept="image/jpeg,image/png,image/webp" required
            aria-describedby="pilot-photo-format" className="min-h-11 max-w-full rounded-md border border-neutral-500 p-2" />
          <span id="pilot-photo-format" className="text-sm">JPEG·PNG·WebP 파일 한 장을 선택하세요.</span>
        </label>
        <label className="grid gap-2">
          촬영일
          <input type="date" name="takenOn" required className="min-h-11 w-full rounded-md border border-neutral-500 px-2" />
        </label>
        <label className="grid gap-2">
          사진 설명
          <textarea name="caption" rows={3} maxLength={240} required className="w-full rounded-md border border-neutral-500 p-2" />
        </label>
        <label className="flex min-h-11 items-start gap-2 py-2">
          <input type="checkbox" name="ownWork" required className="mt-1 size-4 shrink-0" />
          <span>직접 촬영했고 이 사진을 공개할 수 있습니다.</span>
        </label>
        <label className="flex min-h-11 items-start gap-2 py-2">
          <input type="checkbox" name="privacyChecked" required className="mt-1 size-4 shrink-0" />
          <span>얼굴, 연락처 등 다른 사람의 개인정보가 노출되지 않는지 확인했습니다.</span>
        </label>
        <button type="submit" disabled={pending || preparing}
          className="min-h-11 justify-self-start rounded-md bg-neutral-900 px-4 py-2 font-semibold text-white disabled:opacity-50">
          {preparing ? "사진 준비 중" : pending ? "처리 중" : "사진 제출"}
        </button>
      </Form>
    </section> : review.photos.length === 0 && <p role="status">현재 이 리뷰에는 사진을 첨부할 수 없습니다.</p>}
  </main>;
}
