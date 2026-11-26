import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlaceInstagramPhoto } from "../../app/components/places/PlaceInstagramPhoto";
import { PlacePoiPhoto } from "../../app/components/places/PlacePoiPhoto";
import { PlacePhotoOriginalLink } from "../../app/components/places/PlacePhotoOriginalLink";
import { reviewedPlacePhotoOriginal } from "../../app/features/poi-media/photo-original-sources";
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
    ["place-intake-e73658c5cb8bf44d666e628a", "고부정", "전남광주 담양군 지침6길 53 (지침리)", "32230517"],
    ["c893e7dc-c6a0-4467-82b8-8859051d24c8", "고템커피", "전남광주통합특별시 고흥군 고흥읍 고흥로 1670-7", "1117337292"],
    ["place-intake-02c40d8d0a6e5409b7425fda", "담양현재국수", "전남광주 담양군 객사3길 24 (객사리)", "1870179264"],
    ["place-intake-7a534081f2e2fca2ce7b27c8", "들뫼풍경", "전북 고창군 전봉준로 108 (율계리)", "32246867"],
    ["place-intake-5d7a3a429e2c173c6e3c2d5d", "실키밀키", "전남광주 광산구 첨단내촌로 46-1 (월계동)", "1942978740"],
    ["61b9993d-673b-47ed-b3b9-95875cc35ce5", "야들족발", "전남광주통합특별시 광산구 하남산단1번로 61, 1층 132호 (하남동)", "2004050569"],
    ["90807efb-7daa-4d5b-b99d-66ee73962a75", "점심한끼", "전남광주통합특별시 서구 월산로 257, 1층 (농성동)", "1156425740"],
  ])("links the owner gallery for %s", (id, name, address, naverId) => {
    const url = `https://m.place.naver.com/restaurant/${naverId}/photo?filterType=%EC%97%85%EC%B2%B4`;
    const source = reviewedPlacePhotoOriginal({ id, name, address });
    expect(source).toEqual({ url, publisher: "네이버 플레이스 · 업체 사진" });
    expect(reviewedPlacePhotoOriginal({ id, name, address: `${address} 2층` })).toBeNull();
    expectExactPhotoSource(renderToStaticMarkup(createElement(PlacePhotoOriginalLink, { source: source! })), url);
  });

  it.each([
    ["place-intake-1d21bef4545b2941c0c68f66", "옛날두부", "전남광주 화순군 시장길 33 (삼천리)", "hwasun_dubu", "DWkUdT7E-7W"],
    ["c4c2e79d-00a4-4dc5-9dfd-e051bc213bd7", "이것이아구찜이다", "전남광주통합특별시 광양시 중마청룡1길 7-7, 3층중 1층일부 (중동)", "jinvima123", "DcxYATFkzc9"],
  ])("offers the registered Threads gallery only when enabled and waits for a click for %s", (id, name, address, account, shortcode) => {
    const place = { id, name, address };
    const originalUrl = `https://www.threads.com/@${account}/post/${shortcode}`;
    const disabled = reviewedPlacePhotoOriginal(place);
    expect(disabled?.embed).toBeUndefined();
    expect(disabled?.url).toBe(originalUrl);
    const source = reviewedPlacePhotoOriginal(place, { threads: "true" });
    expect(source?.embed).toEqual({ provider: "threads", url: `https://www.threads.com/t/${shortcode}/embed/` });
    const html = renderToStaticMarkup(createElement(PlacePhotoOriginalLink, { source: source! }));
    expect(html).toContain("Threads에 연결해 사진 보기");
    expect(html).not.toContain("<iframe");
    expectExactPhotoSource(html, originalUrl);
    expect(reviewedPlacePhotoOriginal({ ...place, name: "다른 업소" }, { threads: "true" })).toBeNull();
    expect(reviewedPlacePhotoOriginal({ ...place, address: `${address} 2층` }, { threads: "true" })).toBeNull();
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
      "https://m.blog.naver.com/every100/clip/9398864", undefined, "원본에 협찬 표시"],
    ["place-intake-6ffa8e7ddfaac3f3fb91e854", "복록수", "전남광주 동구 서석로10번길 9 (불로동)",
      "https://m.blog.naver.com/fmfun/clip/306388", undefined, undefined],
    ["place-intake-4c5afcf5031e6bfbf8d3484e", "사거리통골뱅이", "광주 동구 충장로58번길 18-2 (충장동, 충장로4가)",
      "https://www.youtube.com/shorts/edU_JvgAprI", "https://www.youtube-nocookie.com/embed/edU_JvgAprI", "2023년 공개 영상"],
    ["place-intake-c30606b3e3b35b21fcbaf9f5", "원조목살집", "전남광주 목포시 평화로107번길 3 (상동)",
      "https://m.blog.naver.com/jiwon4348/clip/5134953", undefined, undefined],
    ["place-intake-14a109105ee648efe481ac85", "착한가리비", "전남광주 북구 대자로 69 (운암동)",
      "https://hwa2ting.tistory.com/429", undefined, undefined],
    ["place-intake-950ba22fa1c3cd0685fbbdde", "목살집", "전남광주 남구 광복마을6길 1 (진월동)",
      "https://www.youtube.com/watch?v=INk0aC5hoK4&t=120s", "https://www.youtube-nocookie.com/embed/INk0aC5hoK4?start=120", undefined],
    ["place-intake-296fe52a6f1a1f39f8a2a9f6", "오비수산", "전남광주 광산구 장신로19번안길 23-4 (장덕동)",
      "https://www.youtube.com/shorts/nILy25jCyaI", "https://www.youtube-nocookie.com/embed/nILy25jCyaI", undefined],
    ["place-intake-17422a656ab8d3e89bc20013", "반달곰식당", "전남광주 구례군 중앙로 88 (봉북리)",
      "https://m.blog.naver.com/studio_young0425/224365538127", undefined, undefined],
    ["place-intake-04a99c49889c69595df5332a", "자매통닭&호프", "광주 동구 천변우로 363-26 (호남동)",
      "https://m.blog.naver.com/sososo2516/224145188426", undefined, undefined],
    ["18c0fe3a-227b-4602-9d83-f6e9e88e0636", "뉴욕감자탕", "전남광주통합특별시 나주시 상야4길 10, 124,125호 (빛가람동)",
      "https://map.naver.com/p/entry/place/2029828674?placePath=%2Fphoto", undefined, undefined],
    ["place-intake-4413539f62e7921d84f7f1d1", "대나무골", "전남광주 담양군 대전로 182 (태목리)",
      "https://www.youtube.com/watch?v=oZOV6I1EbHg", "https://www.youtube-nocookie.com/embed/oZOV6I1EbHg", "2020년 공개 영상"],
    ["place-intake-70adfdd5a852000637f61b24", "구수향", "전남광주 동구 예술길 23-6 (궁동)",
      "https://www.youtube.com/watch?v=aNhumVtW-U4", "https://www.youtube-nocookie.com/embed/aNhumVtW-U4", "2023년 공개 영상"],
    ["place-intake-f7be1ac1c83b2885dff15c0d", "토방닭매운탕", "전남광주 북구 서방로107번길 13 (두암동)",
      "https://www.youtube.com/watch?v=osYf3qz36HI&t=735s", "https://www.youtube-nocookie.com/embed/osYf3qz36HI?start=735&end=745", undefined],
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

  it.each([
    ["0bf5c86b-5043-4d3f-98ce-5949f2db2800", "전라도미가", "전남광주통합특별시 동구 필문대로191번길 19, 1층 (산수동)",
      "https://www.youtube.com/watch?v=VfODxqfwx9w&t=66s", "https://www.youtube-nocookie.com/embed/VfODxqfwx9w?start=66"],
    ["place-intake-02c40d8d0a6e5409b7425fda", "담양현재국수", "전남광주 담양군 객사3길 24 (객사리)",
      "https://www.youtube.com/watch?v=glRm4NcRhac&t=273s", "https://www.youtube-nocookie.com/embed/glRm4NcRhac?start=273&end=298"],
    ["place-intake-e724797f168726b01426c9cc", "그랑깨", "전북 남원시 광한서로 52 (금동)",
      "https://www.youtube.com/watch?v=ZnbtJLRHUzM&t=80s", "https://www.youtube-nocookie.com/embed/ZnbtJLRHUzM?start=80"],
    ["place-intake-684ed24c5417c7ec77450dac", "복순이네", "전남광주 동구 양림로 120 (학동)",
      "https://www.youtube.com/watch?v=XdOXi2ctQQo", "https://www.youtube-nocookie.com/embed/XdOXi2ctQQo"],
    ["place-intake-9b5c7ca3a8904995819e1530", "엄지빈", "전남광주 화순군 화순읍 진각로 168",
      "https://www.youtube.com/watch?v=g9UdzGNidBA", "https://www.youtube-nocookie.com/embed/g9UdzGNidBA"],
    ["place-intake-afcab0afe63e6705a527d23f", "한마음포차", "전남광주 동구 서석로10번길 10 (불로동)",
      "https://www.youtube.com/watch?v=bLChzMGGUSI&t=765s", "https://www.youtube-nocookie.com/embed/bLChzMGGUSI?start=765&end=780"],
    ["bd45a029-bce6-485d-8efc-425dca48f606", "조단부부", "전남광주통합특별시 구례군 구례읍 봉성로 103-1",
      "https://www.youtube.com/watch?v=UuAk8wjryzY&t=512s", "https://www.youtube-nocookie.com/embed/UuAk8wjryzY?start=512&end=525"],
  ])("chooses the matching video and its exact source instead of the fallback gallery for %s", (id, name, address, url, embedUrl) => {
    const place = { id, name, address };
    const source = reviewedPlacePhotoOriginal(place, { youtube: "true" });
    expect(source).toMatchObject({ url, mediaKind: "video", embed: { provider: "youtube", url: embedUrl } });
    expect(reviewedPlacePhotoOriginal({ ...place, name: "다른 업소" }, { youtube: "true" })).toBeNull();
    const html = renderToStaticMarkup(createElement(PlacePhotoOriginalLink, { source: source! }));
    expectExactPhotoSource(html, url);
    expect(html).not.toContain("<iframe");
  });

  it("keeps the Namwon archive available while the venue video is disabled", () => {
    const place = { id: "place-intake-e724797f168726b01426c9cc", name: "그랑깨", address: "전북 남원시 광한서로 52 (금동)" };
    const source = reviewedPlacePhotoOriginal(place, { youtube: "false" });
    expect(source?.publisher).toBe("남원시 사진기록관");
    expect(source?.url).toContain("dataId=922811");
    expect(source?.embed).toBeUndefined();
  });

  it.each([
    ["place-intake-4c5afcf5031e6bfbf8d3484e", "사거리통골뱅이", "광주 동구 충장로58번길 18-2 (충장동, 충장로4가)",
      "https://m.blog.naver.com/loveis7108/clip/7801577"],
    ["place-intake-296fe52a6f1a1f39f8a2a9f6", "오비수산", "전남광주 광산구 장신로19번안길 23-4 (장덕동)",
      "https://m.place.naver.com/restaurant/2004979994/feed"],
  ])("keeps the exact Naver source when the venue video is disabled for %s", (id, name, address, url) => {
    const source = reviewedPlacePhotoOriginal({ id, name, address }, { youtube: "false" });
    expect(source).toMatchObject({ url, mediaKind: "video" });
    expect(source?.embed).toBeUndefined();
    expectExactPhotoSource(renderToStaticMarkup(createElement(PlacePhotoOriginalLink, { source: source! })), url);
  });
});
