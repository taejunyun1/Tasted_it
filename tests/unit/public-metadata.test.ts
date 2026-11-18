import { expect, it, vi } from "vitest";
import { escapeXml, parseSitemapRequest, placePageMeta, publicPageMeta, resolvePublicOrigin, sitemapXml } from "../../app/features/places/public-metadata";

vi.mock("cloudflare:workers", () => ({ env: {} }));

const place = {
  id: "metadata-place", slug: "metadata-slug", name: '가게 & "이름"', address: "광주 합성로 1", neighborhood: "합성동",
  latitude: 35.15, longitude: 126.9, primaryCategory: { name: "라멘", slug: "ramen-detail", emoji: "🍜" },
  heroImageUrl: "https://unverified.example/photo.jpg",
};

it("keeps page identities bounded and makes filtered listings non-indexable", async () => {
  const { meta } = await import("../../app/routes/place-list");
  const base = { publicOrigin: "https://public.example", pagination: { page: 2 }, search: "?page=2" };
  const page = meta({ loaderData: base } as never);
  expect(page).toContainEqual({ title: "맛집 리스트 · 2페이지 — Re:Taste" });
  expect(page).toContainEqual({ tagName: "link", rel: "canonical", href: "https://public.example/places?page=2" });
  expect(page.some(item => "name" in item && item.name === "robots")).toBe(false);
  expect(meta({ loaderData: { ...base, search: "?page=2&q=라멘" } } as never)).toContainEqual({ name: "robots", content: "noindex,follow" });
  expect(meta({ loaderData: { ...base, search: "?badge=&badge=food-ramen" } } as never)).toContainEqual({ name: "robots", content: "noindex,follow" });
  const missing = meta({ loaderData: { ...base, pagination: { page: 999999, outOfRange: true }, search: "?page=999999" } } as never);
  expect(missing).toContainEqual({ name: "robots", content: "noindex,follow" });
  expect(missing).toContainEqual({ tagName: "link", rel: "canonical", href: "https://public.example/places" });
  for (const page of [0, -1, Number.NaN, 2.5]) {
    expect(publicPageMeta({ title: "t", description: "d", path: "/places?untrusted=1", origin: base.publicOrigin, page }))
      .toContainEqual({ tagName: "link", rel: "canonical", href: "https://public.example/places" });
  }
});

it("uses the public place name rather than its technical slug for share metadata", async () => {
  const { meta } = await import("../../app/routes/place-detail");
  const result = meta({ params: { placeSlug: place.slug }, loaderData: { place, publicOrigin: "https://public.example" } } as never);
  expect(result).toContainEqual({ title: '가게 & "이름" · 합성동 — Re:Taste' });
  expect(result).toContainEqual({ property: "og:url", content: "https://public.example/places/metadata-slug" });
  const failure = meta({ loaderData: { detailError: true, status: 404 } } as never);
  expect(failure).toContainEqual({ name: "robots", content: "noindex,follow" });
});

it("uses configured or known request origins without trusting injected host values", () => {
  expect(resolvePublicOrigin("https://evil.example/places/x", "https://public.example/")).toBe("https://public.example");
  expect(resolvePublicOrigin("http://127.0.0.1:5181/places/x")).toBe("http://127.0.0.1:5181");
  expect(resolvePublicOrigin("https://retaste-beta.retaste-beta.workers.dev/places/x")).toBe("https://retaste-beta.retaste-beta.workers.dev");
  for (const origin of ["https://user:pass@public.example", "https://public.example/path", "https://public.example/?evil=1", "javascript:alert(1)", "http://public.example"]) {
    expect(resolvePublicOrigin("http://localhost/", origin)).toBeNull();
  }
  expect(resolvePublicOrigin("https://unknown.example/places/x")).toBeNull();
});

it("preserves TEMP noindex and omits unsupported structured claims and photos", () => {
  const regular = placePageMeta(place, "https://public.example");
  const jsonld = regular.find((item) => "script:ld+json" in item)?.["script:ld+json"] as Record<string, unknown>;
  expect(jsonld).toMatchObject({ "@type": "Restaurant", name: place.name, servesCuisine: "라멘" });
  expect(jsonld).not.toHaveProperty("aggregateRating");
  expect(jsonld).not.toHaveProperty("image");
  expect(jsonld).not.toHaveProperty("geo");
  const temp = placePageMeta({ ...place, tempCatalog: {} }, "https://public.example");
  expect(temp).toContainEqual({ name: "robots", content: "noindex,follow" });
  expect(temp.some((item) => "script:ld+json" in item)).toBe(false);
  expect(publicPageMeta({ title: "title", description: "description", path: "/places" }).some((item) => "href" in item)).toBe(false);
  expect(publicPageMeta({ title: "title", description: "description", path: "//evil.example/path", origin: "https://public.example" }).some((item) => "href" in item)).toBe(false);
});

it("validates bounded sitemap pages and escapes every XML location", () => {
  expect(parseSitemapRequest(new URLSearchParams())).toEqual({ section: "index" });
  expect(parseSitemapRequest(new URLSearchParams("section=places&page=2"))).toEqual({ section: "places", page: 2 });
  for (const query of ["page=1", "section=places&page=0", "section=places&page=-1", "section=places&page=01", "section=places&page=50001", "section=places&page=1&page=2", "section=static&page=1", "section=private", "evil=1"]) {
    expect(parseSitemapRequest(new URLSearchParams(query))).toBeNull();
  }
  expect(escapeXml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&apos;");
  expect(sitemapXml("sitemapindex", ["https://public.example/sitemap.xml?section=places&page=1"])).toContain("section=places&amp;page=1");
});
