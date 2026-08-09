# `/places` 취향 탐색 추천·UI 개편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/places`에서 최대 두 개의 취향 배지를 선택해 개인 발견, Re:Taste 신뢰 추천, Golden Pick 릴레이를 부분 갱신하는 반응형 화면을 만든다.

**Architecture:** 순수 함수 모듈이 배지·계절·제목·재랭킹을 담당하고, 서버 모듈이 기존 사용자 취향·평가 스냅샷·Golden Pick·장소 후보를 한 번에 조회한다. 최초 페이지 loader와 추천 전용 리소스 loader가 같은 추천 서비스를 사용하며 UI는 React Router fetcher로 결과만 교체한다.

**Tech Stack:** React Router 8 Framework Mode, React 19, TypeScript, Drizzle ORM, Cloudflare D1, Vitest, Playwright

## Global Constraints

- 데이터베이스 마이그레이션과 신규 의존성을 추가하지 않는다.
- 취향 개인화는 전체 점수의 최대 35%, Golden Pick 개인화는 최대 25%다.
- 8개 결과에서 동일 대표 카테고리와 동일 동네는 각각 최대 2곳, 새로운 취향은 최소 2곳이다.
- 계절 가중치는 최대 15%이며 품질 하한을 우회하지 않는다.
- 선택 배지는 최대 2개이고 추천 이유는 실제 근거를 최대 2개만 표시한다.
- LLM, 외부 날씨·트렌드 API, 임베딩을 사용하지 않는다.

---

### Task 1: 추천 옵션과 순수 랭킹 규칙

**Files:**
- Create: `app/features/places/place-recommendation-options.ts`
- Modify: `app/features/places/place-discovery.ts`
- Test: `tests/unit/place-recommendation-options.test.ts`
- Test: `tests/unit/place-discovery.test.ts`

**Interfaces:**
- Produces: `parseRecommendationSelection(values: string[]): string[]`, `buildRecommendationChips(profile, month): RecommendationChip[]`, `buildRecommendationTitle(selected, month): string`, `rankPersonalDiscovery(input): DiscoveryPlace[]`, `rankTrustedPlaces(input): DiscoveryPlace[]`, `rankGoldenRelay(input): DiscoveryPlace[]`.

- [ ] 선택값 중 허용된 배지만 보존하고 최대 2개로 자르는 실패 테스트를 작성한다.
- [ ] 계절별 배지, 사용자 취향 우선순위, 제목 템플릿 실패 테스트를 작성한다.
- [ ] 직접 일치·인접 취향·새로운 발견 할당과 카테고리·동네 최대 2개 실패 테스트를 작성한다.
- [ ] `pnpm test -- tests/unit/place-recommendation-options.test.ts tests/unit/place-discovery.test.ts`를 실행해 실패를 확인한다.
- [ ] 취향 상수, 계절 상수, 제목 템플릿과 순수 재랭킹 함수를 최소 구현한다.
- [ ] 같은 명령을 실행해 통과를 확인한다.
- [ ] `git add` 후 `git commit -m "2026-08-09 취향 탐색 추천 규칙 추가"`로 커밋한다.

### Task 2: 추천 후보 조회와 사용자 컨텍스트

**Files:**
- Create: `app/features/places/place-recommendation.server.ts`
- Modify: `app/features/places/place-discovery.server.ts`
- Modify: `app/features/places/place.server.ts`
- Test: `tests/integration/place-recommendation.server.test.ts`

**Interfaces:**
- Consumes: Task 1의 세 랭킹 함수와 배지 함수.
- Produces: `getPlaceRecommendationPage(db, input): Promise<PlaceRecommendationPage>`와 최대 500개를 가나다순 절단 없이 조회하는 `listRecommendationCandidates(db, filters)`.

- [ ] 최신 평가 스냅샷·사용자 취향·활성 Golden Pick을 사용하는 실패 통합 테스트를 작성한다.
- [ ] 스냅샷이 없는 장소의 현재 평가 fallback 실패 테스트를 작성한다.
- [ ] `pnpm run test:integration -- tests/integration/place-recommendation.server.test.ts`로 실패를 확인한다.
- [ ] 후보 조회와 추천 조립 서비스를 최소 구현한다.
- [ ] 같은 통합 테스트를 실행해 통과를 확인한다.
- [ ] `git add` 후 `git commit -m "2026-08-09 추천 후보 조회 서비스 추가"`로 커밋한다.

### Task 3: 부분 갱신 라우트와 상호작용

**Files:**
- Create: `app/routes/place-recommendations-resource.tsx`
- Modify: `app/routes.ts`
- Modify: `app/routes/place-list.tsx`
- Create: `app/components/places/PlaceRecommendationControls.tsx`
- Test: `tests/unit/place-list-contract.test.ts`
- Test: `tests/integration/place-recommendations-resource.test.ts`

**Interfaces:**
- Consumes: `getPlaceRecommendationPage`.
- Produces: `/resources/place-recommendations?badge=<id>&badge=<id>&bbox=...` JSON과 최대 2개 선택 UI.

- [ ] 리소스 라우트가 선택값을 최대 2개로 제한하는 실패 테스트를 작성한다.
- [ ] 배지 `aria-pressed`, 로딩·오류 상태와 fetcher 사용 계약 실패 테스트를 작성한다.
- [ ] 관련 unit/integration 테스트를 실행해 실패를 확인한다.
- [ ] 리소스 라우트와 선택 컨트롤을 최소 구현한다.
- [ ] 관련 테스트를 실행해 통과를 확인한다.
- [ ] `git add` 후 `git commit -m "2026-08-09 추천 배지 부분 갱신 연결"`로 커밋한다.

### Task 4: 세 추천 영역과 카드 시각 체계

**Files:**
- Modify: `app/routes/place-list.tsx`
- Modify: `app/components/places/PlaceDiscoveryRail.tsx`
- Modify: `app/components/places/PlaceCard.tsx`
- Modify: `app/app.css`
- Test: `tests/unit/place-list-contract.test.ts`
- Test: `tests/unit/place-discovery-style-contract.test.ts`

**Interfaces:**
- Consumes: 추천 결과의 `mode`, `reasons`, `score`, `sectionTitle`.
- Produces: 개인 대표 카드, Re:Taste 근거 그리드, Golden Pick 릴레이와 모바일 단일 열 레이아웃.

- [ ] 디자인 토큰, 추천 이유 최대 2개, 세 영역의 서로 다른 레이아웃 계약 실패 테스트를 작성한다.
- [ ] 관련 테스트를 실행해 실패를 확인한다.
- [ ] SUIT/Pretendard, 녹색·오프화이트·라임 토큰과 반응형 CSS를 구현한다.
- [ ] 관련 테스트를 실행해 통과를 확인한다.
- [ ] `git add` 후 `git commit -m "2026-08-09 맛집 발견 화면 리디자인"`으로 커밋한다.

### Task 5: 전체 검증과 시각 증거

**Files:**
- Create: `tests/e2e/place-discovery-v2.spec.ts`
- Create: `output/playwright/place-discovery-v2/desktop.png`
- Create: `output/playwright/place-discovery-v2/mobile.png`
- Modify: `docs/superpowers/specs/2026-08-09-places-discovery-v2-design.md` only if QA finds an agreed correction.

**Interfaces:**
- Consumes: 완성된 `/places`와 로컬 D1 seed.
- Produces: 데스크톱·모바일 상호작용 및 접근성 검증 증거.

- [ ] 배지 최대 2개, 제목 변경, 결과 부분 갱신, 상세 시트 열기를 검증하는 E2E를 작성한다.
- [ ] `pnpm test`, `pnpm run test:integration`, `pnpm run typecheck`, `pnpm run build`를 실행한다.
- [ ] Playwright에서 1440×1000과 390×844 화면을 검증하고 스크린샷을 저장한다.
- [ ] 콘솔 오류, 수평 오버플로, 키보드 포커스와 reduced motion을 확인한다.
- [ ] `git diff --check origin/main...HEAD`와 `git status --short`를 확인한다.
- [ ] `git add` 후 `git commit -m "2026-08-09 맛집 발견 추천 검증 완료"`로 커밋한다.
