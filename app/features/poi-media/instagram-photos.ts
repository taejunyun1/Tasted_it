import { isSupportedRegionAddress } from "../regions/region-pack";

const INSTAGRAM_ORIGIN = "https://www.instagram.com";

type PlaceIdentity = { id: string; name: string; address: string };
type CuratedInstagramPost = PlaceIdentity & { shortcode: string };

const CURATED_POSTS: readonly CuratedInstagramPost[] = [
  {
    id: "326e83f2-e5cb-47d9-aed5-fd0a70d787e7",
    name: "굿베리베이커리카페",
    address: "전남광주통합특별시 구례군 구례읍 구례여중길 1",
    shortcode: "Dfl4bhGs3SL",
  },
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
    shortcode: "DfmAwzLSVgI",
  },
  {
    id: "21878806-0f15-42e4-a57a-3b2089589c93",
    name: "마일드 스탠다드",
    address: "전남광주통합특별시 동구 동계천로 159-11, 1층 (동명동)",
    shortcode: "Df6jAEbPI3Q",
  },
  {
    id: "place-intake-654459fbb74ffadf0c412913",
    name: "스테이케이션",
    address: "전남광주 나주시 석전2길 18 (빛가람동)",
    shortcode: "DgJW1KNyNM1",
  },
  {
    id: "d9a1b95a-0c5d-4c6c-80cf-d5696c83b7cb",
    name: "코롬방제과점",
    address: "전남광주통합특별시 목포시 영산로75번길 7, 1,2층 (무안동)",
    shortcode: "C_2XNECy1hy",
  },
  {
    id: "place-intake-b6994b31660af59b6a587981",
    name: "음악이 흐른다(Music Flows)",
    address: "전남광주 구례군 간문대평1길 1 (간문리)",
    shortcode: "DfV9WOlRzKi",
  },
  {
    id: "place-intake-c17571b501282d309075cff0",
    name: "룩투",
    address: "전북 군산시 구영5길 104-4 (영화동)",
    shortcode: "DfWMykXvNJ5",
  },
  {
    id: "place-intake-c99b2821062cd3f08b365f18",
    name: "트레비아",
    address: "전북 군산시 영화동 17-11 1층",
    shortcode: "DbH-0Xhypdw",
  },
  {
    id: "058fd0c6-8ea2-4eea-9af8-e8d8a0b4e7f0",
    name: "피트(Pitt)",
    address: "전남광주통합특별시 남구 양림로41번길 5-1, 1층 (양림동)",
    shortcode: "DMkWTRwxvi4",
  },
  {
    id: "place-intake-2055f015783de9553209c9a4",
    name: "다수",
    address: "전남광주 광산구 첨단중앙로67번길 56 (월계동)",
    shortcode: "DZFLgRxvvO3",
  },
  {
    id: "place-intake-52f73671abd20c8973588bf3",
    name: "땡스덕 베르베르의집",
    address: "전북 고창군 왕림로 25 (세곡리)",
    shortcode: "DLWKyrfTCKW",
  },
  {
    id: "place-intake-007844d6648aa9c5f7d4afcc",
    name: "코테",
    address: "전남광주 광산구 첨단월봉로 50 (산월동)",
    shortcode: "DgFBb3-TraF",
  },
  {
    id: "08bbeadc-9a60-4c5e-a805-09590af3ae34",
    name: "도리스하우스",
    address: "전남광주통합특별시 서구 경열로 10, 2층 (농성동)",
    shortcode: "DfjLdZZOXOG",
  },
  {
    id: "place-intake-c007ad37464fa9249e57e06d",
    name: "홈댄스",
    address: "전북 전주시 완산구 풍남문2길 37-2 (전동)",
    shortcode: "DgL7hQpvLWs",
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
