import { env } from "cloudflare:workers";

import type { Route } from "./+types/reviewer-photo";
import { createDb } from "../db/client.server";
import { getOptionalUser } from "../features/auth/session.server";
import {
  getPublicReviewerPhoto,
  getReviewerPhotoPreview,
} from "../features/ratings/reviewer-photo-access.server";

const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };

function isOpaquePhotoId(value: string | undefined) {
  return Boolean(value && /^[A-Za-z0-9_-]{1,128}$/.test(value));
}

export async function loader({ request, params }: Route.LoaderArgs) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, {
      status: 405,
      headers: { ...privateHeaders, Allow: "GET, HEAD" },
    });
  }
  if (!isOpaquePhotoId(params.photoId))
    return new Response(null, { status: 404, headers: privateHeaders });

  let row: Awaited<ReturnType<typeof getPublicReviewerPhoto>> | null;
  try {
    const db = createDb(env.DB);
    const preview = new URL(request.url).searchParams.get("preview") === "1";
    const actor = preview ? await getOptionalUser(request) : null;
    row = preview
      ? actor
        ? await getReviewerPhotoPreview(db, {
            photoId: params.photoId!,
            actorUserId: actor.id,
          })
        : null
      : await getPublicReviewerPhoto(db, params.photoId!);
  } catch {
    return new Response(null, { status: 503, headers: privateHeaders });
  }
  if (!row) return new Response(null, { status: 404, headers: privateHeaders });

  let object: R2ObjectBody | null;
  try {
    object = await env.REVIEW_PHOTOS.get(row.objectKey);
  } catch {
    return new Response(null, { status: 503, headers: privateHeaders });
  }
  if (!object)
    return new Response(null, { status: 404, headers: privateHeaders });
  const headers = new Headers({
    ...privateHeaders,
    "Content-Type": row.contentType,
    "X-Content-Type-Options": "nosniff",
    ETag: object.httpEtag,
  });
  return new Response(request.method === "HEAD" ? null : object.body, {
    headers,
  });
}
