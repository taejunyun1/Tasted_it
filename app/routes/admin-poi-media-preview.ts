import { env } from "cloudflare:workers";
import type { Route } from "./+types/admin-poi-media-preview";
import { createDb } from "../db/client.server";
import { requireAdminSession } from "../features/auth/session.server";
import { readAdminPoiMediaPreview } from "../features/poi-media/poi-media-admin.server";
import { POI_MEDIA_CONTENT_TYPE, poiMediaIdSchema } from "../features/poi-media/poi-media";

const PRIVATE = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
};

export function action() {
  return new Response(null, { status: 405, headers: { ...PRIVATE, Allow: "GET, HEAD" } });
}

export async function loader({ params, request }: Route.LoaderArgs) {
  await requireAdminSession(request);
  if (request.method !== "GET" && request.method !== "HEAD") return action();
  const id = poiMediaIdSchema.safeParse(params.mediaId);
  if (!id.success) return new Response(null, { status: 404, headers: PRIVATE });
  try {
    const bytes = await readAdminPoiMediaPreview(createDb(env.DB), env.REVIEW_PHOTOS, id.data);
    if (!bytes) return new Response(null, { status: 404, headers: PRIVATE });
    return new Response(request.method === "HEAD" ? null : bytes, {
      headers: { ...PRIVATE, "Content-Type": POI_MEDIA_CONTENT_TYPE, "Content-Length": String(bytes.byteLength) },
    });
  } catch {
    return new Response(null, { status: 503, headers: PRIVATE });
  }
}
