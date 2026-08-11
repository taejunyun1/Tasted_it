# 홈 추천 알고리즘 Phase 1·2 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈 큐레이션 지도에서 거리가 1순위를 사실상 고정하는 현상을 제거하고, 취향·시간대·평가 신뢰도·새로운 발견·최근 노출을 모드별로 균형 있게 반영하는 결정론적 추천 5곳을 제공한다.

**Architecture:** 기존 추천 후보 조회와 UI 계약은 유지하되 순수 계산을 `features`와 `ranking` 모듈로 분리한다. 서버는 8km 이내 최대 500곳을 한 번 조회해 품질·비추천·Golden 이력을 붙이고, 3/5/8km 후보 밀도에 따라 반경을 결정한다. 브라우저 탭 단위의 제한된 추천 이력은 `sessionStorage`에만 저장해 요청에 전달하며, 서버는 MMR 다양성·최근 1위 페널티·안정적인 일일 변동값으로 5곳을 선택한다.

**Tech Stack:** React Router 8, React 19, TypeScript, Cloudflare Workers, D1/Drizzle ORM, Naver Maps SDK, Vitest, Cloudflare Workers Vitest, Playwright

## Global Constraints

- 공개·활성 장소만 후보로 사용하고 기존 체인점·승인 불가·운영 정책 제외 조건을 우회하지 않는다.
- 표본 8개 이상이면서 공개 추천 점수가 55점 미만인 장소는 제외한다. 표본이 적은 장소는 배제하지 않되 신뢰도 점수를 낮춘다.
- 로그인 사용자의 현재 비추천(`current_votes.value = -1`) 장소는 후보에서 제외한다.
- 후보는 추천 중심 기준 8km, 최대 500곳만 읽고 3km 20곳 이상 → 3km, 아니면 5km 20곳 이상 → 5km, 아니면 8km 순으로 확장한다.
- Golden 모드는 활성 Golden Pick을 우선하고, 부족한 자리만 과거 Golden 또는 평가 근거가 있는 장소로 채운다. 활성 Golden이 0곳이면 일반 근거리 후보로 채우지 않는다.
- 세션 이력은 `sessionStorage`만 사용하고 사용자 ID·좌표·검색어·이메일 등 개인정보를 포함하지 않는다.
- 요청 이력은 `recentFirst` 최대 3개, `recentShown` 최대 30개, `previousIds` 최대 5개로 제한한다. 잘못된 이력은 400이 아니라 빈 이력으로 처리한다.
- 최초 SSR 결과는 자동 hydration 재랭킹하지 않는다. 모드 변경·내 위치·이 지역 다시 추천·재시도 같은 사용자 동작 이후부터 이력을 전송한다.
- 추천 이유는 실제 점수 기여를 근거로 최대 2개만 제공하며 LLM 또는 임의 문구를 사용하지 않는다.
- 신규 migration, 신규 환경 변수, 외부 API, Workers AI, 원격 D1 변경은 없다.
- 브랜치 `tj_home-curation-v2`, 이슈 `#82`, 전용 worktree에서만 작업한다.

## Public Contracts

```ts
export type HomeLocationSource = "gps" | "map_center";

export type HomeRecommendationHistory = {
  sessionSeed: string;
  recentFirst: string[];
  recentShown: Array<{ placeId: string; count: number }>;
  previousMode: HomeCurationMode | null;
  previousIds: string[];
};

export type HomeCurationPage = {
  algorithmVersion: "home-curation-v2";
  status: "READY" | "EMPTY";
  places: HomeCuratedPlace[];
  mode: HomeCurationMode;
  timeSlot: HomeTimeSlot;
  radiusMeters: 3_000 | 5_000 | 8_000;
  candidateCount: number;
  goldenFallback: boolean;
  notice: string | null;
};
```

## File Map

- Create: `app/features/places/home-curation-history.client.ts`
- Create: `app/features/places/home-curation-features.ts`
- Create: `app/features/places/home-curation-ranking.ts`
- Modify: `app/features/maps/home-curation-options.ts`
- Modify: `app/features/places/home-curation.ts`
- Modify: `app/features/places/home-curation.server.ts`
- Modify: `app/features/places/place-discovery.ts`
- Modify: `app/features/places/recommendation-candidates.server.ts`
- Modify: `app/features/ratings/golden-pick.server.ts`
- Modify: `app/routes/home-recommendations-resource.tsx`
- Modify: `app/routes/home.tsx`
- Modify: `app/components/map/HomeCurationCards.tsx`
- Modify: `app/components/map/HomeCurationPanel.tsx`
- Modify: `app/components/map/HomeCurationSheet.tsx`
- Modify: `tests/unit/home-curation-options.test.ts`
- Create: `tests/unit/home-curation-history.test.ts`
- Create: `tests/unit/home-curation-features.test.ts`
- Create: `tests/unit/home-curation-ranking.test.ts`
- Modify: `tests/unit/home-curation.test.ts`
- Modify: `tests/unit/home-curation-route.test.ts`
- Modify: `tests/unit/home-recommendations-resource.test.ts`
- Modify: `tests/unit/home-curation-components.test.ts`
- Modify: `tests/integration/home-curation.server.test.ts`
- Modify: `tests/e2e/home-curation.spec.ts`

---

### Task 1: 세션 이력과 요청 파서 계약

**Files:**
- Create: `app/features/places/home-curation-history.client.ts`
- Modify: `app/features/maps/home-curation-options.ts`
- Create: `tests/unit/home-curation-history.test.ts`
- Modify: `tests/unit/home-curation-options.test.ts`

**Interfaces:**
- Produces: `emptyHomeRecommendationHistory()`, `readHomeRecommendationHistory(storage)`, `recordHomeRecommendation(storage, page)`, `encodeHomeRecommendationHistory(history)`, `decodeHomeRecommendationHistory(raw)`, `HomeLocationSource`
- Consumes: `Storage`, `HomeCurationPage`, `URLSearchParams`

- [ ] **Step 1: 실패 테스트 작성**

```ts
it("세션 이력을 정해진 최대 크기로 잘라 base64url로 왕복한다", () => {
  const history = decodeHomeRecommendationHistory(encodeHomeRecommendationHistory({
    sessionSeed: "seed-1",
    recentFirst: ["p1", "p2", "p3", "p4"],
    recentShown: Array.from({ length: 40 }, (_, index) => ({ placeId: `p${index}`, count: index + 1 })),
    previousMode: "taste",
    previousIds: ["p1", "p2", "p3", "p4", "p5", "p6"],
  }));
  expect(history.recentFirst).toHaveLength(3);
  expect(history.recentShown).toHaveLength(30);
  expect(history.previousIds).toHaveLength(5);
});

it("손상된 이력은 요청 실패 대신 빈 이력로 처리한다", () => {
  expect(decodeHomeRecommendationHistory("not-base64-json")).toEqual(expect.objectContaining({
    recentFirst: [], recentShown: [], previousIds: [], previousMode: null,
  }));
});

it("locationSource만 허용하고 history는 손상돼도 요청을 보존한다", () => {
  expect(parseHomeRecommendationRequest(new URL("https://x.test/r?mode=now&locationSource=gps&history=bad")))
    .toEqual(expect.objectContaining({ locationSource: "gps", history: expect.objectContaining({ recentFirst: [] }) }));
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run tests/unit/home-curation-history.test.ts tests/unit/home-curation-options.test.ts`

Expected: FAIL because the client history module and extended parser do not exist.

- [ ] **Step 3: 최소 구현**

```ts
const HISTORY_KEY = "retaste:home-curation-v2";

export function normalizeHomeRecommendationHistory(input: unknown): HomeRecommendationHistory {
  const value = isRecord(input) ? input : {};
  return {
    sessionSeed: safeToken(value.sessionSeed) ?? crypto.randomUUID(),
    recentFirst: safeIds(value.recentFirst, 3),
    recentShown: safeShown(value.recentShown).slice(0, 30),
    previousMode: isHomeCurationMode(value.previousMode) ? value.previousMode : null,
    previousIds: safeIds(value.previousIds, 5),
  };
}

export function recordHomeRecommendation(storage: Storage, page: HomeCurationPage) {
  const current = readHomeRecommendationHistory(storage);
  const ids = page.places.slice(0, 5).map((place) => place.id);
  const counts = new Map(current.recentShown.map((item) => [item.placeId, item.count]));
  ids.forEach((id) => counts.set(id, Math.min(9, (counts.get(id) ?? 0) + 1)));
  write(storage, {
    ...current,
    recentFirst: ids[0] ? [ids[0], ...current.recentFirst.filter((id) => id !== ids[0])].slice(0, 3) : current.recentFirst,
    recentShown: [...counts].map(([placeId, count]) => ({ placeId, count })).slice(-30),
    previousMode: page.mode,
    previousIds: ids,
  });
}
```

`home-curation-options.ts`에서 기존 허용 쿼리 키에 `history`, `locationSource`를 추가하고 `locationSource`는 `gps | map_center` 외 값을 거부한다. `history` 디코딩 실패는 빈 이력을 반환한다. 기존 알 수 없는 쿼리 키 거부는 유지한다.

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run tests/unit/home-curation-history.test.ts tests/unit/home-curation-options.test.ts`

Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add app/features/places/home-curation-history.client.ts app/features/maps/home-curation-options.ts tests/unit/home-curation-history.test.ts tests/unit/home-curation-options.test.ts
git commit -m "2026-08-11 홈 추천 세션 이력 계약"
```

---

### Task 2: 점수 특징 순수 함수

**Files:**
- Create: `app/features/places/home-curation-features.ts`
- Create: `tests/unit/home-curation-features.test.ts`

**Interfaces:**
- Produces: `distanceBandScore`, `confidenceScore`, `aggregateTasteScore`, `timeCompatibilityScore`, `discoveryScore`, `freshnessScore`, `firstRankPenalty`, `deterministicVariation`, `buildHomeCandidateFeatures`
- Consumes: `DiscoveryPlace`, `RankingTasteSignal`, `HomeTimeSlot`, `HomeRecommendationHistory`

- [ ] **Step 1: 정확한 경계값 실패 테스트 작성**

```ts
it.each([[500, 1], [501, .95], [1_001, .85], [2_001, .72], [3_001, .55], [5_001, .35], [8_001, .15]])(
  "거리 %im 점수는 %f다", (meters, expected) => expect(distanceBandScore(meters)).toBe(expected),
);

it("신뢰도는 표본 로그 완화와 무표본 하한을 사용한다", () => {
  expect(confidenceScore(null, 0)).toBe(.35);
  expect(confidenceScore(80, 30)).toBeCloseTo(.8, 5);
  expect(confidenceScore(80, 1)).toBeLessThan(confidenceScore(80, 30));
});

it("직접·인접 취향을 중복 없이 지수 포화한다", () => {
  expect(aggregateTasteScore([{ badgeId: "gukbap", strength: 1, match: "DIRECT" }])).toBeCloseTo(1 - Math.exp(-1));
  expect(aggregateTasteScore([
    { badgeId: "gukbap", strength: 1, match: "DIRECT" },
    { badgeId: "gukbap", strength: 1, match: "ADJACENT" },
  ])).toBeCloseTo(1 - Math.exp(-1));
});

it.each([[0, 1], [1, .8], [2, .55], [3, .3], [9, .3]])("노출 %i회 freshness", (count, expected) => {
  expect(freshnessScore(count)).toBe(expected);
});

it("최근 1위 페널티는 가장 심한 값 하나만 적용한다", () => {
  expect(firstRankPenalty("p1", ["p1", "p1", "p1"])).toBe(-.30);
});

it("변동값은 같은 날짜·세션·모드·500m 위치에서 안정적이다", () => {
  const a = deterministicVariation({ sessionSeed: "s", dateKey: "2026-08-11", mode: "now", center: centerA, placeId: "p" });
  const b = deterministicVariation({ sessionSeed: "s", dateKey: "2026-08-11", mode: "now", center: centerBWithin500m, placeId: "p" });
  expect(a).toBe(b);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(a).toBeLessThanOrEqual(.05);
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run tests/unit/home-curation-features.test.ts`

Expected: FAIL with missing module.

- [ ] **Step 3: 공식 그대로 구현**

```ts
export function distanceBandScore(meters: number) {
  if (meters <= 500) return 1;
  if (meters <= 1_000) return .95;
  if (meters <= 2_000) return .85;
  if (meters <= 3_000) return .72;
  if (meters <= 5_000) return .55;
  if (meters <= 8_000) return .35;
  return .15;
}

export function confidenceScore(score: number | null, samples: number) {
  if (samples <= 0 || score == null) return .35;
  const sampleConfidence = Math.min(1, Math.log1p(samples) / Math.log(31));
  return score / 100 * (.45 + .55 * sampleConfidence);
}

export function aggregateTasteScore(matches: TasteMatch[]) {
  const strongest = new Map<string, number>();
  for (const match of matches) {
    const weighted = match.strength * (match.match === "DIRECT" ? 1 : .6);
    strongest.set(match.badgeId, Math.max(strongest.get(match.badgeId) ?? 0, weighted));
  }
  return Math.min(1, 1 - Math.exp(-[...strongest.values()].reduce((sum, value) => sum + value, 0)));
}
```

`timeCompatibilityScore`는 강한 일치 `1`, 약한 일치 `.7`, 근거 없음 `.5`, 명백한 불일치 `.2`를 반환한다. `discoveryScore`는 강한 직접 `.20`, 약한 직접 `.35`, 인접 `.65`, 미일치 `.80`, 명시적 새로움 `1`이다. `firstRankPenalty`는 직전 `-.12`, 최근 2/3회 `-.18`, 3/3회 `-.30` 중 가장 큰 절댓값 하나만 반환한다. 변동값은 FNV-1a 계열 안정 해시를 `0...0.05`로 정규화하며 중심 좌표를 500m 셀로 양자화한다.

- [ ] **Step 4: 통과 및 기존 순수 테스트 확인**

Run: `pnpm vitest run tests/unit/home-curation-features.test.ts tests/unit/place-discovery.test.ts`

Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add app/features/places/home-curation-features.ts tests/unit/home-curation-features.test.ts
git commit -m "2026-08-11 홈 추천 특징 점수 고도화"
```

---

### Task 3: 모드 가중치·1위·MMR·Golden 랭킹

**Files:**
- Create: `app/features/places/home-curation-ranking.ts`
- Modify: `app/features/places/home-curation.ts`
- Create: `tests/unit/home-curation-ranking.test.ts`
- Modify: `tests/unit/home-curation.test.ts`

**Interfaces:**
- Produces: `rankHomeCandidates(input)`, `rankGoldenCandidates(input)`, `HomeCandidateFeatures`, `HomeRankedCandidate`
- `home-curation.ts`는 기존 호출자용 `rankHomeCuration(input)` facade와 공개 타입만 유지한다.

- [ ] **Step 1: 랭킹 실패 테스트 작성**

```ts
it("거리만 가까운 장소보다 현재 모드 핵심 점수가 높은 장소를 1위로 둔다", () => {
  const result = rankHomeCandidates(input({ mode: "taste", candidates: [nearWeakTaste, fartherStrongTaste] }));
  expect(result[0].place.id).toBe("farther-strong-taste");
});

it("2~5위는 같은 카테고리·세부 유형·500m 군집·같은 이유를 MMR로 분산한다", () => {
  const result = rankHomeCandidates(input({ candidates: diversityFixture }));
  expect(result.slice(0, 5).map((item) => item.place.id)).toEqual(["a", "d", "f", "b", "e"]);
});

it("모드를 실제 변경했고 겹침이 4곳 이상이면 2곳 이상 바꾼다", () => {
  const result = rankHomeCandidates(input({ mode: "time", previousMode: "taste", previousIds: ["a", "b", "c", "d", "e"] }));
  expect(result.filter((item) => ["a", "b", "c", "d", "e"].includes(item.place.id))).toHaveLength(3);
});

it("Golden 활성 후보가 없으면 근거리 일반 장소를 섞지 않고 평가 근거 후보만 반환한다", () => {
  const result = rankGoldenCandidates(input({ candidates: [generalNearby, pastGolden, reviewerTrusted], activeGoldenIds: [] }));
  expect(result.places.map((item) => item.place.id)).toEqual(expect.arrayContaining(["past", "reviewer"]));
  expect(result.places.some((item) => item.place.id === "general")).toBe(false);
  expect(result.notice).toBe("현재 주변 Golden Pick이 없어 과거 선정 이력과 평가 기록을 바탕으로 추천합니다.");
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run tests/unit/home-curation-ranking.test.ts tests/unit/home-curation.test.ts`

Expected: FAIL because the v2 ranking module and behavior are absent.

- [ ] **Step 3: 가중치와 MMR 구현**

```ts
const MODE_WEIGHTS = {
  now:       { taste: .25, distance: .20, time: .25, confidence: .15, discovery: .10, freshness: .05 },
  taste:     { taste: .45, distance: .12, time: .08, confidence: .15, discovery: .12, freshness: .08 },
  time:      { taste: .18, distance: .17, time: .40, confidence: .10, discovery: .08, freshness: .07 },
  discovery: { taste: .10, distance: .12, time: .05, confidence: .15, discovery: .40, freshness: .18 },
} as const;

function mmrAdjustment(candidate: HomeRankedCandidate, selected: HomeRankedCandidate[]) {
  let adjustment = candidate.features.freshness * .05;
  if (selected.some((item) => item.categoryKey === candidate.categoryKey)) adjustment -= .12;
  if (selected.some((item) => item.detailTypeKey === candidate.detailTypeKey)) adjustment -= .10;
  if (selected.some((item) => distanceBetween(item.place, candidate.place) <= 500)) adjustment -= .08;
  if (selected.some((item) => item.primaryReason === candidate.primaryReason)) adjustment -= .08;
  if (candidate.reviewerId && selected.some((item) => item.reviewerId === candidate.reviewerId)) adjustment -= .08;
  return adjustment;
}
```

1위는 `weightedScore + firstRankPenalty + variation`으로 고르고, 2~5위는 남은 후보마다 `weightedScore + mmrAdjustment`를 다시 계산한다. 동점은 freshness → 모드 핵심 특징 → variation → place ID 안정 해시 순으로 푼다. `detailTypeKey`는 가장 강한 직접 배지, 인접 배지, 대표 카테고리 slug 순이다.

Golden은 활성 후보를 아래 점수로 먼저 정렬한다.

```ts
goldenScore = golden * .55 + confidence * .18 + taste * .10 + distance * .07 + time * .03 + freshness * .07;
fallbackScore = pastGolden * .35 + reviewerConfidence * .35 + confidence * .20 + freshness * .10;
```

활성 후보가 5곳 미만일 때만 fallback으로 남은 자리를 채운다. 과거 Golden은 `.4`, 14일 이내 만료 예정 활성 Golden의 보조 강도는 `.8`, 정상 활성은 `1`, 회수·무관 후보는 `0`이다. Golden 결과가 5곳 미만이면 그대로 반환한다.

- [ ] **Step 4: facade와 이유 문구 연결**

`rankHomeCuration`은 특징 계산 → 일반/Golden 랭킹 → `HomeCuratedPlace` 변환만 담당한다. 이유는 실제 상위 기여 1~2개만 선택하고 거리 이유는 `locationSource`에 따라 다음 둘 중 하나를 사용한다.

```ts
const DISTANCE_REASON = {
  gps: "현재 위치에서 가까워요",
  map_center: "현재 보고 있는 지역에서 가까워요",
} as const;
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm vitest run tests/unit/home-curation-features.test.ts tests/unit/home-curation-ranking.test.ts tests/unit/home-curation.test.ts`

Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add app/features/places/home-curation-ranking.ts app/features/places/home-curation.ts tests/unit/home-curation-ranking.test.ts tests/unit/home-curation.test.ts
git commit -m "2026-08-11 홈 추천 MMR 랭킹 고도화"
```

---

### Task 4: 후보 평가·비추천·Golden 이력 D1 조립

**Files:**
- Modify: `app/features/places/place-discovery.ts`
- Modify: `app/features/places/recommendation-candidates.server.ts`
- Modify: `app/features/ratings/golden-pick.server.ts`
- Modify: `tests/integration/golden-pick.server.test.ts`
- Modify: `tests/integration/home-curation.server.test.ts`

**Interfaces:**
- Extend `DiscoveryPlace`: `userRatingScore`, `userRatingSampleCount`, `reviewerRatingScore`, `reviewerRatingSampleCount`
- Produces: `listGoldenPickHistoryForPlaces(db, placeIds, now)`, `loadRecommendationCandidateContext(db, input)` with `dislikedPlaceIds` and per-place Golden summaries.

- [ ] **Step 1: Workers 통합 실패 테스트 작성**

```ts
it("로그인 사용자의 현재 비추천 장소를 후보에서 제외한다", async () => {
  await seedVote({ placeId: "disliked", userId: "u1", value: -1 });
  const context = await loadRecommendationCandidateContext(db, request({ userId: "u1" }));
  expect(context.candidates.some((place) => place.id === "disliked")).toBe(false);
});

it("평가 스냅샷의 전체·사용자·리뷰어 점수와 표본을 모두 붙인다", async () => {
  const context = await loadRecommendationCandidateContext(db, request());
  expect(context.candidates[0]).toEqual(expect.objectContaining({
    ratingSampleCount: 12,
    userRatingSampleCount: 4,
    reviewerRatingSampleCount: 8,
  }));
});

it("요청 후보 ID만 청크로 Golden 이력을 조회한다", async () => {
  const history = await listGoldenPickHistoryForPlaces(db, ["p1", "p2"], now);
  expect([...history.keys()]).toEqual(["p1", "p2"]);
  expect(history.has("outside-candidate")).toBe(false);
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run --config vitest.integration.config.ts tests/integration/golden-pick.server.test.ts tests/integration/home-curation.server.test.ts`

Expected: FAIL because sample counts, dislike exclusion, and candidate-scoped Golden history are absent.

- [ ] **Step 3: 후보 데이터 확장**

`recommendation-candidates.server.ts`에서 현재 rating snapshot의 여섯 필드를 모두 attach한다. 로그인 사용자일 때만 `currentVotes`를 `userId + value=-1 + candidate placeIds`로 조회하고 해당 ID를 제거한다. candidate ID 배열은 D1 바인딩 한도를 넘지 않도록 기존 프로젝트 청크 유틸 또는 80개 청크를 사용한다.

```ts
export type GoldenPlaceSummary = {
  placeId: string;
  active: boolean;
  activeStrength: 0 | .8 | 1;
  pastStrength: 0 | .4;
  reviewerUserId: string | null;
};
```

`listGoldenPickHistoryForPlaces`는 후보 ID 청크마다 `goldenPickEvents`를 읽고 `GRANT`의 `expiresAt`, `WITHDRAW/EXPIRE.previousEventId`를 결합해 위 요약을 만든다. 전체 Golden 테이블을 읽는 기존 `listActiveGoldenPicks` 호출은 홈 경로에서 제거하되 다른 호출자는 보존한다.

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run --config vitest.integration.config.ts tests/integration/golden-pick.server.test.ts tests/integration/home-curation.server.test.ts`

Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add app/features/places/place-discovery.ts app/features/places/recommendation-candidates.server.ts app/features/ratings/golden-pick.server.ts tests/integration/golden-pick.server.test.ts tests/integration/home-curation.server.test.ts
git commit -m "2026-08-11 홈 추천 후보 신뢰 데이터 확장"
```

---

### Task 5: 3·5·8km 후보 밀도와 서버 응답 v2

**Files:**
- Modify: `app/features/places/home-curation.server.ts`
- Modify: `tests/integration/home-curation.server.test.ts`

**Interfaces:**
- `HomeCurationRequest` adds `history`, `locationSource`
- `HomeCurationPage` adds `algorithmVersion`, `candidateCount`, `goldenFallback`, `notice`; radius union adds `8_000`.

- [ ] **Step 1: 반경·품질 실패 테스트 작성**

```ts
it.each([
  [21, 0, 0, 3_000],
  [10, 12, 0, 5_000],
  [10, 8, 7, 8_000],
])("3/5/8km 후보 밀도로 반경을 결정한다", async (within3, within5Extra, within8Extra, expected) => {
  await seedConcentricCandidates({ within3, within5Extra, within8Extra });
  const page = await getHomeCurationPage(db, request());
  expect(page.radiusMeters).toBe(expected);
});

it("8km에도 20곳 미만이면 존재하는 품질 후보만 사용한다", async () => {
  await seedConcentricCandidates({ within3: 3, within5Extra: 2, within8Extra: 1 });
  const page = await getHomeCurationPage(db, request());
  expect(page.radiusMeters).toBe(8_000);
  expect(page.candidateCount).toBe(6);
});

it("v2 메타데이터와 Golden fallback notice를 반환한다", async () => {
  const page = await getHomeCurationPage(db, request({ mode: "golden" }));
  expect(page).toEqual(expect.objectContaining({
    algorithmVersion: "home-curation-v2",
    goldenFallback: true,
    notice: "현재 주변 Golden Pick이 없어 과거 선정 이력과 평가 기록을 바탕으로 추천합니다.",
  }));
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run --config vitest.integration.config.ts tests/integration/home-curation.server.test.ts`

Expected: FAIL because the server supports only 3/5km and old metadata.

- [ ] **Step 3: 단일 8km 조회와 반경 결정 구현**

```ts
const qualityCandidates = context.candidates
  .map(attachDistance)
  .filter(passesHomeQuality)
  .filter((place) => place.distanceMeters <= 8_000);

const radiusMeters = qualityCandidates.filter(within(3_000)).length >= 20 ? 3_000
  : qualityCandidates.filter(within(5_000)).length >= 20 ? 5_000
  : 8_000;

const candidates = qualityCandidates.filter(within(radiusMeters));
const ranked = rankHomeCuration({ ...input, places: candidates, goldenSummaries: context.goldenSummaries });
```

입력 bbox를 그대로 신뢰하지 말고 `center` 기준 8km bbox를 서버에서 계산해 후보 서비스에 전달한다. 최대 500개 제한은 유지한다. `candidateCount`는 품질·비추천·반경 적용 뒤 랭킹 직전 후보 수다.

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run --config vitest.integration.config.ts tests/integration/home-curation.server.test.ts`

Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add app/features/places/home-curation.server.ts tests/integration/home-curation.server.test.ts
git commit -m "2026-08-11 홈 추천 반경과 응답 v2"
```

---

### Task 6: 리소스 요청과 브라우저 세션 이력 연결

**Files:**
- Modify: `app/routes/home-recommendations-resource.tsx`
- Modify: `app/routes/home.tsx`
- Modify: `tests/unit/home-recommendations-resource.test.ts`
- Modify: `tests/unit/home-curation-route.test.ts`

**Interfaces:**
- Resource GET accepts bounded `history` and `locationSource`.
- `home.tsx` sends history only after user action and records only successful responses.

- [ ] **Step 1: 계약 실패 테스트 작성**

```ts
it("resource loader가 history와 gps source를 서버 요청에 전달한다", async () => {
  await loader(args("?mode=taste&locationSource=gps&history=eyJzZXNzaW9uU2VlZCI6InMifQ"));
  expect(getHomeCurationPage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    locationSource: "gps",
    history: expect.objectContaining({ sessionSeed: "s" }),
  }));
});

it("모드 변경·위치·지역 재추천은 세션 이력을 붙이고 최초 hydration은 재요청하지 않는다", () => {
  const source = readFile("app/routes/home.tsx");
  expect(source).toContain("readHomeRecommendationHistory");
  expect(source).toContain("recordHomeRecommendation");
  expect(source).not.toMatch(/useEffect\([^]*loadRecommendations\([^]*initial/s);
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run tests/unit/home-recommendations-resource.test.ts tests/unit/home-curation-route.test.ts`

Expected: FAIL because request history/source wiring is absent.

- [ ] **Step 3: resource와 화면 구현**

```ts
function buildRecommendationUrl(mode: HomeCurationMode, bbox: Bbox, locationSource: HomeLocationSource) {
  const params = new URLSearchParams({
    mode,
    bbox: bbox.join(","),
    locationSource,
    history: encodeHomeRecommendationHistory(readHomeRecommendationHistory(sessionStorage)),
  });
  return `/resources/home-recommendations?${params}`;
}
```

`locate()` 성공 후 source는 `gps`, 지도 drag 후 `이 지역 다시 추천`은 `map_center`다. 모드 변경은 현재 source를 보존한다. fetcher가 `idle`이며 `data.algorithmVersion === "home-curation-v2"`이고 READY/EMPTY 정상 응답일 때 한 번만 `recordHomeRecommendation`한다. 같은 fetcher data를 재렌더할 때 중복 기록하지 않도록 마지막 기록 요청 key ref를 둔다.

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run tests/unit/home-recommendations-resource.test.ts tests/unit/home-curation-route.test.ts tests/unit/home-curation-history.test.ts`

Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add app/routes/home-recommendations-resource.tsx app/routes/home.tsx tests/unit/home-recommendations-resource.test.ts tests/unit/home-curation-route.test.ts
git commit -m "2026-08-11 홈 추천 세션 변동 연결"
```

---

### Task 7: 데스크톱·모바일 notice와 이유 UI

**Files:**
- Modify: `app/components/map/HomeCurationCards.tsx`
- Modify: `app/components/map/HomeCurationPanel.tsx`
- Modify: `app/components/map/HomeCurationSheet.tsx`
- Modify: `tests/unit/home-curation-components.test.ts`

**Interfaces:**
- Panel and Sheet receive `notice: string | null`, `candidateCount`, `radiusMeters`.
- Cards continue to render at most two server-provided reasons.

- [ ] **Step 1: 컴포넌트 계약 실패 테스트 작성**

```ts
it("Golden fallback 안내를 데스크톱 패널과 모바일 시트에 모두 전달한다", () => {
  const panel = renderToStaticMarkup(<HomeCurationPanel {...props} notice={NOTICE} />);
  const sheet = renderToStaticMarkup(<HomeCurationSheet {...props} notice={NOTICE} />);
  expect(panel).toContain(NOTICE);
  expect(sheet).toContain(NOTICE);
});

it("카드는 서버 근거를 최대 두 개만 표시한다", () => {
  const html = renderToStaticMarkup(<HomeCurationCards places={[fixture({ recommendationReasons: ["A", "B", "C"] })]} />);
  expect(html).toContain("A");
  expect(html).toContain("B");
  expect(html).not.toContain("C");
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run tests/unit/home-curation-components.test.ts`

Expected: FAIL because notice props/rendering are absent.

- [ ] **Step 3: 최소 UI 구현**

기존 디자인 토큰과 간격을 그대로 사용해 notice를 추천 제목 아래의 작은 안내 영역으로 표시한다. Golden 배지는 활성 Golden 결과에만 붙인다. fallback 결과에는 Golden 배지를 붙이지 않고 평가 근거 이유만 노출한다. 반경 footer는 `3km/5km/8km 안에서 추천`으로 동적으로 표시한다.

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run tests/unit/home-curation-components.test.ts tests/unit/home-curation-design.test.ts`

Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add app/components/map/HomeCurationCards.tsx app/components/map/HomeCurationPanel.tsx app/components/map/HomeCurationSheet.tsx tests/unit/home-curation-components.test.ts
git commit -m "2026-08-11 홈 추천 근거와 안내 UI"
```

---

### Task 8: 실제 브라우저 회귀와 모바일 동작

**Files:**
- Modify: `tests/e2e/home-curation.spec.ts`
- Create: `docs/evidence/2026-08-11-home-curation-v2-desktop.png`
- Create: `docs/evidence/2026-08-11-home-curation-v2-mobile.png`

- [ ] **Step 1: E2E 실패 시나리오 추가**

```ts
test("모드 변경은 최소 두 곳을 바꾸고 단순 UI 재렌더는 결과를 바꾸지 않는다", async ({ page }) => {
  await page.goto("/?view=curated");
  const nowIds = await recommendationIds(page);
  await page.getByRole("button", { name: "내 취향" }).click();
  const tasteIds = await recommendationIds(page);
  expect(nowIds.filter((id) => tasteIds.includes(id)).length).toBeLessThanOrEqual(3);
  await page.getByRole("button", { name: "추천 목록 접기" }).click();
  await page.getByRole("button", { name: "추천 목록 펼치기" }).click();
  expect(await recommendationIds(page)).toEqual(tasteIds);
});

test("Golden 활성 후보가 없으면 안내와 근거 후보만 보인다", async ({ page }) => {
  await page.goto("/?view=curated");
  await page.getByRole("button", { name: "Golden Pick" }).click();
  await expect(page.getByText("현재 주변 Golden Pick이 없어 과거 선정 이력과 평가 기록을 바탕으로 추천합니다.")).toBeVisible();
  await expect(page.locator('[data-golden-pick="true"]')).toHaveCount(0);
});
```

데스크톱과 모바일 프로젝트 모두에서 `지금 갈 만한 곳`, `내 취향`, `시간대 추천`, `Golden Pick`, `새로운 발견`, `내 위치`, `이 지역 다시 추천` 경로를 검증한다. 모바일에서는 바텀시트 안내와 카드 스크롤 후 지도 marker 선택 동기화를 확인한다.

- [ ] **Step 2: 관련 E2E 실패 확인**

Run: `pnpm run test:e2e tests/e2e/home-curation.spec.ts`

Expected: New v2 scenarios FAIL before final wiring fixes.

- [ ] **Step 3: 실패 원인만 최소 수정 후 재실행**

Run: `pnpm run test:e2e tests/e2e/home-curation.spec.ts`

Expected: Desktop and mobile home-curation scenarios PASS.

- [ ] **Step 4: 시각 증거 저장**

Playwright로 1440×1000 desktop과 390×844 mobile을 캡처해 다음 파일에 저장한다.

- `docs/evidence/2026-08-11-home-curation-v2-desktop.png`
- `docs/evidence/2026-08-11-home-curation-v2-mobile.png`

- [ ] **Step 5: 커밋**

```bash
git add tests/e2e/home-curation.spec.ts docs/evidence/2026-08-11-home-curation-v2-desktop.png docs/evidence/2026-08-11-home-curation-v2-mobile.png
git commit -m "2026-08-11 홈 추천 v2 브라우저 검증"
```

---

### Task 9: 전체 검증·코드리뷰·PR

**Files:**
- Modify only files required by findings from verification/review.

- [ ] **Step 1: 포맷·타입·빌드**

```bash
pnpm exec prettier --check app/features/maps/home-curation-options.ts app/features/places/home-curation*.ts app/features/places/recommendation-candidates.server.ts app/features/ratings/golden-pick.server.ts app/routes/home-recommendations-resource.tsx app/routes/home.tsx app/components/map/HomeCuration*.tsx tests/unit/home-curation*.test.ts tests/unit/home-recommendations-resource.test.ts tests/integration/home-curation.server.test.ts tests/e2e/home-curation.spec.ts
pnpm run typecheck
pnpm run build
```

Expected: all commands exit 0.

- [ ] **Step 2: 단위·Workers 통합 전체 검증**

```bash
pnpm test
pnpm vitest run --config vitest.integration.config.ts
```

Expected: all unit and Workers integration tests PASS. Any unrelated pre-existing failure must be reproduced on `origin/main` before classification.

- [ ] **Step 3: 관련 브라우저 검증**

```bash
pnpm run test:e2e tests/e2e/home-curation.spec.ts
```

Expected: desktop/mobile PASS. If the full suite is run, the known map baseline must be compared with `origin/main`; no new home-curation failure is acceptable.

- [ ] **Step 4: diff와 보안·개인정보 점검**

```bash
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git status --short
```

확인 항목:

- 이력 payload에 userId, 좌표, 이메일, 검색어가 없다.
- 잘못된 history는 빈 이력이고, 알 수 없는 쿼리 키는 기존처럼 거부된다.
- D1 후보/Golden/비추천 조회는 후보 ID 청크와 최대 500곳 경계를 지킨다.
- Golden fallback은 일반 근거리 장소를 섞지 않는다.
- 최초 SSR hydration 자동 재랭킹이 없다.
- 다른 작업자의 파일과 `.pnpm-store/`를 포함한 무관 변경을 커밋하지 않는다.

- [ ] **Step 5: 독립 코드리뷰 요청 및 지적 수정**

Use `superpowers:requesting-code-review` against `origin/main...HEAD`. P0/P1과 재현 가능한 P2를 수정하고, 수정 뒤 Step 1~4를 다시 실행한다.

- [ ] **Step 6: 최종 커밋**

```bash
git add -u
git commit -m "2026-08-11 홈 추천 v2 검증 보완"
```

수정 파일이 없으면 빈 커밋을 만들지 않는다.

- [ ] **Step 7: feature branch push와 PR 생성**

```bash
git push -u origin tj_home-curation-v2
gh pr create --base main --head tj_home-curation-v2 --title "홈 추천 알고리즘 Phase 1·2 고도화" --body-file /tmp/home-curation-v2-pr.md
```

PR 본문에는 이슈 `#82`, 3/5/8km 후보 정책, 모드별 가중치, Golden fallback, 세션 이력 개인정보 경계, 테스트 결과, 데스크톱·모바일 증거를 기록한다. 필수 체크가 통과한 뒤 diff를 다시 확인하고 사람 리뷰 승인을 기다린다. 이 계획의 실행 완료는 PR 생성까지이며, 병합·production 배포는 별도 승인 후 `main`에서 수행한다.
