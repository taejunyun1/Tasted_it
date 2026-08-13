import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";

import type { Route } from "./+types/reviewer-photo";
import { createDb } from "../db/client.server";
import { reviewerVisitPhotos } from "../db/schema";

function isOpaquePhotoId(value: string | undefined) {
  return Boolean(value && /^[A-Za-z0-9_-]{1,128}$/.test(value));
}

export async function loader({ request, params }: Route.LoaderArgs) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  if (!isOpaquePhotoId(params.photoId)) return new Response(null, { status: 404 });

  const row = await createDb(env.DB).select({
    objectKey: reviewerVisitPhotos.objectKey,
    contentType: reviewerVisitPhotos.contentType,
  }).from(reviewerVisitPhotos)
    .where(eq(reviewerVisitPhotos.id, params.photoId))
    .limit(1)
    .then((rows) => rows[0] ?? null);
  if (!row) return new Response(null, { status: 404 });

  const object = await env.REVIEW_PHOTOS.get(row.objectKey);
  if (!object) return new Response(null, { status: 404 });
  const headers = new Headers({
    "Content-Type": row.contentType,
    "Cache-Control": "public, max-age=3600, s-maxage=86400",
    "X-Content-Type-Options": "nosniff",
    ETag: object.httpEtag,
  });
  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}
