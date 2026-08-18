import type { Route } from "./+types/sitemap";

const PUBLIC_PATHS = ["/", "/privacy", "/terms", "/login", "/signup", "/courses", "/places"];

export async function loader({ request }: Route.LoaderArgs) {
  const origin = new URL(request.url).origin;
  const urls = PUBLIC_PATHS.map((path) => `  <url><loc>${origin}${path}</loc></url>`).join("\n");
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
