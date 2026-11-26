type PlaceIdentity = { id: string; name: string; address: string };

export type PlacePhotoOriginalSource = {
  url: string;
  publisher: string;
  disclosure?: string;
  mediaKind?: "video";
  embed?: { provider: "threads" | "youtube"; url: string };
};
export type PlaceVisualFlags = { threads?: string; youtube?: string };
type ReviewedSource = PlaceIdentity & PlacePhotoOriginalSource & {
  fallback?: Omit<PlacePhotoOriginalSource, "embed">;
};

// The official embed script produces this narrowly scoped frame for the selected post.
export const THREADS_PHOTO_FRAME_SOURCE = "https://www.threads.com/t/DWkUdT7E-7W/embed/";

export function allowsPlaceVisualFrames(pathname: string) {
  return pathname === "/" || /^\/(?:places|maps)(?:\/|$)/u.test(pathname);
}

const REVIEWED_SOURCES: readonly ReviewedSource[] = [
  {
    id: "place-intake-684ed24c5417c7ec77450dac",
    name: "복순이네",
    address: "전남광주 동구 양림로 120 (학동)",
    publisher: "YouTube · 콘텐츠몬스터",
    url: "https://www.youtube.com/watch?v=XdOXi2ctQQo",
    mediaKind: "video",
    embed: { provider: "youtube", url: "https://www.youtube-nocookie.com/embed/XdOXi2ctQQo" },
    fallback: {
      publisher: "오매광주",
      url: "https://tour.gwangju.go.kr/home/tour/info/food.cs?act=view&infoId=1138",
    },
  },
  {
    id: "place-intake-9b5c7ca3a8904995819e1530",
    name: "엄지빈",
    address: "전남광주 화순군 화순읍 진각로 168",
    publisher: "YouTube · 레이디함맘",
    url: "https://www.youtube.com/watch?v=g9UdzGNidBA",
    mediaKind: "video",
    embed: { provider: "youtube", url: "https://www.youtube-nocookie.com/embed/g9UdzGNidBA" },
    fallback: {
      publisher: "화순군 관광후기",
      url: "https://www.hwasun.go.kr/gallery.do?M=050100000000&S=S05&act=view&b_code=0000000090&list_no=561",
    },
  },
  {
    id: "place-intake-70adfdd5a852000637f61b24",
    name: "구수향",
    address: "전남광주 동구 예술길 23-6 (궁동)",
    publisher: "YouTube · 무등산신사",
    disclosure: "2023년 공개 영상",
    url: "https://www.youtube.com/watch?v=aNhumVtW-U4",
    mediaKind: "video",
    embed: { provider: "youtube", url: "https://www.youtube-nocookie.com/embed/aNhumVtW-U4" },
    fallback: { publisher: "progress log", url: "https://pglog.tistory.com/381" },
  },
  {
    id: "place-intake-6ffa8e7ddfaac3f3fb91e854",
    name: "복록수",
    address: "전남광주 동구 서석로10번길 9 (불로동)",
    publisher: "네이버 클립 · 디노라윤",
    url: "https://m.blog.naver.com/fmfun/clip/306388",
    mediaKind: "video",
  },
  {
    id: "place-intake-1d21bef4545b2941c0c68f66",
    name: "옛날두부",
    address: "전남광주 화순군 시장길 33 (삼천리)",
    publisher: "Threads · @hwasun_dubu",
    url: "https://www.threads.com/@hwasun_dubu/post/DWkUdT7E-7W",
    embed: { provider: "threads", url: THREADS_PHOTO_FRAME_SOURCE },
  },
  {
    id: "place-intake-e724797f168726b01426c9cc",
    name: "그랑깨",
    address: "전북 남원시 광한서로 52 (금동)",
    publisher: "YouTube · 맛사장",
    url: "https://www.youtube.com/watch?v=ZnbtJLRHUzM&t=80s",
    mediaKind: "video",
    embed: { provider: "youtube", url: "https://www.youtube-nocookie.com/embed/ZnbtJLRHUzM?start=80" },
    fallback: {
      publisher: "남원시 사진기록관",
      url: "https://photo.namwon.go.kr/index.namwon?menuCd=DOM_000000201002002000&pageType=VIEW&category_code=001002002000&dataId=922811&returnList=Y",
    },
  },
  {
    id: "place-intake-4c5afcf5031e6bfbf8d3484e",
    name: "사거리통골뱅이",
    address: "광주 동구 충장로58번길 18-2 (충장동, 충장로4가)",
    publisher: "YouTube · 스튜디오 워매",
    disclosure: "2023년 공개 영상",
    url: "https://www.youtube.com/shorts/edU_JvgAprI",
    mediaKind: "video",
    embed: { provider: "youtube", url: "https://www.youtube-nocookie.com/embed/edU_JvgAprI" },
    fallback: { publisher: "네이버 클립 · 식샤를합시다", url: "https://m.blog.naver.com/loveis7108/clip/7801577", mediaKind: "video" },
  },
  {
    id: "0bf5c86b-5043-4d3f-98ce-5949f2db2800",
    name: "전라도미가",
    address: "전남광주통합특별시 동구 필문대로191번길 19, 1층 (산수동)",
    publisher: "YouTube · ON리 마을방송국",
    url: "https://www.youtube.com/watch?v=VfODxqfwx9w&t=66s",
    mediaKind: "video",
    embed: { provider: "youtube", url: "https://www.youtube-nocookie.com/embed/VfODxqfwx9w?start=66" },
    fallback: {
      publisher: "네이버 플레이스 · 업체 사진",
      url: "https://m.place.naver.com/restaurant/37505718/photo?filterType=%EC%97%85%EC%B2%B4",
    },
  },
  {
    id: "place-intake-afcab0afe63e6705a527d23f",
    name: "한마음포차",
    address: "전남광주 동구 서석로10번길 10 (불로동)",
    publisher: "YouTube · 박소술",
    url: "https://www.youtube.com/watch?v=bLChzMGGUSI&t=765s",
    mediaKind: "video",
    embed: { provider: "youtube", url: "https://www.youtube-nocookie.com/embed/bLChzMGGUSI?start=765&end=780" },
    fallback: {
      publisher: "네이버 플레이스 · 업체 사진",
      url: "https://m.place.naver.com/restaurant/38276589/photo?filterType=%EC%97%85%EC%B2%B4",
    },
  },
  {
    id: "bd45a029-bce6-485d-8efc-425dca48f606",
    name: "조단부부",
    address: "전남광주통합특별시 구례군 구례읍 봉성로 103-1",
    publisher: "YouTube · 구례군",
    url: "https://www.youtube.com/watch?v=UuAk8wjryzY&t=512s",
    mediaKind: "video",
    embed: { provider: "youtube", url: "https://www.youtube-nocookie.com/embed/UuAk8wjryzY?start=512&end=525" },
    fallback: {
      publisher: "네이버 플레이스 · 업체 사진",
      url: "https://m.place.naver.com/restaurant/1619421905/photo?filterType=%EC%97%85%EC%B2%B4",
    },
  },
  {
    id: "place-intake-f7a0d770e886c35979f8fd2a",
    name: "서성식당",
    address: "전남광주 해남군 중앙1로 282 (구교리)",
    publisher: "YouTube · 해남군",
    url: "https://www.youtube.com/watch?v=XVApkkeXoRQ",
    mediaKind: "video",
    embed: { provider: "youtube", url: "https://www.youtube-nocookie.com/embed/XVApkkeXoRQ" },
  },
  {
    id: "place-intake-5510fb20164ca7a5536bcb45",
    name: "60년전통손두부식당",
    address: "전남광주 구례군 동해벚꽃로 95 (죽마리)",
    publisher: "YouTube · KBS LIFE",
    url: "https://www.youtube.com/watch?v=kTz_GZQEXZ4&t=65s",
    mediaKind: "video",
    embed: { provider: "youtube", url: "https://www.youtube-nocookie.com/embed/kTz_GZQEXZ4?start=65" },
  },
  {
    id: "place-intake-7b0c5921a7dd34f9b880ed5e",
    name: "팔레스분식",
    address: "전남광주 북구 밤실로208번길 20 (두암동)",
    publisher: "YouTube · 채널광주",
    disclosure: "원본 영상에 유료 프로모션 포함",
    url: "https://www.youtube.com/watch?v=fFQgQMYL8ag&t=320s",
    mediaKind: "video",
    embed: { provider: "youtube", url: "https://www.youtube-nocookie.com/embed/fFQgQMYL8ag?start=320&end=338" },
  },
  {
    id: "place-intake-d9ea0471ad5c4eb487d3dc29",
    name: "광성식당",
    address: "전북 남원시 광한서로 7 (천거동)",
    publisher: "네이버 클립 · YoungJ",
    disclosure: "원본에 협찬 표시",
    url: "https://m.blog.naver.com/every100/clip/9398864",
    mediaKind: "video",
  },
  {
    id: "place-intake-14a109105ee648efe481ac85",
    name: "착한가리비",
    address: "전남광주 북구 대자로 69 (운암동)",
    publisher: "치즈맛양념감자",
    url: "https://hwa2ting.tistory.com/429",
  },
  {
    id: "place-intake-950ba22fa1c3cd0685fbbdde",
    name: "목살집",
    address: "전남광주 남구 광복마을6길 1 (진월동)",
    publisher: "YouTube · 맛집따개",
    url: "https://www.youtube.com/watch?v=INk0aC5hoK4&t=120s",
    mediaKind: "video",
    embed: { provider: "youtube", url: "https://www.youtube-nocookie.com/embed/INk0aC5hoK4?start=120" },
  },
  {
    id: "place-intake-e73658c5cb8bf44d666e628a",
    name: "고부정",
    address: "전남광주 담양군 지침6길 53 (지침리)",
    publisher: "네이버 플레이스 · 업체 사진",
    url: "https://m.place.naver.com/restaurant/32230517/photo?filterType=%EC%97%85%EC%B2%B4",
  },
  {
    id: "c893e7dc-c6a0-4467-82b8-8859051d24c8",
    name: "고템커피",
    address: "전남광주통합특별시 고흥군 고흥읍 고흥로 1670-7",
    publisher: "네이버 플레이스 · 업체 사진",
    url: "https://m.place.naver.com/restaurant/1117337292/photo?filterType=%EC%97%85%EC%B2%B4",
  },
  {
    id: "place-intake-02c40d8d0a6e5409b7425fda",
    name: "담양현재국수",
    address: "전남광주 담양군 객사3길 24 (객사리)",
    publisher: "YouTube · 오자링",
    url: "https://www.youtube.com/watch?v=glRm4NcRhac&t=273s",
    mediaKind: "video",
    embed: { provider: "youtube", url: "https://www.youtube-nocookie.com/embed/glRm4NcRhac?start=273&end=298" },
    fallback: {
      publisher: "네이버 플레이스 · 업체 사진",
      url: "https://m.place.naver.com/restaurant/1870179264/photo?filterType=%EC%97%85%EC%B2%B4",
    },
  },
  {
    id: "place-intake-296fe52a6f1a1f39f8a2a9f6",
    name: "오비수산",
    address: "전남광주 광산구 장신로19번안길 23-4 (장덕동)",
    publisher: "YouTube · 3초 후",
    url: "https://www.youtube.com/shorts/nILy25jCyaI",
    mediaKind: "video",
    embed: { provider: "youtube", url: "https://www.youtube-nocookie.com/embed/nILy25jCyaI" },
    fallback: { publisher: "오비수산 · 네이버 플레이스 소식", url: "https://m.place.naver.com/restaurant/2004979994/feed", mediaKind: "video" },
  },
  {
    id: "place-intake-7a534081f2e2fca2ce7b27c8",
    name: "들뫼풍경",
    address: "전북 고창군 전봉준로 108 (율계리)",
    publisher: "네이버 플레이스 · 업체 사진",
    url: "https://m.place.naver.com/restaurant/32246867/photo?filterType=%EC%97%85%EC%B2%B4",
  },
  {
    id: "place-intake-4413539f62e7921d84f7f1d1",
    name: "대나무골",
    address: "전남광주 담양군 대전로 182 (태목리)",
    publisher: "YouTube · 와우 푸드",
    disclosure: "2020년 공개 영상",
    url: "https://www.youtube.com/watch?v=oZOV6I1EbHg",
    mediaKind: "video",
    embed: { provider: "youtube", url: "https://www.youtube-nocookie.com/embed/oZOV6I1EbHg" },
  },
  {
    id: "place-intake-f7be1ac1c83b2885dff15c0d",
    name: "토방닭매운탕",
    address: "전남광주 북구 서방로107번길 13 (두암동)",
    publisher: "YouTube · yoovlog",
    url: "https://www.youtube.com/watch?v=osYf3qz36HI&t=735s",
    mediaKind: "video",
    embed: { provider: "youtube", url: "https://www.youtube-nocookie.com/embed/osYf3qz36HI?start=735&end=745" },
  },
  {
    id: "place-intake-c30606b3e3b35b21fcbaf9f5",
    name: "원조목살집",
    address: "전남광주 목포시 평화로107번길 3 (상동)",
    publisher: "네이버 클립 · 져니콩",
    url: "https://m.blog.naver.com/jiwon4348/clip/5134953",
    mediaKind: "video",
  },
  {
    id: "place-intake-17422a656ab8d3e89bc20013",
    name: "반달곰식당",
    address: "전남광주 구례군 중앙로 88 (봉북리)",
    publisher: "네이버 블로그 · young624",
    url: "https://m.blog.naver.com/studio_young0425/224365538127",
  },
  {
    id: "place-intake-5d7a3a429e2c173c6e3c2d5d",
    name: "실키밀키",
    address: "전남광주 광산구 첨단내촌로 46-1 (월계동)",
    publisher: "네이버 플레이스 · 업체 사진",
    url: "https://m.place.naver.com/restaurant/1942978740/photo?filterType=%EC%97%85%EC%B2%B4",
  },
  {
    id: "place-intake-04a99c49889c69595df5332a",
    name: "자매통닭&호프",
    address: "광주 동구 천변우로 363-26 (호남동)",
    publisher: "네이버 블로그 · 박소술",
    url: "https://m.blog.naver.com/sososo2516/224145188426",
  },
];

// CSP source expressions match the video path. The player URL carries playback bounds.
export const YOUTUBE_VIDEO_FRAME_SOURCES = REVIEWED_SOURCES.flatMap(({ embed }) =>
  embed?.provider === "youtube" ? [embed.url.split("?")[0]] : []);

export function reviewedPlacePhotoOriginal(place: PlaceIdentity, flags: PlaceVisualFlags = {}): PlacePhotoOriginalSource | null {
  const source = REVIEWED_SOURCES.find(({ id, name, address }) => id === place.id && name === place.name && address === place.address);
  if (!source) return null;
  const { id, name, address, embed, fallback, ...original } = source;
  return embed && flags[embed.provider] === "true" ? { ...original, embed } : fallback ?? original;
}
