import type { Route } from "./+types/sitemap";
import { env } from "cloudflare:workers";
import { createDb } from "../db/client.server";
import { getPublicSitemapCounts, listPublicSitemapPage } from "../features/places/public-metadata.server";
import { MAX_SITEMAP_PAGES, PUBLIC_SITEMAP_PATHS, SITEMAP_PAGE_SIZE, parseSitemapRequest, resolvePublicOrigin, sitemapXml } from "../features/places/public-metadata";

export async function loader({ request }: Route.LoaderArgs) {
  const selection = parseSitemapRequest(new URL(request.url).searchParams);
  if (!selection) return new Response("사이트맵 요청 형식이 올바르지 않습니다.", { status: 400, headers: { "Cache-Control": "no-store" } });
  const origin = resolvePublicOrigin(request.url, (env as Env & { APP_BASE_URL?: string }).APP_BASE_URL);
  if (!origin) return new Response("공개 사이트 주소 확인이 필요합니다.", { status: 503, headers: { "Cache-Control": "no-store" } });
  let kind: "urlset" | "sitemapindex" = "urlset";
  let paths: string[];
  if (selection.section === "static") paths = [...PUBLIC_SITEMAP_PATHS];
  else {
    const db = createDb(env.DB), counts = await getPublicSitemapCounts(db);
    if (selection.section === "index") {
      kind = "sitemapindex";
      const sections = ["places", "categories"] as const;
      const pageCounts = sections.map((section) => Math.ceil(counts[section] / SITEMAP_PAGE_SIZE));
      if (1 + pageCounts.reduce((total, count) => total + count, 0) > MAX_SITEMAP_PAGES) return new Response("사이트맵 분할 범위 확인이 필요합니다.", { status: 503, headers: { "Cache-Control": "no-store" } });
      paths = ["/sitemap.xml?section=static", ...sections.flatMap((section, index) => Array.from({ length: pageCounts[index] }, (_, page) => `/sitemap.xml?section=${section}&page=${page + 1}`))];
    } else {
      if (selection.page > Math.max(1, Math.ceil(counts[selection.section] / SITEMAP_PAGE_SIZE))) return new Response("사이트맵 페이지를 찾지 못했습니다.", { status: 404, headers: { "Cache-Control": "no-store" } });
      paths = await listPublicSitemapPage(db, selection.section, selection.page);
    }
  }
  const body = sitemapXml(kind, paths.map((path) => new URL(path, origin).href));
  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" },
  });
}
