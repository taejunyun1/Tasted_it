import { env } from "cloudflare:workers";
import type { Route } from "./+types/temp-photo";
import { getTempPhoto } from "../features/temp-catalog/temp-catalog.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405, headers: { ...headers, Allow: "GET, HEAD" } });
  const photo = await getTempPhoto(env.DB, params.entryId ?? "");
  if (!photo) return new Response(null, { status: 404, headers });
  const object = await env.REVIEW_PHOTOS.get(photo.key);
  if (!object || object.customMetadata?.sha256 !== photo.sha256) return new Response(null, { status: 404, headers });
  return new Response(request.method === "HEAD" ? null : object.body, { headers: { ...headers, "Content-Type": photo.contentType } });
}
