export type TasteBadgeCategory = "FOOD" | "TASTE" | "STYLE";
export type TasteBadgeSource = "USER" | "NAVER" | "GOOGLE" | "INFERRED";

export type TasteBadgeDefinition = {
  id: string;
  category: TasteBadgeCategory;
  label: string;
  headlineNoun: string;
  matchTerms?: string[];
  headlineSetting?: string;
};

const food = (id: string, label: string, headlineNoun: string, matchTerms: string[] = []): TasteBadgeDefinition => ({
  id: `food-${id}`, category: "FOOD", label, headlineNoun, matchTerms,
});
const taste = (id: string, label: string, headlineNoun: string): TasteBadgeDefinition => ({
  id: `taste-${id}`, category: "TASTE", label, headlineNoun,
});
const style = (id: string, label: string, headlineNoun: string, matchTerms: string[] = [], headlineSetting = headlineNoun): TasteBadgeDefinition => ({
  id: `style-${id}`, category: "STYLE", label, headlineNoun, matchTerms, headlineSetting,
});

export const TASTE_BADGE_CATALOG: TasteBadgeDefinition[] = [
  food("gukbap", "국밥러", "국밥", ["국밥", "해장국"]),
  food("naengmyeon", "냉면러", "냉면", ["냉면"]),
  food("pyeongyang-naengmyeon", "평냉파", "평양냉면", ["평양냉면", "평냉"]),
  food("spicy-pork", "제육러", "제육볶음", ["제육"]),
  food("kimchi-stew", "김치찌개파", "김치찌개", ["김치찌개"]),
  food("sundubu", "순두부파", "순두부", ["순두부"]),
  food("samgyeopsal", "삼겹살러", "삼겹살", ["삼겹살"]),
  food("gopchang", "곱창러", "곱창", ["곱창", "막창", "대창"]),
  food("bossam", "보쌈파", "보쌈", ["보쌈"]),
  food("jokbal", "족발러", "족발", ["족발"]),
  food("galbi", "갈비러", "갈비", ["갈비"]),
  food("baekban", "백반러", "백반", ["백반"]),
  food("tteokbokki", "떡볶이러", "떡볶이", ["떡볶이"]),
  food("sundae", "순대파", "순대", ["순대"]),
  food("fried-snacks", "튀김러", "튀김", ["튀김"]),
  food("gimbap", "김밥러", "김밥", ["김밥"]),
  food("rabokki", "라볶이파", "라볶이", ["라볶이"]),
  food("instant-tteokbokki", "즉떡파", "즉석떡볶이", ["즉석떡볶이", "즉떡"]),
  food("noodles", "면덕후", "면 요리", ["면요리", "누들"]),
  food("makguksu", "막국수파", "막국수", ["막국수"]),
  food("kalguksu", "칼국수러", "칼국수", ["칼국수"]),
  food("pho", "쌀국수러", "쌀국수", ["쌀국수", "베트남국수"]),
  food("ramen", "라멘러", "라멘", ["라멘", "라멘-detail", "ramen-detail"]),
  food("udon", "우동파", "우동", ["우동"]),
  food("soba", "소바파", "소바", ["소바", "메밀국수"]),
  food("jjajang", "짜장파", "짜장면", ["짜장"]),
  food("jjambbong", "짬뽕파", "짬뽕", ["짬뽕"]),
  food("tangsuyuk", "탕수육러", "탕수육", ["탕수육"]),
  food("mala", "마라러", "마라 요리", ["마라"]),
  food("dimsum", "딤섬러", "딤섬", ["딤섬", "만두"]),
  food("chinese", "중화요리파", "중화요리", ["중식", "중화"]),
  food("sushi", "스시러", "스시", ["스시", "초밥"]),
  food("sashimi", "사시미파", "사시미", ["사시미"]),
  food("donkatsu", "돈카츠러", "돈카츠", ["돈가스", "돈까스", "돈카츠", "donkatsu-detail"]),
  food("yakitori", "야키토리파", "야키토리", ["야키토리", "꼬치"]),
  food("izakaya", "이자카야파", "이자카야", ["이자카야"]),
  food("rice-bowl", "덮밥러", "덮밥", ["덮밥"]),
  food("pasta", "파스타러", "파스타", ["파스타"]),
  food("pizza", "피자파", "피자", ["피자"]),
  food("burger", "버거러", "버거", ["버거", "햄버거"]),
  food("steak", "스테이크파", "스테이크", ["스테이크"]),
  food("brunch", "브런치러", "브런치", ["브런치"]),
  food("raw-fish", "회러버", "회", ["횟집", "활어회", "회센터"]),
  food("oyster", "굴러버", "굴", ["굴구이", "굴찜", "굴요리"]),
  food("shellfish", "조개파", "조개 요리", ["조개", "바지락", "꼬막"]),
  food("crustacean", "갑각류파", "갑각류", ["대게", "꽃게", "홍게", "게장", "킹크랩", "크랩", "랍스터", "새우"]),
  food("seafood", "해산물러", "해산물", ["해산물", "수산", "씨푸드"]),
  food("grilled-fish", "생선구이파", "생선구이", ["생선구이", "고등어구이"]),
  food("coffee", "커피러", "커피", ["커피", "카페"]),
  food("espresso", "에스프레소파", "에스프레소", ["에스프레소"]),
  food("bread", "빵러버", "빵", ["빵", "브레드", "브래드"]),
  food("dessert", "디저트러", "디저트", ["디저트"]),
  food("icecream", "아이스크림파", "아이스크림", ["아이스크림", "젤라또"]),
  food("cake", "케이크러", "케이크", ["케이크"]),
  food("bakery-hunter", "베이커리헌터", "베이커리", ["베이커리", "제과", "bakery-detail"]),

  taste("spicy", "맵부심", "매운맛"),
  taste("mild-spice", "맵찔이", "순한맛"),
  taste("subtle", "슴슴한맛", "슴슴한 맛"),
  taste("salty", "간센맛", "간이 센 맛"),
  taste("clean", "담백한맛", "담백한 맛"),
  taste("rich", "진한맛", "진한 맛"),
  taste("sweet", "단맛", "단맛"),
  taste("sour", "신맛", "신맛"),
  taste("nutty", "고소한맛", "고소한 맛"),
  taste("broth", "국물파", "국물 요리"),
  taste("charred", "불맛파", "불맛"),
  taste("spices", "향신료파", "향신료"),
  taste("meat", "고기파", "고기"),
  taste("carbs", "탄수화물파", "탄수화물"),
  taste("vegetables", "채소좋아", "채소"),

  style("old-school", "노포파", "노포", ["노포", "전통"], "오래된 식당"),
  style("market", "시장맛집파", "시장 맛집", ["시장"], "시장과 골목"),
  style("local", "로컬맛집파", "로컬 맛집", ["동네맛집", "로컬"], "동네 맛집"),
  style("solo", "혼밥러", "혼밥", ["혼밥"], "혼자 먹기 좋은 식당"),
  style("bar-food", "술안주파", "술안주", ["포차", "주점", "술집"], "술안주가 좋은 식당"),
  style("hangover", "해장전문", "해장 음식", ["해장"], "해장하기 좋은 식당"),
  style("late-night", "야식러", "야식", ["야식", "심야"], "늦은 시간의 식당"),
  style("breakfast", "아침밥파", "아침밥", ["아침식사", "조식"], "아침을 여는 식당"),
  style("new-openings", "신상헌터", "새로운 식당", ["신상", "신규오픈"], "새로 문 연 식당"),
  style("regular", "단골집파", "단골집", ["단골"], "오래 다닐 식당"),
  style("value", "가성비파", "가성비", ["가성비", "착한가격"], "가격이 좋은 식당"),
  style("mood", "분위기파", "분위기", ["분위기", "뷰맛집"], "분위기 좋은 식당"),
  style("taste-first", "맛우선", "맛", ["맛집"], "맛을 먼저 보는 식당"),
  style("large-portions", "양많은집", "푸짐한 양", ["푸짐", "대용량"], "양이 넉넉한 식당"),
  style("single-menu", "메뉴하나집", "단일 메뉴", ["단일메뉴", "전문점"], "한 메뉴에 집중한 식당"),
  style("driver-restaurant", "기사식당파", "기사식당", ["기사식당"], "기사식당"),
  style("baekban-house", "백반집파", "백반집", ["백반집"], "백반집"),
  style("street-stall", "포장마차파", "포장마차", ["포장마차", "포차"], "포장마차"),
  style("fine-dining", "파인다이닝파", "파인다이닝", ["파인다이닝", "오마카세"], "격식 있는 식당"),
  style("no-wait", "웨이팅싫어", "기다리지 않는 식당", ["예약제"], "기다림이 적은 식당"),
  style("wait-ok", "웨이팅가능", "기다려서 먹는 식당", ["웨이팅"], "기다려서 먹는 식당"),
];

const catalogById = new Map(TASTE_BADGE_CATALOG.map((badge) => [badge.id, badge]));
const SOURCE_WEIGHT: Record<TasteBadgeSource, number> = { USER: 1, NAVER: 0.9, GOOGLE: 0.9, INFERRED: 0.75 };

export type TasteBadgeScore = { badgeId: string; score: number; source: TasteBadgeSource };
export type MergedTasteBadge = { badgeId: string; score: number; sources: TasteBadgeSource[] };
export type DisplayTasteBadge = MergedTasteBadge & TasteBadgeDefinition;

function clampScore(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function mergeTasteBadgeScores(scores: TasteBadgeScore[]): MergedTasteBadge[] {
  const grouped = new Map<string, TasteBadgeScore[]>();
  for (const score of scores) {
    if (!catalogById.has(score.badgeId)) continue;
    grouped.set(score.badgeId, [...(grouped.get(score.badgeId) ?? []), score]);
  }
  return [...grouped].map(([badgeId, rows]) => ({
    badgeId,
    score: clampScore(1 - rows.reduce((remaining, row) => remaining * (1 - clampScore(row.score) * SOURCE_WEIGHT[row.source]), 1)),
    sources: [...new Set(rows.map((row) => row.source))].sort((left, right) => Object.keys(SOURCE_WEIGHT).indexOf(left) - Object.keys(SOURCE_WEIGHT).indexOf(right)),
  })).sort((left, right) => right.score - left.score || left.badgeId.localeCompare(right.badgeId));
}

type ActivityPlace = { name: string; categoryName: string };
type RatedPlace = ActivityPlace & { value: number };

function saturatingScore(strength: number) {
  return clampScore(1 - Math.exp(-strength / 1.7));
}

export function inferTasteBadges(input: {
  saved: ActivityPlace[];
  rated: RatedPlace[];
  flavorDimensions: Array<{ key: string; value: number }>;
}): TasteBadgeScore[] {
  const strength = new Map<string, number>();
  const add = (badgeId: string, amount: number) => strength.set(badgeId, (strength.get(badgeId) ?? 0) + amount);
  const activity = [
    ...input.saved.map((place) => ({ ...place, weight: 0.55 })),
    ...input.rated.filter((place) => place.value === 1).map((place) => ({ ...place, weight: 0.9 })),
  ];
  const matchable = TASTE_BADGE_CATALOG.filter((badge) => badge.matchTerms?.length);
  for (const place of activity) {
    const haystack = `${place.name} ${place.categoryName}`.toLowerCase().replace(/\s+/g, "");
    for (const badge of matchable) {
      if (badge.matchTerms!.some((term) => haystack.includes(term.toLowerCase().replace(/\s+/g, "")))) add(badge.id, place.weight);
    }
  }

  for (const dimension of input.flavorDimensions) {
    const normalized = clampScore((dimension.value - 1) / 4);
    if (normalized < 0.55) continue;
    if (dimension.key.includes("국물")) {
      add("taste-broth", normalized * 1.2);
      if (normalized >= 0.75) add("taste-rich", normalized * 0.8);
    }
    if (dimension.key.includes("향신료")) add("taste-spices", normalized);
    if (dimension.key.includes("매운")) add("taste-spicy", normalized);
    if (dimension.key.includes("감칠맛")) add("taste-rich", normalized * 0.75);
    if (dimension.key.includes("고소")) add("taste-nutty", normalized);
    if (dimension.key.includes("양")) add("style-large-portions", normalized);
  }

  return [...strength].map(([badgeId, value]) => ({ badgeId, score: saturatingScore(value), source: "INFERRED" as const }));
}

function hasBatchim(value: string) {
  const code = value.trim().charCodeAt(value.trim().length - 1);
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
}

function withObjectParticle(value: string) {
  return `${value}${hasBatchim(value) ? "을" : "를"}`;
}

function withAndParticle(value: string) {
  return `${value}${hasBatchim(value) ? "과" : "와"}`;
}

function displayBadge(badge: MergedTasteBadge): DisplayTasteBadge | null {
  const definition = catalogById.get(badge.badgeId);
  return definition ? { ...badge, ...definition } : null;
}

export function buildTasteHeadline(displayName: string, badges: MergedTasteBadge[]) {
  const visible = badges.map(displayBadge).filter((badge): badge is DisplayTasteBadge => Boolean(badge));
  const foods = visible.filter((badge) => badge.category === "FOOD");
  const styles = visible.filter((badge) => badge.category === "STYLE");
  if (foods[0] && styles[0] && styles[0].score >= (foods[1]?.score ?? 0)) {
    return `${styles[0].headlineSetting}에서 ${withObjectParticle(foods[0].headlineNoun)} 찾는 ${displayName}`;
  }
  if (foods[0] && foods[1]) return `${withAndParticle(foods[0].headlineNoun)} ${withObjectParticle(foods[1].headlineNoun)} 좋아하는 ${displayName}`;
  if (foods[0]) return `${foods[0].headlineNoun}에 진심인 ${displayName}`;
  if (styles[0]) return `${withObjectParticle(styles[0].headlineSetting ?? styles[0].headlineNoun)} 좋아하는 ${displayName}`;
  const tastes = visible.filter((badge) => badge.category === "TASTE");
  if (tastes[0]) return `${tastes[0].headlineNoun}에 진심인 ${displayName}`;
  return `${displayName}님의 취향을 알아가는 중`;
}

function selectRepresentativeBadges(badges: DisplayTasteBadge[], limit = 7) {
  const eligible = badges.filter((badge) => badge.score >= 0.18).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  const selected = new Map<string, DisplayTasteBadge>();
  for (const category of ["FOOD", "TASTE", "STYLE"] as const) {
    const first = eligible.find((badge) => badge.category === category);
    if (first) selected.set(first.id, first);
  }
  for (const badge of eligible) {
    if (selected.size >= limit) break;
    selected.set(badge.id, badge);
  }
  return [...selected.values()].sort((left, right) => right.score - left.score || left.id.localeCompare(right.id)).slice(0, limit);
}

export function buildTasteProfile(input: { displayName: string; stored: TasteBadgeScore[]; inferred: TasteBadgeScore[] }) {
  const merged = mergeTasteBadgeScores([...input.stored, ...input.inferred]);
  const display = merged.map(displayBadge).filter((badge): badge is DisplayTasteBadge => Boolean(badge));
  return {
    headline: buildTasteHeadline(input.displayName, merged),
    badges: selectRepresentativeBadges(display),
    vector: display,
  };
}
