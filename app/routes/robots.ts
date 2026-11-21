import type { Route } from "./+types/robots";
import { env } from "cloudflare:workers";
import { resolvePublicOrigin } from "../features/places/public-metadata";

export async function loader({ request }: Route.LoaderArgs) {
  const origin = resolvePublicOrigin(request.url, (env as Env & { APP_BASE_URL?: string }).APP_BASE_URL);
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin",
    "Disallow: /admin/",
    "Disallow: /me",
    "Disallow: /me/",
    ...(origin ? [`Sitemap: ${origin}/sitemap.xml`] : []),
    "",
  ].join("\n");
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
