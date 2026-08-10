# 앱 우선 취향 온보딩 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 비회원 사용자가 앱 우선 온보딩에서 취향을 고르고 추천을 체험한 뒤, 로그인 시 선택 데이터를 계정에 합치고 이후 저장·평가로 추천 취향을 갱신하도록 만든다.

**Architecture:** 기존 `TASTE_BADGE_CATALOG`, `user_taste_badges`, 장소 추천·저장·평가 서비스를 그대로 사용한다. 신규 D1 테이블은 비회원 세션, 비회원 취향, 추천 피드백, 최소 제품 이벤트만 담당하며, 화면은 `/onboarding/taste`의 단계 상태와 서버 서비스 계약을 분리한다. 로그인 방식과 무관하게 하나의 병합 함수를 호출하고, 추천 서비스는 회원 취향 또는 비회원 취향을 동일한 `tasteBadgeIds` 입력으로 처리한다.

**Tech Stack:** React Router 8, React 19, TypeScript 7, Drizzle ORM, Cloudflare D1/Workers, Vitest, Playwright, 기존 Re:Taste 디자인 시스템

## Global Constraints

- 신규 브랜치와 worktree는 최신 `origin/main`에서 시작하며 다른 작업자의 파일과 브랜치를 수정하지 않는다.
- DB 변경은 기존 migration을 수정하지 않고 `drizzle/0018_app_first_taste_onboarding.sql`로 추가한다.
- 패키지 관리자는 `pnpm`만 사용하며 신규 외부 의존성을 추가하지 않는다.
- 음식 취향은 5개 선택을 권장하고 0~5개를 허용한다.
- 식당 스타일은 0~3개를 허용하며 네 번째 선택은 거절한다.
- 온보딩 모든 단계는 건너뛸 수 있다.
- 비회원 세션은 마지막 활동 후 30일 동안 유지한다.
- 원본 위치 좌표, 이메일, 이름은 제품 이벤트에 기록하지 않는다.
- 최종 추천 점수에서 개인 취향 영향은 최대 35%다.
- 추천 8곳에서 새로운 취향 후보를 최소 2곳 유지한다.
- 모바일·앱은 전체 화면, 데스크톱 웹은 중앙 카드로 표현하고 같은 서버 계약을 사용한다.
- 저장·평가·코스 생성은 로그인 이후 실행한다. 로그인 안내를 닫아도 비회원 취향과 추천 화면을 유지한다.
- 새 흐름은 기능 플래그로 끌 수 있어야 하며 비활성화 시 기존 `/places` 흐름으로 복귀한다.

---

## 파일 구조

### 새 파일

- `drizzle/0018_app_first_taste_onboarding.sql`: 비회원 세션·선택·피드백·제품 이벤트 스키마
- `app/features/onboarding/onboarding.ts`: 선택 제한, 단계 상태, 진행률의 순수 도메인 로직
- `app/features/onboarding/location.client.ts`: 브라우저 위치 요청과 세션 단위 좌표 보관 어댑터
- `app/features/onboarding/guest-session.server.ts`: 비회원 쿠키와 세션 생성·조회·저장
- `app/features/onboarding/guest-merge.server.ts`: 로그인 후 비회원 취향의 멱등 병합
- `app/features/onboarding/onboarding-events.server.ts`: 개인정보 없는 제품 이벤트 기록
- `app/features/members/taste-learning.server.ts`: 저장·평가 후 추론 취향을 다시 계산해 저장
- `app/components/onboarding/TasteOnboarding.tsx`: 앱 우선 단계 UI
- `app/routes/taste-onboarding.tsx`: `/onboarding/taste` loader/action과 화면 조립
- `tests/unit/onboarding.test.ts`: 선택·단계·진행률 단위 테스트
- `tests/unit/taste-onboarding-contract.test.ts`: 화면·접근성 계약 테스트
- `tests/integration/guest-onboarding.server.test.ts`: 비회원 세션과 저장·복원 통합 테스트
- `tests/integration/guest-merge.server.test.ts`: 로그인 병합과 멱등성 통합 테스트
- `tests/integration/taste-learning.server.test.ts`: 행동 기반 취향 갱신 통합 테스트
- `tests/e2e/taste-onboarding.spec.ts`: 모바일·데스크톱 전체 흐름

### 수정 파일

- `app/db/schema.ts`: 신규 테이블 Drizzle 정의
- `app/routes.ts`: 온보딩 경로 등록
- `app/routes/place-list.tsx`: 첫 비회원 진입 분기와 비회원 취향 추천 입력
- `app/routes/place-recommendations-resource.tsx`: 비회원 취향을 재랭킹 요청에 전달
- `app/features/places/place-recommendation.server.ts`: 회원·비회원 공통 취향 입력 계약
- `app/features/places/place-discovery.ts`: 개인화 상한과 탐색 슬롯 회귀 보강
- `app/features/auth/session.server.ts`: 비회원 세션 쿠키 만료 헤더 지원
- `app/routes/login.tsx`: 이메일 로그인 성공 후 병합
- `app/routes/auth-google-callback.tsx`: Google 로그인 성공 후 병합
- `app/routes/auth-naver-callback.tsx`: 네이버 로그인 성공 후 병합
- `app/routes/place-detail.tsx`: 부정 이유 저장과 취향 학습 호출
- `app/components/ratings/VoteControl.tsx`: 간단한 피드백 문구와 부정 이유 선택
- `app/features/saves/save.server.ts`: 저장 후 취향 학습을 호출하는 상위 서비스와 계약 정리
- `app/styles/design-system.css`: 앱 우선 전체 화면·데스크톱 카드 스타일
- `worker-configuration.d.ts`: `ONBOARDING_ENABLED` 환경 타입
- `wrangler.jsonc`: 기본 기능 플래그 바인딩
- `docs/operations/place-operations-runbook.md`: 기능 플래그, 지표, 롤백 확인 방법

---

### Task 1: 온보딩 데이터 기반 추가

**Files:**
- Create: `drizzle/0018_app_first_taste_onboarding.sql`
- Modify: `app/db/schema.ts`
- Modify: `tests/unit/schema-contract.test.ts`

**Interfaces:**
- Produces: `guestTasteSessions`, `guestTasteBadges`, `recommendationFeedback`, `productEvents`
- Consumes: 기존 `users`, `tasteBadges`, `places`

- [ ] **Step 1: 신규 테이블 계약 테스트 작성**

`tests/unit/schema-contract.test.ts` import에 네 테이블을 추가하고 다음 테스트를 작성한다.

```ts
it("exports app-first onboarding and feedback tables", () => {
  expect(guestTasteSessions.expiresAt).toBeDefined();
  expect(guestTasteSessions.mergedUserId).toBeDefined();
  expect(guestTasteBadges.badgeId).toBeDefined();
  expect(recommendationFeedback.reason).toBeDefined();
  expect(productEvents.eventName).toBeDefined();
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run tests/unit/schema-contract.test.ts`

Expected: FAIL — 신규 export를 `app/db/schema.ts`에서 찾지 못한다.

- [ ] **Step 3: 순차 migration 작성**

`drizzle/0018_app_first_taste_onboarding.sql`에 아래 스키마를 작성한다.

```sql
CREATE TABLE guest_taste_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  onboarding_version INTEGER NOT NULL DEFAULT 1,
  location_mode TEXT NOT NULL DEFAULT 'DEFAULT' CHECK (location_mode IN ('DEVICE', 'DEFAULT')),
  completed_steps_json TEXT NOT NULL DEFAULT '[]',
  completed_at TEXT,
  skipped_at TEXT,
  merged_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX guest_taste_sessions_expiry_idx
  ON guest_taste_sessions(expires_at, merged_user_id);

CREATE TABLE guest_taste_badges (
  session_id TEXT NOT NULL REFERENCES guest_taste_sessions(id) ON DELETE CASCADE,
  badge_id TEXT NOT NULL REFERENCES taste_badges(id) ON DELETE RESTRICT,
  selected_at TEXT NOT NULL,
  PRIMARY KEY (session_id, badge_id)
);

CREATE INDEX guest_taste_badges_badge_idx ON guest_taste_badges(badge_id);

CREATE TABLE recommendation_feedback (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  reason TEXT CHECK (reason IN ('MENU', 'DISTANCE', 'PRICE', 'ATMOSPHERE', 'ALREADY_VISITED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, place_id)
);

CREATE TABLE product_events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  guest_session_id TEXT REFERENCES guest_taste_sessions(id) ON DELETE SET NULL,
  event_name TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL
);

CREATE INDEX product_events_name_time_idx ON product_events(event_name, occurred_at);
CREATE INDEX product_events_guest_idx ON product_events(guest_session_id, occurred_at);
CREATE INDEX product_events_user_idx ON product_events(user_id, occurred_at);
```

- [ ] **Step 4: Drizzle 스키마 정의**

`app/db/schema.ts`에 SQL과 동일한 열, enum, FK, 인덱스, 복합 PK를 정의한다. 이름은 아래 export와 정확히 일치시킨다.

```ts
export const guestTasteSessions = sqliteTable("guest_taste_sessions", {
  id: text("id").primaryKey(),
  onboardingVersion: integer("onboarding_version").notNull().default(1),
  locationMode: text("location_mode", { enum: ["DEVICE", "DEFAULT"] }).notNull().default("DEFAULT"),
  completedStepsJson: text("completed_steps_json").notNull().default("[]"),
  completedAt: text("completed_at"),
  skippedAt: text("skipped_at"),
  mergedUserId: text("merged_user_id").references(() => users.id, { onDelete: "set null" }),
  expiresAt: text("expires_at").notNull(),
  ...timestamps,
}, (table) => [index("guest_taste_sessions_expiry_idx").on(table.expiresAt, table.mergedUserId)]);
```

나머지 세 테이블은 다음 정의를 사용한다.

```ts
export const guestTasteBadges = sqliteTable("guest_taste_badges", {
  sessionId: text("session_id").notNull().references(() => guestTasteSessions.id, { onDelete: "cascade" }),
  badgeId: text("badge_id").notNull().references(() => tasteBadges.id, { onDelete: "restrict" }),
  selectedAt: text("selected_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.sessionId, table.badgeId] }),
  index("guest_taste_badges_badge_idx").on(table.badgeId),
]);

export const recommendationFeedback = sqliteTable("recommendation_feedback", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  placeId: text("place_id").notNull().references(() => places.id, { onDelete: "cascade" }),
  value: integer("value").notNull(),
  reason: text("reason", { enum: ["MENU", "DISTANCE", "PRICE", "ATMOSPHERE", "ALREADY_VISITED"] }),
  ...timestamps,
}, (table) => [primaryKey({ columns: [table.userId, table.placeId] })]);

export const productEvents = sqliteTable("product_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  guestSessionId: text("guest_session_id").references(() => guestTasteSessions.id, { onDelete: "set null" }),
  eventName: text("event_name").notNull(),
  metadataJson: text("metadata_json").notNull().default("{}"),
  occurredAt: text("occurred_at").notNull(),
}, (table) => [
  index("product_events_name_time_idx").on(table.eventName, table.occurredAt),
  index("product_events_guest_idx").on(table.guestSessionId, table.occurredAt),
  index("product_events_user_idx").on(table.userId, table.occurredAt),
]);
```

- [ ] **Step 5: 스키마 테스트 통과 확인**

Run: `pnpm vitest run tests/unit/schema-contract.test.ts`

Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add drizzle/0018_app_first_taste_onboarding.sql app/db/schema.ts tests/unit/schema-contract.test.ts
git commit -m "2026-08-10 취향 온보딩 데이터 기반 추가"
```

---

### Task 2: 비회원 세션과 선택 도메인 구현

**Files:**
- Create: `app/features/onboarding/onboarding.ts`
- Create: `app/features/onboarding/guest-session.server.ts`
- Create: `tests/unit/onboarding.test.ts`
- Create: `tests/integration/guest-onboarding.server.test.ts`

**Interfaces:**
- Produces: `toggleOnboardingBadge`, `onboardingProgress`, `getOrCreateGuestSession`, `saveGuestOnboarding`, `readGuestSessionId`
- Consumes: `TASTE_BADGE_CATALOG`, Task 1의 `guestTasteSessions`, `guestTasteBadges`

- [ ] **Step 1: 선택 제한 단위 테스트 작성**

```ts
import { describe, expect, it } from "vitest";
import { toggleOnboardingBadge } from "../../app/features/onboarding/onboarding";

describe("toggleOnboardingBadge", () => {
  it("allows at most five FOOD badges", () => {
    const selected = ["food-gukbap", "food-naengmyeon", "food-tteokbokki", "food-ramen", "food-sushi"];
    expect(toggleOnboardingBadge({ selected, badgeId: "food-pasta", maximum: 5 }))
      .toEqual({ selected, limitReached: true });
  });

  it("allows deselection without hitting the limit", () => {
    expect(toggleOnboardingBadge({ selected: ["style-old-school"], badgeId: "style-old-school", maximum: 3 }))
      .toEqual({ selected: [], limitReached: false });
  });
});
```

- [ ] **Step 2: 단위 테스트 실패 확인**

Run: `pnpm vitest run tests/unit/onboarding.test.ts`

Expected: FAIL — 모듈이 존재하지 않는다.

- [ ] **Step 3: 순수 선택 로직 구현**

```ts
export type OnboardingStep = "LOCATION" | "FOOD" | "STYLE" | "PREVIEW";

export function toggleOnboardingBadge(input: {
  selected: string[];
  badgeId: string;
  maximum: number;
}) {
  if (input.selected.includes(input.badgeId)) {
    return { selected: input.selected.filter((id) => id !== input.badgeId), limitReached: false };
  }
  if (input.selected.length >= input.maximum) return { selected: input.selected, limitReached: true };
  return { selected: [...input.selected, input.badgeId], limitReached: false };
}

export function onboardingProgress(step: OnboardingStep) {
  return ({ LOCATION: 1, FOOD: 2, STYLE: 3, PREVIEW: 4 } as const)[step];
}
```

- [ ] **Step 4: 세션 통합 테스트 작성**

`tests/integration/guest-onboarding.server.test.ts`에서 다음을 검증한다.

```ts
it("creates a 30-day guest session and replaces selected badges", async () => {
  const created = await createGuestSession(db, { id: "guest-1", now: "2026-08-10T00:00:00Z" });
  expect(created.expiresAt).toBe("2026-09-09T00:00:00.000Z");

  await saveGuestOnboarding(db, {
    sessionId: created.id,
    step: "STYLE",
    locationMode: "DEVICE",
    foodBadgeIds: ["food-gukbap"],
    styleBadgeIds: ["style-old-school"],
    now: "2026-08-10T00:01:00Z",
  });

  const restored = await getGuestOnboarding(db, created.id, "2026-08-10T00:02:00Z");
  expect(restored?.foodBadgeIds).toEqual(["food-gukbap"]);
  expect(restored?.styleBadgeIds).toEqual(["style-old-school"]);
});
```

- [ ] **Step 5: 세션 서버 구현**

`guest-session.server.ts`에 다음 공개 계약을 구현한다.

```ts
export const GUEST_COOKIE_NAME = "retaste_guest";
export const GUEST_TTL_SECONDS = 60 * 60 * 24 * 30;

export function readGuestSessionId(request: Request): string | null;
export function guestSessionCookie(id: string, requestUrl: string): string;
export function expiredGuestSessionCookie(requestUrl: string): string;
export async function createGuestSession(db: AppDb, input: { id: string; now: string }): Promise<typeof guestTasteSessions.$inferSelect>;
export async function getOrCreateGuestSession(db: AppDb, request: Request, now: string): Promise<{ session: typeof guestTasteSessions.$inferSelect; setCookie: string | null }>;
export async function getGuestOnboarding(db: AppDb, sessionId: string, now: string): Promise<GuestOnboardingState | null>;
export async function getGuestOnboardingFromRequest(db: AppDb, request: Request, now: string): Promise<GuestOnboardingState | null>;
export async function saveGuestOnboarding(db: AppDb, input: SaveGuestOnboardingInput): Promise<void>;
```

`getGuestOnboardingFromRequest`는 `readGuestSessionId`로 쿠키를 읽고 ID가 있을 때만 `getGuestOnboarding`을 호출한다. `saveGuestOnboarding`은 배지 ID를 `TASTE_BADGE_CATALOG`에서 검증하고 FOOD 5개, STYLE/TASTE 합계 3개를 다시 검증한다. 현재 선택을 `db.batch`로 삭제 후 삽입하고 세션의 단계·위치 방식·만료 시간을 갱신한다. 만료됐거나 이미 병합된 세션은 `GUEST_SESSION_UNAVAILABLE`을 던진다.

- [ ] **Step 6: 세션 테스트 통과 확인**

Run: `pnpm vitest run tests/unit/onboarding.test.ts --config vitest.config.ts && pnpm vitest run tests/integration/guest-onboarding.server.test.ts --config vitest.workers.config.ts`

Expected: 단위·통합 모두 PASS

- [ ] **Step 7: 커밋**

```bash
git add app/features/onboarding tests/unit/onboarding.test.ts tests/integration/guest-onboarding.server.test.ts
git commit -m "2026-08-10 비회원 취향 세션 구현"
```

---

### Task 3: 온보딩 경로와 앱 우선 화면 구현

**Files:**
- Create: `app/components/onboarding/TasteOnboarding.tsx`
- Create: `app/features/onboarding/location.client.ts`
- Create: `app/routes/taste-onboarding.tsx`
- Create: `tests/unit/taste-onboarding-contract.test.ts`
- Modify: `app/routes.ts`
- Modify: `app/styles/design-system.css`
- Modify: `worker-configuration.d.ts`
- Modify: `wrangler.jsonc`

**Interfaces:**
- Produces: `/onboarding/taste`, `TasteOnboarding`
- Consumes: Task 2의 세션 함수와 `TASTE_BADGE_CATALOG`

- [ ] **Step 1: 경로·접근성 계약 테스트 작성**

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";

describe("taste onboarding contract", () => {
  it("registers the route and exposes pressed badge buttons", () => {
    expect(fs.readFileSync("app/routes.ts", "utf8")).toContain('route("onboarding/taste", "routes/taste-onboarding.tsx")');
    const component = fs.readFileSync("app/components/onboarding/TasteOnboarding.tsx", "utf8");
    expect(component).toContain("aria-pressed");
    expect(component).toContain("나중에 할게요");
    expect(component).toContain("44px");
  });
});
```

- [ ] **Step 2: 계약 테스트 실패 확인**

Run: `pnpm vitest run tests/unit/taste-onboarding-contract.test.ts`

Expected: FAIL — 경로와 컴포넌트가 없다.

- [ ] **Step 3: 환경 플래그와 경로 등록**

`wrangler.jsonc`에 기본 바인딩을 추가한다.

```json
"vars": { "ONBOARDING_ENABLED": "true" }
```

`worker-configuration.d.ts`의 `Env`에 다음을 추가하고 `app/routes.ts`에 경로를 등록한다.

```ts
ONBOARDING_ENABLED?: string;
```

```ts
route("onboarding/taste", "routes/taste-onboarding.tsx"),
```

- [ ] **Step 4: loader/action 구현**

`taste-onboarding.tsx` loader는 로그인 사용자를 `returnTo`로 돌려보내고, 비회원 세션을 생성·복원한다. action은 아래 스키마로 단계 저장 또는 건너뛰기를 처리한다.

```ts
const onboardingAction = z.object({
  intent: z.enum(["SAVE_STEP", "SKIP", "COMPLETE"]),
  step: z.enum(["LOCATION", "FOOD", "STYLE", "PREVIEW"]),
  locationMode: z.enum(["DEVICE", "DEFAULT"]).default("DEFAULT"),
  foodBadgeIds: z.array(z.string()).max(5).default([]),
  styleBadgeIds: z.array(z.string()).max(3).default([]),
  returnTo: z.string().default("/places"),
});
```

폼의 반복 필드는 `form.getAll("foodBadgeId")`와 `form.getAll("styleBadgeId")`로 조립한다. `SKIP`과 `COMPLETE`는 세션에 완료 시각을 기록하고 `returnTo`로 redirect한다. 신규 세션이면 응답에 `Set-Cookie`를 붙인다.

- [ ] **Step 5: 앱 우선 컴포넌트 구현**

`TasteOnboarding`은 서버에서 받은 초기 상태를 `useState`로 관리한다. 배지 버튼은 다음 계약을 사용한다.

```tsx
<button
  type="button"
  className="taste-onboarding__badge"
  aria-pressed={selected.includes(badge.id)}
  onClick={() => onToggle(badge.id)}
>
  {badge.label}
</button>
```

각 화면은 `1/4`, `2/4`, `3/4`, `4/4` 진행 상태, 선택 개수, `계속`, `이전`, `나중에 할게요`를 제공한다. 네 번째 스타일 선택 시 기존 선택을 유지하고 `최대 3개까지 선택할 수 있어요.`를 `role="status"`로 알린다.

- [ ] **Step 6: 위치 어댑터 구현**

`location.client.ts`는 원본 좌표를 서버 세션에 저장하지 않고 현재 브라우저 세션에서만 사용한다.

```ts
export type OnboardingLocation = {
  center: { latitude: number; longitude: number };
  bbox: [number, number, number, number];
  mode: "DEVICE" | "DEFAULT";
};

const DEFAULT_CENTER = { latitude: 35.1601, longitude: 126.8514 };

function bboxAround(center: OnboardingLocation["center"], delta = 0.035): OnboardingLocation["bbox"] {
  return [center.longitude - delta, center.latitude - delta, center.longitude + delta, center.latitude + delta];
}

export async function requestOnboardingLocation(): Promise<OnboardingLocation> {
  if (!("geolocation" in navigator)) return defaultOnboardingLocation();
  return new Promise((resolve) => navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      const center = { latitude: coords.latitude, longitude: coords.longitude };
      const value = { center, bbox: bboxAround(center), mode: "DEVICE" as const };
      sessionStorage.setItem("retaste_onboarding_location", JSON.stringify(value));
      resolve(value);
    },
    () => resolve(defaultOnboardingLocation()),
    { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 },
  ));
}

export function defaultOnboardingLocation(): OnboardingLocation {
  return { center: DEFAULT_CENTER, bbox: bboxAround(DEFAULT_CENTER), mode: "DEFAULT" };
}
```

온보딩 폼에는 `locationMode`만 저장한다. 추천 미리보기와 `/places` 이동에는 `sessionStorage`의 좌표를 읽어 현재 요청의 `bbox`에만 사용한다.

- [ ] **Step 7: 반응형 스타일 구현**

`design-system.css`에 `.taste-onboarding` 계열을 추가한다. 모바일 기본은 `min-height: 100dvh`, 배지 최소 크기는 `min-height: 44px`이다. `@media (min-width: 768px)`에서는 카드 최대 너비 `720px`, 기존 표면·테두리·라운드 토큰을 사용한다. 선택 상태는 색상과 테두리·아이콘을 함께 바꾼다.

- [ ] **Step 8: 계약 테스트와 타입 검사**

Run: `pnpm vitest run tests/unit/taste-onboarding-contract.test.ts && pnpm run typecheck`

Expected: PASS

- [ ] **Step 9: 커밋**

```bash
git add app/routes.ts app/routes/taste-onboarding.tsx app/components/onboarding/TasteOnboarding.tsx app/features/onboarding/location.client.ts app/styles/design-system.css worker-configuration.d.ts wrangler.jsonc tests/unit/taste-onboarding-contract.test.ts
git commit -m "2026-08-10 앱 우선 취향 온보딩 화면 추가"
```

---

### Task 4: 첫 진입 분기와 비회원 추천 연결

**Files:**
- Modify: `app/routes/place-list.tsx`
- Modify: `app/routes/place-recommendations-resource.tsx`
- Modify: `app/features/places/place-recommendation.server.ts`
- Modify: `app/features/places/place-discovery.ts`
- Modify: `tests/integration/place-recommendation.server.test.ts`
- Modify: `tests/unit/place-list-contract.test.ts`
- Modify: `tests/unit/discovery-rating-seed.test.ts`

**Interfaces:**
- Produces: `tasteBadgeIds?: string[]` 입력과 비회원 첫 진입 redirect
- Consumes: `getGuestOnboarding`, 기존 `rankPersonalDiscovery`

- [ ] **Step 1: 비회원 추천 통합 테스트 작성**

`place-recommendation.server.test.ts`에 회원 ID 없이 취향 ID를 전달하는 테스트를 추가한다.

```ts
const result = await getPlaceRecommendationPage(db, {
  userId: null,
  tasteBadgeIds: ["food-gukbap", "style-old-school"],
  bbox: [126.8, 35.0, 127.0, 35.3],
  center: { latitude: 35.15, longitude: 126.9 },
  selectedBadges: [],
  now,
  limit: 8,
});
expect(result.chips.some((chip) => chip.id === "food-gukbap")).toBe(true);
expect(result.personal).toHaveLength(8);
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run tests/integration/place-recommendation.server.test.ts --config vitest.workers.config.ts`

Expected: FAIL — `tasteBadgeIds` 입력이 없다.

- [ ] **Step 3: 추천 서비스 입력 통합**

`getPlaceRecommendationPage` input에 `tasteBadgeIds?: string[]`를 추가한다. 회원 DB 취향과 입력 취향은 중복 제거 후 결합한다.

```ts
const userBadgeIds = [...new Set([
  ...storedTaste.map((badge) => badge.badgeId),
  ...(input.tasteBadgeIds ?? []),
])];
```

`place-discovery.ts`의 개인화 항은 최종 점수의 `0.35`를 넘지 않게 clamp하고, 8개 결과에서 `EXPLORATION`을 두 개 먼저 예약한 뒤 나머지를 점수순으로 채운다. 기존 동일 카테고리 최대 3곳·동네 최대 2곳 제한을 유지한다.

- [ ] **Step 4: 첫 진입 계약 테스트 작성**

`place-list-contract.test.ts`에 비회원·플래그 활성·미완료 세션에서 `/onboarding/taste?returnTo=%2Fplaces`로 이동하는 계약을 추가한다. 플래그 비활성, 로그인 사용자, 완료 세션은 redirect하지 않는 테스트도 각각 작성한다.

- [ ] **Step 5: `/places`와 resource loader 연결**

`place-list.tsx` loader에서 사용자와 비회원 세션을 함께 읽는다.

```ts
const user = await getOptionalUser(request);
const guest = user ? null : await getGuestOnboardingFromRequest(db, request, now);
if (!user && env.ONBOARDING_ENABLED === "true" && !guest?.completedAt && !guest?.skippedAt) {
  throw redirect(`/onboarding/taste?returnTo=${encodeURIComponent(`${url.pathname}${url.search}`)}`);
}
```

추천 호출에는 `tasteBadgeIds: guest?.badgeIds ?? []`를 전달한다. resource loader도 같은 함수를 사용해 배지 클릭 재랭킹에서 비회원 취향이 사라지지 않게 한다.

- [ ] **Step 6: 온보딩 추천 미리보기 연결**

`TasteOnboarding`의 PREVIEW 단계는 `sessionStorage`의 bbox를 읽고 `/resources/place-recommendations`를 `useFetcher`로 호출한다. 서버는 Task 2에서 저장한 비회원 배지를 자동으로 결합하므로 URL에는 배지 ID를 반복해서 싣지 않는다. 응답의 `personal.slice(0, 8)`을 기존 `PlaceCard`로 표시하고 요청 실패 시 선택 상태를 유지한 채 `다시 불러오기`를 제공한다.

```ts
const search = new URLSearchParams({ bbox: location.bbox.join(",") });
recommendationFetcher.load(`/resources/place-recommendations?${search}`);
```

`추천 보러가기`는 같은 bbox를 `/places?bbox=...`에 전달한다. 위치 값은 URL 요청에만 사용하고 D1의 비회원 세션이나 제품 이벤트에는 저장하지 않는다.

- [ ] **Step 7: 추천 회귀 테스트 실행**

Run: `pnpm vitest run tests/integration/place-recommendation.server.test.ts --config vitest.workers.config.ts && pnpm vitest run tests/unit/place-list-contract.test.ts tests/unit/discovery-rating-seed.test.ts`

Expected: PASS

- [ ] **Step 8: 커밋**

```bash
git add app/routes/place-list.tsx app/routes/place-recommendations-resource.tsx app/features/places/place-recommendation.server.ts app/features/places/place-discovery.ts tests/integration/place-recommendation.server.test.ts tests/unit/place-list-contract.test.ts tests/unit/discovery-rating-seed.test.ts
git commit -m "2026-08-10 비회원 취향 추천 연결"
```

---

### Task 5: 로그인 후 비회원 취향 멱등 병합

**Files:**
- Create: `app/features/onboarding/guest-merge.server.ts`
- Create: `tests/integration/guest-merge.server.test.ts`
- Modify: `app/features/auth/session.server.ts`
- Modify: `app/routes/login.tsx`
- Modify: `app/routes/auth-google-callback.tsx`
- Modify: `app/routes/auth-naver-callback.tsx`

**Interfaces:**
- Produces: `mergeGuestTasteSessionFromRequest(db, request, userId, now)`
- Consumes: Task 1의 guest/user taste tables, Task 2의 guest cookie 함수

- [ ] **Step 1: 멱등 병합 테스트 작성**

```ts
it("merges USER taste once and expires the guest cookie", async () => {
  await seedGuestTaste(db, "guest-merge", ["food-gukbap", "style-old-school"]);
  const request = new Request("https://retaste.test/login", {
    headers: { Cookie: "retaste_guest=guest-merge" },
  });

  const first = await mergeGuestTasteSessionFromRequest(db, request, "member-1", "2026-08-10T00:00:00Z");
  const second = await mergeGuestTasteSessionFromRequest(db, request, "member-1", "2026-08-10T00:01:00Z");

  expect(first.merged).toBe(true);
  expect(second.merged).toBe(false);
  expect(await countUserTasteRows(db, "member-1", "USER")).toBe(2);
  expect(first.expireCookie).toContain("Max-Age=0");
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run tests/integration/guest-merge.server.test.ts --config vitest.workers.config.ts`

Expected: FAIL — 병합 함수가 없다.

- [ ] **Step 3: 병합 함수 구현**

`guest-merge.server.ts`에 다음 계약을 구현한다.

```ts
export async function mergeGuestTasteSessionFromRequest(
  db: AppDb,
  request: Request,
  userId: string,
  now: string,
): Promise<{ merged: boolean; expireCookie: string | null }>;
```

세션이 없거나 만료됐거나 이미 병합됐으면 쓰지 않는다. 유효한 배지는 `userTasteBadges`에 `source: "USER"`, `score: 0.8`, `evidenceJson: JSON.stringify({ source: "ONBOARDING", version: 1 })`로 upsert한다. 기존 USER 점수가 더 높으면 낮추지 않는다. 배지 upsert와 `mergedUserId`, `updatedAt` 갱신은 하나의 `db.batch`로 실행한다.

- [ ] **Step 4: 세 로그인 경로에 병합 연결**

이메일, Google, 네이버 로그인에서 계정 식별이 끝난 직후 같은 병합 함수를 호출한다. 응답 `Headers`에는 회원 세션 쿠키, OAuth 쿠키 만료, 비회원 쿠키 만료를 각각 `append`한다. 병합 실패는 로그인 자체를 취소하지 않고 `GUEST_TASTE_MERGE_FAILED`만 기록하며 비회원 쿠키를 유지한다.

이메일 로그인 action도 단일 `Headers` 객체를 사용한다.

```ts
const headers = new Headers();
headers.append("Set-Cookie", await createUserSession({ userId: user.id, now, requestUrl: request.url }));
const guestMerge = await mergeGuestTasteSessionFromRequest(db, request, user.id, now.toISOString());
if (guestMerge.expireCookie) headers.append("Set-Cookie", guestMerge.expireCookie);
return redirect(safeReturnTo(parsed.data.returnTo), { headers });
```

- [ ] **Step 5: 통합 테스트 통과 확인**

Run: `pnpm vitest run tests/integration/guest-merge.server.test.ts tests/integration/login.server.test.ts --config vitest.workers.config.ts`

Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add app/features/onboarding/guest-merge.server.ts app/features/auth/session.server.ts app/routes/login.tsx app/routes/auth-google-callback.tsx app/routes/auth-naver-callback.tsx tests/integration/guest-merge.server.test.ts
git commit -m "2026-08-10 로그인 취향 병합 추가"
```

---

### Task 6: 저장·평가 피드백과 행동 기반 취향 학습

**Files:**
- Create: `app/features/members/taste-learning.server.ts`
- Create: `tests/integration/taste-learning.server.test.ts`
- Modify: `app/routes/place-detail.tsx`
- Modify: `app/components/ratings/VoteControl.tsx`
- Modify: `app/features/saves/save.server.ts`
- Modify: `app/features/members/profile-taste.server.ts`
- Modify: `tests/unit/taste-signals.test.ts`

**Interfaces:**
- Produces: `recordRecommendationFeedback`, `refreshInferredTasteSignals`
- Consumes: `castVote`, `setSaved`, `listMemberTaste`, `inferTasteBadges`

- [ ] **Step 1: 행동 학습 통합 테스트 작성**

```ts
it("stores one current feedback row and refreshes inferred taste", async () => {
  await recordRecommendationFeedback(db, {
    userId: "learning-user",
    placeId: "gukbap-place",
    value: 1,
    reason: null,
    now: "2026-08-10T00:00:00Z",
  });
  await refreshInferredTasteSignals(db, "learning-user", "2026-08-10T00:00:00Z");

  const inferred = await db.query.userTasteBadges.findFirst({
    where: and(
      eq(userTasteBadges.userId, "learning-user"),
      eq(userTasteBadges.badgeId, "food-gukbap"),
      eq(userTasteBadges.source, "INFERRED"),
    ),
  });
  expect(inferred?.score).toBeGreaterThan(0);
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run tests/integration/taste-learning.server.test.ts --config vitest.workers.config.ts`

Expected: FAIL — 학습 서비스가 없다.

- [ ] **Step 3: 피드백 저장과 추론 갱신 구현**

`recordRecommendationFeedback`은 `(userId, placeId)` 충돌 시 `value`, `reason`, `updatedAt`만 갱신한다. `refreshInferredTasteSignals`은 `listMemberTaste`와 기존 `inferTasteBadges`를 사용해 INFERRED 행을 다시 계산한다. 이번 계산에서 사라진 INFERRED 행은 삭제하고 새 계산 결과를 upsert한다. USER/NAVER/GOOGLE 행은 수정하지 않는다. 비추천 중 `MENU` 또는 이유 없음만 해당 장소의 FOOD 일치 신호에서 `0.18`씩 감점하고, 거리·가격·분위기·이미 방문은 음식 취향 감점에 사용하지 않는다. 여러 장소에서 같은 음식에 비추천이 반복되면 감점이 누적되지만 최종 점수는 0 미만으로 내려가지 않는다.

```ts
export type FeedbackReason = "MENU" | "DISTANCE" | "PRICE" | "ATMOSPHERE" | "ALREADY_VISITED";

export async function recordRecommendationFeedback(db: AppDb, input: {
  userId: string;
  placeId: string;
  value: -1 | 1;
  reason: FeedbackReason | null;
  now: string;
}): Promise<void>;

export async function refreshInferredTasteSignals(db: AppDb, userId: string, now: string): Promise<void>;
```

- [ ] **Step 4: 장소 상세 action 연결**

`place-detail.tsx` vote schema에 선택 이유를 추가한다.

```ts
z.object({
  intent: z.literal("vote"),
  value: z.coerce.number().refine((value): value is -1 | 1 => value === -1 || value === 1),
  reason: z.enum(["MENU", "DISTANCE", "PRICE", "ATMOSPHERE", "ALREADY_VISITED"]).nullable().default(null),
})
```

투표 후 피드백 저장과 추론 갱신을 호출한다. 저장 토글 후에도 추론 갱신을 호출한다. 피드백 저장 실패로 기존 투표·저장을 취소하지 말고 운영 로그에 `TASTE_LEARNING_REFRESH_FAILED`를 남긴다.

- [ ] **Step 5: 간단한 부정 이유 UI 구현**

`VoteControl`에서 비추천을 선택한 경우에만 이유 버튼을 표시한다. 이유는 메뉴, 거리, 가격, 분위기, 이미 가본 곳 다섯 개이며 하나만 선택한다. 숫자 점수는 노출하지 않는다. 로그인 전에는 기존처럼 `returnTo`가 포함된 로그인 안내만 제공한다.

- [ ] **Step 6: 테스트 통과 확인**

Run: `pnpm vitest run tests/integration/taste-learning.server.test.ts --config vitest.workers.config.ts && pnpm vitest run tests/unit/taste-signals.test.ts`

Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add app/features/members/taste-learning.server.ts app/features/members/profile-taste.server.ts app/features/saves/save.server.ts app/routes/place-detail.tsx app/components/ratings/VoteControl.tsx tests/integration/taste-learning.server.test.ts tests/unit/taste-signals.test.ts
git commit -m "2026-08-10 추천 피드백 취향 학습 연결"
```

---

### Task 7: 개인정보 없는 제품 이벤트 기록

**Files:**
- Create: `app/features/onboarding/onboarding-events.server.ts`
- Create: `tests/integration/onboarding-events.server.test.ts`
- Modify: `app/routes/taste-onboarding.tsx`
- Modify: `app/routes/place-detail.tsx`

**Interfaces:**
- Produces: `recordProductEvent`
- Consumes: Task 1의 `productEvents`

- [ ] **Step 1: 이벤트 개인정보 방지 테스트 작성**

```ts
it("rejects direct identifiers and raw coordinates", async () => {
  await expect(recordProductEvent(db, {
    id: "event-1",
    eventName: "ONBOARDING_STARTED",
    guestSessionId: "guest-1",
    userId: null,
    metadata: { email: "member@example.com" },
    occurredAt: "2026-08-10T00:00:00Z",
  })).rejects.toThrow("EVENT_METADATA_NOT_ALLOWED");
});
```

허용 metadata인 `{ step: "FOOD", selectedCount: 3 }`는 저장되고 이메일, 이름, latitude, longitude, address 키는 거절되는 테스트를 각각 작성한다.

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run tests/integration/onboarding-events.server.test.ts --config vitest.workers.config.ts`

Expected: FAIL — 이벤트 서비스가 없다.

- [ ] **Step 3: allowlist 이벤트 서비스 구현**

허용 이벤트 이름은 아래 union으로 제한한다.

```ts
export type ProductEventName =
  | "ONBOARDING_STARTED"
  | "ONBOARDING_STEP_COMPLETED"
  | "ONBOARDING_COMPLETED"
  | "ONBOARDING_SKIPPED"
  | "RECOMMENDATION_DETAIL_OPENED"
  | "RECOMMENDATION_SAVED"
  | "RECOMMENDATION_LIKED"
  | "RECOMMENDATION_DISLIKED"
  | "GUEST_CONVERTED";
```

metadata 키는 `step`, `selectedCount`, `sourceRail`, `discoveryMode`, `reason`만 허용한다. 값은 문자열 또는 유한 정수만 허용한다. `userId`와 `guestSessionId`가 모두 없으면 저장하지 않는다.

- [ ] **Step 4: 온보딩·피드백 경로 연결**

온보딩 loader/action과 장소 상세 action의 성공 지점에서 이벤트를 기록한다. 이벤트 기록 실패는 사용자 동작을 실패시키지 않고 `PRODUCT_EVENT_WRITE_FAILED`만 기록한다.

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm vitest run tests/integration/onboarding-events.server.test.ts --config vitest.workers.config.ts`

Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add app/features/onboarding/onboarding-events.server.ts app/routes/taste-onboarding.tsx app/routes/place-detail.tsx tests/integration/onboarding-events.server.test.ts
git commit -m "2026-08-10 취향 온보딩 제품 이벤트 추가"
```

---

### Task 8: 모바일·데스크톱 사용자 흐름 검증

**Files:**
- Create: `tests/e2e/taste-onboarding.spec.ts`
- Modify: `playwright.config.ts` only if the existing mobile and desktop projects do not already cover both viewports
- Modify: `design-qa.md`

**Interfaces:**
- Consumes: Tasks 1~7의 완성된 온보딩 흐름
- Produces: 재현 가능한 앱 우선 UX 검증 증거

- [ ] **Step 1: E2E 테스트 작성**

```ts
import { expect, test } from "@playwright/test";

test("guest completes optional onboarding and reaches personalized places", async ({ page }) => {
  await page.goto("/places");
  await expect(page).toHaveURL(/\/onboarding\/taste/);
  await page.getByRole("button", { name: "광주시청 기준으로 둘러보기" }).click();
  await page.getByRole("button", { name: "국밥러" }).click();
  await page.getByRole("button", { name: "냉면러" }).click();
  await page.getByRole("button", { name: "계속" }).click();
  await page.getByRole("button", { name: "노포파" }).click();
  await page.getByRole("button", { name: "계속" }).click();
  await page.getByRole("button", { name: "추천 보러가기" }).click();
  await expect(page).toHaveURL(/\/places/);
  await expect(page.getByText("오늘의 취향")).toBeVisible();
});

test("guest can skip and is not trapped in onboarding", async ({ page }) => {
  await page.goto("/places");
  await page.getByRole("button", { name: "나중에 할게요" }).click();
  await expect(page).toHaveURL(/\/places/);
  await page.reload();
  await expect(page).toHaveURL(/\/places/);
});
```

추가로 최대 5/3 제한, 중간 종료 복원, 로그인 `returnTo`, 키보드 선택을 각각 독립 테스트로 작성한다.

- [ ] **Step 2: E2E 현재 결과 확인**

Run: `pnpm run test:e2e tests/e2e/taste-onboarding.spec.ts`

Expected: PASS가 목표다. 실패하면 출력에 표시된 최초의 사용자 흐름 결함만 Step 3에서 수정한다.

- [ ] **Step 3: E2E가 요구하는 최소 수정**

실패한 동작만 해당 Task 소유 파일에서 수정한다. 모바일에서 하단 버튼이 안전 영역에 가려지면 `padding-bottom: max(var(--space-6), env(safe-area-inset-bottom))`을 적용한다. 키보드 포커스가 이동하지 않으면 단계 변경 시 제목에 `tabIndex={-1}`와 focus effect를 적용한다.

- [ ] **Step 4: 모바일·데스크톱 E2E 통과 확인**

Run: `pnpm run test:e2e tests/e2e/taste-onboarding.spec.ts`

Expected: desktop Chromium 및 mobile Chromium 모두 PASS

- [ ] **Step 5: QA 문서 기록**

`design-qa.md`에 검증 일시, 데스크톱·모바일 viewport, 위치 거부, 건너뛰기, 복원, 로그인 병합 결과를 기록한다. 실제 이메일, 계정 ID, 원본 좌표는 첨부하지 않는다.

- [ ] **Step 6: 커밋**

```bash
git add tests/e2e/taste-onboarding.spec.ts playwright.config.ts design-qa.md app/components/onboarding/TasteOnboarding.tsx app/styles/design-system.css
git commit -m "2026-08-10 취향 온보딩 사용자 흐름 검증"
```

---

### Task 9: 운영 문서와 전체 회귀 검증

**Files:**
- Modify: `docs/operations/place-operations-runbook.md`
- Modify: `docs/superpowers/plans/2026-08-10-app-first-taste-onboarding.md` only to check completed boxes during execution

**Interfaces:**
- Produces: 배포·관찰·롤백 절차와 PR 검증 증거
- Consumes: 모든 이전 Task

- [ ] **Step 1: 운영 문서 추가**

다음 항목을 `place-operations-runbook.md`에 작성한다.

```md
### 취향 온보딩 기능 플래그

- 활성: `ONBOARDING_ENABLED=true`
- 비활성: `ONBOARDING_ENABLED=false`
- 롤백 확인: 비회원 `/places`가 `/onboarding/taste`로 이동하지 않고 기존 추천을 표시한다.
- 관찰 이벤트: ONBOARDING_STARTED, ONBOARDING_COMPLETED, ONBOARDING_SKIPPED, GUEST_CONVERTED
- 개인정보 금지: 이메일, 이름, 주소, 원본 위치 좌표를 product_events.metadata_json에 기록하지 않는다.
```

- [ ] **Step 2: migration 로컬 적용 확인**

Run: `pnpm wrangler d1 migrations apply DB --local`

Expected: `0018_app_first_taste_onboarding.sql` 적용 성공

- [ ] **Step 3: 정적 검사와 단위 테스트**

Run: `git diff --check && pnpm run typecheck && pnpm test`

Expected: typecheck 성공, 단위 테스트 0 failure

- [ ] **Step 4: Worker 통합 테스트**

Run: `pnpm run test:integration`

Expected: 모든 integration test PASS. AI binding 원격 경고는 허용하되 인증 실패는 허용하지 않는다.

- [ ] **Step 5: production build와 E2E**

Run: `pnpm run build && pnpm run test:e2e tests/e2e/taste-onboarding.spec.ts`

Expected: build 성공, desktop/mobile 온보딩 E2E PASS

- [ ] **Step 6: 최신 main 반영과 재검증**

```bash
git fetch origin
git merge origin/main
pnpm run typecheck
pnpm test
```

Expected: 충돌 없음. 충돌이 있으면 다른 작업자의 변경을 보존해 해결하고 전체 테스트를 다시 실행한다.

- [ ] **Step 7: 운영 문서 커밋**

```bash
git add docs/operations/place-operations-runbook.md docs/superpowers/plans/2026-08-10-app-first-taste-onboarding.md
git commit -m "2026-08-10 취향 온보딩 운영 절차 정리"
```

- [ ] **Step 8: 브랜치 push와 PR 생성**

```bash
git push -u origin codex/app-first-taste-onboarding-spec
gh pr create --base main --head codex/app-first-taste-onboarding-spec --title "앱 우선 취향 온보딩 및 추천 피드백 루프" --body-file /private/tmp/retaste-onboarding-pr.md
```

PR 본문에는 변경 범위, 검증 결과, migration `0018`, `ONBOARDING_ENABLED`, 개인정보 영향, 롤백, 미확인 위험을 기록한다. UI 변경의 데스크톱·모바일 화면 증거를 첨부한다. 독립적인 사람의 승인과 필수 체크가 완료되기 전에는 병합하지 않는다.

---

## 완료 기준

- 비회원 사용자가 위치, 음식 취향, 식당 스타일을 모두 선택하거나 건너뛸 수 있다.
- 중간 종료 후 30일 이내 재진입하면 선택 상태가 복원된다.
- 비회원 선택이 `/places` 개인 추천에 반영된다.
- 이메일·Google·네이버 로그인 후 USER 출처 취향으로 한 번만 병합된다.
- 저장과 평가가 INFERRED 취향을 갱신하고 직접 선택 취향을 덮어쓰지 않는다.
- 개인화 영향 35% 상한과 새로운 취향 최소 2곳이 테스트로 고정된다.
- 제품 이벤트는 허용된 비식별 metadata만 저장한다.
- 모바일·데스크톱, 위치 거부, 건너뛰기, 복원, 로그인 병합 E2E가 통과한다.
- 기능 플래그 비활성화 시 기존 `/places` 흐름으로 복귀한다.
- migration, typecheck, unit, integration, build, E2E가 모두 통과한다.
