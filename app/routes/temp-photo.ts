import { env } from "cloudflare:workers";
import type { Route } from "./+types/temp-photo";
import { getTempPhoto, readVerifiedTempPhoto } from "../features/temp-catalog/temp-catalog.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405, headers: { ...headers, Allow: "GET, HEAD" } });
  const photo = await getTempPhoto(env.DB, params.entryId ?? "");
  if (!photo) return new Response(null, { status: 404, headers });
  try {
    const bytes = await readVerifiedTempPhoto(env.REVIEW_PHOTOS, photo);
    return new Response(request.method === "HEAD" ? null : bytes, { headers: { ...headers, "Content-Type": photo.contentType } });
  } catch (error) {
    return new Response(null, { status: error instanceof Error && error.message === "TEMP_PHOTO_NOT_READY" ? 404 : 503, headers });
  }
}
