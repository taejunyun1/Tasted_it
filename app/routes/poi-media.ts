import { env } from "cloudflare:workers";
import type { Route } from "./+types/poi-media";
import { createDb } from "../db/client.server";
import { POI_MEDIA_CONTENT_TYPE, poiMediaIdSchema } from "../features/poi-media/poi-media";
import { getPublishedPoiMedia, readVerifiedPoiMedia } from "../features/poi-media/poi-media.server";

const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

function methodNotAllowed() {
  return new Response(null, { status: 405, headers: { ...privateHeaders, Allow: "GET, HEAD" } });
}

export function action() {
  return methodNotAllowed();
}

export async function loader({ request, params }: Route.LoaderArgs) {
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed();
  const id = poiMediaIdSchema.safeParse(params.mediaId);
  if (env.POI_MEDIA_PUBLIC_ENABLED !== "true" || !id.success) {
    return new Response(null, { status: 404, headers: privateHeaders });
  }

  try {
    const photo = await getPublishedPoiMedia(createDb(env.DB), id.data);
    const bytes = photo ? await readVerifiedPoiMedia(env.REVIEW_PHOTOS, photo) : null;
    if (!bytes) return new Response(null, { status: 404, headers: privateHeaders });
    return new Response(request.method === "HEAD" ? null : bytes, {
      headers: {
        ...privateHeaders,
        "Content-Type": POI_MEDIA_CONTENT_TYPE,
        "Content-Length": String(bytes.byteLength),
      },
    });
  } catch {
    return new Response(null, { status: 503, headers: privateHeaders });
  }
}
