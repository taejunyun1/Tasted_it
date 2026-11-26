import { env } from "cloudflare:workers";

import type { Route } from "./+types/student-review-photo";
import { createDb } from "../db/client.server";
import { getOptionalUser } from "../features/auth/session.server";
import { lookupPilotPhoto, matchesPilotPhotoObject } from "../features/ratings/student-review-pilot-photo.server";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
};

function hidden() {
  return new Response(null, { status: 404, headers: PRIVATE_HEADERS });
}

export async function loader({ request, params }: Route.LoaderArgs) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { ...PRIVATE_HEADERS, Allow: "GET, HEAD" } });
  }
  const bucket = env.STUDENT_REVIEW_PILOT_PHOTOS;
  const photoId = params.photoId;
  if (!bucket || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(photoId ?? "")) {
    return hidden();
  }

  try {
    const db = createDb(env.DB);
    const preview = new URL(request.url).searchParams.get("preview") === "1";
    const actor = preview ? await getOptionalUser(request) : null;
    if (preview && !actor) return hidden();

    const input = { photoId: photoId!, previewForUserId: actor?.id };
    const photo = await lookupPilotPhoto(db, input);
    if (!photo) return hidden();
    const content = request.method === "GET" ? await bucket.get(photo.objectKey) : null;
    const object = request.method === "HEAD" ? await bucket.head(photo.objectKey) : content;
    if (!matchesPilotPhotoObject(object, { photoId: input.photoId, byteSize: photo.byteSize })) return hidden();

    // A withdrawal or review edit during the object read must win before delivery.
    const current = await lookupPilotPhoto(db, input);
    if (current?.objectKey !== photo.objectKey || current.byteSize !== photo.byteSize) return hidden();

    return new Response(content?.body ?? null, { headers: {
      ...PRIVATE_HEADERS,
      "Content-Type": "image/jpeg",
      "Content-Length": String(photo.byteSize),
      ETag: object.httpEtag,
    } });
  } catch {
    return new Response(null, { status: 503, headers: PRIVATE_HEADERS });
  }
}
