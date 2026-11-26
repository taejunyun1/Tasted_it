type PlaceIdentity = { id: string; name: string; address: string };

export type PlacePhotoOriginalSource = { url: string; publisher: string };

const REVIEWED_SOURCES: readonly (PlaceIdentity & PlacePhotoOriginalSource)[] = [
  {
    id: "place-intake-684ed24c5417c7ec77450dac",
    name: "복순이네",
    address: "전남광주 동구 양림로 120 (학동)",
    publisher: "오매광주",
    url: "https://tour.gwangju.go.kr/home/tour/info/food.cs?act=view&infoId=1138",
  },
  {
    id: "place-intake-9b5c7ca3a8904995819e1530",
    name: "엄지빈",
    address: "전남광주 화순군 화순읍 진각로 168",
    publisher: "화순군 관광후기",
    url: "https://www.hwasun.go.kr/gallery.do?M=050100000000&S=S05&act=view&b_code=0000000090&list_no=561",
  },
  {
    id: "place-intake-70adfdd5a852000637f61b24",
    name: "구수향",
    address: "전남광주 동구 예술길 23-6 (궁동)",
    publisher: "progress log",
    url: "https://pglog.tistory.com/381",
  },
  {
    id: "place-intake-6ffa8e7ddfaac3f3fb91e854",
    name: "복록수",
    address: "전남광주 동구 서석로10번길 9 (불로동)",
    publisher: "광주잇(EAT)다 · 지앵",
    url: "https://wisdom-blog.tistory.com/entry/광주-구시청-양꼬치-맛집-복록수-10번-넘게-간-중국-현지쉐프-맛집",
  },
  {
    id: "place-intake-1d21bef4545b2941c0c68f66",
    name: "옛날두부",
    address: "전남광주 화순군 시장길 33 (삼천리)",
    publisher: "Threads · @hwasun_dubu",
    url: "https://www.threads.com/@hwasun_dubu/post/DWkUdT7E-7W",
  },
  {
    id: "place-intake-e724797f168726b01426c9cc",
    name: "그랑깨",
    address: "전북 남원시 광한서로 52 (금동)",
    publisher: "남원시 사진기록관",
    url: "https://photo.namwon.go.kr/index.namwon?menuCd=DOM_000000201002002000&pageType=VIEW&category_code=001002002000&dataId=922811&returnList=Y",
  },
  {
    id: "place-intake-4c5afcf5031e6bfbf8d3484e",
    name: "사거리통골뱅이",
    address: "광주 동구 충장로58번길 18-2 (충장동, 충장로4가)",
    publisher: "광주잇(EAT)다 · 지앵",
    url: "https://wisdom-blog.tistory.com/entry/광주-시내-충장로-금남로-술집-사거리통골뱅이-힙한-실내포차-골뱅이탕",
  },
];

export function reviewedPlacePhotoOriginal(place: PlaceIdentity): PlacePhotoOriginalSource | null {
  const source = REVIEWED_SOURCES.find(({ id, name, address }) => id === place.id && name === place.name && address === place.address);
  return source ? { url: source.url, publisher: source.publisher } : null;
}
