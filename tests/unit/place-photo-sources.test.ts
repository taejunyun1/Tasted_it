import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlaceInstagramPhoto } from "../../app/components/places/PlaceInstagramPhoto";
import { PlacePoiPhoto } from "../../app/components/places/PlacePoiPhoto";
import { TempCatalogNotice } from "../../app/features/temp-catalog/TempCatalogNotice";

function expectExactPhotoSource(html: string, url: string) {
  const sourceLinks = [...html.matchAll(/<a ([^>]+)>출처<\/a>/gu)];
  expect(sourceLinks).toHaveLength(1);
  expect(sourceLinks[0][1]).toContain(`href="${url}"`);
  expect(sourceLinks[0][1]).toContain('rel="noopener"');
  expect(sourceLinks[0][1]).toContain('referrerPolicy="strict-origin"');
}

describe("place photo source links", () => {
  it.each([
    "https://pcmap.place.naver.com/restaurant/123/review/visitor/test-review",
    "https://www.facebook.com/example/posts/123",
    "https://www.threads.com/@example/post/TestPost",
    "https://www.tiktok.com/@example/photo/123",
  ])("keeps the exact approved original URL %s", (sourceUrl) => {
    const html = renderToStaticMarkup(createElement(PlacePoiPhoto, {
      placeName: "합성 장소", heroClassName: "detail-hero",
      photo: { url: "/poi-media/test", sourceUrl, attribution: "합성 제공자" },
    }));
    expectExactPhotoSource(html, sourceUrl);
    expect(html).toContain("합성 제공자");
  });

  it("links the Instagram post and does not refer from the embedded frame", () => {
    const postUrl = "https://www.instagram.com/p/TestPost/";
    const html = renderToStaticMarkup(createElement(PlaceInstagramPhoto, {
      placeName: "합성 장소", photo: { postUrl, embedUrl: `${postUrl}embed/` },
    }));
    expectExactPhotoSource(html, postUrl);
    expect(html).toContain('referrerPolicy="no-referrer"');
  });

  it("links the exact recorded Naver file for an existing TEMP image", () => {
    const imageUrl = "https://pup-review-phinf.pstatic.net/test-photo.jpg";
    const sourceUrl = "https://tour.gwangju.go.kr/example";
    const sourceId = "temp100-001";
    const name = "합성 장소";
    const address = "광주 합성 주소";
    const checkedAt = "2026-11-26T00:00:00Z";
    const html = renderToStaticMarkup(createElement(TempCatalogNotice, { info: {
      sourceId, name, address, checkedAt, region: "광주", cuisine: "기타", summary: "합성 검증용 장소입니다.",
      entryId: "test", photoUrl: "/temp-photos/test", sourceUrl, sourceTitle: "합성 위치",
      evaluation: { kind: "OFFICIAL_CURATION", provider: "합성", sourceUrl }, photo: null,
      photoSupplement: { sourceId, name, address, checkedAt, imageUrl, rightsStatus: "UNVERIFIED",
        sourcePageUrl: "https://pcmap.place.naver.com/restaurant/123/photo", attribution: "네이버 공개 사진",
        sha256: "a".repeat(64), contentType: "image/jpeg" },
    } }));
    expectExactPhotoSource(html, imageUrl);
    expect(html).toContain("네이버 공개 사진");
  });
});
