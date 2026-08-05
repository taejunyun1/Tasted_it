# Re:Taste Week 1 Real-Data Beta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a real-data Re:Taste beta where a visitor can browse Gwangju/Jeonnam places on a synchronized map/list, open a place, sign in with a local beta identity, vote, and save it, while an admin can import and maintain place data.

**Architecture:** Use the current Cloudflare React Router v8 full-stack scaffold, with loader/action routes calling focused domain services. Persist relational data in D1 through Drizzle, keep rating math as a pure TypeScript module, and render MapLibre only in the browser. Week 1 uses local Wrangler D1 until the final remote database/deploy task.

**Tech Stack:** React Router v8, TypeScript strict, Vite, Cloudflare Workers/Static Assets, D1, Drizzle ORM, Zod, MapLibre GL JS, Vitest, Playwright, pnpm.

## Global Constraints

- Runtime and deployment: Cloudflare Workers + Static Assets; do not use Cloudflare Pages.
- Cloudflare compatibility date: `2026-08-05`.
- Cloudflare Workers-incompatible Node-only APIs are prohibited in runtime code.
- Public launch geography is limited to Gwangju and Jeollanam-do.
- Roles are `GUEST`, `USER`, `REVIEWER`, and `ADMIN`; Week 1 exposes Guest, User, and minimal Admin flows.
- Server-side authorization is mandatory for every mutation.
- One active vote per `(placeId, userId)`; changes are append-only events plus a current-state row.
- Rating v1 uses a Beta prior of `alpha0=2`, `beta0=2`; advanced reviewer trust and overlap are outside Week 1.
- Map location permission is requested only after the user presses “내 주변”.
- Public copy uses “추천/비추천”, not five-star ratings.
- UI baseline: `#FAFAF8` background, `#111111` text, `#6B6B6B` muted text, `#D9D9D4` borders; radius 0–8px; mobile first.
- Every task follows test-first development and ends with independently passing checks.
- Source of truth: `docs/superpowers/specs/2026-08-05-retaste-master-design.md`.

---

## File Map

```text
app/
  app.css                         design tokens and global layout
  root.tsx                        document shell and error boundary
  routes.ts                       route registration
  routes/home.tsx                 editorial home and category entry
  routes/map-category.tsx         synchronized category map/list
  routes/place-detail.tsx         detail, vote and save actions
  routes/login.tsx                beta identity login
  routes/admin-places.tsx         minimal place administration
  routes/admin-import.tsx         CSV import screen/action
  components/map/PlaceMap.tsx     client-only MapLibre map
  components/places/PlaceCard.tsx accessible place summary
  components/ratings/VoteControl.tsx recommendation control
  db/client.server.ts             D1/Drizzle construction
  db/schema.ts                    Week 1 relational schema
  features/auth/session.server.ts signed beta session
  features/auth/guards.server.ts  role checks
  features/places/place.types.ts  public place contracts
  features/places/place.server.ts place queries and commands
  features/places/import.server.ts CSV parse/validation/import
  features/ratings/rating-v1.ts   pure Beta rating calculation
  features/ratings/vote.server.ts transactional vote event write
  features/saves/save.server.ts   saved-place toggle
  lib/env.server.ts               typed Worker bindings
drizzle/0000_week1.sql            deterministic D1 migration
scripts/seed-week1.sql            local repeatable seed
tests/unit/                        pure module tests
tests/integration/                 Worker/D1 service tests
tests/e2e/                         browser acceptance tests
workers/app.ts                     React Router Worker entry
wrangler.jsonc                     bindings and observability
```

---

### Task 1: Scaffold and Local Quality Gate

**Files:**
- Create: scaffold-generated project files at repository root
- Modify: `package.json`
- Modify: `wrangler.jsonc`
- Create: `.dev.vars.example`
- Test: `tests/unit/smoke.test.ts`

**Interfaces:**
- Consumes: no application interfaces.
- Produces: `pnpm dev`, `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm test:e2e`; Worker binding `DB: D1Database`.

- [x] **Step 1: Initialize Git and preserve the reference documents**

Run:

```bash
git init
git add refer docs
git commit -m "docs: establish ReTaste product specification"
```

Expected: a root commit containing only the supplied references and approved planning documents.

- [x] **Step 2: Scaffold the official Cloudflare React Router application into a temporary directory**

Run:

```bash
pnpm create cloudflare@latest retaste-scaffold --framework=react-router --no-deploy --no-git
```

Expected: `retaste-scaffold` contains `app`, `workers/app.ts`, `vite.config.ts`, `react-router.config.ts`, and `wrangler.jsonc`.

- [x] **Step 3: Move scaffold output into the repository and remove only the empty scaffold directory**

Run:

```bash
rsync -a --exclude node_modules --exclude .gitignore retaste-scaffold/ ./
mv retaste-scaffold /tmp/retaste-scaffold-generated-20260805
pnpm install
```

Expected: dependencies install successfully and existing `refer`/`docs` remain unchanged.

- [x] **Step 4: Add quality scripts and test dependencies**

Modify `package.json` so its scripts include:

```json
{
  "scripts": {
    "build": "react-router build",
    "dev": "react-router dev",
    "deploy": "wrangler deploy",
    "typecheck": "react-router typegen && tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "db:migrate:local": "wrangler d1 migrations apply retaste-local --local",
    "db:seed:local": "wrangler d1 execute retaste-local --local --file scripts/seed-week1.sql"
  }
}
```

Run:

```bash
pnpm add drizzle-orm zod maplibre-gl csv-parse
pnpm add -D drizzle-kit vitest @playwright/test
```

Expected: dependency installation exits 0.

- [x] **Step 5: Configure the local D1 binding**

Set `wrangler.jsonc` to:

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "retaste-beta",
  "main": "./workers/app.ts",
  "compatibility_date": "2026-08-05",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "retaste-local",
      "database_id": "00000000-0000-0000-0000-000000000000"
    }
  ],
  "observability": { "enabled": true }
}
```

Create `.dev.vars.example`:

```dotenv
SESSION_SECRET=replace-with-at-least-32-random-characters
ADMIN_EMAIL=admin@example.com
```

- [x] **Step 6: Write and run the first smoke test**

Create `tests/unit/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("week 1 toolchain", () => {
  it("runs TypeScript tests", () => {
    expect("Re:Taste").toContain("Taste");
  });
});
```

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Expected: all three commands exit 0.

- [x] **Step 7: Commit the scaffold**

```bash
git add .
git commit -m "chore: scaffold Cloudflare React Router application"
```

---

### Task 2: D1 Schema and Deterministic Seed

**Files:**
- Create: `app/db/schema.ts`
- Create: `app/db/client.server.ts`
- Create: `drizzle/0000_week1.sql`
- Create: `scripts/seed-week1.sql`
- Test: `tests/unit/schema-contract.test.ts`

**Interfaces:**
- Consumes: Worker binding `DB: D1Database`.
- Produces: `createDb(database: D1Database)`, Wrangler-generated `Env`, and Drizzle tables `users`, `sessions`, `categories`, `places`, `placeCategories`, `voteEvents`, `currentVotes`, and `savedPlaces`.

- [x] **Step 1: Write the schema contract test**

Create `tests/unit/schema-contract.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  categories,
  currentVotes,
  places,
  savedPlaces,
  users,
  voteEvents,
} from "../../app/db/schema";

describe("week 1 schema", () => {
  it("exports every required domain table", () => {
    expect([users, categories, places, voteEvents, currentVotes, savedPlaces]).toHaveLength(6);
  });
});
```

Run `pnpm test -- tests/unit/schema-contract.test.ts`.

Expected: FAIL because `app/db/schema.ts` does not exist.

- [x] **Step 2: Implement typed Drizzle schema**

Create `app/db/schema.ts` with these exact table contracts:

```ts
import { integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  role: text("role", { enum: ["USER", "REVIEWER", "ADMIN"] }).notNull().default("USER"),
  ...timestamps,
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
});

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  emoji: text("emoji").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

export const places = sqliteTable("places", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  status: text("status", { enum: ["DRAFT", "PUBLISHED", "HIDDEN"] }).notNull().default("DRAFT"),
  address: text("address").notNull(),
  neighborhood: text("neighborhood").notNull(),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  phone: text("phone"),
  parkingSummary: text("parking_summary"),
  heroImageUrl: text("hero_image_url"),
  kakaoPlaceId: text("kakao_place_id"),
  searchText: text("search_text").notNull(),
  ...timestamps,
});

export const placeCategories = sqliteTable("place_categories", {
  placeId: text("place_id").notNull().references(() => places.id, { onDelete: "cascade" }),
  categoryId: text("category_id").notNull().references(() => categories.id, { onDelete: "restrict" }),
  isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
}, (table) => [primaryKey({ columns: [table.placeId, table.categoryId] })]);

export const voteEvents = sqliteTable("vote_events", {
  id: text("id").primaryKey(),
  placeId: text("place_id").notNull().references(() => places.id, { onDelete: "restrict" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  value: integer("value").notNull(),
  eventType: text("event_type", { enum: ["CREATE", "CHANGE", "WITHDRAW"] }).notNull(),
  previousEventId: text("previous_event_id"),
  createdAt: text("created_at").notNull(),
});

export const currentVotes = sqliteTable("current_votes", {
  placeId: text("place_id").notNull().references(() => places.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  eventId: text("event_id").notNull().references(() => voteEvents.id, { onDelete: "restrict" }),
  value: integer("value").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [primaryKey({ columns: [table.placeId, table.userId] })]);

export const savedPlaces = sqliteTable("saved_places", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  placeId: text("place_id").notNull().references(() => places.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.placeId] })]);
```

- [x] **Step 3: Add DB construction and generated environment bindings**

Create `app/db/client.server.ts`:

```ts
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function createDb(database: D1Database) {
  return drizzle(database, { schema });
}

export type AppDb = ReturnType<typeof createDb>;
```

Run `wrangler types` after each binding change and use the generated global `Env` interface. Do not hand-write Worker binding interfaces because they can drift from `wrangler.jsonc`.

- [x] **Step 4: Write migration and seed SQL**

Create `drizzle/0000_week1.sql` with SQL equivalent to the schema, including `CHECK(value IN (-1, 1))`, FK constraints, and indexes on `places(status)`, `places(search_text)`, and `place_categories(category_id, place_id)`.

Create `scripts/seed-week1.sql` containing idempotent `INSERT OR IGNORE` rows for categories `ramen`, `donkatsu`, `gukbap`, `bakery`, and at least six clearly labeled sample places with coordinates inside Gwangju. Each place must use a stable ID and `PUBLISHED` status.

- [x] **Step 5: Apply migration and verify constraints**

Run:

```bash
pnpm exec wrangler d1 execute retaste-local --local --file drizzle/0000_week1.sql
pnpm db:seed:local
pnpm exec wrangler d1 execute retaste-local --local --command "SELECT COUNT(*) AS count FROM places"
pnpm test -- tests/unit/schema-contract.test.ts
```

Expected: the query reports at least 6 places and the test passes.

- [x] **Step 6: Commit database foundation**

```bash
git add app/db app/lib drizzle scripts tests/unit/schema-contract.test.ts wrangler.jsonc package.json pnpm-lock.yaml
git commit -m "feat: add week one D1 data model"
```

---

### Task 3: Rating v1 and Transactional Votes

**Files:**
- Create: `app/features/ratings/rating-v1.ts`
- Create: `app/features/ratings/vote.server.ts`
- Test: `tests/unit/rating-v1.test.ts`
- Test: `tests/integration/vote.server.test.ts`

**Interfaces:**
- Consumes: `AppDb`, `voteEvents`, `currentVotes`.
- Produces: `calculateRating(input: { positive: number; negative: number }): RatingV1`; `castVote(db, input: { placeId: string; userId: string; value: -1 | 1; now: string; eventId: string }): Promise<void>`.

- [x] **Step 1: Write failing rating tests**

Create `tests/unit/rating-v1.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { calculateRating } from "../../app/features/ratings/rating-v1";

describe("rating v1", () => {
  it("starts at 50 percent with no votes", () => {
    expect(calculateRating({ positive: 0, negative: 0 })).toEqual({
      algorithmVersion: "rating-v1",
      positive: 0,
      negative: 0,
      displayScore: 50,
      sampleStatus: "INSUFFICIENT",
    });
  });

  it("uses Beta(2,2) and exposes scores after eight votes", () => {
    expect(calculateRating({ positive: 6, negative: 2 }).displayScore).toBe(67);
    expect(calculateRating({ positive: 6, negative: 2 }).sampleStatus).toBe("VISIBLE");
  });
});
```

Run `pnpm test -- tests/unit/rating-v1.test.ts`.

Expected: FAIL because the module does not exist.

- [x] **Step 2: Implement rating v1**

Create `app/features/ratings/rating-v1.ts`:

```ts
export interface RatingV1 {
  algorithmVersion: "rating-v1";
  positive: number;
  negative: number;
  displayScore: number;
  sampleStatus: "INSUFFICIENT" | "VISIBLE";
}

export function calculateRating(input: { positive: number; negative: number }): RatingV1 {
  const alpha = 2 + input.positive;
  const beta = 2 + input.negative;
  return {
    algorithmVersion: "rating-v1",
    positive: input.positive,
    negative: input.negative,
    displayScore: Math.round((alpha / (alpha + beta)) * 100),
    sampleStatus: input.positive + input.negative >= 8 ? "VISIBLE" : "INSUFFICIENT",
  };
}
```

- [x] **Step 3: Write vote service integration cases**

Create `tests/integration/vote.server.test.ts` using a test D1 database migrated from `drizzle/0000_week1.sql`. Assert:

```ts
it("creates one current vote and appends a change event", async () => {
  await castVote(db, { placeId, userId, value: 1, now: "2026-08-05T00:00:00Z", eventId: "vote-1" });
  await castVote(db, { placeId, userId, value: -1, now: "2026-08-05T00:01:00Z", eventId: "vote-2" });
  expect(await countVoteEvents(db, placeId, userId)).toBe(2);
  expect(await getCurrentVote(db, placeId, userId)).toBe(-1);
});
```

Run `pnpm test -- tests/integration/vote.server.test.ts`.

Expected: FAIL because `castVote` does not exist.

- [x] **Step 4: Implement transactional vote writes**

Create `app/features/ratings/vote.server.ts` with `castVote` that:

```ts
export async function castVote(db: AppDb, input: CastVoteInput): Promise<void> {
  if (input.value !== 1 && input.value !== -1) throw new Error("INVALID_VOTE_VALUE");
  const previous = await db.query.currentVotes.findFirst({
    where: and(eq(currentVotes.placeId, input.placeId), eq(currentVotes.userId, input.userId)),
  });
  await db.batch([
    db.insert(voteEvents).values({
      id: input.eventId,
      placeId: input.placeId,
      userId: input.userId,
      value: input.value,
      eventType: previous ? "CHANGE" : "CREATE",
      previousEventId: previous?.eventId ?? null,
      createdAt: input.now,
    }),
    db.insert(currentVotes).values({
      placeId: input.placeId,
      userId: input.userId,
      eventId: input.eventId,
      value: input.value,
      updatedAt: input.now,
    }).onConflictDoUpdate({
      target: [currentVotes.placeId, currentVotes.userId],
      set: { eventId: input.eventId, value: input.value, updatedAt: input.now },
    }),
  ]);
}
```

Include the exact `CastVoteInput` type and Drizzle imports required by this implementation.

- [x] **Step 5: Run rating and vote checks**

Run:

```bash
pnpm test -- tests/unit/rating-v1.test.ts tests/integration/vote.server.test.ts
pnpm typecheck
```

Expected: both test files pass and typecheck exits 0.

- [x] **Step 6: Commit rating domain**

```bash
git add app/features/ratings tests/unit/rating-v1.test.ts tests/integration/vote.server.test.ts
git commit -m "feat: add reproducible rating and vote events"
```

---

### Task 4: Beta Identity, Sessions, and Role Guards

**Files:**
- Create: `app/features/auth/session.server.ts`
- Create: `app/features/auth/guards.server.ts`
- Create: `app/routes/login.tsx`
- Test: `tests/unit/auth-guards.test.ts`
- Test: `tests/e2e/login.spec.ts`

**Interfaces:**
- Consumes: `users`, `sessions`, `AppEnv`.
- Produces: `getOptionalUser(request, env)`, `requireUser(request, env)`, `requireAdmin(request, env)`, and `/login`.

- [x] **Step 1: Write role guard tests**

Create `tests/unit/auth-guards.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { assertRole } from "../../app/features/auth/guards.server";

describe("role guards", () => {
  it("allows matching roles", () => expect(() => assertRole("ADMIN", ["ADMIN"])).not.toThrow());
  it("rejects non-matching roles", () => expect(() => assertRole("USER", ["ADMIN"])).toThrow("FORBIDDEN"));
});
```

Run the test and expect module-not-found failure.

- [x] **Step 2: Implement opaque beta sessions and guards**

Implement cryptographically random, opaque cookie-backed session IDs whose records live in D1. Cookies must be `HttpOnly`, `Secure` outside local development, `SameSite=Lax`, and expire after seven days. Implement:

```ts
export type UserRole = "USER" | "REVIEWER" | "ADMIN";

export function assertRole(actual: UserRole, allowed: readonly UserRole[]): void {
  if (!allowed.includes(actual)) throw new Response("Forbidden", { status: 403, statusText: "FORBIDDEN" });
}
```

`requireUser` redirects to `/login?returnTo=<encoded path>`. `requireAdmin` calls `requireUser` and accepts only `ADMIN`.

- [x] **Step 3: Implement beta login route**

Create `/login` with email and display name fields validated by Zod. The action upserts a user; `ADMIN_EMAIL` receives role `ADMIN`, all others receive `USER`; it creates a seven-day D1 session and redirects only to a same-origin path beginning with `/`.

- [x] **Step 4: Test authentication behavior**

Run:

```bash
pnpm test -- tests/unit/auth-guards.test.ts
pnpm test:e2e -- tests/e2e/login.spec.ts
```

Expected: User login reaches `/`, malicious external `returnTo` is ignored, and a User receives 403 from `/admin/places`.

- [x] **Step 5: Commit authentication slice**

```bash
git add app/features/auth app/routes/login.tsx tests/unit/auth-guards.test.ts tests/e2e/login.spec.ts
git commit -m "feat: add beta identity and role guards"
```

---

### Task 5: Place Queries, CSV Import, and Admin CRUD

**Files:**
- Create: `app/features/places/place.types.ts`
- Create: `app/features/places/place.server.ts`
- Create: `app/features/places/import.server.ts`
- Create: `app/routes/admin-places.tsx`
- Create: `app/routes/admin-import.tsx`
- Test: `tests/unit/place-import.test.ts`
- Test: `tests/integration/place.server.test.ts`

**Interfaces:**
- Consumes: `AppDb`, `requireAdmin`, place/category tables.
- Produces: `listPlaces(filters)`, `getPlaceBySlug(slug)`, `upsertPlace(input)`, and `parsePlaceCsv(text): PlaceImportResult`.

- [x] **Step 1: Write CSV validation tests**

Create `tests/unit/place-import.test.ts` covering a valid row and invalid coordinates:

```ts
const valid = "name,slug,address,neighborhood,latitude,longitude,primary_category,hero_image_url\n테스트식당,test-place,광주광역시 동구 테스트로 1,동명동,35.1465,126.9220,ramen,https://images.example.com/test.jpg";
expect(parsePlaceCsv(valid).rows).toHaveLength(1);
expect(parsePlaceCsv(valid).errors).toEqual([]);

const invalid = valid.replace("35.1465", "not-a-number");
expect(parsePlaceCsv(invalid).errors[0]).toMatchObject({ row: 2, field: "latitude" });
```

Run and expect module-not-found failure.

- [x] **Step 2: Define public place contracts and CSV parser**

Define `PlaceSummary`, `PlaceDetail`, `PlaceFilters`, `PlaceImportRow`, `PlaceImportError`, and `PlaceImportResult`. Use Zod to require non-empty name/slug/address/neighborhood/category, latitude `33..39`, longitude `124..132`, and an optional HTTP(S) image URL. Normalize `searchText` from name, neighborhood, address, and primary category.

- [x] **Step 3: Implement place service**

Implement `listPlaces` with `PUBLISHED` status, category slug, bounding box, search prefix/contains, stable `(name,id)` cursor, and rating counts from `current_votes`. Implement `getPlaceBySlug` to return 404 for non-public places. Implement `upsertPlace` in a D1 batch with its primary category relation.

- [x] **Step 4: Implement minimal Admin routes**

`/admin/places` lists status, name, category, and edit link. `/admin/import` accepts a UTF-8 CSV file up to 2 MB, shows row-specific errors without partial writes, and imports valid rows only after an explicit confirmation submission. Both loader and action call `requireAdmin`.

- [x] **Step 5: Verify place behavior**

Run:

```bash
pnpm test -- tests/unit/place-import.test.ts tests/integration/place.server.test.ts
pnpm typecheck
```

Expected: invalid imports do not write rows, valid imports are idempotent by slug, and hidden/draft places are absent from public queries.

- [ ] **Step 6: Commit place administration**

```bash
git add app/features/places app/routes/admin-places.tsx app/routes/admin-import.tsx tests
git commit -m "feat: add real place import and administration"
```

---

### Task 6: Editorial Public UI and Synchronized Map/List

**Files:**
- Modify: `app/app.css`
- Modify: `app/root.tsx`
- Modify: `app/routes.ts`
- Create: `app/routes/home.tsx`
- Create: `app/routes/map-category.tsx`
- Create: `app/routes/place-detail.tsx`
- Create: `app/components/map/PlaceMap.tsx`
- Create: `app/components/places/PlaceCard.tsx`
- Test: `tests/unit/map-state.test.ts`
- Test: `tests/e2e/browse.spec.ts`

**Interfaces:**
- Consumes: `listPlaces`, `getPlaceBySlug`, `PlaceSummary`, `RatingV1`.
- Produces: `/`, `/maps/:categorySlug`, `/places/:placeSlug`; URL keys `bbox`, `selected`, `q`, and `view`.

- [ ] **Step 1: Write URL state and browse acceptance tests**

Assert that `parseMapState("?bbox=126.80,35.05,127.05,35.25&selected=place-1&view=list")` returns numeric bounds and `view: "list"`; invalid bounds return the Gwangju default. In Playwright, assert category navigation renders the same seeded place in both the list and map marker accessible label.

- [ ] **Step 2: Implement design tokens and document shell**

Set CSS variables:

```css
:root {
  --bg: #fafaf8;
  --text: #111111;
  --muted: #6b6b6b;
  --border: #d9d9d4;
  --accent: #22543d;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;
  color: var(--text);
  background: var(--bg);
  font-family: Pretendard, "Noto Sans KR", system-ui, sans-serif;
}
```

Implement skip link, semantic header/main/footer, focus styles, reduced-motion handling, and route-level error boundary.

- [ ] **Step 3: Implement home and category list loaders**

Home displays the product proposition, category grid, and latest places. Category loader validates `bbox`, `q`, `selected`, and `view`, calls `listPlaces`, and returns serializable place summaries.

- [ ] **Step 4: Implement client-only MapLibre map**

`PlaceMap` initializes only inside `useEffect`, uses a Gwangju default center `[126.8526, 35.1595]`, and renders accessible marker buttons whose labels equal `장소명 지도 핀`. It emits selected place and debounced bounds after 400 ms. It never requests geolocation during mount; “내 주변” triggers the browser permission request.

- [ ] **Step 5: Implement synchronized responsive layout**

Desktop uses 60% map and 40% list. Mobile exposes map/list tabs using `view=map|list`; both representations remain keyboard reachable. Clicking a marker updates `selected` in the URL and highlights/scrolls the matching card without refetching unrelated state.

- [ ] **Step 6: Implement place detail view**

Display editorial hero, recommendation percentage or “평가 수 부족”, positive/negative counts, address, parking summary, category, inactive save/vote positions that Task 7 activates, and Kakao/Naver external directions links. Missing images use a neutral text fallback with no broken image request.

- [ ] **Step 7: Run UI verification**

Run:

```bash
pnpm test -- tests/unit/map-state.test.ts
pnpm test:e2e -- tests/e2e/browse.spec.ts
pnpm typecheck
pnpm build
```

Expected: all checks pass at desktop and mobile Playwright projects.

- [ ] **Step 8: Commit public exploration UI**

```bash
git add app tests
git commit -m "feat: add synchronized map and place exploration"
```

---

### Task 7: Vote and Save User Actions

**Files:**
- Modify: `app/routes/place-detail.tsx`
- Create: `app/components/ratings/VoteControl.tsx`
- Create: `app/features/saves/save.server.ts`
- Test: `tests/integration/save.server.test.ts`
- Test: `tests/e2e/vote-save.spec.ts`

**Interfaces:**
- Consumes: `requireUser`, `castVote`, `savedPlaces`, `getPlaceBySlug`.
- Produces: place-detail intents `vote` and `save`; `setSaved(db, { userId, placeId, saved, now }): Promise<void>`.

- [ ] **Step 1: Write failing save and E2E tests**

Assert `setSaved(...saved:true)` is idempotent and `saved:false` removes the row. E2E flow: login, open place, recommend, switch to not recommended, save, reload, and observe the final vote/save state.

- [ ] **Step 2: Implement save service**

```ts
export async function setSaved(db: AppDb, input: SaveInput): Promise<void> {
  if (input.saved) {
    await db.insert(savedPlaces).values({
      userId: input.userId,
      placeId: input.placeId,
      createdAt: input.now,
    }).onConflictDoNothing();
    return;
  }
  await db.delete(savedPlaces).where(and(
    eq(savedPlaces.userId, input.userId),
    eq(savedPlaces.placeId, input.placeId),
  ));
}
```

Define `SaveInput` with `userId`, `placeId`, `saved`, and ISO `now`.

- [ ] **Step 3: Add guarded place actions**

The place-detail action calls `requireUser`, validates a discriminated union:

```ts
const actionSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("vote"), value: z.coerce.number().refine((v): v is -1 | 1 => v === -1 || v === 1) }),
  z.object({ intent: z.literal("save"), saved: z.enum(["true", "false"]).transform((v) => v === "true") }),
]);
```

Generate event IDs with `crypto.randomUUID()`, never accept user ID from form data, and redirect unauthenticated users to login.

- [ ] **Step 4: Implement accessible optimistic controls**

`VoteControl` uses two labeled buttons, `aria-pressed`, visible selected state beyond color, pending state, and an `aria-live` result message. Save uses a labeled toggle button. Loader returns the current user's own vote/save state without exposing identity to other users.

- [ ] **Step 5: Verify repeatable user flow**

Run:

```bash
pnpm test -- tests/integration/save.server.test.ts tests/integration/vote.server.test.ts
pnpm test:e2e -- tests/e2e/vote-save.spec.ts
pnpm typecheck
```

Expected: changing a vote appends an event but leaves one current vote; save survives reload.

- [ ] **Step 6: Commit user reactions**

```bash
git add app tests
git commit -m "feat: add guarded vote and save actions"
```

---

### Task 8: Real Data Intake, Hardening, and Remote Deployment

**Files:**
- Create: `data/week1-places.csv`
- Create: `docs/operations/week1-data-runbook.md`
- Create: `docs/operations/cloudflare-deploy.md`
- Create: `tests/e2e/release.spec.ts`
- Modify: `wrangler.jsonc`

**Interfaces:**
- Consumes: Admin CSV import, all public/user routes, Cloudflare account at the deployment sub-step only.
- Produces: production Worker URL, remote D1 database binding, reproducible data/deploy runbooks.

- [ ] **Step 1: Prepare verified real-data CSV**

Create `data/week1-places.csv` with 20–50 rows and exact header:

```csv
name,slug,address,neighborhood,latitude,longitude,primary_category,phone,parking_summary,kakao_place_id,hero_image_url,status
```

Each row must be sourced or manually verified, use coordinates within service geography, have a unique slug, and use only images the project is authorized to publish. Do not fabricate business facts or copy third-party images without permission.

- [ ] **Step 2: Run local import and data-quality queries**

Run the Admin import, then execute:

```bash
pnpm exec wrangler d1 execute retaste-local --local --command "SELECT COUNT(*) total, SUM(hero_image_url IS NULL) missing_images, SUM(latitude IS NULL OR longitude IS NULL) missing_coordinates FROM places WHERE status='PUBLISHED'"
pnpm exec wrangler d1 execute retaste-local --local --command "SELECT slug, COUNT(*) count FROM places GROUP BY slug HAVING count > 1"
```

Expected: 20–50 published rows, zero duplicate slugs, zero missing coordinates, and missing image count documented.

- [ ] **Step 3: Write operational runbooks**

`docs/operations/week1-data-runbook.md` documents CSV columns, validation rules, import, rollback by imported IDs, and quality queries. `docs/operations/cloudflare-deploy.md` documents login, remote D1 creation, migration, secret entry, data import, deploy, smoke tests, and rollback to the prior Worker version.

- [ ] **Step 4: Run the full local release gate**

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm test:e2e
```

Expected: every command exits 0. Fix failures before requesting Cloudflare access.

- [ ] **Step 5: Request only the required Cloudflare account action**

Ask the user to complete `pnpm wrangler login` in the current terminal, or provide an API token limited to Workers Scripts, D1, and account membership read. Do not request the global API key.

- [ ] **Step 6: Create remote D1 and replace the local development ID**

Run:

```bash
pnpm exec wrangler d1 create retaste-production
```

Copy the returned `database_id` into `wrangler.jsonc`, then run:

```bash
pnpm exec wrangler d1 execute retaste-production --remote --file drizzle/0000_week1.sql
```

Expected: remote migration exits 0.

- [ ] **Step 7: Configure secrets and deploy**

Run:

```bash
pnpm exec wrangler secret put SESSION_SECRET
pnpm exec wrangler secret put ADMIN_EMAIL
pnpm deploy
```

Expected: Wrangler prints a `workers.dev` URL and deployment version.

- [ ] **Step 8: Import production data and run remote smoke tests**

Use the deployed Admin import to load `data/week1-places.csv`, then run `BASE_URL=<workers-url> pnpm test:e2e -- tests/e2e/release.spec.ts`.

The release spec asserts HTTP 200 for home, category map, and place detail; login succeeds; vote/save persist; `/admin/places` rejects a normal user; and no console error occurs on the map page.

- [ ] **Step 9: Commit release configuration and tag the beta**

```bash
git add data docs/operations wrangler.jsonc tests/e2e/release.spec.ts
git commit -m "release: prepare week one real-data beta"
git tag week1-beta
```

Expected: clean `git status --short` and tag `week1-beta` points to the release commit.

---

## Seven-Day Schedule

| Day | Tasks | Shippable checkpoint |
|---|---|---|
| 1 | Tasks 1–2 | App builds locally; D1 schema and seed work |
| 2 | Tasks 3–4 | Login, roles, deterministic rating, vote history work |
| 3 | Task 5 | Real CSV import and minimal Admin place management work |
| 4 | Task 6 | Home, category map/list, and place detail work on mobile/desktop |
| 5 | Task 7 | Logged-in vote and save flow passes E2E |
| 6 | Task 8 steps 1–4 | Real data and full local release gate pass |
| 7 | Task 8 steps 5–9 | Cloudflare D1 migration, deploy, smoke test, and beta tag complete |

## Week 1 Acceptance Gate

- Production URL is reachable on mobile and desktop.
- 20–50 verified real places can be imported reproducibly; the path to 300 uses the same CSV contract.
- Guest can browse; User can vote and save; normal User cannot access Admin mutations.
- Map and accessible list show the same filtered places and preserve selection in the URL.
- Vote changes preserve two events and one current vote.
- Rating output records algorithm name `rating-v1` and uses Beta(2,2).
- Full test, typecheck, build, E2E, and production smoke suites pass.
- Cloudflare secrets are not committed; deployment and data rollback instructions exist.

## Official References Verified on 2026-08-05

- Cloudflare React Router guide: `https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/`
- Cloudflare Workers Static Assets: `https://developers.cloudflare.com/workers/static-assets/`
- Cloudflare D1 local development: `https://developers.cloudflare.com/d1/best-practices/local-development/`
