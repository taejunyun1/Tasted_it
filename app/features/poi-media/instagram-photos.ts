import { isSupportedRegionAddress } from "../regions/region-pack";

const INSTAGRAM_ORIGIN = "https://www.instagram.com";

type PlaceIdentity = { id: string; name: string; address: string };
type CuratedInstagramPost = PlaceIdentity & { shortcode: string };

const CURATED_POSTS: readonly CuratedInstagramPost[] = [
  {
    id: "676ff645-06d0-4bb3-9e2c-9969b3618000",
    name: "가람장어다이닝",
    address: "전남광주통합특별시 광산구 풍영정길 325, 1동 2층 (신창동)",
    shortcode: "DEcSqVthH6E",
  },
  {
    id: "f711554b-2ae0-47d2-bea3-762b70533a96",
    name: "티에디트",
    address: "전남광주통합특별시 동구 의재로 9, 학동 873-21 제1종근린생활시설 1층 (학동)",
    shortcode: "C5sT09vLNW4",
  },
  {
    id: "place-intake-9cb8d455bf0b50237cb59c2e",
    name: "나이테",
    address: "전남광주 동구 백서로175번길 7 (서석동)",
    shortcode: "Df9H9fjEzNW",
  },
  {
    id: "d8c67bc7-20ff-40b8-a5bb-86b5f849f7e3",
    name: "주접",
    address: "전남광주통합특별시 광산구 임방울대로826번길 25, 1층 103호 (쌍암동)",
    shortcode: "DcEb8cAkz7e",
  },
  {
    id: "4b6e0f2a-2ebd-4d01-960c-1b033569a933",
    name: "들꽃숲",
    address: "전남광주통합특별시 담양군 봉산면 송강정로 200",
    shortcode: "DfG0mW1E3l-",
  },
  {
    id: "place-intake-85fc315d9a90a21cb152dc85",
    name: "커피오소리 로스터스",
    address: "전북 남원시 비석길 158 (동충동)",
    shortcode: "C2TTY4MvUjU",
  },
  {
    id: "place-intake-f7b108b403228b28211b8512",
    name: "젤라또 노베오",
    address: "전북 군산시 구영4길 18 (영화동)",
    shortcode: "DVU7dmQEnHV",
  },
  {
    id: "place-intake-12e4bb3b60b418d98f05aec3",
    name: "연다원",
    address: "전북 고창군 복분자로 184-81 (반암리)",
    shortcode: "CwJOuJcvHlI",
  },
  {
    id: "place-intake-5dfc9346f7776ba6a1890265",
    name: "나그네의 주머니",
    address: "전북 남원시 동헌길 9-1 (하정동)",
    shortcode: "DfmA5vokm4m",
  },
];

export type PublicInstagramPhoto = { postUrl: string; embedUrl: string };

function instagramPhoto(shortcode: string): PublicInstagramPhoto {
  const postUrl = `${INSTAGRAM_ORIGIN}/p/${shortcode}/`;
  return { postUrl, embedUrl: `${postUrl}embed/` };
}

export const INSTAGRAM_PHOTO_FRAME_SOURCES = CURATED_POSTS
  .map(({ shortcode }) => instagramPhoto(shortcode).embedUrl)
  .join(" ");

export function curatedInstagramPhoto(place: PlaceIdentity, enabled?: string): PublicInstagramPhoto | null {
  if (enabled !== "true" || !(isSupportedRegionAddress(place.address) || /^(?:전북특별자치도|전라북도|전북)(?:\s|$)/u.test(place.address))) return null;
  const post = CURATED_POSTS.find(({ id, name, address }) => id === place.id && name === place.name && address === place.address);
  return post ? instagramPhoto(post.shortcode) : null;
}
