import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlaceInstagramPhoto } from "../../app/components/places/PlaceInstagramPhoto";
import { PlacePoiPhoto } from "../../app/components/places/PlacePoiPhoto";
import { PlacePhotoOriginalLink } from "../../app/components/places/PlacePhotoOriginalLink";
import { reviewedPlacePhotoOriginal, THREADS_PHOTO_FRAME_SOURCE } from "../../app/features/poi-media/photo-original-sources";
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

  it.each([
    ["0bf5c86b-5043-4d3f-98ce-5949f2db2800", "전라도미가", "전남광주통합특별시 동구 필문대로191번길 19, 1층 (산수동)", "37505718"],
    ["place-intake-afcab0afe63e6705a527d23f", "한마음포차", "전남광주 동구 서석로10번길 10 (불로동)", "38276589"],
    ["bd45a029-bce6-485d-8efc-425dca48f606", "조단부부", "전남광주통합특별시 구례군 구례읍 봉성로 103-1", "1619421905"],
  ])("links the owner gallery for %s", (id, name, address, naverId) => {
    const url = `https://m.place.naver.com/restaurant/${naverId}/photo?filterType=%EC%97%85%EC%B2%B4`;
    const source = reviewedPlacePhotoOriginal({ id, name, address }, "true");
    expect(source).toEqual({ url, publisher: "네이버 플레이스 · 업체 사진" });
    expect(reviewedPlacePhotoOriginal({ id, name, address: `${address} 2층` })).toBeNull();
    expectExactPhotoSource(renderToStaticMarkup(createElement(PlacePhotoOriginalLink, { source: source! })), url);
  });

  it("offers the registered Threads gallery only when enabled and waits for a click", () => {
    const place = { id: "place-intake-1d21bef4545b2941c0c68f66", name: "옛날두부", address: "전남광주 화순군 시장길 33 (삼천리)" };
    const disabled = reviewedPlacePhotoOriginal(place);
    expect(disabled?.embedUrl).toBeUndefined();
    const source = reviewedPlacePhotoOriginal(place, "true");
    expect(source?.embedUrl).toBe(THREADS_PHOTO_FRAME_SOURCE);
    const html = renderToStaticMarkup(createElement(PlacePhotoOriginalLink, { source: source! }));
    expect(html).toContain("Threads에 연결해 사진 보기");
    expect(html).not.toContain("<iframe");
    expectExactPhotoSource(html, "https://www.threads.com/@hwasun_dubu/post/DWkUdT7E-7W");
    expect(reviewedPlacePhotoOriginal({ ...place, name: "다른 업소" }, "true")).toBeNull();
  });
});
