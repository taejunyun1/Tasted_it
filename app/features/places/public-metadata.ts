import type { MetaDescriptor } from "react-router";
import { RSI_LIVE_ORIGIN } from "../operations/rsi-self-check";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
export const PUBLIC_SITEMAP_PATHS = ["/", "/privacy", "/terms", "/login", "/signup", "/courses", "/places"] as const;
export const SITEMAP_PAGE_SIZE = 100;
export const MAX_SITEMAP_PAGES = 50_000;

/** Configured origin wins. Never read proxy/Host headers for canonical URLs. */
export function resolvePublicOrigin(requestUrl: string, appBaseUrl?: string | null): string | null {
  try {
    if (appBaseUrl?.trim()) {
      const base = new URL(appBaseUrl.trim());
      if (base.username || base.password || base.search || base.hash || base.pathname !== "/") return null;
      if (base.protocol !== "https:" && !(base.protocol === "http:" && LOCAL_HOSTS.has(base.hostname))) return null;
      return base.origin;
    }
    const request = new URL(requestUrl);
    if (request.username || request.password) return null;
    if (request.origin === RSI_LIVE_ORIGIN) return request.origin;
    if (LOCAL_HOSTS.has(request.hostname) && ["http:", "https:"].includes(request.protocol)) return request.origin;
  } catch { /* Unknown origins must not become canonical URLs. */ }
  return null;
}

function canonicalPublicUrl(path: string, origin?: string | null, page?: number): string | null {
  if (!origin || !path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u001f]/u.test(path)) return null;
  const trusted = resolvePublicOrigin("", origin);
  if (!trusted) return null;
  const url = new URL(path, trusted);
  if (url.origin !== trusted) return null;
  url.search = "";
  if (url.pathname === "/places" && page && Number.isSafeInteger(page) && page > 1) url.searchParams.set("page", String(page));
  url.hash = "";
  return url.href;
}

export function publicPageMeta(input: { title: string; description: string; path: string; origin?: string | null; noindex?: boolean; page?: number }): MetaDescriptor[] {
  const descriptors: MetaDescriptor[] = [
    { title: input.title },
    { name: "description", content: input.description },
    { property: "og:title", content: input.title },
    { property: "og:description", content: input.description },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ];
  const canonical = canonicalPublicUrl(input.path, input.origin, input.page);
  if (canonical) {
    descriptors.push({ tagName: "link", rel: "canonical", href: canonical }, { property: "og:url", content: canonical });
  }
  if (input.noindex) descriptors.push({ name: "robots", content: "noindex,follow" });
  return descriptors;
}

export function placePageMeta(place: {
  slug: string; name: string; address: string; neighborhood: string;
  primaryCategory: { name: string }; tempCatalog?: unknown;
}, origin?: string | null): MetaDescriptor[] {
  const title = `${place.name}${place.neighborhood ? ` · ${place.neighborhood}` : ""} — Re:Taste`;
  const description = [place.name, place.primaryCategory.name, place.neighborhood, place.address].filter(Boolean).join(" · ");
  const path = `/places/${encodeURIComponent(place.slug)}`;
  const canonical = canonicalPublicUrl(path, origin);
  const descriptors = publicPageMeta({ title, description, path, origin, noindex: Boolean(place.tempCatalog) });
  if (!place.tempCatalog) {
    // Only the published identity fields also rendered on this page are used.
    // Coordinates, hours, images and ratings have separate evidence contracts.
    descriptors.push({ "script:ld+json": {
      "@context": "https://schema.org", "@type": "Restaurant",
      name: place.name,
      address: { "@type": "PostalAddress", streetAddress: place.address },
      servesCuisine: place.primaryCategory.name,
      ...(canonical ? { url: canonical } : {}),
    } });
  }
  return descriptors;
}

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
}

export type SitemapRequest = { section: "index" } | { section: "static" } | { section: "places" | "categories"; page: number };
export function parseSitemapRequest(search: URLSearchParams): SitemapRequest | null {
  if ([...search.keys()].some((key) => !["section", "page"].includes(key)) || search.getAll("section").length > 1 || search.getAll("page").length > 1) return null;
  const section = search.get("section");
  if (section === null) return search.has("page") ? null : { section: "index" };
  if (section === "static") return search.has("page") ? null : { section };
  if (section !== "places" && section !== "categories") return null;
  const raw = search.get("page") ?? "1";
  if (!/^[1-9]\d{0,4}$/.test(raw) || Number(raw) > MAX_SITEMAP_PAGES) return null;
  return { section, page: Number(raw) };
}

export function sitemapXml(kind: "urlset" | "sitemapindex", urls: string[]): string {
  const entry = kind === "urlset" ? "url" : "sitemap";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<${kind} xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <${entry}><loc>${escapeXml(url)}</loc></${entry}>`).join("\n")}\n</${kind}>\n`;
}
