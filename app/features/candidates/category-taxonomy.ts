export type CategoryGroup = "korean" | "seafood" | "japanese" | "chinese" | "western" | "bunsik" | "chicken" | "world" | "cafe" | "bar" | "healthy" | "other";
export type SignalKind = "FOOD" | "CUISINE" | "VENUE" | "DEFAULT";

export type CategoryRule = {
  pattern: RegExp;
  slug: string;
  group: CategoryGroup;
  label: string;
  kind: SignalKind;
  priority?: number;
  excludePattern?: RegExp;
};

export const nameCategoryRules: CategoryRule[] = [
  { pattern: /(?<!자)연어|장어|킹크랩|크랩|대게|꽃게|홍게|랍스터|바닷가재|전복|굴(?:밥|국밥|구이|전|찜|탕|보쌈|세상|나라|마을|집|요리|전문|향|$)|꼬막|조개|가리비|낙지|주꾸미|쭈꾸미|문어|오징어|갑오징어|아귀|아구|생선|고등어|갈치|복어|복집|물회|해물|해산물|횟집|회집|사시미/, slug: "seafood-dish", group: "seafood", label: "상호의 해산물·생선 음식 표현", kind: "FOOD", priority: 25 },
  { pattern: /해장국|순대국|돼지국밥|국밥|설렁탕|곰탕/, slug: "gukbap-detail", group: "korean", label: "상호의 국밥·해장국·탕반 표현", kind: "FOOD" },
  { pattern: /육개장|찌개|전골|감자탕/, slug: "stew", group: "korean", label: "상호의 육계장·육개장·찌개·전골 표현", kind: "FOOD" },
  { pattern: /삼겹|갈비|떡갈비|구이|고기|정육/, slug: "grill", group: "korean", label: "상호의 고기·구이 표현", kind: "FOOD" },
  { pattern: /족발|보쌈/, slug: "jokbal-bossam", group: "korean", label: "상호의 족발·보쌈 표현", kind: "FOOD" },
  { pattern: /한정식/, slug: "hanjeongsik", group: "korean", label: "상호의 한정식 표현", kind: "FOOD" },
  { pattern: /스시|초밥/, slug: "sushi-sashimi", group: "japanese", label: "상호의 스시·초밥 표현", kind: "FOOD" },
  { pattern: /라멘|멘야/, slug: "ramen-detail", group: "japanese", label: "상호의 라멘 표현", kind: "FOOD" },
  { pattern: /우동|소바/, slug: "udon-soba", group: "japanese", label: "상호의 우동·소바 표현", kind: "FOOD" },
  { pattern: /돈가스|돈까스/, slug: "donkatsu-detail", group: "japanese", label: "상호의 돈가스 표현", kind: "FOOD" },
  { pattern: /타코야끼|타코야키/, slug: "japanese-rice", group: "japanese", label: "상호의 타코야끼 표현", kind: "FOOD" },
  { pattern: /이자카야/, slug: "izakaya", group: "japanese", label: "상호의 이자카야 표현", kind: "VENUE" },
  { pattern: /짜장|짬뽕/, slug: "jjajang-jjamppong", group: "chinese", label: "상호의 짜장·짬뽕 표현", kind: "FOOD" },
  { pattern: /마라|훠궈/, slug: "mala-hotpot", group: "chinese", label: "상호의 마라·훠궈 표현", kind: "FOOD" },
  { pattern: /양꼬치/, slug: "lamb-skewer", group: "chinese", label: "상호의 양꼬치 표현", kind: "FOOD" },
  { pattern: /파스타/, slug: "pasta", group: "western", label: "상호의 파스타 표현", kind: "FOOD" },
  { pattern: /스테이크/, slug: "steak", group: "western", label: "상호의 스테이크 표현", kind: "FOOD" },
  { pattern: /피자/, slug: "pizza", group: "western", label: "상호의 피자 표현", kind: "FOOD" },
  { pattern: /햄버거|버거/, slug: "burger", group: "western", label: "상호의 버거 표현", kind: "FOOD" },
  { pattern: /브런치/, slug: "brunch", group: "western", label: "상호의 브런치 표현", kind: "FOOD" },
  { pattern: /떡볶이|튀김|순대(?:분식|집|마을|나라|전문|$)/, slug: "tteokbokki", group: "bunsik", label: "상호의 떡볶이·튀김·순대 표현", kind: "FOOD" },
  { pattern: /김밥/, slug: "gimbap", group: "bunsik", label: "상호의 김밥 표현", kind: "FOOD" },
  { pattern: /만두/, slug: "dumpling", group: "bunsik", label: "상호의 만두 표현", kind: "FOOD" },
  { pattern: /치킨|통닭|닭강정/, slug: "chicken", group: "chicken", label: "상호의 치킨·통닭·닭강정 표현", kind: "FOOD" },
  { pattern: /쌀국수|베트남|사이공/, slug: "vietnamese", group: "world", label: "상호의 베트남 음식 표현", kind: "FOOD" },
  { pattern: /태국|타이/, slug: "thai", group: "world", label: "상호의 태국 음식 표현", kind: "FOOD" },
  { pattern: /인도|인디아|(?<!베이)커리/, slug: "indian", group: "world", label: "상호의 인도 음식 표현", kind: "FOOD" },
  { pattern: /멕시칸|타코(?!야끼|야키)/, slug: "mexican", group: "world", label: "상호의 멕시칸 표현", kind: "FOOD" },
  { pattern: /베이킹|제과|제빵|베이커리|브레드|브래드|빵집|빵쇼핑|꽈배기|바게뜨|바게트|식빵|케이크|도넛|도너츠|크루아상|쿠키|과자(?:점)?/, slug: "bakery-detail", group: "cafe", label: "상호의 제과·제빵·베이커리 표현", kind: "FOOD" },
  { pattern: /아이스크림|빙수|젤라또/, slug: "ice-dessert", group: "cafe", label: "상호의 아이스크림·빙수 표현", kind: "FOOD" },
  { pattern: /디저트/, slug: "dessert", group: "cafe", label: "상호의 디저트 표현", kind: "FOOD" },
  { pattern: /라이브카페|라이브바|음악주점|7080라이브|7080음악|라이브클럽/, slug: "pub", group: "bar", label: "상호의 라이브·음악 주점 표현", kind: "VENUE", priority: 40 },
  { pattern: /카페|커피|다방/, slug: "cafe", group: "cafe", label: "상호의 카페 표현", kind: "VENUE" },
  { pattern: /와인/, slug: "wine-bar", group: "bar", label: "상호의 와인 표현", kind: "VENUE" },
  { pattern: /칵테일/, slug: "cocktail-bar", group: "bar", label: "상호의 칵테일 표현", kind: "VENUE" },
  { pattern: /포차|소주/, slug: "pocha", group: "bar", label: "상호의 포차·소주 표현", kind: "VENUE" },
  { pattern: /호프|펍|맥주|주점/, slug: "pub", group: "bar", label: "상호의 호프·펍·주점 표현", kind: "VENUE" },
  { pattern: /샐러드/, slug: "salad", group: "healthy", label: "상호의 샐러드 표현", kind: "FOOD" },
  { pattern: /비건|채식/, slug: "vegan", group: "healthy", label: "상호의 비건·채식 표현", kind: "FOOD" },
];

export const subtypeCategoryRules: CategoryRule[] = [
  { pattern: /횟집|회집|해산물|수산|생선|회센터/, slug: "seafood-dish", group: "seafood", label: "원천 업태의 해산물·생선 표현", kind: "FOOD" },
  { pattern: /해장국|순대국|돼지국밥|국밥|설렁탕|곰탕/, slug: "gukbap-detail", group: "korean", label: "원천 업태의 국밥·해장국·탕반 표현", kind: "FOOD" },
  { pattern: /육개장|찌개|전골|감자탕/, slug: "stew", group: "korean", label: "원천 업태의 찌개·전골·탕 표현", kind: "FOOD" },
  { pattern: /치킨|통닭|닭강정/, group: "chicken", slug: "chicken", label: "원천 업태의 치킨·통닭 표현", kind: "FOOD" },
  { pattern: /한식/, group: "korean", slug: "home-meal", label: "원천 업태의 한식 표현", kind: "CUISINE" },
  { pattern: /일식/, group: "japanese", slug: "japanese-rice", label: "원천 업태의 일식 표현", kind: "CUISINE" },
  { pattern: /중국|중식/, group: "chinese", slug: "chinese-dish", label: "원천 업태의 중식 표현", kind: "CUISINE" },
  { pattern: /경양식/, group: "japanese", slug: "donkatsu-detail", label: "원천 업태의 경양식 표현", kind: "CUISINE" },
  { pattern: /양식/, group: "western", slug: "pasta", label: "원천 업태의 양식 표현", kind: "CUISINE", excludePattern: /경양식/ },
  { pattern: /분식|김밥|떡볶이|순대/, group: "bunsik", slug: "tteokbokki", label: "원천 업태의 분식 표현", kind: "CUISINE" },
  { pattern: /커피|카페|다방/, group: "cafe", slug: "cafe", label: "원천 업태의 카페 표현", kind: "VENUE" },
  { pattern: /베이킹|제과|제빵|베이커리|과자점/, group: "cafe", slug: "bakery-detail", label: "원천 업태의 제과·제빵 표현", kind: "FOOD" },
  { pattern: /호프|주점|펍|유흥|라이브|음악/, group: "bar", slug: "pub", label: "원천 업태의 호프·주점 표현", kind: "VENUE" },
];
