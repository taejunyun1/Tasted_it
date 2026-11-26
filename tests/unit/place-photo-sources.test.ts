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
  expect(sourceLinks[0][1]).toContain(`href="${url.replaceAll("&", "&amp;")}"`);
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
    const source = reviewedPlacePhotoOriginal({ id, name, address }, { threads: "true", youtube: "true" });
    expect(source).toEqual({ url, publisher: "네이버 플레이스 · 업체 사진" });
    expect(reviewedPlacePhotoOriginal({ id, name, address: `${address} 2층` })).toBeNull();
    expectExactPhotoSource(renderToStaticMarkup(createElement(PlacePhotoOriginalLink, { source: source! })), url);
  });

  it("offers the registered Threads gallery only when enabled and waits for a click", () => {
    const place = { id: "place-intake-1d21bef4545b2941c0c68f66", name: "옛날두부", address: "전남광주 화순군 시장길 33 (삼천리)" };
    const disabled = reviewedPlacePhotoOriginal(place);
    expect(disabled?.embed).toBeUndefined();
    const source = reviewedPlacePhotoOriginal(place, { threads: "true" });
    expect(source?.embed).toEqual({ provider: "threads", url: THREADS_PHOTO_FRAME_SOURCE });
    const html = renderToStaticMarkup(createElement(PlacePhotoOriginalLink, { source: source! }));
    expect(html).toContain("Threads에 연결해 사진 보기");
    expect(html).not.toContain("<iframe");
    expectExactPhotoSource(html, "https://www.threads.com/@hwasun_dubu/post/DWkUdT7E-7W");
    expect(reviewedPlacePhotoOriginal({ ...place, name: "다른 업소" }, { threads: "true" })).toBeNull();
  });

  it("keeps the county video source available with its player independently gated", () => {
    const place = { id: "place-intake-f7a0d770e886c35979f8fd2a", name: "서성식당", address: "전남광주 해남군 중앙1로 282 (구교리)" };
    const original = reviewedPlacePhotoOriginal(place, { threads: "true" });
    expect(original).toEqual({ url: "https://www.youtube.com/watch?v=XVApkkeXoRQ", publisher: "YouTube · 해남군", mediaKind: "video" });
    const source = reviewedPlacePhotoOriginal(place, { youtube: "true" });
    expect(source?.embed).toEqual({ provider: "youtube", url: "https://www.youtube-nocookie.com/embed/XVApkkeXoRQ" });
    const html = renderToStaticMarkup(createElement(PlacePhotoOriginalLink, { source: source! }));
    expect(html).toContain("YouTube에 연결해 영상 보기");
    expect(html).not.toContain("<iframe");
    expectExactPhotoSource(html, "https://www.youtube.com/watch?v=XVApkkeXoRQ");
  });

  it.each([
    ["place-intake-5510fb20164ca7a5536bcb45", "60년전통손두부식당", "전남광주 구례군 동해벚꽃로 95 (죽마리)",
      "https://www.youtube.com/watch?v=kTz_GZQEXZ4&t=65s", "https://www.youtube-nocookie.com/embed/kTz_GZQEXZ4?start=65", undefined],
    ["place-intake-7b0c5921a7dd34f9b880ed5e", "팔레스분식", "전남광주 북구 밤실로208번길 20 (두암동)",
      "https://www.youtube.com/watch?v=fFQgQMYL8ag&t=320s", "https://www.youtube-nocookie.com/embed/fFQgQMYL8ag?start=320&end=338", "원본 영상에 유료 프로모션 포함"],
    ["place-intake-d9ea0471ad5c4eb487d3dc29", "광성식당", "전북 남원시 광한서로 7 (천거동)",
      "https://carcam-n-garden.tistory.com/69", undefined, undefined],
  ])("binds the exact reviewed source for %s", (id, name, address, url, embedUrl, disclosure) => {
    const place = { id, name, address };
    expect(reviewedPlacePhotoOriginal(place)?.embed).toBeUndefined();
    expect(reviewedPlacePhotoOriginal({ ...place, address: `${address} 2층` }, { youtube: "true" })).toBeNull();
    const source = reviewedPlacePhotoOriginal(place, { youtube: "true" });
    expect(source?.embed?.url).toBe(embedUrl);
    const html = renderToStaticMarkup(createElement(PlacePhotoOriginalLink, { source: source! }));
    expectExactPhotoSource(html, url);
    expect(html).not.toContain("<iframe");
    if (disclosure) expect(html).toContain(disclosure);
  });
});
