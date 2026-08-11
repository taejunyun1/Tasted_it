# 홈 큐레이션 지도 및 상황별 추천 5곳 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈 지도를 현재 위치·시간대·취향·평가 신뢰도·새로운 발견으로 구성한 추천 5곳 중심의 큐레이션 지도로 바꾸고, 기존 전체 장소 지도는 명시적인 전체 탐색 모드로 보존한다.

**Architecture:** 기존 `/places` 추천 후보 조회와 저장된 평가·취향·Golden Pick 데이터를 공용 후보 서비스로 분리한다. 홈 전용 순수 함수가 품질 하한, 가중치, 5개 슬롯, 다양성 규칙을 적용하고 React Router loader와 리소스 라우트가 결과를 데스크톱 패널·모바일 바텀시트·번호 지도 마커에 전달한다. 지도 pan은 추천을 자동 변경하지 않고 `이 지역 다시 추천` 요청에서만 새 bbox를 반영한다.

**Tech Stack:** React Router 8, React 19, TypeScript, Cloudflare Workers, D1/Drizzle ORM, Naver Maps SDK, Vitest, Cloudflare Workers Vitest, Playwright, CSS

## Global Constraints

- 기본 큐레이션 지도에는 추천 5곳만 표시하고 전체 공개 장소는 `전체 탐색`에서만 표시한다.
- 기본 반경은 3km이며 후보가 부족할 때만 5km로 확장한다.
- 개인화 기여도는 최종 점수의 35%를 넘지 않는다.
- 동일 대표 카테고리와 동일 동네는 각각 2곳을 기본 상한으로 하고, 5km에서도 다섯 자리를 채울 수 없을 때만 설계 문서 순서대로 3곳까지 완화한다.
- `지금 추천`, `나의 취향`, `시간대`에는 새로운 발견을 최소 1곳 유지한다.
- 표본이 8개 이상이면서 공개 추천 점수가 55점 미만인 장소는 홈 추천에서 제외한다.
- 평가 표본 8개 미만 장소는 신뢰 추천 슬롯에 넣지 않고 `평가 수집 중`으로 표시한다.
- 활성 Golden Pick이 부족하면 Re:Taste 신뢰 추천으로 채우되 Golden Pick 배지를 붙이지 않는다.
- 영업시간 근거가 없으면 `영업 중`을 생성하지 않는다.
- 위치 권한은 사용자 동작으로만 요청하며 좌표를 취향·제품 데이터로 저장하지 않는다.
- 지도 pan·zoom은 자동 재추천을 발생시키지 않는다.
- 외부 API, Workers AI, 신규 의존성, 신규 migration, 환경 변수 추가는 없다.
- 모든 구현은 전용 브랜치 `tj_home_curated_map`과 worktree에서 수행한다.

---

## 파일 구조

- Create: `app/features/maps/home-curation-options.ts` — `view`, `mode`, 한국 시간대 파싱과 URL 정규화
- Create: `app/features/places/home-curation.ts` — 점수, 품질 하한, 슬롯, 다양성, 이유를 계산하는 순수 함수
- Create: `app/features/places/recommendation-candidates.server.ts` — 홈과 `/places`가 공유하는 후보·평가·취향·Golden Pick 조회
- Create: `app/features/places/home-curation.server.ts` — 반경 확장과 홈 추천 페이지 조립
- Create: `app/routes/home-recommendations-resource.tsx` — 모드 변경·이 지역 재추천용 경량 리소스
- Create: `app/components/map/HomeCurationCards.tsx` — 데스크톱·모바일이 공유하는 추천 카드와 표시 타입
- Create: `app/components/map/HomeCurationPanel.tsx` — 데스크톱 추천 패널과 전체 탐색 전환
- Create: `app/components/map/HomeCurationSheet.tsx` — 모바일 스냅 바텀시트
- Modify: `app/features/places/place-recommendation.server.ts` — 공용 후보 서비스를 사용하도록 중복 조회 제거
- Modify: `app/routes.ts` — 홈 추천 리소스 라우트 등록
- Modify: `app/routes/home.tsx` — 큐레이션·전체 탐색 loader와 클라이언트 상태 조립
- Modify: `app/components/map/PlaceMap.tsx` — 추천 번호 마커와 draft bbox 통지 지원
- Modify: `app/app.css` — 데스크톱 패널·모바일 바텀시트·번호 마커 스타일
- Create: `tests/unit/home-curation-options.test.ts`
- Create: `tests/unit/home-curation.test.ts`
- Create: `tests/unit/home-curation-ui-contract.test.ts`
- Create: `tests/integration/home-curation.server.test.ts`
- Create: `tests/e2e/home-curation-map.spec.ts`
- Create: `scripts/seed-home-curation-qa.sql`
- Modify: `playwright.config.ts`
- Create: `docs/evidence/2026-08-11-home-curation-desktop.png`
- Create: `docs/evidence/2026-08-11-home-curation-mobile.png`

---

### Task 1: 홈 URL 상태와 한국 시간대 계약

**Files:**
- Create: `app/features/maps/home-curation-options.ts`
- Create: `tests/unit/home-curation-options.test.ts`

**Interfaces:**
- Produces: `HomeMapView`, `HomeCurationMode`, `HomeTimeSlot`, `parseHomeCurationState(search)`, `homeTimeSlotAt(now)`, `homeTimeSlotLabel(slot)`, `centerOfBbox(bbox)`
- Consumes: 표준 `URLSearchParams`, `Date`

- [ ] **Step 1: URL·시간대 실패 테스트 작성**

```ts
import { describe, expect, it } from "vitest";
import { centerOfBbox, homeTimeSlotAt, homeTimeSlotLabel, parseHomeCurationState } from "../../app/features/maps/home-curation-options";

describe("home curation options", () => {
  it("알 수 없는 view와 mode를 큐레이션 기본값으로 정규화한다", () => {
    expect(parseHomeCurationState("?view=bad&mode=bad")).toEqual({ view: "curated", mode: "now" });
  });

  it("지원하는 view와 mode만 보존한다", () => {
    expect(parseHomeCurationState("?view=browse&mode=golden")).toEqual({ view: "browse", mode: "golden" });
  });

  it.each(["?category=ramen-detail", "?q=국밥"])("기존 검색·카테고리 URL은 전체 탐색으로 연다: %s", (search) => {
    expect(parseHomeCurationState(search).view).toBe("browse");
  });

  it("bbox 중심을 계산한다", () => {
    expect(centerOfBbox([126.8, 35.1, 127, 35.3])).toEqual({ latitude: 35.2, longitude: 126.9 });
  });

  it.each([
    ["2026-08-10T20:29:00.000Z", "breakfast"],
    ["2026-08-10T01:30:00.000Z", "lunch"],
    ["2026-08-10T05:30:00.000Z", "afternoon"],
    ["2026-08-10T08:30:00.000Z", "dinner"],
    ["2026-08-10T12:30:00.000Z", "late"],
  ])("Asia/Seoul 기준 시간대를 계산한다", (now, expected) => {
    expect(homeTimeSlotAt(new Date(now))).toBe(expected);
  });

  it("시간대 식별자를 사용자 문구로 바꾼다", () => {
    expect(homeTimeSlotLabel("late")).toBe("늦은 시간");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run tests/unit/home-curation-options.test.ts`

Expected: FAIL with `Cannot find module '../../app/features/maps/home-curation-options'`.

- [ ] **Step 3: 최소 상태 파서 구현**

```ts
export type HomeMapView = "curated" | "browse";
export type HomeCurationMode = "now" | "taste" | "time" | "golden" | "discovery";
export type HomeTimeSlot = "breakfast" | "lunch" | "afternoon" | "dinner" | "late";

const MODES = new Set<HomeCurationMode>(["now", "taste", "time", "golden", "discovery"]);

export function parseHomeCurationState(search: string) {
  const params = new URLSearchParams(search);
  const mode = params.get("mode") as HomeCurationMode | null;
  const hasBrowseIntent = params.get("view") === "browse" || Boolean(params.get("category")) || Boolean(params.get("q")?.trim());
  return {
    view: hasBrowseIntent ? "browse" as const : "curated" as const,
    mode: mode && MODES.has(mode) ? mode : "now" as const,
  };
}

export function homeTimeSlotAt(now: Date): HomeTimeSlot {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const total = hour * 60 + minute;
  if (total >= 300 && total < 630) return "breakfast";
  if (total >= 630 && total < 870) return "lunch";
  if (total >= 870 && total < 1050) return "afternoon";
  if (total >= 1050 && total < 1290) return "dinner";
  return "late";
}

export function centerOfBbox([west, south, east, north]: [number, number, number, number]) {
  return { latitude: (south + north) / 2, longitude: (west + east) / 2 };
}

export function homeTimeSlotLabel(slot: HomeTimeSlot) {
  return ({ breakfast: "아침", lunch: "점심", afternoon: "오후", dinner: "저녁", late: "늦은 시간" } as const)[slot];
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run tests/unit/home-curation-options.test.ts`

Expected: 1 file passed, all parameter cases passed.

- [ ] **Step 5: 커밋**

```bash
git add app/features/maps/home-curation-options.ts tests/unit/home-curation-options.test.ts
git commit -m "2026-08-11 홈 추천 상태와 시간대 계약"
```

---

### Task 2: 홈 추천 점수·슬롯·다양성 순수 함수

**Files:**
- Create: `app/features/places/home-curation.ts`
- Create: `tests/unit/home-curation.test.ts`

**Interfaces:**
- Consumes: `DiscoveryPlace`, `DiscoveryCenter`, `RankingTasteSignal`, `HomeCurationMode`, `HomeTimeSlot`
- Produces: `HomeCurationSlot`, `HomeCuratedPlace`, `rankHomeCuration(input)`

- [ ] **Step 1: 5개 슬롯과 품질·다양성 실패 테스트 작성**

```ts
import { describe, expect, it } from "vitest";
import { rankHomeCuration } from "../../app/features/places/home-curation";
import type { DiscoveryPlace } from "../../app/features/places/place-discovery";

const center = { latitude: 35.15, longitude: 126.92 };

function place(id: string, input: {
  category: string;
  neighborhood: string;
  ratingScore?: number | null;
  ratingSampleCount?: number;
  terms?: string;
  latitude?: number;
  longitude?: number;
}): DiscoveryPlace {
  return {
    id, slug: id, name: id, address: `${input.neighborhood} ${id}`, neighborhood: input.neighborhood,
    latitude: input.latitude ?? 35.151, longitude: input.longitude ?? 126.921,
    heroImageUrl: null, searchText: input.terms ?? "",
    primaryCategory: { slug: input.category, name: input.category, emoji: "🍽️" },
    positive: input.ratingSampleCount ?? 0, negative: 0,
    ratingScore: input.ratingScore, ratingSampleCount: input.ratingSampleCount,
  };
}

function counts(items: DiscoveryPlace[], key: (item: DiscoveryPlace) => string) {
  const result = new Map<string, number>();
  items.forEach((item) => result.set(key(item), (result.get(key(item)) ?? 0) + 1));
  return result;
}

function buildDiversityFixtures() {
  return [
    place("a1", { category: "soup", neighborhood: "A", ratingScore: 90, ratingSampleCount: 20 }),
    place("a2", { category: "soup", neighborhood: "A", ratingScore: 89, ratingSampleCount: 20 }),
    place("a3", { category: "soup", neighborhood: "A", ratingScore: 88, ratingSampleCount: 20 }),
    place("b1", { category: "noodle", neighborhood: "B", ratingScore: 87, ratingSampleCount: 20 }),
    place("c1", { category: "seafood", neighborhood: "C", ratingScore: 86, ratingSampleCount: 20 }),
    place("d1", { category: "home-meal", neighborhood: "D", ratingScore: 85, ratingSampleCount: 20 }),
  ];
}

function qualityFixtures() {
  return [
    place("visible-low", { category: "soup", neighborhood: "A", ratingScore: 54, ratingSampleCount: 8 }),
    place("small-sample", { category: "noodle", neighborhood: "B", ratingScore: null, ratingSampleCount: 4 }),
    ...buildDiversityFixtures(),
  ];
}

describe("rankHomeCuration", () => {
  it("기본 모드에서 다섯 역할과 새로운 발견을 유지한다", () => {
    const result = rankHomeCuration({
      places: [
        place("best", { category: "soup", neighborhood: "A", ratingScore: 88, ratingSampleCount: 20, terms: "국밥" }),
        place("taste", { category: "noodle", neighborhood: "B", ratingScore: 82, ratingSampleCount: 14, terms: "냉면" }),
        place("time", { category: "home-meal", neighborhood: "C", ratingScore: 79, ratingSampleCount: 10, terms: "백반" }),
        place("trusted", { category: "seafood", neighborhood: "D", ratingScore: 91, ratingSampleCount: 40, terms: "생선" }),
        place("new", { category: "soba", neighborhood: "E", ratingScore: 76, ratingSampleCount: 9, terms: "메밀" }),
      ],
      goldenPicks: [], center: { latitude: 35.15, longitude: 126.92 },
      tasteSignals: [{ badgeId: "food-gukbap", score: 1, source: "USER" }],
      mode: "now", timeSlot: "lunch", radiusMeters: 3_000,
    });
    expect(result.map((item) => item.slot)).toEqual(["BEST_NOW", "TASTE_MATCH", "TIME_MATCH", "TRUSTED_PICK", "DISCOVERY"]);
    expect(result).toHaveLength(5);
  });

  it("같은 카테고리와 동네를 각각 두 곳까지만 선택한다", () => {
    const result = rankHomeCuration({ places: buildDiversityFixtures(), goldenPicks: [], center, tasteSignals: [], mode: "now", timeSlot: "lunch", radiusMeters: 3_000 });
    expect(Math.max(...counts(result, (place) => place.primaryCategory.slug).values())).toBeLessThanOrEqual(2);
    expect(Math.max(...counts(result, (place) => place.neighborhood).values())).toBeLessThanOrEqual(2);
  });

  it("표본 8개 이상 55점 미만 장소를 제외하고 소표본 장소를 신뢰 슬롯에 넣지 않는다", () => {
    const result = rankHomeCuration({ places: qualityFixtures(), goldenPicks: [], center, tasteSignals: [], mode: "now", timeSlot: "lunch", radiusMeters: 3_000 });
    expect(result.some((place) => place.id === "visible-low")).toBe(false);
    expect(result.find((place) => place.id === "small-sample")?.slot).not.toBe("TRUSTED_PICK");
  });

  it.each(["now", "taste", "time"] as const)("%s 모드에서 새로운 발견 한 곳을 유지한다", (mode) => {
    const result = rankHomeCuration({ places: buildDiversityFixtures(), goldenPicks: [], center, tasteSignals: [{ badgeId: "food-gukbap", score: 1, source: "USER" }], mode, timeSlot: "lunch", radiusMeters: 3_000 });
    expect(result.some((place) => place.slot === "DISCOVERY")).toBe(true);
  });

  it("Golden Pick 부족분은 신뢰 장소로 채우되 Golden 배지를 위조하지 않는다", () => {
    const fixtures = buildDiversityFixtures();
    const result = rankHomeCuration({ places: fixtures, goldenPicks: [{ placeId: "a1" }], center, tasteSignals: [], mode: "golden", timeSlot: "dinner", radiusMeters: 3_000 });
    expect(result).toHaveLength(5);
    expect(result.filter((place) => place.isGoldenPick).map((place) => place.id)).toEqual(["a1"]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run tests/unit/home-curation.test.ts`

Expected: FAIL because `rankHomeCuration` does not exist.

- [ ] **Step 3: 입력·출력 타입과 품질 게이트 구현**

```ts
import { calculateRating } from "../ratings/rating-v1";
import type { HomeCurationMode, HomeTimeSlot } from "../maps/home-curation-options";
import { distanceInMeters, normalizedTasteSignalStrength, type DiscoveryCenter, type DiscoveryPlace, type RankingTasteSignal } from "./place-discovery";
import { termsForBadge, TASTE_ADJACENCY } from "./place-recommendation-options";

export type HomeCurationSlot = "BEST_NOW" | "TASTE_MATCH" | "TIME_MATCH" | "TRUSTED_PICK" | "DISCOVERY";

export type HomeCuratedPlace = DiscoveryPlace & {
  slot: HomeCurationSlot;
  rank: number;
  recommendationReasons: string[];
  isGoldenPick: boolean;
};

export type HomeCurationInput = {
  places: DiscoveryPlace[];
  goldenPicks: Array<{ placeId: string }>;
  center: DiscoveryCenter;
  tasteSignals: RankingTasteSignal[];
  mode: HomeCurationMode;
  timeSlot: HomeTimeSlot;
  radiusMeters: 3_000 | 5_000;
};

export type HomeCurationPage = {
  status: "READY" | "EMPTY";
  places: HomeCuratedPlace[];
  mode: HomeCurationMode;
  timeSlot: HomeTimeSlot;
  radiusMeters: 3_000 | 5_000;
};

type ScoredHomeCandidate = {
  place: DiscoveryPlace;
  directTaste: number;
  adjacentTaste: number;
  time: number;
  trust: number;
  distance: number;
  discovery: number;
  total: number;
  isGoldenPick: boolean;
};

function passesHomeQuality(place: DiscoveryPlace) {
  const sample = place.ratingSampleCount ?? place.positive + place.negative;
  const visibleScore = place.ratingScore ?? (sample >= 8 ? calculateRating(place).displayScore : null);
  return visibleScore == null || visibleScore >= 55;
}

function trustedEligible(place: DiscoveryPlace) {
  return (place.ratingSampleCount ?? place.positive + place.negative) >= 8;
}

function normalizedText(place: DiscoveryPlace) {
  return `${place.name} ${place.primaryCategory.slug} ${place.primaryCategory.name} ${place.searchText ?? ""}`.toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
}

function includesAny(place: DiscoveryPlace, terms: string[]) {
  const text = normalizedText(place);
  return terms.some((term) => text.includes(term.toLocaleLowerCase("ko-KR").replace(/\s+/g, "")));
}

const TIME_TERMS: Record<HomeTimeSlot, string[]> = {
  breakfast: ["백반", "국밥", "해장국", "베이커리", "빵", "커피"],
  lunch: ["백반", "국밥", "면", "분식", "돈가스", "덮밥", "한식"],
  afternoon: ["카페", "커피", "디저트", "베이커리", "빙수"],
  dinner: ["고기", "해산물", "전골", "구이", "주점", "술안주"],
  late: ["야식", "국물", "주점", "분식", "해장", "포장마차"],
};
```

- [ ] **Step 4: 모드 가중치와 슬롯 선택 구현**

```ts
const MODE_WEIGHTS = {
  now: { taste: .30, distance: .25, time: .20, trust: .15, discovery: .10 },
  taste: { taste: .35, distance: .20, time: .10, trust: .20, discovery: .15 },
  time: { taste: .20, distance: .25, time: .30, trust: .15, discovery: .10 },
  golden: { taste: .20, distance: .20, time: .10, trust: .40, discovery: .10 },
  discovery: { taste: .15, distance: .20, time: .10, trust: .20, discovery: .35 },
} satisfies Record<HomeCurationMode, Record<string, number>>;

const MODE_SLOTS: Record<HomeCurationMode, HomeCurationSlot[]> = {
  now: ["BEST_NOW", "TASTE_MATCH", "TIME_MATCH", "TRUSTED_PICK", "DISCOVERY"],
  taste: ["TASTE_MATCH", "TASTE_MATCH", "TIME_MATCH", "TRUSTED_PICK", "DISCOVERY"],
  time: ["TIME_MATCH", "TIME_MATCH", "BEST_NOW", "TRUSTED_PICK", "DISCOVERY"],
  golden: ["TRUSTED_PICK", "TRUSTED_PICK", "TRUSTED_PICK", "TRUSTED_PICK", "TRUSTED_PICK"],
  discovery: ["DISCOVERY", "DISCOVERY", "DISCOVERY", "DISCOVERY", "TRUSTED_PICK"],
};

function scoreHomeCandidates(places: DiscoveryPlace[], input: HomeCurationInput, weights: typeof MODE_WEIGHTS[HomeCurationMode]): ScoredHomeCandidate[] {
  const goldenIds = new Set(input.goldenPicks.map((pick) => pick.placeId));
  return places.map((place) => {
    const directSignal = input.tasteSignals.find((signal) => includesAny(place, termsForBadge(signal.badgeId)));
    const adjacentSignal = directSignal ? undefined : input.tasteSignals.find((signal) => includesAny(place, TASTE_ADJACENCY[signal.badgeId] ?? []));
    const directTaste = directSignal ? normalizedTasteSignalStrength(directSignal) : 0;
    const adjacentTaste = adjacentSignal ? normalizedTasteSignalStrength(adjacentSignal) * .7 : 0;
    const taste = Math.min(1, directTaste + adjacentTaste);
    const distance = Math.max(0, 1 - distanceInMeters(input.center, place) / input.radiusMeters);
    const time = includesAny(place, TIME_TERMS[input.timeSlot]) ? 1 : .25;
    const sample = place.ratingSampleCount ?? place.positive + place.negative;
    const score = place.ratingScore ?? calculateRating(place).displayScore;
    const trust = sample >= 8 ? Math.min(1, score / 100 * .7 + Math.min(1, sample / 50) * .3) : .2;
    const discovery = directTaste ? 0 : adjacentTaste ? .65 : 1;
    const total = Math.min(1, taste * weights.taste + distance * weights.distance + time * weights.time + trust * weights.trust + discovery * weights.discovery);
    return { place: { ...place, distanceMeters: distanceInMeters(input.center, place) }, directTaste, adjacentTaste, time, trust, distance, discovery, total, isGoldenPick: goldenIds.has(place.id) };
  });
}

function slotScore(candidate: ScoredHomeCandidate, slot: HomeCurationSlot, mode: HomeCurationMode) {
  if (slot === "TASTE_MATCH") return candidate.directTaste + candidate.adjacentTaste * .8 + candidate.total * .2;
  if (slot === "TIME_MATCH") return candidate.time + candidate.distance * .2 + candidate.total * .2;
  if (slot === "TRUSTED_PICK") return (mode === "golden" && candidate.isGoldenPick ? 2 : 0) + candidate.trust + candidate.total * .2;
  if (slot === "DISCOVERY") return candidate.discovery + candidate.trust * .25 + candidate.total * .2;
  return candidate.total;
}

function eligibleForSlot(candidate: ScoredHomeCandidate, slot: HomeCurationSlot, mode: HomeCurationMode) {
  if (slot === "TRUSTED_PICK") return candidate.isGoldenPick || trustedEligible(candidate.place);
  if (slot === "TASTE_MATCH") return candidate.directTaste > 0 || candidate.adjacentTaste > 0;
  if (slot === "DISCOVERY") return candidate.directTaste === 0;
  return mode !== "golden" || candidate.isGoldenPick || trustedEligible(candidate.place);
}

function reasonsFor(candidate: ScoredHomeCandidate, slot: HomeCurationSlot) {
  const reasons: string[] = [];
  if (slot === "TRUSTED_PICK" && candidate.isGoldenPick) reasons.push("리뷰어 Golden Pick");
  else if (slot === "TRUSTED_PICK" && trustedEligible(candidate.place)) reasons.push("평가 신뢰도 상위");
  if (slot === "DISCOVERY" && candidate.directTaste === 0) reasons.push(candidate.adjacentTaste ? "평소 취향에서 한 발짝" : "아직 평가하지 않은 메뉴");
  if (slot === "TIME_MATCH" && candidate.time === 1) reasons.push("현재 시간대에 어울림");
  if (slot === "TASTE_MATCH" && candidate.directTaste) reasons.push("나의 취향과 가까움");
  else if (slot === "TASTE_MATCH" && candidate.adjacentTaste) reasons.push("평소 취향과 이어짐");
  if (candidate.distance >= .65) reasons.push("현재 위치에서 가까움");
  if (!reasons.length) reasons.push("지금 가기 좋은 균형");
  return reasons.slice(0, 2);
}

function selectSlotsWithDiversity(candidates: ScoredHomeCandidate[], slots: HomeCurationSlot[], mode: HomeCurationMode) {
  const selected: Array<{ place: DiscoveryPlace; slot: HomeCurationSlot; reasons: string[]; isGoldenPick: boolean }> = [];
  const categoryCounts = new Map<string, number>();
  const neighborhoodCounts = new Map<string, number>();
  for (const slot of slots) {
    const unused = candidates.filter((candidate) => !selected.some((item) => item.place.id === candidate.place.id));
    const preferred = unused.filter((candidate) => eligibleForSlot(candidate, slot, mode));
    const ranked = (preferred.length ? preferred : unused)
      .sort((left, right) => slotScore(right, slot, mode) - slotScore(left, slot, mode) || left.place.name.localeCompare(right.place.name, "ko"));
    const picked = ([[2, 2], [3, 2], [3, 3]] as const)
      .map(([categoryLimit, neighborhoodLimit]) => ranked.find((candidate) =>
        (categoryCounts.get(candidate.place.primaryCategory.slug) ?? 0) < categoryLimit
        && (neighborhoodCounts.get(candidate.place.neighborhood) ?? 0) < neighborhoodLimit,
      ))
      .find((candidate) => candidate !== undefined);
    if (!picked) continue;
    selected.push({ place: picked.place, slot, reasons: reasonsFor(picked, slot), isGoldenPick: picked.isGoldenPick });
    categoryCounts.set(picked.place.primaryCategory.slug, (categoryCounts.get(picked.place.primaryCategory.slug) ?? 0) + 1);
    neighborhoodCounts.set(picked.place.neighborhood, (neighborhoodCounts.get(picked.place.neighborhood) ?? 0) + 1);
  }
  return selected;
}

export function rankHomeCuration(input: HomeCurationInput): HomeCuratedPlace[] {
  const eligible = input.places.filter((place) => passesHomeQuality(place) && distanceInMeters(input.center, place) <= input.radiusMeters);
  const scored = scoreHomeCandidates(eligible, input, MODE_WEIGHTS[input.mode]);
  const selected = selectSlotsWithDiversity(scored, MODE_SLOTS[input.mode], input.mode);
  return selected.map((item, index) => ({ ...item.place, slot: item.slot, rank: index + 1, recommendationReasons: item.reasons.slice(0, 2), isGoldenPick: item.isGoldenPick }));
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm vitest run tests/unit/home-curation.test.ts`

Expected: all slot, diversity, quality, Golden fallback, mode-weight tests passed.

- [ ] **Step 6: 커밋**

```bash
git add app/features/places/home-curation.ts tests/unit/home-curation.test.ts
git commit -m "2026-08-11 홈 추천 5개 슬롯 알고리즘"
```

---

### Task 3: 공용 추천 후보 조회와 홈 서버 조립

**Files:**
- Create: `app/features/places/recommendation-candidates.server.ts`
- Create: `app/features/places/home-curation.server.ts`
- Modify: `app/features/places/place-recommendation.server.ts`
- Create: `tests/integration/home-curation.server.test.ts`

**Interfaces:**
- Produces: `loadRecommendationCandidateContext(db, input)`, `getHomeCurationPage(db, input)`
- Consumes: `listRecommendationCandidates`, `ratingSnapshots`, `userTasteBadges`, `listActiveGoldenPicks`, `rankHomeCuration`

- [ ] **Step 1: 실제 D1 결합·반경 확장 실패 테스트 작성**

```ts
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { categories, goldenPickEvents, placeCategories, places, ratingSnapshots, userTasteBadges, users } from "../../app/db/schema";
import { getHomeCurationPage } from "../../app/features/places/home-curation.server";

async function seedHomeCurationFixtures(input: { farTail: boolean }) {
  const db = createDb(env.DB);
  const suffix = crypto.randomUUID();
  const now = "2026-08-11T03:00:00.000Z";
  const userId = `home-user-${suffix}`;
  const reviewerId = `home-reviewer-${suffix}`;
  await db.insert(users).values([
    { id: userId, email: `${userId}@example.com`, displayName: "홈 사용자", role: "USER", createdAt: now, updatedAt: now },
    { id: reviewerId, email: `${reviewerId}@example.com`, displayName: "홈 리뷰어", role: "REVIEWER", createdAt: now, updatedAt: now },
  ]);
  await db.insert(userTasteBadges).values({ userId, badgeId: "food-gukbap", source: "USER", score: .95, evidenceJson: "{}", createdAt: now, updatedAt: now });
  const categoryIds = Array.from({ length: 6 }, (_, index) => `home-category-${suffix}-${index}`);
  await db.insert(categories).values(categoryIds.map((id, index) => ({ id, slug: id, name: `홈 분류 ${index}`, emoji: "🍽️", isActive: true, sortOrder: index, createdAt: now, updatedAt: now })));
  const placeIds = Array.from({ length: 6 }, (_, index) => `home-place-${suffix}-${index}`);
  await db.insert(places).values(placeIds.map((id, index) => ({
    id, slug: id, name: index === 0 ? "테스트 국밥" : `테스트 장소 ${index}`, status: "PUBLISHED" as const,
    address: "광주광역시 테스트", neighborhood: `테스트동-${index}`, searchText: index === 0 ? "국밥 백반" : index === 1 ? "점심 백반" : `새로운 메뉴 ${index}`,
    latitude: 35.15 + (input.farTail && index >= 4 ? .036 : index * .002), longitude: 126.92,
    createdAt: now, updatedAt: now,
  })));
  await db.insert(placeCategories).values(placeIds.map((placeId, index) => ({ placeId, categoryId: categoryIds[index]!, isPrimary: true })));
  const snapshots = placeIds.map((placeId, index) => ({
    id: `home-snapshot-${suffix}-${index}`, placeId, configId: "rating-config-v2", inputHash: `${suffix}-${index}`,
    overallScore: 90 - index, userScore: 89 - index, reviewerScore: 92 - index, overallSampleCount: 20,
    userSampleCount: 15, reviewerSampleCount: 5, reviewerRawWeight: 5, reviewerCombinedWeight: 5,
    reviewerWeightShare: .25, reasonsJson: "{}", isStale: false, computedAt: now, createdAt: now, updatedAt: now,
  }));
  await db.insert(ratingSnapshots).values(snapshots.slice(0, 4));
  await db.insert(ratingSnapshots).values(snapshots.slice(4));
  await db.insert(goldenPickEvents).values({ id: `home-golden-${suffix}`, reviewerUserId: reviewerId, placeId: placeIds[2]!, eventType: "GRANT", previousEventId: null, reason: null, effectiveAt: now, expiresAt: "2026-09-11T03:00:00.000Z", createdAt: now });
  return { userId, now };
}

const center = { latitude: 35.15, longitude: 126.92 };
const bbox: [number, number, number, number] = [126.85, 35.09, 126.99, 35.21];

it("공개 후보와 평가·취향·Golden Pick을 결합해 3km 추천을 반환한다", async () => {
  const fixture = await seedHomeCurationFixtures({ farTail: false });
  const page = await getHomeCurationPage(createDb(env.DB), { userId: fixture.userId, bbox, center, mode: "now", now: fixture.now });
  expect(page.status).toBe("READY");
  expect(page.radiusMeters).toBe(3_000);
  expect(page.places).toHaveLength(5);
  expect(page.places.map((place) => place.rank)).toEqual([1, 2, 3, 4, 5]);
  expect(page.places.some((place) => place.isGoldenPick)).toBe(true);
});

it("3km 후보가 부족하면 5km로 한 번만 확장한다", async () => {
  const fixture = await seedHomeCurationFixtures({ farTail: true });
  const page = await getHomeCurationPage(createDb(env.DB), { userId: fixture.userId, bbox, center, mode: "now", now: fixture.now });
  expect(page.radiusMeters).toBe(5_000);
  expect(page.places.every((place) => (place.distanceMeters ?? Infinity) <= 5_000)).toBe(true);
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run --config vitest.workers.config.ts tests/integration/home-curation.server.test.ts`

Expected: FAIL because the shared loader and home service do not exist.

- [ ] **Step 3: 공용 후보 컨텍스트 추출**

```ts
import { and, desc, eq, inArray } from "drizzle-orm";
import type { AppDb } from "../../db/client.server";
import { loadInD1Chunks } from "../../db/d1-query-chunks";
import { ratingSnapshots, userTasteBadges } from "../../db/schema";
import { listActiveGoldenPicks } from "../ratings/golden-pick.server";
import { GUEST_TASTE_SIGNAL_SCORE, type DiscoveryPlace, type RankingTasteSignal } from "./place-discovery";
import { listRecommendationCandidates } from "./place.server";

async function loadStoredTasteSignals(db: AppDb, userId?: string | null): Promise<RankingTasteSignal[]> {
  if (!userId) return [];
  return db.select({ badgeId: userTasteBadges.badgeId, score: userTasteBadges.score, source: userTasteBadges.source })
    .from(userTasteBadges).where(eq(userTasteBadges.userId, userId)).orderBy(desc(userTasteBadges.score));
}

async function attachLatestRatingSnapshots(db: AppDb, places: Awaited<ReturnType<typeof listRecommendationCandidates>>): Promise<DiscoveryPlace[]> {
  const snapshots = await loadInD1Chunks(places.map((place) => place.id), (ids) => db.select().from(ratingSnapshots)
    .where(and(inArray(ratingSnapshots.placeId, ids), eq(ratingSnapshots.isStale, false)))
    .orderBy(desc(ratingSnapshots.computedAt)), { reservedBindings: 1 });
  const latest = new Map<string, typeof snapshots[number]>();
  snapshots.forEach((snapshot) => { if (!latest.has(snapshot.placeId)) latest.set(snapshot.placeId, snapshot); });
  return places.map((place) => {
    const snapshot = latest.get(place.id);
    return { ...place, ratingScore: snapshot?.overallScore, ratingSampleCount: snapshot?.overallSampleCount, userScore: snapshot?.userScore, reviewerScore: snapshot?.reviewerScore };
  });
}

function mergeTasteSignals(stored: RankingTasteSignal[], guestBadgeIds: string[]) {
  const merged = new Map<string, RankingTasteSignal>();
  stored.forEach((signal) => merged.set(signal.badgeId, signal));
  guestBadgeIds.forEach((badgeId) => merged.set(badgeId, { badgeId, score: GUEST_TASTE_SIGNAL_SCORE, source: "USER" }));
  return [...merged.values()];
}

export async function loadRecommendationCandidateContext(db: AppDb, input: {
  userId?: string | null;
  tasteBadgeIds?: string[];
  bbox: [number, number, number, number];
  categorySlug?: string;
  now: string;
  limit?: number;
}) {
  const [places, goldenPicks, storedTaste] = await Promise.all([
    listRecommendationCandidates(db, { bbox: input.bbox, categorySlug: input.categorySlug, limit: input.limit ?? 500 }),
    listActiveGoldenPicks(db, input.now),
    loadStoredTasteSignals(db, input.userId),
  ]);
  const candidates = await attachLatestRatingSnapshots(db, places);
  return { candidates, goldenPicks, tasteSignals: mergeTasteSignals(storedTaste, input.tasteBadgeIds ?? []) };
}
```

- [ ] **Step 4: `/places`가 공용 후보 컨텍스트를 사용하도록 변경**

```ts
const { candidates, goldenPicks, tasteSignals } = await loadRecommendationCandidateContext(db, {
  userId: input.userId,
  tasteBadgeIds: input.tasteBadgeIds,
  bbox: input.bbox,
  categorySlug: input.categorySlug,
  now: input.now,
  limit: 500,
});
```

- [ ] **Step 5: 홈 서버 조립과 반경 확장 구현**

```ts
export type HomeCurationRequest = {
  userId?: string | null;
  tasteBadgeIds?: string[];
  bbox: [number, number, number, number];
  center: DiscoveryCenter;
  mode: HomeCurationMode;
  now: string;
};

export async function getHomeCurationPage(db: AppDb, input: HomeCurationRequest): Promise<HomeCurationPage> {
  const context = await loadRecommendationCandidateContext(db, { ...input, limit: 500 });
  const timeSlot = homeTimeSlotAt(new Date(input.now));
  const withinThree = rankHomeCuration({ ...context, center: input.center, mode: input.mode, timeSlot, radiusMeters: 3_000 });
  const places = withinThree.length >= 5 ? withinThree : rankHomeCuration({ ...context, center: input.center, mode: input.mode, timeSlot, radiusMeters: 5_000 });
  const radiusMeters = withinThree.length >= 5 ? 3_000 : 5_000;
  return { status: places.length ? "READY" as const : "EMPTY" as const, places, mode: input.mode, timeSlot, radiusMeters };
}
```

- [ ] **Step 6: `/places` 회귀와 홈 통합 테스트 통과 확인**

Run: `pnpm vitest run --config vitest.workers.config.ts tests/integration/home-curation.server.test.ts tests/integration/place.server.test.ts tests/integration/golden-pick.server.test.ts`

Expected: all selected integration suites passed.

- [ ] **Step 7: 커밋**

```bash
git add app/features/places/recommendation-candidates.server.ts app/features/places/home-curation.server.ts app/features/places/place-recommendation.server.ts tests/integration/home-curation.server.test.ts
git commit -m "2026-08-11 홈 추천 후보 서버 결합"
```

---

### Task 4: 홈 추천 리소스와 엄격한 요청 계약

**Files:**
- Modify: `app/features/maps/home-curation-options.ts`
- Create: `app/routes/home-recommendations-resource.tsx`
- Modify: `app/routes.ts`
- Create: `tests/unit/home-recommendations-resource-contract.test.ts`

**Interfaces:**
- Consumes: `getHomeCurationPage`, `parseHomeCurationState`, optional authenticated user and guest taste session
- Produces: `GET /resources/home-recommendations?mode=...&bbox=...`

- [ ] **Step 1: 허용 query와 중복·미지 query 거부 테스트 작성**

```ts
import { homeRecommendationPath, parseHomeRecommendationRequest } from "../../app/features/maps/home-curation-options";

it("mode와 단일 bbox만 허용한다", async () => {
  const bbox: [number, number, number, number] = [126.8, 35.1, 126.9, 35.2];
  expect(parseHomeRecommendationRequest(new URL(`https://local${homeRecommendationPath("time", bbox)}`))).toEqual({ mode: "time", bbox });
});

it.each([
  "?mode=time&mode=golden",
  "?mode=bad",
  "?bbox=1,2,3,4",
  "?mode=now&admin=true",
])("잘못된 공개 query를 거부한다: %s", (search) => {
  expect(() => parseHomeRecommendationRequest(new URL(`https://local/resources/home-recommendations${search}`))).toThrow("INVALID_HOME_RECOMMENDATION_REQUEST");
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run tests/unit/home-recommendations-resource-contract.test.ts`

Expected: FAIL because the resource parser does not exist.

- [ ] **Step 3: 리소스 loader와 라우트 구현**

```ts
// Add these pure helpers to app/features/maps/home-curation-options.ts so Node unit tests do not import cloudflare:workers.
const RESOURCE_MODES = new Set<HomeCurationMode>(["now", "taste", "time", "golden", "discovery"]);

export function parseHomeRecommendationRequest(url: URL) {
  const allowed = new Set(["mode", "bbox"]);
  if ([...url.searchParams.keys()].some((key) => !allowed.has(key))) throw new Error("INVALID_HOME_RECOMMENDATION_REQUEST");
  if (url.searchParams.getAll("mode").length !== 1 || url.searchParams.getAll("bbox").length !== 1) throw new Error("INVALID_HOME_RECOMMENDATION_REQUEST");
  const mode = url.searchParams.get("mode") as HomeCurationMode;
  const bbox = url.searchParams.get("bbox")!.split(",").map(Number);
  if (!RESOURCE_MODES.has(mode) || bbox.length !== 4 || bbox.some((value) => !Number.isFinite(value))) throw new Error("INVALID_HOME_RECOMMENDATION_REQUEST");
  const [west, south, east, north] = bbox;
  if (west < 124 || east > 132 || south < 32 || north > 39 || west >= east || south >= north) throw new Error("INVALID_HOME_RECOMMENDATION_REQUEST");
  return { mode, bbox: bbox as [number, number, number, number] };
}

export function homeRecommendationPath(mode: HomeCurationMode, bbox: [number, number, number, number]) {
  const params = new URLSearchParams({ mode, bbox: bbox.join(",") });
  return `/resources/home-recommendations?${params}`;
}

// app/routes/home-recommendations-resource.tsx
import { env } from "cloudflare:workers";
import { data } from "react-router";
import type { Route } from "./+types/home-recommendations-resource";
import { createDb } from "../db/client.server";
import { getOptionalUser } from "../features/auth/session.server";
import { centerOfBbox, parseHomeRecommendationRequest } from "../features/maps/home-curation-options";
import { getGuestOnboardingFromRequest } from "../features/onboarding/guest-session.server";
import { getHomeCurationPage } from "../features/places/home-curation.server";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  let input: ReturnType<typeof parseHomeRecommendationRequest>;
  try { input = parseHomeRecommendationRequest(url); }
  catch { return data({ ok: false as const, message: "잘못된 추천 요청입니다." }, { status: 400 }); }
  try {
    const db = createDb(env.DB);
    const now = new Date().toISOString();
    const user = await getOptionalUser(request);
    const guest = !user && env.ONBOARDING_ENABLED === "true" ? await getGuestOnboardingFromRequest(db, request, now) : null;
    const recommendations = await getHomeCurationPage(db, {
      userId: user?.id,
      tasteBadgeIds: guest ? [...guest.foodBadgeIds, ...guest.styleBadgeIds] : [],
      bbox: input.bbox,
      center: centerOfBbox(input.bbox),
      mode: input.mode,
      now,
    });
    return data({ ok: true as const, recommendations });
  } catch (error) {
    console.error("HOME_RECOMMENDATION_RESOURCE_FAILED", error);
    return data({ ok: false as const, message: "추천을 새로 불러오지 못했어요. 다시 시도해 주세요." }, { status: 503 });
  }
}
```

Add to `app/routes.ts`:

```ts
route("resources/home-recommendations", "routes/home-recommendations-resource.tsx"),
```

- [ ] **Step 4: 테스트·타입 생성 통과 확인**

Run: `pnpm vitest run tests/unit/home-recommendations-resource-contract.test.ts`

Run: `pnpm typecheck`

Expected: contract tests and TypeScript checks passed.

- [ ] **Step 5: 커밋**

```bash
git add app/features/maps/home-curation-options.ts app/routes/home-recommendations-resource.tsx app/routes.ts tests/unit/home-recommendations-resource-contract.test.ts
git commit -m "2026-08-11 홈 추천 경량 리소스 계약"
```

---

### Task 5: 추천 패널과 모바일 스냅 시트

**Files:**
- Create: `app/components/map/HomeCurationCards.tsx`
- Create: `app/components/map/HomeCurationPanel.tsx`
- Create: `app/components/map/HomeCurationSheet.tsx`
- Create: `tests/unit/home-curation-ui-contract.test.ts`

**Interfaces:**
- Consumes: `HomeCurationPage`, selected place id, pending/loading/error state
- Produces: 모드 선택, 카드 선택, 상세 열기, 전체 탐색, 시트 단계 변경 callbacks

- [ ] **Step 1: 접근성·문구·5개 카드 계약 실패 테스트 작성**

```ts
it("추천 모드는 aria-pressed 버튼이고 전체 탐색은 별도 동작이다", () => {
  const source = `${read("app/components/map/HomeCurationPanel.tsx")}\n${read("app/components/map/HomeCurationCards.tsx")}`;
  expect(source).toContain("aria-pressed={props.mode === option.id}");
  expect(source).toContain("전체 장소 보기");
  expect(source).toContain("aria-live=\"polite\"");
});

it("모바일 시트는 접힘·중간·전체 세 단계를 가진다", () => {
  const source = read("app/components/map/HomeCurationSheet.tsx");
  expect(source).toContain('type SheetSnap = "peek" | "half" | "full"');
  expect(source).toContain("지금 갈 만한 5곳");
  expect(source).toContain("전체 장소 보기");
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run tests/unit/home-curation-ui-contract.test.ts`

Expected: FAIL because both components do not exist.

- [ ] **Step 3: 공용 추천 카드 목록과 데스크톱 패널 구현**

```tsx
// app/components/map/HomeCurationCards.tsx
import { useEffect, useRef } from "react";
import type { HomeCurationMode } from "../../features/maps/home-curation-options";
import type { HomeCuratedPlace } from "../../features/places/home-curation";
import { formatRatingSummary } from "../../features/places/place-discovery";

export type HomeCurationPresentationProps = {
  places: HomeCuratedPlace[];
  mode: HomeCurationMode;
  selectedPlaceId: string | null;
  contextLabel: string;
  statusMessage: string;
  retryVisible: boolean;
  onMode: (mode: HomeCurationMode) => void;
  onSelectPlace: (placeId: string) => void;
  onOpenPlace: (slug: string) => void;
  onLocate: () => void;
  onRetry: () => void;
  onBrowse: () => void;
};

export const MODE_OPTIONS = [
  { id: "now", label: "지금 추천" },
  { id: "taste", label: "나의 취향" },
  { id: "time", label: "시간대" },
  { id: "golden", label: "Golden Pick" },
  { id: "discovery", label: "새로운 맛" },
] as const;

export function HomeCurationModes(props: Pick<HomeCurationPresentationProps, "mode" | "onMode">) {
  return <div className="home-curation-modes" aria-label="추천 방식">
    {MODE_OPTIONS.map((option) => <button className="home-curation-mode" key={option.id} type="button" aria-pressed={props.mode === option.id} onClick={() => props.onMode(option.id)}>{option.label}</button>)}
  </div>;
}

export function HomeCurationCards(props: HomeCurationPresentationProps & { visibleCount?: number }) {
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (!props.selectedPlaceId) return;
    const selected = listRef.current?.querySelector<HTMLElement>(`[data-place-id="${CSS.escape(props.selectedPlaceId)}"]`);
    selected?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [props.selectedPlaceId]);
  return <ol ref={listRef} className="home-curation-cards">
    {props.places.slice(0, props.visibleCount ?? 5).map((place) => <li key={place.id}>
      <button type="button" data-home-curation-card data-place-id={place.id} aria-current={props.selectedPlaceId === place.id ? "true" : undefined} onClick={() => props.onSelectPlace(place.id)}>
        <span>{String(place.rank).padStart(2, "0")}</span><strong>{place.name}</strong>
        <small>{place.recommendationReasons.join(" · ")}</small>
        <em>{formatRatingSummary(place)}</em>
        {place.isGoldenPick && <b>Golden Pick</b>}
      </button>
      <button type="button" onClick={() => props.onOpenPlace(place.slug)}>상세 보기</button>
    </li>)}
  </ol>;
}

// app/components/map/HomeCurationPanel.tsx
export function HomeCurationPanel(props: HomeCurationPresentationProps) {
  return <aside className="home-curation-panel" aria-label="지금 갈 만한 곳">
    <header><p>NOW · FOR YOU</p><h1>지금 갈 만한 5곳</h1><span>{props.contextLabel}</span></header>
    <button type="button" onClick={props.onLocate}>내 위치로 추천</button>
    <HomeCurationModes mode={props.mode} onMode={props.onMode} />
    <p aria-live="polite">{props.statusMessage}</p>
    {props.retryVisible && <button type="button" onClick={props.onRetry}>다시 추천</button>}
    <HomeCurationCards {...props} />
    <button type="button" onClick={props.onBrowse}>전체 장소 보기</button>
  </aside>;
}
```

- [ ] **Step 4: 모바일 스냅 시트 구현**

```tsx
import { useEffect, useRef, useState } from "react";

type SheetSnap = "peek" | "half" | "full";
const nextSnap = (snap: SheetSnap): SheetSnap => snap === "peek" ? "half" : snap === "half" ? "full" : "peek";
const previousSnap = (snap: SheetSnap): SheetSnap => snap === "full" ? "half" : "peek";

export function HomeCurationSheet(props: HomeCurationPresentationProps) {
  const [snap, setSnap] = useState<SheetSnap>("half");
  const pointerStartY = useRef<number | null>(null);
  useEffect(() => { if (props.selectedPlaceId) setSnap((current) => current === "peek" ? "half" : current); }, [props.selectedPlaceId]);
  return <section className="home-curation-sheet" data-snap={snap} aria-labelledby="home-curation-sheet-title">
    <button type="button" className="home-curation-sheet__handle" aria-label="추천 시트 크기 변경" onClick={() => setSnap(nextSnap(snap))}
      onPointerDown={(event) => { pointerStartY.current = event.clientY; }}
      onPointerUp={(event) => { const delta = pointerStartY.current == null ? 0 : event.clientY - pointerStartY.current; pointerStartY.current = null; if (Math.abs(delta) >= 36) setSnap((current) => delta < 0 ? nextSnap(current) : previousSnap(current)); }} />
    <h2 id="home-curation-sheet-title">지금 갈 만한 5곳</h2>
    <button type="button" onClick={props.onLocate}>내 위치로 추천</button>
    <HomeCurationModes {...props} />
    <p aria-live="polite">{props.statusMessage}</p>
    {props.retryVisible && <button type="button" onClick={props.onRetry}>다시 추천</button>}
    <HomeCurationCards {...props} visibleCount={snap === "peek" ? 1 : snap === "half" ? 2 : 5} />
    <button type="button" onClick={props.onBrowse}>전체 장소 보기</button>
  </section>;
}
```

- [ ] **Step 5: 계약 테스트 통과 확인**

Run: `pnpm vitest run tests/unit/home-curation-ui-contract.test.ts`

Expected: all component contract tests passed.

- [ ] **Step 6: 커밋**

```bash
git add app/components/map/HomeCurationCards.tsx app/components/map/HomeCurationPanel.tsx app/components/map/HomeCurationSheet.tsx tests/unit/home-curation-ui-contract.test.ts
git commit -m "2026-08-11 홈 추천 패널과 모바일 시트"
```

---

### Task 6: 추천 번호 마커와 draft 지도 범위

**Files:**
- Modify: `app/components/map/PlaceMap.tsx`
- Modify: `tests/unit/home-curation-ui-contract.test.ts`

**Interfaces:**
- Adds props: `markerRanks?: Record<string, number>`, `deferBounds?: boolean`, `onPendingBounds?: (bbox) => void`
- Preserves: browse map category emoji and region cluster behavior

- [ ] **Step 1: 추천 번호와 browse emoji 회귀 실패 테스트 작성**

```ts
it("추천 모드에서는 번호를 쓰고 전체 탐색에서는 기존 emoji를 유지한다", () => {
  const source = read("app/components/map/PlaceMap.tsx");
  expect(source).toContain("markerRanks?.[place.id]");
  expect(source).toContain("String(markerRanks[place.id])");
  expect(source).toContain("place.primaryCategory.emoji");
  expect(source).toContain("pendingBoundsCallbackRef.current?.(nextBounds)");
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run tests/unit/home-curation-ui-contract.test.ts`

Expected: FAIL because `PlaceMap` has no curated marker props.

- [ ] **Step 3: 실제 SDK와 QA fallback 모두에 번호 마커 구현**

```tsx
// Extend the PlaceMap prop object and dependency list with markerRanks, deferBounds and onPendingBounds.
const pendingBoundsCallbackRef = useRef(onPendingBounds);
const deferBoundsRef = useRef(deferBounds);
const viewportDirtyRef = useRef(false);
pendingBoundsCallbackRef.current = onPendingBounds;
deferBoundsRef.current = deferBounds;
const publishBounds = (nextBounds: [number, number, number, number]) => {
  if (deferBoundsRef.current && !viewportDirtyRef.current) return;
  viewportDirtyRef.current = false;
  if (deferBoundsRef.current) pendingBoundsCallbackRef.current?.(nextBounds);
  else boundsRef.current(nextBounds);
};

const curatedRank = markerRanks?.[place.id];
const markerSize = curatedRank ? (isSelected ? 40 : 34) : isSelected ? 36 : influence === "high" ? 34 : influence === "medium" ? 32 : 30;
button.className = curatedRank
  ? `map-pin map-pin--curated${isSelected ? " is-selected" : ""}`
  : `map-pin influence-${influence}${isSelected ? " is-selected" : ""}`;
button.setAttribute("aria-label", curatedRank ? `${curatedRank}번 ${place.name} 추천 지도 핀` : `${place.name} 지도 핀`);
button.textContent = curatedRank ? String(curatedRank) : place.primaryCategory.emoji;
```

Change idle callback:

```ts
const nextBounds = toBoundsTuple({ lat: southwest.lat(), lng: southwest.lng() }, { lat: northeast.lat(), lng: northeast.lng() });
publishBounds(nextBounds);
```

Add `onPointerDownCapture={() => { viewportDirtyRef.current = true; }}` and `onWheelCapture={() => { viewportDirtyRef.current = true; }}` to both map host containers, and set the same flag immediately before the QA fallback zoom button calls `publishBounds(...)`. This prevents programmatic initial fit/idle from showing `이 지역 다시 추천` while preserving user pan/zoom updates. Apply the same `markerRanks?.[place.id]` text/aria-label/class branch to the QA fallback marker button, keep the existing emoji branch unchanged when `markerRanks` is absent, and include `markerRanks` in the marker effect dependency list.

- [ ] **Step 4: 지도 정책·컴포넌트 계약 테스트 통과 확인**

Run: `pnpm vitest run tests/unit/home-curation-ui-contract.test.ts tests/unit/map-marker-policy.test.ts tests/unit/map-region-clusters.test.ts`

Expected: curated marker contract and existing map policy tests passed.

- [ ] **Step 5: 커밋**

```bash
git add app/components/map/PlaceMap.tsx tests/unit/home-curation-ui-contract.test.ts
git commit -m "2026-08-11 홈 추천 번호 지도 마커"
```

---

### Task 7: 홈 loader와 큐레이션·전체 탐색 상태 조립

**Files:**
- Modify: `app/routes/home.tsx`
- Modify: `tests/unit/home-curation-ui-contract.test.ts`

**Interfaces:**
- Consumes: `getHomeCurationPage`, `HomeCurationPanel`, `HomeCurationSheet`, resource loader type
- Produces: curated loader data or existing browse loader data without duplicated place fetch

- [ ] **Step 1: 기본 curated와 browse 보존 계약 실패 테스트 작성**

```ts
it("홈 기본값은 curated이고 browse에서 기존 탐색 패널을 유지한다", () => {
  const source = read("app/routes/home.tsx");
  expect(source).toContain("parseHomeCurationState(url.search)");
  expect(source).toContain('homeState.view === "curated"');
  expect(source).toContain("<HomeCurationPanel");
  expect(source).toContain("<HomeCurationSheet");
  expect(source).toContain("<MapExplorerPanel");
  expect(source).toContain("이 지역 다시 추천");
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run tests/unit/home-curation-ui-contract.test.ts`

Expected: FAIL because home route remains browse-only.

- [ ] **Step 3: loader를 view별로 분기**

```ts
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const mapState = parseMapState(url.search);
  const homeState = parseHomeCurationState(url.search);
  const db = createDb(env.DB);
  if (homeState.view === "browse") {
    const [places, groups] = await Promise.all([
      listPlaces(db, { categorySlug: url.searchParams.get("category") || undefined, query: mapState.query, bbox: mapState.bbox }),
      listPublicCategoryGroups(db),
    ]);
    return { view: "browse" as const, places, groups, mapState, homeState, clientId: env.NAVER_MAPS_CLIENT_ID ?? "", qaMode: url.searchParams.has("qa") };
  }
  const user = await getOptionalUser(request);
  const now = new Date().toISOString();
  const guest = !user && env.ONBOARDING_ENABLED === "true" ? await getGuestOnboardingFromRequest(db, request, now) : null;
  const recommendations = await getHomeCurationPage(db, { userId: user?.id, tasteBadgeIds: guest ? [...guest.foodBadgeIds, ...guest.styleBadgeIds] : [], bbox: mapState.bbox, center: centerOfBbox(mapState.bbox), mode: homeState.mode, now });
  return { view: "curated" as const, places: recommendations.places, recommendations, groups: [], mapState, homeState, clientId: env.NAVER_MAPS_CLIENT_ID ?? "", qaMode: url.searchParams.has("qa") };
}

export function shouldRevalidate({ currentUrl, nextUrl, defaultShouldRevalidate }: Route.ShouldRevalidateFunctionArgs) {
  const current = parseHomeCurationState(currentUrl.search);
  const next = parseHomeCurationState(nextUrl.search);
  if (currentUrl.pathname === nextUrl.pathname && current.view === "curated" && next.view === "curated") return false;
  return defaultShouldRevalidate;
}
```

- [ ] **Step 4: fetcher 모드 변경과 pending bbox 구현**

```tsx
const recommendationFetcher = useFetcher<{ ok: true; recommendations: HomeCurationPage } | { ok: false; message: string }>();
const [pendingBounds, setPendingBounds] = useState<[number, number, number, number] | null>(null);
const [locationBasis, setLocationBasis] = useState(params.has("bbox") ? "선택 지역 기준" : "광주 중심 기준");
const recommendations = recommendationFetcher.data?.ok ? recommendationFetcher.data.recommendations : loaderData.view === "curated" ? loaderData.recommendations : null;
const activeMode = parseHomeCurationState(`?${params}`).mode;
const activeMapState = parseMapState(`?${params}`);
const activeBbox = activeMapState.bbox;
const currentPlaces = recommendations?.places ?? loaderData.places;
const selectedPlace = findSelectedPlace(currentPlaces, activeMapState.selected);
useEffect(() => {
  if (loaderData.view !== "curated" || !recommendations?.places.length) return;
  if (!activeMapState.selected || !selectedPlace) setSearch({ selected: recommendations.places[0]!.id });
}, [loaderData.view, recommendations, activeMapState.selected, selectedPlace]);

const changeMode = (mode: HomeCurationMode) => {
  recommendationFetcher.load(homeRecommendationPath(mode, activeBbox));
  setParams((current) => { const next = new URLSearchParams(current); next.set("view", "curated"); next.set("mode", mode); return next; }, { replace: true });
};

const refreshArea = (bbox: [number, number, number, number]) => {
  recommendationFetcher.load(homeRecommendationPath(activeMode, bbox));
  setParams((current) => { const next = new URLSearchParams(current); next.set("bbox", bbox.join(",")); return next; }, { replace: true });
  setPendingBounds(null);
};

// Replace the existing locate callback so curated mode reloads only the five recommendations.
const locate = () => navigator.geolocation?.getCurrentPosition(({ coords }) => {
  const result = resolveLocationViewport(coords);
  setLocationBounds(result.bbox);
  setLocationNotice(result.notice);
  setLocationBasis("현재 위치 기준");
  if (loaderData.view === "curated") recommendationFetcher.load(homeRecommendationPath(activeMode, result.bbox));
  setParams((current) => { const next = new URLSearchParams(current); next.set("bbox", result.bbox.map((value) => value.toFixed(5)).join(",")); next.delete("selected"); return next; }, { replace: true });
}, () => setLocationNotice("위치 권한을 사용할 수 없어 광주 중심 기준 추천을 유지합니다."), { enableHighAccuracy: true, timeout: 8_000 });

const panelProps: HomeCurationPresentationProps = {
  places: recommendations?.places ?? [],
  mode: activeMode,
  selectedPlaceId: selectedPlace?.id ?? null,
  contextLabel: `${homeTimeSlotLabel(recommendations?.timeSlot ?? "lunch")} · ${locationBasis} · 반경 ${(recommendations?.radiusMeters ?? 3_000) / 1_000}km`,
  statusMessage: recommendationFetcher.state !== "idle" ? "추천을 다시 고르는 중입니다." : recommendationFetcher.data && !recommendationFetcher.data.ok ? recommendationFetcher.data.message : "현재 조건에 맞춘 추천입니다.",
  retryVisible: Boolean(recommendationFetcher.data && !recommendationFetcher.data.ok),
  onMode: changeMode,
  onSelectPlace: (id) => setSearch({ selected: id }),
  onOpenPlace: openDetail,
  onLocate: locate,
  onRetry: () => recommendationFetcher.load(homeRecommendationPath(activeMode, activeBbox)),
  onBrowse: () => setParams((current) => { const next = new URLSearchParams(current); next.set("view", "browse"); return next; }),
};
```

- [ ] **Step 5: 큐레이션·browse 렌더 분기 구현**

```tsx
<main id="main" className="map-explorer">
  {loaderData.view === "curated" && recommendations
    ? <HomeCurationPanel {...panelProps} />
    : <MapExplorerPanel {...browseProps} />}
  <section className="map-explorer-map" aria-label="지도 영역">
    <PlaceMap
      places={loaderData.view === "curated" && recommendations ? recommendations.places : loaderData.places}
      selected={selectedPlace?.id ?? null}
      clientId={loaderData.clientId}
      qaMode={loaderData.qaMode}
      zoom={mapZoom}
      clusters={loaderData.view === "curated" ? [] : clusters}
      focusCluster={loaderData.view === "curated" ? null : focusCluster}
      markerRanks={loaderData.view === "curated" && recommendations ? Object.fromEntries(recommendations.places.map((place) => [place.id, place.rank])) : undefined}
      deferBounds={loaderData.view === "curated"}
      onPendingBounds={setPendingBounds}
      initialBounds={loaderData.view === "curated" || params.has("bbox") ? activeBbox : undefined}
      locationBounds={locationBounds}
      locationNotice={locationNotice}
      onSelect={(id) => setSearch({ selected: id })}
      onBounds={setBounds}
      onZoom={setMapZoom}
      onClusterSelect={focusRegion}
    />
    {loaderData.view === "curated" && recommendations && <HomeCurationSheet {...panelProps} />}
    {loaderData.view === "browse" && <button type="button" className="home-curation-return" onClick={() => setParams((current) => { const next = new URLSearchParams(current); next.set("view", "curated"); next.delete("q"); next.delete("category"); return next; })}>추천 지도로 돌아가기</button>}
    {pendingBounds && loaderData.view === "curated" && <button type="button" className="home-curation-refresh-area" onClick={() => refreshArea(pendingBounds)}>이 지역 다시 추천</button>}
    {loaderData.view === "browse" && selectedPlace && !detailSlug && <MapPlaceDetail key={selectedPlace.id} place={selectedPlace} onBack={() => setSearch({ selected: null })} onOpenDetail={openDetail} />}
    <PlaceDetailSheet slug={detailSlug} onClose={closeDetail} />
  </section>
</main>
```

- [ ] **Step 6: 홈·기존 지도 단위 계약 통과 확인**

Run: `pnpm vitest run tests/unit/home-curation-ui-contract.test.ts tests/unit/map-state.test.ts tests/unit/map-selection.test.ts tests/unit/map-region-clusters.test.ts`

Expected: home curation contracts and existing map contracts passed.

- [ ] **Step 7: 커밋**

```bash
git add app/routes/home.tsx tests/unit/home-curation-ui-contract.test.ts
git commit -m "2026-08-11 홈 큐레이션과 전체 탐색 전환"
```

---

### Task 8: Re:Taste 반응형 디자인과 접근성 상태

**Files:**
- Modify: `app/app.css`
- Modify: `tests/unit/home-curation-ui-contract.test.ts`

**Interfaces:**
- Consumes: component class names from Tasks 5–7
- Produces: desktop sidebar, mobile snap sheet, selected lime marker, reduced-motion behavior

- [ ] **Step 1: CSS 토큰·모바일·reduced motion 실패 계약 작성**

```ts
it("홈 큐레이션은 공용 디자인 토큰과 모바일 스냅 상태를 사용한다", () => {
  const css = read("app/app.css");
  expect(css).toContain(".home-curation-panel");
  expect(css).toContain(".home-curation-sheet[data-snap=\"peek\"]");
  expect(css).toContain(".home-curation-sheet[data-snap=\"half\"]");
  expect(css).toContain(".home-curation-sheet[data-snap=\"full\"]");
  expect(css).toContain(".map-pin--curated.is-selected");
  expect(css).toContain("@media (prefers-reduced-motion: reduce)");
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run tests/unit/home-curation-ui-contract.test.ts`

Expected: FAIL because curation CSS selectors do not exist.

- [ ] **Step 3: 데스크톱 패널과 번호 마커 스타일 구현**

```css
.home-curation-panel { width:100%; min-width:0; padding:var(--space-8); background:var(--surface-card); border-right:1px solid var(--color-ink); overflow-y:auto; }
.home-curation-sheet { display:none; }
.home-curation-panel h1,.home-curation-sheet h2 { margin:var(--space-2) 0; font-size:clamp(1.75rem,3vw,2.35rem); line-height:1.02; letter-spacing:-.05em; }
.home-curation-modes { display:flex; gap:var(--space-2); margin:var(--space-5) 0; overflow-x:auto; }
.home-curation-mode { flex:none; min-height:var(--control-height-compact); padding:0 var(--space-4); border:1px solid var(--color-line); border-radius:var(--radius-pill); background:var(--surface-card); color:var(--color-ink); }
.home-curation-mode[aria-pressed="true"] { background: var(--color-ink); color: var(--surface-card); }
.home-curation-cards { display:grid; gap:var(--space-3); margin:var(--space-5) 0; padding:0; list-style:none; }
.home-curation-cards li { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; border:1px solid var(--color-line); border-radius:var(--radius-card); background:var(--surface-page); }
.home-curation-cards button { border:0; background:transparent; color:inherit; text-align:left; }
.home-curation-cards [data-home-curation-card] { display:grid; grid-template-columns:40px minmax(0,1fr); gap:var(--space-1) var(--space-3); padding:var(--space-4); }
.home-curation-cards [data-home-curation-card] span { grid-row:1/3; display:grid; place-items:center; width:40px; height:40px; border-radius:50%; background:var(--color-ink); color:white; font-family:"IBM Plex Mono",monospace; }
.home-curation-cards [data-home-curation-card] small { color:var(--color-accent); }
.home-curation-cards [data-home-curation-card][aria-current="true"] { outline:3px solid var(--color-signal); outline-offset:-3px; border-radius:var(--radius-card); }
.map-pin--curated { display:grid; place-items:center; width:34px; height:34px; border-radius:50%; background:var(--color-ink); color:white; font-weight:800; }
.map-pin--curated.is-selected { width:40px; height:40px; background:var(--color-signal); color:var(--color-ink); }
.home-curation-refresh-area,.home-curation-return { position:absolute; z-index:12; top:var(--space-4); left:50%; min-height:var(--control-height); padding:0 var(--space-4); border:1px solid var(--color-ink); border-radius:var(--radius-pill); background:var(--surface-card); color:var(--color-ink); transform:translateX(-50%); }
```

- [ ] **Step 4: 모바일 스냅 시트 스타일 구현**

```css
@media (max-width: 760px) {
  .home-curation-panel { display:none; }
  .home-curation-sheet { display:block; position:absolute; left:8px; right:8px; bottom:8px; z-index:30; overflow:hidden; padding:var(--space-5); background:var(--surface-card); border:1px solid var(--color-ink); border-radius:var(--radius-feature) var(--radius-feature) var(--radius-control) var(--radius-control); box-shadow:5px 5px 0 rgba(23,34,28,.18); transition:height .24s ease; }
  .home-curation-sheet__handle { display:block; width:52px; height:24px; margin:-12px auto 0; border:0; background:linear-gradient(transparent 10px,var(--color-line) 10px 14px,transparent 14px); touch-action:none; }
  .home-curation-sheet[data-snap="peek"] { height:112px; }
  .home-curation-sheet[data-snap="half"] { height:46dvh; }
  .home-curation-sheet[data-snap="full"] { height:calc(100% - 16px); overflow-y:auto; }
}
@media (prefers-reduced-motion: reduce) { .home-curation-sheet { transition:none; } }
```

- [ ] **Step 5: 계약 테스트·빌드 통과 확인**

Run: `pnpm vitest run tests/unit/home-curation-ui-contract.test.ts`

Run: `pnpm build`

Expected: CSS contract passed and production build completed.

- [ ] **Step 6: 커밋**

```bash
git add app/app.css tests/unit/home-curation-ui-contract.test.ts
git commit -m "2026-08-11 홈 큐레이션 지도 반응형 디자인"
```

---

### Task 9: 브라우저 흐름·회귀·시각 검수

**Files:**
- Create: `tests/e2e/home-curation-map.spec.ts`
- Create: `scripts/seed-home-curation-qa.sql`
- Modify: `playwright.config.ts`
- Create: `docs/evidence/2026-08-11-home-curation-desktop.png`
- Create: `docs/evidence/2026-08-11-home-curation-mobile.png`

**Interfaces:**
- Consumes: local D1 seed, `?qa=1` map fallback, public home route
- Produces: desktop/mobile behavioral and visual evidence

- [ ] **Step 1: 데스크톱·모바일 E2E 실패 테스트 작성**

```ts
test.beforeEach(() => {
  test.skip(Boolean(process.env.BASE_URL), "홈 큐레이션 장소는 로컬 전용 합성 fixture입니다.");
});

test("기본 홈은 추천 5곳만 번호 마커로 보여주고 전체 탐색으로 전환한다", async ({ page }) => {
  await page.goto("/?qa=1&view=curated");
  await expect(page.getByRole("heading", { name: "지금 갈 만한 5곳" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /1번 .* 추천 지도 핀/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /6번 .* 추천 지도 핀/ })).toHaveCount(0);
  if (process.env.HOME_CURATION_EVIDENCE === "1") {
    const mobile = (page.viewportSize()?.width ?? 0) <= 760;
    await page.screenshot({ path: mobile ? "docs/evidence/2026-08-11-home-curation-mobile.png" : "docs/evidence/2026-08-11-home-curation-desktop.png", fullPage: true });
  }
  await page.getByRole("button", { name: "전체 장소 보기" }).first().click();
  await expect(page.getByRole("complementary", { name: "장소 탐색" })).toBeVisible();
});

test("추천 모드와 카드·마커 선택을 새로고침 없이 동기화한다", async ({ page }) => {
  await page.goto("/?qa=1&view=curated");
  await page.getByRole("button", { name: "새로운 맛" }).first().click();
  await expect(page).toHaveURL(/mode=discovery/);
  const firstCard = page.locator("[data-home-curation-card]").first();
  await firstCard.click();
  await expect(page.locator(".map-pin--curated.is-selected")).toHaveCount(1);
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm exec playwright test tests/e2e/home-curation-map.spec.ts --project=chromium --project=mobile-chromium`

Expected: focused E2E fails before the complete home behavior is wired.

- [ ] **Step 3: 로컬 전용 E2E fixture와 누락 동작 최소 수정**

Create `scripts/seed-home-curation-qa.sql` that deletes only IDs prefixed `e2e-home-`, then inserts six published places within 1km of `(35.1595, 126.8526)` across the four existing categories and six distinct neighborhoods. Insert current `rating-config-v2` snapshots with scores 76–92 and sample count 20, one active Golden Pick by `qa-active-reviewer`, plus a seventh `e2e-home-low` place with score 40/sample 20. Add `pnpm exec wrangler d1 execute DB --local --file scripts/seed-home-curation-qa.sql` to the end of the existing Playwright `webServer.command`. The E2E must assert exactly five numbered pins and that `e2e-home-low` is absent. Never run this fixture against remote D1.

```sql
DELETE FROM golden_pick_events WHERE id LIKE 'e2e-home-%';
DELETE FROM rating_snapshots WHERE id LIKE 'e2e-home-%';
DELETE FROM place_categories WHERE place_id LIKE 'e2e-home-%';
DELETE FROM places WHERE id LIKE 'e2e-home-%';

INSERT INTO places (id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES
('e2e-home-1','e2e-home-1','E2E 지금 국밥','PUBLISHED','광주광역시 QA로 1','지금동',35.1595,126.8526,'국밥 백반','2026-08-11T00:00:00Z','2026-08-11T00:00:00Z'),
('e2e-home-2','e2e-home-2','E2E 취향 라멘','PUBLISHED','광주광역시 QA로 2','취향동',35.1605,126.8536,'라멘 면','2026-08-11T00:00:00Z','2026-08-11T00:00:00Z'),
('e2e-home-3','e2e-home-3','E2E 시간 돈가스','PUBLISHED','광주광역시 QA로 3','시간동',35.1585,126.8516,'돈가스 점심','2026-08-11T00:00:00Z','2026-08-11T00:00:00Z'),
('e2e-home-4','e2e-home-4','E2E 신뢰 베이커리','PUBLISHED','광주광역시 QA로 4','신뢰동',35.1615,126.8546,'베이커리 빵','2026-08-11T00:00:00Z','2026-08-11T00:00:00Z'),
('e2e-home-5','e2e-home-5','E2E 발견 국밥','PUBLISHED','광주광역시 QA로 5','발견동',35.1575,126.8506,'해장국 새로운 메뉴','2026-08-11T00:00:00Z','2026-08-11T00:00:00Z'),
('e2e-home-6','e2e-home-6','E2E 발견 라멘','PUBLISHED','광주광역시 QA로 6','골목동',35.1625,126.8556,'소바 새로운 메뉴','2026-08-11T00:00:00Z','2026-08-11T00:00:00Z'),
('e2e-home-low','e2e-home-low','E2E 제외 저점','PUBLISHED','광주광역시 QA로 7','제외동',35.1565,126.8496,'국밥','2026-08-11T00:00:00Z','2026-08-11T00:00:00Z');

INSERT INTO place_categories (place_id,category_id,is_primary) VALUES
('e2e-home-1','cat-gukbap',1),('e2e-home-2','cat-ramen',1),('e2e-home-3','cat-donkatsu',1),
('e2e-home-4','cat-bakery',1),('e2e-home-5','cat-gukbap',1),('e2e-home-6','cat-ramen',1),('e2e-home-low','cat-gukbap',1);

INSERT INTO rating_snapshots (id,place_id,config_id,input_hash,overall_score,user_score,reviewer_score,overall_sample_count,user_sample_count,reviewer_sample_count,reviewer_raw_weight,reviewer_combined_weight,reviewer_weight_share,reasons_json,is_stale,computed_at,created_at,updated_at) VALUES
('e2e-home-s1','e2e-home-1','rating-config-v2','e2e-home-1',92,91,94,20,15,5,5,5,.25,'{}',0,'2026-08-11T00:00:00Z','2026-08-11T00:00:00Z','2026-08-11T00:00:00Z'),
('e2e-home-s2','e2e-home-2','rating-config-v2','e2e-home-2',88,87,90,20,15,5,5,5,.25,'{}',0,'2026-08-11T00:00:00Z','2026-08-11T00:00:00Z','2026-08-11T00:00:00Z'),
('e2e-home-s3','e2e-home-3','rating-config-v2','e2e-home-3',84,83,86,20,15,5,5,5,.25,'{}',0,'2026-08-11T00:00:00Z','2026-08-11T00:00:00Z','2026-08-11T00:00:00Z'),
('e2e-home-s4','e2e-home-4','rating-config-v2','e2e-home-4',82,81,84,20,15,5,5,5,.25,'{}',0,'2026-08-11T00:00:00Z','2026-08-11T00:00:00Z','2026-08-11T00:00:00Z'),
('e2e-home-s5','e2e-home-5','rating-config-v2','e2e-home-5',79,78,81,20,15,5,5,5,.25,'{}',0,'2026-08-11T00:00:00Z','2026-08-11T00:00:00Z','2026-08-11T00:00:00Z'),
('e2e-home-s6','e2e-home-6','rating-config-v2','e2e-home-6',76,75,78,20,15,5,5,5,.25,'{}',0,'2026-08-11T00:00:00Z','2026-08-11T00:00:00Z','2026-08-11T00:00:00Z'),
('e2e-home-s-low','e2e-home-low','rating-config-v2','e2e-home-low',40,40,40,20,15,5,5,5,.25,'{}',0,'2026-08-11T00:00:00Z','2026-08-11T00:00:00Z','2026-08-11T00:00:00Z');

INSERT INTO golden_pick_events (id,reviewer_user_id,place_id,event_type,previous_event_id,reason,effective_at,expires_at,created_at)
VALUES ('e2e-home-golden','qa-active-reviewer','e2e-home-4','GRANT',NULL,'HOME_CURATION_QA','2026-08-11T00:00:00Z','2027-08-11T00:00:00Z','2026-08-11T00:00:00Z');
```

- [ ] **Step 4: focused desktop/mobile E2E 통과 확인**

Run: `pnpm exec playwright test tests/e2e/home-curation-map.spec.ts --project=chromium --project=mobile-chromium`

Expected: both projects passed with no retry-only success.

- [ ] **Step 5: 데스크톱·모바일 캡처와 직접 검수**

Capture both configured projects from the deterministic QA fixture:

```bash
HOME_CURATION_EVIDENCE=1 pnpm exec playwright test tests/e2e/home-curation-map.spec.ts --project=chromium --project=mobile-chromium
```

Verify:

- 데스크톱 지도와 추천 패널이 겹치지 않는다.
- 모바일 첫 진입 시 지도와 중간 높이 시트가 동시에 보인다.
- H1/H2 위계, 모드 버튼, 1..5 마커가 선명하다.
- 가로 스크롤과 잘린 버튼이 없다.
- Golden Pick 대체 장소에 Golden 배지가 없다.

- [ ] **Step 6: 전체 검증**

Run: `pnpm test`

Expected: all unit suites passed.

Run: `pnpm run test:integration`

Expected: all Workers integration suites passed.

Run: `pnpm run typecheck`

Expected: exit 0.

Run: `pnpm run build`

Expected: exit 0.

Run: `git diff --check`

Expected: no output.

- [ ] **Step 7: 증거와 E2E 커밋**

```bash
git add tests/e2e/home-curation-map.spec.ts scripts/seed-home-curation-qa.sql playwright.config.ts docs/evidence/2026-08-11-home-curation-desktop.png docs/evidence/2026-08-11-home-curation-mobile.png
git commit -m "2026-08-11 홈 큐레이션 지도 브라우저 검증"
```

---

## 완료 및 PR 체크리스트

- [ ] 최신 `origin/main`을 반영하고 충돌 해결 후 전체 검증을 다시 실행한다.
- [ ] PR 본문에 Issue #80, 변경 범위, 검증 결과, 운영 영향, 남은 위험을 기록한다.
- [ ] 데스크톱·모바일 증거 파일을 PR에 연결한다.
- [ ] migration·환경 변수·원격 데이터 변경이 없음을 기록한다.
- [ ] PR은 Draft로 생성하고 독립적인 사람의 승인 전에는 병합하지 않는다.
- [ ] 승인·checks 통과 후에만 squash merge하고 병합된 main에서 배포한다.
