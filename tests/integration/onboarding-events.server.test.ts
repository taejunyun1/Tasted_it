import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  castVote: vi.fn(async () => undefined),
  getOptionalUser: vi.fn(async () => null),
  getLatestRatingSnapshot: vi.fn(async () => null),
  getPlaceBySlug: vi.fn(async () => ({ id: "place-event-test", slug: "place-event-test" })),
  recordRecommendationFeedback: vi.fn(async () => undefined),
  refreshInferredTasteSignals: vi.fn(async () => undefined),
  requireUser: vi.fn(async () => ({ id: "user-event-test" })),
  resolvePlaceSlugRedirect: vi.fn(async () => null),
  setSavedAndRefreshTaste: vi.fn(async () => undefined),
}));

vi.mock("react-router", () => ({
  Form: () => null,
  Link: () => null,
  data: (value: unknown, init?: ResponseInit) => ({ data: value, init }),
  redirect: (location: string, init?: number | ResponseInit) => {
    const responseInit = typeof init === "number" ? { status: init } : init;
    const headers = new Headers(responseInit?.headers);
    headers.set("Location", location);
    return new Response(null, { ...responseInit, status: responseInit?.status ?? 302, headers });
  },
  useFetcher: () => ({ data: undefined, load: () => undefined, state: "idle" }),
}));

vi.mock("react", () => ({
  useEffect: () => undefined,
  useRef: <Value>(value: Value) => ({ current: value }),
  useState: <Value>(value: Value) => [value, () => undefined],
}));

vi.mock("react/jsx-runtime", () => ({
  Fragment: Symbol("Fragment"),
  jsx: () => null,
  jsxs: () => null,
}));

vi.mock("react/jsx-dev-runtime", () => ({
  Fragment: Symbol("Fragment"),
  jsxDEV: () => null,
}));

vi.mock("../../app/features/auth/session.server", () => ({
  getOptionalUser: routeMocks.getOptionalUser,
  requireUser: routeMocks.requireUser,
}));

vi.mock("../../app/features/places/place.server", () => ({
  getPlaceBySlug: routeMocks.getPlaceBySlug,
  resolvePlaceSlugRedirect: routeMocks.resolvePlaceSlugRedirect,
}));

vi.mock("../../app/features/ratings/vote.server", () => ({
  castVote: routeMocks.castVote,
  getCurrentVoteState: vi.fn(async () => null),
  withdrawVote: vi.fn(async () => true),
}));

vi.mock("../../app/features/saves/save.server", () => ({
  getSaved: vi.fn(async () => false),
  setSavedAndRefreshTaste: routeMocks.setSavedAndRefreshTaste,
}));

vi.mock("../../app/features/members/taste-learning.server", () => ({
  recordRecommendationFeedback: routeMocks.recordRecommendationFeedback,
  refreshInferredTasteSignals: routeMocks.refreshInferredTasteSignals,
}));

vi.mock("../../app/features/ratings/rating-v1", () => ({
  calculateRating: () => ({ sampleStatus: "COLLECTING", displayScore: null }),
}));
vi.mock("../../app/features/ratings/recompute.server", () => ({
  getLatestRatingSnapshot: routeMocks.getLatestRatingSnapshot,
}));
vi.mock("../../app/features/ratings/flavor-print.server", () => ({
  getPlaceFlavorPrint: vi.fn(async () => ({ status: "COLLECTING", ratingCount: 0 })),
}));
vi.mock("../../app/features/ratings/golden-pick.server", () => ({
  listActiveGoldenPicks: vi.fn(async () => []),
}));
vi.mock("../../app/features/ratings/rating-badges.server", () => ({
  getHiddenGemStatus: vi.fn(async () => ({ eligible: false })),
  recordPlaceDetailView: vi.fn(async () => undefined),
}));

import { createDb, type AppDb } from "../../app/db/client.server";
import {
  guestTasteBadges,
  guestTasteSessions,
  productEvents,
  users,
} from "../../app/db/schema";
import {
  PRODUCT_EVENT_METADATA_KEYS,
  PRODUCT_EVENT_NAMES,
  recordProductEvent,
  type ProductEventMetadata,
  type ProductEventMetadataKey,
  type ProductEventName,
} from "../../app/features/onboarding/onboarding-events.server";
import {
  onboardingNavigation,
  type OnboardingNavigationDirection,
} from "../../app/components/onboarding/TasteOnboarding";
import {
  recommendationPlacePath,
  recommendationRequestPath,
} from "../../app/components/places/PlaceCard";
import { mergeGuestTasteSessionFromRequest } from "../../app/features/onboarding/guest-merge.server";

const NOW = "2026-08-10T00:00:00.000Z";

async function seedGuest(
  db: AppDb,
  id = `guest-${crypto.randomUUID()}`,
  step: "LOCATION" | "FOOD" | "STYLE" | "PREVIEW" = "LOCATION",
) {
  await db.insert(guestTasteSessions).values({
    id,
    selectionEpoch: 1,
    locationMode: "DEFAULT",
    completedStepsJson: JSON.stringify([step]),
    expiresAt: "2026-09-09T00:00:00.000Z",
    createdAt: NOW,
    updatedAt: NOW,
  });
  return id;
}

async function seedUser(db: AppDb, id = `user-${crypto.randomUUID()}`) {
  await db.insert(users).values({
    id,
    email: `${id}@example.com`,
    displayName: "제품 이벤트 테스트 사용자",
    role: "USER",
    createdAt: NOW,
    updatedAt: NOW,
  });
  return id;
}

function compileTimeAllowlistContract(db: AppDb, guestSessionId: string) {
  const eventName: ProductEventName = "ONBOARDING_STARTED";
  const metadataKey: ProductEventMetadataKey = "step";
  const metadata: ProductEventMetadata = { step: "FOOD", selectedCount: 3 };
  void eventName;
  void metadataKey;
  void metadata;

  // @ts-expect-error event names outside the public union must not compile.
  void recordProductEvent(db, { eventName: "TASTE_ACTIVITY_VERSION", guestSessionId, userId: null, occurredAt: NOW });
  // @ts-expect-error metadata keys outside the public allowlist must not compile.
  void recordProductEvent(db, { eventName, guestSessionId, userId: null, metadata: { email: "member@example.com" }, occurredAt: NOW });
}
void compileTimeAllowlistContract;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime("2026-08-10T00:10:00.000Z");
  routeMocks.castVote.mockReset();
  routeMocks.castVote.mockResolvedValue(undefined);
  routeMocks.getOptionalUser.mockReset();
  routeMocks.getOptionalUser.mockResolvedValue(null);
  routeMocks.getLatestRatingSnapshot.mockReset();
  routeMocks.getLatestRatingSnapshot.mockResolvedValue(null);
  routeMocks.getPlaceBySlug.mockReset();
  routeMocks.getPlaceBySlug.mockResolvedValue({ id: "place-event-test", slug: "place-event-test" });
  routeMocks.recordRecommendationFeedback.mockReset();
  routeMocks.recordRecommendationFeedback.mockResolvedValue(undefined);
  routeMocks.refreshInferredTasteSignals.mockReset();
  routeMocks.refreshInferredTasteSignals.mockResolvedValue(undefined);
  routeMocks.requireUser.mockReset();
  routeMocks.requireUser.mockResolvedValue({ id: "user-event-test" });
  routeMocks.resolvePlaceSlugRedirect.mockReset();
  routeMocks.resolvePlaceSlugRedirect.mockResolvedValue(null);
  routeMocks.setSavedAndRefreshTaste.mockReset();
  routeMocks.setSavedAndRefreshTaste.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("recordProductEvent", () => {
  it("exports exactly the specified compile-time and runtime allowlists", () => {
    expect(PRODUCT_EVENT_NAMES).toEqual([
      "ONBOARDING_STARTED",
      "ONBOARDING_STEP_COMPLETED",
      "ONBOARDING_COMPLETED",
      "ONBOARDING_SKIPPED",
      "RECOMMENDATION_DETAIL_OPENED",
      "RECOMMENDATION_SAVED",
      "RECOMMENDATION_LIKED",
      "RECOMMENDATION_DISLIKED",
      "GUEST_CONVERTED",
    ]);
    expect(PRODUCT_EVENT_METADATA_KEYS).toEqual([
      "step",
      "selectedCount",
      "sourceRail",
      "discoveryMode",
      "reason",
    ]);
  });

  it("stores allowlisted metadata and generates an opaque event ID", async () => {
    const db = createDb(env.DB);
    const guestSessionId = await seedGuest(db);

    const result = await recordProductEvent(db, {
      eventName: "ONBOARDING_STEP_COMPLETED",
      guestSessionId,
      userId: null,
      metadata: { step: "FOOD", selectedCount: 3 },
      occurredAt: NOW,
    });

    expect(result.recorded).toBe(true);
    expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(result.id).not.toContain("example.com");
    expect(result.id).not.toContain("제품 이벤트 테스트 사용자");
    expect(result.id).not.toContain("126.978");
    await expect(db.select().from(productEvents).where(eq(productEvents.id, result.id!)))
      .resolves.toEqual([expect.objectContaining({
        id: result.id,
        eventName: "ONBOARDING_STEP_COMPLETED",
        guestSessionId,
        userId: null,
        metadataJson: JSON.stringify({ step: "FOOD", selectedCount: 3 }),
        occurredAt: NOW,
      })]);
  });

  it.each(["email", "name", "latitude", "longitude", "address", "unknownKey"])(
    "rejects disallowed metadata key %s",
    async (key) => {
      const db = createDb(env.DB);
      const guestSessionId = await seedGuest(db);

      await expect(recordProductEvent(db, {
        eventName: "ONBOARDING_STARTED",
        guestSessionId,
        userId: null,
        metadata: { [key]: key === "email" ? "member@example.com" : "not-allowed" } as never,
        occurredAt: NOW,
      })).rejects.toThrow("EVENT_METADATA_NOT_ALLOWED");
    },
  );

  it.each([
    ["nested object", { step: { value: "FOOD" } }],
    ["array", { step: ["FOOD"] }],
    ["null", { reason: null }],
    ["float", { selectedCount: 1.5 }],
    ["NaN", { selectedCount: Number.NaN }],
    ["Infinity", { selectedCount: Number.POSITIVE_INFINITY }],
  ])("rejects %s metadata values", async (_label, metadata) => {
    const db = createDb(env.DB);
    const guestSessionId = await seedGuest(db);

    await expect(recordProductEvent(db, {
      eventName: "ONBOARDING_STEP_COMPLETED",
      guestSessionId,
      userId: null,
      metadata: metadata as never,
      occurredAt: NOW,
    })).rejects.toThrow("EVENT_METADATA_NOT_ALLOWED");
  });

  it("rejects an event name outside the runtime allowlist", async () => {
    const db = createDb(env.DB);
    const guestSessionId = await seedGuest(db);

    await expect(recordProductEvent(db, {
      eventName: "TASTE_ACTIVITY_VERSION" as ProductEventName,
      guestSessionId,
      userId: null,
      occurredAt: NOW,
    })).rejects.toThrow("PRODUCT_EVENT_NAME_NOT_ALLOWED");
  });

  it("does not write an event when both identities are absent", async () => {
    const db = createDb(env.DB);
    const before = await db.select().from(productEvents);

    await expect(recordProductEvent(db, {
      eventName: "ONBOARDING_STARTED",
      guestSessionId: null,
      userId: null,
      occurredAt: NOW,
    })).resolves.toEqual({ recorded: false, id: null });

    await expect(db.select().from(productEvents)).resolves.toHaveLength(before.length);
  });

  it("keeps guest and user identifiers behind database foreign keys", async () => {
    const db = createDb(env.DB);
    const guestSessionId = await seedGuest(db);
    const userId = await seedUser(db);

    await expect(recordProductEvent(db, {
      eventName: "GUEST_CONVERTED",
      guestSessionId,
      userId,
      occurredAt: NOW,
    })).resolves.toMatchObject({ recorded: true });

    await expect(recordProductEvent(db, {
      eventName: "ONBOARDING_STARTED",
      guestSessionId: `missing-${crypto.randomUUID()}`,
      userId: null,
      occurredAt: NOW,
    })).rejects.toThrow();
    await expect(recordProductEvent(db, {
      eventName: "RECOMMENDATION_SAVED",
      guestSessionId: null,
      userId: `missing-${crypto.randomUUID()}`,
      occurredAt: NOW,
    })).rejects.toThrow();
  });

  it("atomically records at most one unique guest lifecycle event", async () => {
    const db = createDb(env.DB);
    const guestSessionId = await seedGuest(db);

    const results = await Promise.all(Array.from({ length: 8 }, () => recordProductEvent(db, {
      eventName: "ONBOARDING_STARTED",
      guestSessionId,
      userId: null,
      occurredAt: NOW,
    })));

    expect(results.filter((result) => result.recorded)).toHaveLength(1);
    await expect(db.select().from(productEvents).where(and(
      eq(productEvents.guestSessionId, guestSessionId),
      eq(productEvents.eventName, "ONBOARDING_STARTED"),
    ))).resolves.toHaveLength(1);
  });

  it("rejects a caller-provided event ID unless it is an opaque UUID", async () => {
    const db = createDb(env.DB);
    const guestSessionId = await seedGuest(db);

    await expect(recordProductEvent(db, {
      eventId: "member@example.com-35.1-name",
      eventName: "RECOMMENDATION_DETAIL_OPENED",
      guestSessionId,
      userId: null,
      occurredAt: NOW,
    } as never)).rejects.toThrow("PRODUCT_EVENT_ID_NOT_ALLOWED");
  });
});

function cookiePair(setCookie: string) {
  return setCookie.split(";", 1)[0]!;
}

function onboardingForm(input: {
  intent: "SAVE_STEP" | "SAVE_SELECTION" | "SKIP" | "COMPLETE";
  currentStep: "LOCATION" | "FOOD" | "STYLE" | "PREVIEW";
  selectionEpoch?: number;
  selectionRevision?: number;
  direction?: OnboardingNavigationDirection;
  foodBadgeIds?: string[];
  styleBadgeIds?: string[];
}) {
  const navigation = onboardingNavigation(input.currentStep, input.direction ?? "FORWARD");
  const form = new FormData();
  form.set("intent", input.intent);
  form.set("currentStep", navigation.currentStep);
  form.set("targetStep", input.intent === "SAVE_SELECTION" ? navigation.currentStep : navigation.targetStep);
  form.set("direction", navigation.direction);
  form.set("selectionEpoch", String(input.selectionEpoch ?? 1));
  form.set("selectionRevision", String(input.selectionRevision ?? 1));
  form.set("locationMode", "DEFAULT");
  form.set("returnTo", "/places");
  for (const badgeId of input.foodBadgeIds ?? []) form.append("foodBadgeId", badgeId);
  for (const badgeId of input.styleBadgeIds ?? []) form.append("styleBadgeId", badgeId);
  return form;
}

async function selectedGuestBadges(db: AppDb, guestSessionId: string) {
  return db.select({ badgeId: guestTasteBadges.badgeId })
    .from(guestTasteBadges)
    .where(eq(guestTasteBadges.sessionId, guestSessionId));
}

describe("product event route wiring", () => {
  it.each([
    ["disabled", "loader", "/onboarding/taste"],
    ["authenticated", "loader", "/admin/candidates"],
    ["disabled", "action", "/auth/google"],
    ["authenticated", "action", "/logout"],
  ] as const)(
    "returns %s %s requests with a non-public returnTo to /places without mutation",
    async (guard, requestKind, returnTo) => {
      const db = createDb(env.DB);
      const guestSessionId = await seedGuest(db, undefined, "FOOD");
      await db.insert(guestTasteBadges).values({
        sessionId: guestSessionId,
        badgeId: "food-gukbap",
        selectedAt: NOW,
      });
      if (guard === "authenticated") {
        const userId = await seedUser(db);
        routeMocks.getOptionalUser.mockResolvedValue({ id: userId });
      }
      const sessionsBefore = await db.select().from(guestTasteSessions);
      const badgesBefore = await db.select().from(guestTasteBadges);
      const eventsBefore = await db.select().from(productEvents);
      const previousFlag = env.ONBOARDING_ENABLED;
      if (guard === "disabled") env.ONBOARDING_ENABLED = "false";

      try {
        const route = await import("../../app/routes/taste-onboarding");
        const response = requestKind === "loader"
          ? await route.loader({
            request: new Request(
              `https://retaste.test/onboarding/taste?returnTo=${encodeURIComponent(returnTo)}`,
              { headers: { Cookie: `retaste_guest=${guestSessionId}` } },
            ),
          } as never) as Response
          : await route.action({
            request: new Request("https://retaste.test/onboarding/taste", {
              method: "POST",
              headers: { Cookie: `retaste_guest=${guestSessionId}`, Origin: "https://retaste.test" },
              body: (() => {
                const form = onboardingForm({
                  intent: "SAVE_STEP",
                  currentStep: "FOOD",
                  foodBadgeIds: ["food-ramen"],
                });
                form.set("returnTo", returnTo);
                return form;
              })(),
            }),
          } as never) as Response;

        expect(response.headers.get("Location")).toBe("/places");
        expect(response.headers.get("Set-Cookie")).toBeNull();
      } finally {
        env.ONBOARDING_ENABLED = previousFlag;
      }

      await expect(db.select().from(guestTasteSessions)).resolves.toEqual(sessionsBefore);
      await expect(db.select().from(guestTasteBadges)).resolves.toEqual(badgesBefore);
      await expect(db.select().from(productEvents)).resolves.toEqual(eventsBefore);
    },
  );

  it("makes a disabled stale onboarding POST a complete no-mutation kill switch", async () => {
    const db = createDb(env.DB);
    const guestSessionId = await seedGuest(db, undefined, "FOOD");
    await db.insert(guestTasteBadges).values({
      sessionId: guestSessionId,
      badgeId: "food-gukbap",
      selectedAt: NOW,
    });
    const sessionsBefore = await db.select().from(guestTasteSessions);
    const eventsBefore = await db.select().from(productEvents);
    const form = onboardingForm({
      intent: "SAVE_STEP",
      currentStep: "FOOD",
      foodBadgeIds: ["food-ramen"],
    });
    form.set("returnTo", "/places.data?category=ramen-detail&_routes=routes%2Fplace-list");
    const previousFlag = env.ONBOARDING_ENABLED;
    env.ONBOARDING_ENABLED = "false";

    try {
      const { action } = await import("../../app/routes/taste-onboarding");
      const response = await action({
        request: new Request("https://retaste.test/onboarding/taste", {
          method: "POST",
          headers: { Cookie: `retaste_guest=${guestSessionId}`, Origin: "https://retaste.test" },
          body: form,
        }),
      } as never) as Response;

      expect(response.headers.get("Location")).toBe("/places?category=ramen-detail");
      expect(response.headers.get("Set-Cookie")).toBeNull();
    } finally {
      env.ONBOARDING_ENABLED = previousFlag;
    }

    await expect(db.select().from(guestTasteSessions)).resolves.toEqual(sessionsBefore);
    await expect(selectedGuestBadges(db, guestSessionId)).resolves.toEqual([{ badgeId: "food-gukbap" }]);
    await expect(db.select().from(productEvents)).resolves.toEqual(eventsBefore);
  });

  it("does not create guest state for an authenticated direct onboarding POST", async () => {
    const db = createDb(env.DB);
    const userId = await seedUser(db);
    routeMocks.getOptionalUser.mockResolvedValueOnce({ id: userId });
    const sessionsBefore = await db.select().from(guestTasteSessions);
    const eventsBefore = await db.select().from(productEvents);
    const { action } = await import("../../app/routes/taste-onboarding");

    const response = await action({
      request: new Request("https://retaste.test/onboarding/taste", {
        method: "POST",
        headers: { Origin: "https://retaste.test" },
        body: onboardingForm({ intent: "SKIP", currentStep: "LOCATION" }),
      }),
    } as never) as Response;

    expect(response.headers.get("Location")).toBe("/places");
    expect(response.headers.get("Set-Cookie")).toBeNull();
    await expect(db.select().from(guestTasteSessions)).resolves.toEqual(sessionsBefore);
    await expect(db.select().from(productEvents)).resolves.toEqual(eventsBefore);
  });

  it("records ONBOARDING_STARTED only when the loader creates a guest session", async () => {
    const { loader } = await import("../../app/routes/taste-onboarding");
    const first = await loader({
      request: new Request("https://retaste.test/onboarding/taste"),
    } as never) as unknown as { init?: ResponseInit };
    const setCookie = new Headers(first.init?.headers).get("Set-Cookie");
    expect(setCookie).toBeTruthy();
    const guestSessionId = decodeURIComponent(cookiePair(setCookie!).split("=")[1]!);

    await loader({
      request: new Request("https://retaste.test/onboarding/taste", {
        headers: { Cookie: cookiePair(setCookie!) },
      }),
    } as never);

    const events = await createDb(env.DB).select().from(productEvents)
      .where(eq(productEvents.guestSessionId, guestSessionId));
    expect(events).toEqual([
      expect.objectContaining({ eventName: "ONBOARDING_STARTED", metadataJson: "{}" }),
    ]);
  });

  it("records one onboarding start across concurrent revalidation of the same guest session", async () => {
    const db = createDb(env.DB);
    const guestSessionId = await seedGuest(db);
    const { loader } = await import("../../app/routes/taste-onboarding");
    const request = () => new Request("https://retaste.test/onboarding/taste", {
      headers: { Cookie: `retaste_guest=${guestSessionId}` },
    });

    await Promise.all(Array.from({ length: 8 }, () => loader({ request: request() } as never)));

    await expect(db.select().from(productEvents).where(and(
      eq(productEvents.guestSessionId, guestSessionId),
      eq(productEvents.eventName, "ONBOARDING_STARTED"),
    ))).resolves.toHaveLength(1);
  });

  it("treats simultaneous requests without a cookie as distinct server-issued guest sessions", async () => {
    const { loader } = await import("../../app/routes/taste-onboarding");
    const responses = await Promise.all([
      loader({ request: new Request("https://retaste.test/onboarding/taste") } as never),
      loader({ request: new Request("https://retaste.test/onboarding/taste") } as never),
    ]) as unknown as Array<{ init?: ResponseInit }>;
    const guestSessionIds = responses.map((response) => {
      const setCookie = new Headers(response.init?.headers).get("Set-Cookie")!;
      return decodeURIComponent(cookiePair(setCookie).split("=")[1]!);
    });

    expect(new Set(guestSessionIds)).toHaveLength(2);
    const rows = await createDb(env.DB).select().from(productEvents);
    for (const guestSessionId of guestSessionIds) {
      expect(rows).toContainEqual(expect.objectContaining({
        guestSessionId,
        eventName: "ONBOARDING_STARTED",
      }));
    }
  });

  it.each([
    ["SAVE_STEP", "LOCATION", "ONBOARDING_STEP_COMPLETED", { step: "LOCATION", selectedCount: 0 }, [], []],
    ["SAVE_STEP", "FOOD", "ONBOARDING_STEP_COMPLETED", { step: "FOOD", selectedCount: 2 }, ["food-gukbap", "food-ramen"], ["style-old-school"]],
    ["SKIP", "STYLE", "ONBOARDING_SKIPPED", { step: "STYLE", selectedCount: 1 }, ["food-gukbap"], ["style-old-school"]],
    ["COMPLETE", "PREVIEW", "ONBOARDING_COMPLETED", { step: "PREVIEW", selectedCount: 0 }, ["food-gukbap"], ["style-old-school"]],
  ] as const)("records a successful %s onboarding action", async (intent, currentStep, eventName, metadata, foodBadgeIds, styleBadgeIds) => {
    const db = createDb(env.DB);
    const guestSessionId = await seedGuest(db, undefined, currentStep);
    const { action } = await import("../../app/routes/taste-onboarding");

    await action({
      request: new Request("https://retaste.test/onboarding/taste", {
        method: "POST",
        headers: { Cookie: `retaste_guest=${guestSessionId}`, Origin: "https://retaste.test" },
        body: onboardingForm({ intent, currentStep, foodBadgeIds: [...foodBadgeIds], styleBadgeIds: [...styleBadgeIds] }),
      }),
    } as never);

    await expect(db.select().from(productEvents).where(eq(productEvents.guestSessionId, guestSessionId)))
      .resolves.toEqual([
        expect.objectContaining({ eventName, metadataJson: JSON.stringify(metadata) }),
      ]);
  });

  it("does not record a completed step when the actual component contract navigates back", async () => {
    const db = createDb(env.DB);
    const guestSessionId = await seedGuest(db, undefined, "STYLE");
    const { action } = await import("../../app/routes/taste-onboarding");

    await action({
      request: new Request("https://retaste.test/onboarding/taste", {
        method: "POST",
        headers: { Cookie: `retaste_guest=${guestSessionId}`, Origin: "https://retaste.test" },
        body: onboardingForm({
          intent: "SAVE_STEP",
          currentStep: "STYLE",
          direction: "BACK",
          foodBadgeIds: ["food-gukbap"],
          styleBadgeIds: ["style-old-school"],
        }),
      }),
    } as never);

    await expect(db.select().from(productEvents).where(eq(productEvents.guestSessionId, guestSessionId)))
      .resolves.toEqual([]);
    await expect(db.query.guestTasteSessions.findFirst({ where: eq(guestTasteSessions.id, guestSessionId) }))
      .resolves.toMatchObject({ completedStepsJson: JSON.stringify(["FOOD"]) });
  });

  it("saves a page-exit selection without advancing or recording a completion event", async () => {
    const db = createDb(env.DB);
    const guestSessionId = await seedGuest(db, undefined, "STYLE");
    const { action } = await import("../../app/routes/taste-onboarding");

    const response = await action({
      request: new Request("https://retaste.test/onboarding/taste", {
        method: "POST",
        headers: { Cookie: `retaste_guest=${guestSessionId}`, Origin: "https://retaste.test" },
        body: onboardingForm({
          intent: "SAVE_SELECTION",
          currentStep: "STYLE",
          foodBadgeIds: ["food-gukbap"],
          styleBadgeIds: ["style-old-school"],
        }),
      }),
    } as never) as unknown as { init?: ResponseInit };

    await expect(db.select().from(productEvents).where(eq(productEvents.guestSessionId, guestSessionId)))
      .resolves.toEqual([]);
    await expect(db.query.guestTasteSessions.findFirst({ where: eq(guestTasteSessions.id, guestSessionId) }))
      .resolves.toMatchObject({ completedStepsJson: JSON.stringify(["STYLE"]) });
    await expect(db.select({ badgeId: guestTasteBadges.badgeId })
      .from(guestTasteBadges)
      .where(eq(guestTasteBadges.sessionId, guestSessionId)))
      .resolves.toEqual(expect.arrayContaining([
        { badgeId: "food-gukbap" },
        { badgeId: "style-old-school" },
      ]));
    expect(new Headers(response.init?.headers).get("Set-Cookie"))
      .toContain(`retaste_guest=${guestSessionId}`);
  });

  it("does not let an older page-exit selection overwrite a newer step", async () => {
    const db = createDb(env.DB);
    const guestSessionId = await seedGuest(db);
    await db.update(guestTasteSessions)
      .set({ completedStepsJson: JSON.stringify(["STYLE"]) })
      .where(eq(guestTasteSessions.id, guestSessionId));
    const { action } = await import("../../app/routes/taste-onboarding");

    await action({
      request: new Request("https://retaste.test/onboarding/taste", {
        method: "POST",
        headers: { Cookie: `retaste_guest=${guestSessionId}`, Origin: "https://retaste.test" },
        body: onboardingForm({
          intent: "SAVE_STEP",
          currentStep: "STYLE",
          selectionRevision: 2,
          foodBadgeIds: ["food-gukbap"],
          styleBadgeIds: ["style-old-school", "style-market"],
        }),
      }),
    } as never);
    await action({
      request: new Request("https://retaste.test/onboarding/taste", {
        method: "POST",
        headers: { Cookie: `retaste_guest=${guestSessionId}`, Origin: "https://retaste.test" },
        body: onboardingForm({
          intent: "SAVE_SELECTION",
          currentStep: "STYLE",
          selectionRevision: 1,
          foodBadgeIds: ["food-gukbap"],
          styleBadgeIds: ["style-old-school"],
        }),
      }),
    } as never);
    await action({
      request: new Request("https://retaste.test/onboarding/taste", {
        method: "POST",
        headers: { Cookie: `retaste_guest=${guestSessionId}`, Origin: "https://retaste.test" },
        body: onboardingForm({
          intent: "SAVE_SELECTION",
          currentStep: "STYLE",
          selectionRevision: 3,
          foodBadgeIds: ["food-gukbap"],
          styleBadgeIds: ["style-old-school"],
        }),
      }),
    } as never);

    await expect(db.query.guestTasteSessions.findFirst({ where: eq(guestTasteSessions.id, guestSessionId) }))
      .resolves.toMatchObject({
        completedStepsJson: JSON.stringify(["PREVIEW"]),
        selectionRevision: 2,
      });
    await expect(selectedGuestBadges(db, guestSessionId)).resolves.toEqual(expect.arrayContaining([
      { badgeId: "food-gukbap" },
      { badgeId: "style-old-school" },
      { badgeId: "style-market" },
    ]));
  });

  it.each(["COMPLETE", "SKIP"] as const)(
    "keeps %s terminal state and its newer selection when an older beacon arrives late",
    async (intent) => {
      const db = createDb(env.DB);
      const guestSessionId = await seedGuest(db);
      const currentStep = intent === "COMPLETE" ? "PREVIEW" : "STYLE";
      await db.update(guestTasteSessions)
        .set({ completedStepsJson: JSON.stringify([currentStep]) })
        .where(eq(guestTasteSessions.id, guestSessionId));
      const sessionsBefore = await db.select({ id: guestTasteSessions.id }).from(guestTasteSessions);
      const { action } = await import("../../app/routes/taste-onboarding");

      await action({
        request: new Request("https://retaste.test/onboarding/taste", {
          method: "POST",
          headers: { Cookie: `retaste_guest=${guestSessionId}`, Origin: "https://retaste.test" },
          body: onboardingForm({
            intent,
            currentStep,
            selectionRevision: 2,
            foodBadgeIds: ["food-gukbap"],
            styleBadgeIds: ["style-old-school", "style-market"],
          }),
        }),
      } as never);
      await action({
        request: new Request("https://retaste.test/onboarding/taste", {
          method: "POST",
          headers: { Cookie: `retaste_guest=${guestSessionId}`, Origin: "https://retaste.test" },
          body: onboardingForm({
            intent: "SAVE_SELECTION",
            currentStep,
            selectionRevision: 1,
            foodBadgeIds: ["food-gukbap"],
            styleBadgeIds: ["style-old-school"],
          }),
        }),
      } as never);

      const session = await db.query.guestTasteSessions.findFirst({
        where: eq(guestTasteSessions.id, guestSessionId),
      });
      expect(intent === "COMPLETE" ? session?.completedAt : session?.skippedAt).toEqual(expect.any(String));
      expect(session?.selectionRevision).toBe(2);
      await expect(db.select({ id: guestTasteSessions.id }).from(guestTasteSessions))
        .resolves.toHaveLength(sessionsBefore.length);
      await expect(selectedGuestBadges(db, guestSessionId)).resolves.toEqual(expect.arrayContaining([
        { badgeId: "food-gukbap" },
        { badgeId: "style-old-school" },
        { badgeId: "style-market" },
      ]));
    },
  );

  it("does not create an orphan session when an old beacon arrives after merge", async () => {
    const db = createDb(env.DB);
    const guestSessionId = await seedGuest(db);
    const userId = await seedUser(db);
    await db.update(guestTasteSessions)
      .set({ completedStepsJson: JSON.stringify(["STYLE"]) })
      .where(eq(guestTasteSessions.id, guestSessionId));
    await db.insert(guestTasteBadges).values([
      { sessionId: guestSessionId, badgeId: "food-gukbap", selectedAt: NOW },
      { sessionId: guestSessionId, badgeId: "style-market", selectedAt: NOW },
    ]);
    await mergeGuestTasteSessionFromRequest(
      db,
      new Request("https://retaste.test/login", { headers: { Cookie: `retaste_guest=${guestSessionId}` } }),
      userId,
      "2026-08-10T00:10:00.000Z",
    );
    const sessionsBefore = await db.select({ id: guestTasteSessions.id }).from(guestTasteSessions);
    const { action } = await import("../../app/routes/taste-onboarding");

    const response = await action({
      request: new Request("https://retaste.test/onboarding/taste", {
        method: "POST",
        headers: { Cookie: `retaste_guest=${guestSessionId}`, Origin: "https://retaste.test" },
        body: onboardingForm({
          intent: "SAVE_SELECTION",
          currentStep: "STYLE",
          selectionRevision: 1,
          foodBadgeIds: ["food-gukbap"],
          styleBadgeIds: ["style-old-school"],
        }),
      }),
    } as never) as unknown as { init?: ResponseInit };

    await expect(db.select({ id: guestTasteSessions.id }).from(guestTasteSessions))
      .resolves.toHaveLength(sessionsBefore.length);
    await expect(selectedGuestBadges(db, guestSessionId)).resolves.toEqual([]);
    const copied = await env.DB.prepare("SELECT badge_id FROM user_taste_badges WHERE user_id=? AND source='USER' ORDER BY badge_id").bind(userId).all<{ badge_id: string }>();
    expect(copied.results).toEqual([{ badge_id: "food-gukbap" }, { badge_id: "style-market" }]);
    expect(new Headers(response.init?.headers).get("Set-Cookie")).toBeNull();
  });

  it("does not create an orphan session for an expired beacon cookie", async () => {
    const db = createDb(env.DB);
    const guestSessionId = await seedGuest(db, undefined, "STYLE");
    await db.update(guestTasteSessions)
      .set({ expiresAt: "2026-08-10T00:01:00.000Z" })
      .where(eq(guestTasteSessions.id, guestSessionId));
    const sessionsBefore = await db.select({ id: guestTasteSessions.id }).from(guestTasteSessions);
    const { action } = await import("../../app/routes/taste-onboarding");

    const response = await action({
      request: new Request("https://retaste.test/onboarding/taste", {
        method: "POST",
        headers: { Cookie: `retaste_guest=${guestSessionId}`, Origin: "https://retaste.test" },
        body: onboardingForm({
          intent: "SAVE_SELECTION",
          currentStep: "STYLE",
          selectionRevision: 1,
          foodBadgeIds: ["food-gukbap"],
          styleBadgeIds: ["style-old-school"],
        }),
      }),
    } as never) as unknown as { init?: ResponseInit };

    await expect(db.select({ id: guestTasteSessions.id }).from(guestTasteSessions))
      .resolves.toHaveLength(sessionsBefore.length);
    await expect(selectedGuestBadges(db, guestSessionId)).resolves.toEqual([]);
    expect(new Headers(response.init?.headers).get("Set-Cookie")).toBeNull();
  });

  it("keeps a successful onboarding mutation when event storage fails and logs only the fixed code", async () => {
    const db = createDb(env.DB);
    const guestSessionId = await seedGuest(db, undefined, "PREVIEW");
    const triggerName = `force_product_event_failure_${crypto.randomUUID().replaceAll("-", "")}`;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await env.DB.exec(
      `CREATE TRIGGER ${triggerName} BEFORE INSERT ON product_events BEGIN SELECT RAISE(ABORT, 'email@example.com 126.978 name'); END`,
    );

    try {
      const { action } = await import("../../app/routes/taste-onboarding");
      await expect(action({
        request: new Request("https://retaste.test/onboarding/taste", {
          method: "POST",
          headers: { Cookie: `retaste_guest=${guestSessionId}`, Origin: "https://retaste.test" },
          body: onboardingForm({ intent: "COMPLETE", currentStep: "PREVIEW" }),
        }),
      } as never)).resolves.toBeInstanceOf(Response);

      await expect(db.query.guestTasteSessions.findFirst({
        where: eq(guestTasteSessions.id, guestSessionId),
      })).resolves.toMatchObject({ completedAt: expect.any(String) });
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith("PRODUCT_EVENT_WRITE_FAILED");
    } finally {
      errorSpy.mockRestore();
      await env.DB.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
    }
  });

  it.each([
    ["vote", { value: "1", reason: null }, "RECOMMENDATION_LIKED", {}],
    ["vote", { value: "-1", reason: "PRICE" }, "RECOMMENDATION_DISLIKED", { reason: "PRICE" }],
    ["save", { saved: "true" }, "RECOMMENDATION_SAVED", {}],
  ] as const)("records a successful recommendation %s action", async (intent, fields, eventName, metadata) => {
    const db = createDb(env.DB);
    const userId = await seedUser(db);
    routeMocks.requireUser.mockResolvedValue({ id: userId });
    const form = new FormData();
    form.set("intent", intent);
    for (const [key, value] of Object.entries(fields)) {
      if (value !== null) form.set(key, value);
    }

    const { action } = await import("../../app/routes/place-detail");
    const cardPath = recommendationPlacePath("place-event-test", {
      variant: "personal",
      discoveryMode: "EXPLORATION",
    });
    const requestPath = recommendationRequestPath(cardPath, crypto.randomUUID());
    await action({
      request: new Request(`https://retaste.test${requestPath}`, { method: "POST", headers: { Origin: "https://retaste.test" }, body: form }),
      params: { placeSlug: "place-event-test" },
    } as never);

    await expect(db.select().from(productEvents).where(eq(productEvents.userId, userId)))
      .resolves.toEqual([
        expect.objectContaining({
          eventName,
          metadataJson: JSON.stringify({
            sourceRail: "PERSONAL",
            discoveryMode: "EXPLORATION",
            ...metadata,
          }),
        }),
      ]);
  });

  it("does not emit recommendation action events for direct detail actions or unsave", async () => {
    const db = createDb(env.DB);
    const userId = await seedUser(db);
    routeMocks.requireUser.mockResolvedValue({ id: userId });
    const form = new FormData();
    form.set("intent", "save");
    form.set("saved", "true");

    const { action } = await import("../../app/routes/place-detail");
    await action({
      request: new Request("https://retaste.test/places/place-event-test", { method: "POST", headers: { Origin: "https://retaste.test" }, body: form }),
      params: { placeSlug: "place-event-test" },
    } as never);

    await expect(db.select().from(productEvents).where(eq(productEvents.userId, userId)))
      .resolves.toEqual([]);

    form.set("saved", "false");
    await action({
      request: new Request("https://retaste.test/places/place-event-test", { method: "POST", headers: { Origin: "https://retaste.test" }, body: form }),
      params: { placeSlug: "place-event-test" },
    } as never);
    await expect(db.select().from(productEvents).where(eq(productEvents.userId, userId)))
      .resolves.toEqual([]);
  });

  it("records one detail-opened event for one validated recommendation card request", async () => {
    const db = createDb(env.DB);
    const userId = await seedUser(db);
    routeMocks.getOptionalUser.mockResolvedValue({ id: userId });
    const requestId = crypto.randomUUID();
    const cardPath = recommendationPlacePath("place-event-test", {
      variant: "trusted",
    });
    const requestPath = recommendationRequestPath(cardPath, requestId);
    const request = new Request(`https://retaste.test${requestPath}`);
    const { loader } = await import("../../app/routes/place-detail");

    await loader({ request, params: { placeSlug: "place-event-test" } } as never);
    await loader({ request, params: { placeSlug: "place-event-test" } } as never);

    await expect(db.select().from(productEvents).where(and(
      eq(productEvents.userId, userId),
      eq(productEvents.eventName, "RECOMMENDATION_DETAIL_OPENED"),
    ))).resolves.toEqual([
      expect.objectContaining({
        id: requestId,
        metadataJson: JSON.stringify({ sourceRail: "TRUSTED", discoveryMode: "QUALITY" }),
      }),
    ]);
  });

  it("records detail-opened from the canonical React Router data request", async () => {
    const db = createDb(env.DB);
    const userId = await seedUser(db);
    routeMocks.getOptionalUser.mockResolvedValue({ id: userId });
    const requestId = crypto.randomUUID();
    const cardPath = recommendationPlacePath("place-event-test", {
      variant: "personal",
      discoveryMode: "EXPLORATION",
    });
    const requestPath = recommendationRequestPath(cardPath, requestId);
    const dataPath = requestPath.replace("/places/place-event-test?", "/places/place-event-test.data?");
    const request = new Request(`https://retaste.test${dataPath}&_routes=routes%2Fplace-detail`);
    const { loader } = await import("../../app/routes/place-detail");

    await loader({ request, params: { placeSlug: "place-event-test" } } as never);

    await expect(db.select().from(productEvents).where(and(
      eq(productEvents.userId, userId),
      eq(productEvents.eventName, "RECOMMENDATION_DETAIL_OPENED"),
    ))).resolves.toEqual([
      expect.objectContaining({
        id: requestId,
        metadataJson: JSON.stringify({ sourceRail: "PERSONAL", discoveryMode: "EXPLORATION" }),
      }),
    ]);
  });

  it.each([
    "/places/place-event-test",
    "/places/place-event-test?sourceRail=MAP&discoveryMode=EXPLORATION&recommendationRequestId=7b3c9a17-8064-4d2e-8cf7-857dfc78b86f",
    "/places/place-event-test?sourceRail=PERSONAL&discoveryMode=member%40example.com&recommendationRequestId=7b3c9a17-8064-4d2e-8cf7-857dfc78b86f",
    "/places/place-event-test?sourceRail=GOLDEN&discoveryMode=EXPLORATION&recommendationRequestId=7b3c9a17-8064-4d2e-8cf7-857dfc78b86f",
    "/places/place-event-test?sourceRail=PERSONAL&discoveryMode=EXPLORATION&recommendationRequestId=not-a-uuid",
    "/places/place-event-test?sourceRail=PERSONAL&discoveryMode=EXPLORATION&recommendationRequestId=7b3c9a17-8064-4d2e-8cf7-857dfc78b86f&unexpected=1",
    "/places/place-event-test?sourceRail=PERSONAL&sourceRail=TRUSTED&discoveryMode=EXPLORATION&recommendationRequestId=8c4d0b28-9175-4e3f-9df8-968efc89c970",
    "/places/place-event-test?sourceRail=PERSONAL&discoveryMode=EXPLORATION&recommendationRequestId=9d5e1c39-a286-4f40-8ea9-a79f0d90da81&recommendationRequestId=ae6f2d4a-b397-4141-9fba-b8a01ea1eb92",
    "/places/place-event-test.data?sourceRail=PERSONAL&discoveryMode=EXPLORATION&recommendationRequestId=af702d5b-c408-4a62-8c0b-091fb9b289c3&unexpected=1&_routes=routes%2Fplace-detail",
    "/places/place-event-test.data?sourceRail=PERSONAL&discoveryMode=EXPLORATION&recommendationRequestId=b0813e6c-d519-4b73-9d1c-1a20cab39ad4&_routes=routes%2Fplace-detail&_routes=routes%2Fplace-detail",
  ])("does not record detail-opened for unvalidated provenance %s", async (path) => {
    const db = createDb(env.DB);
    const userId = await seedUser(db);
    routeMocks.getOptionalUser.mockResolvedValue({ id: userId });
    const { loader } = await import("../../app/routes/place-detail");

    await loader({
      request: new Request(`https://retaste.test${path}`),
      params: { placeSlug: "place-event-test" },
    } as never);

    await expect(db.select().from(productEvents).where(eq(productEvents.userId, userId)))
      .resolves.toEqual([]);
  });

  it("does not record detail-opened when the detail loader fails", async () => {
    const db = createDb(env.DB);
    const userId = await seedUser(db);
    routeMocks.getOptionalUser.mockResolvedValue({ id: userId });
    routeMocks.getLatestRatingSnapshot.mockRejectedValueOnce(new Error("DETAIL_LOADER_FAILED"));
    const cardPath = recommendationPlacePath("place-event-test", { variant: "personal" });
    const requestPath = recommendationRequestPath(cardPath, crypto.randomUUID());
    const { loader } = await import("../../app/routes/place-detail");

    await expect(loader({
      request: new Request(`https://retaste.test${requestPath}`),
      params: { placeSlug: "place-event-test" },
    } as never)).rejects.toThrow("DETAIL_LOADER_FAILED");
    await expect(db.select().from(productEvents).where(eq(productEvents.userId, userId)))
      .resolves.toEqual([]);
  });

  it("does not record a product event when the primary place action fails", async () => {
    const db = createDb(env.DB);
    const userId = await seedUser(db);
    routeMocks.requireUser.mockResolvedValue({ id: userId });
    routeMocks.castVote.mockRejectedValueOnce(new Error("PRIMARY_VOTE_FAILED"));
    const form = new FormData();
    form.set("intent", "vote");
    form.set("value", "1");

    const { action } = await import("../../app/routes/place-detail");
    await expect(action({
      request: new Request("https://retaste.test/places/place-event-test", { method: "POST", headers: { Origin: "https://retaste.test" }, body: form }),
      params: { placeSlug: "place-event-test" },
    } as never)).rejects.toThrow("PRIMARY_VOTE_FAILED");
    await expect(db.select().from(productEvents).where(eq(productEvents.userId, userId)))
      .resolves.toEqual([]);
  });

  it("keeps a successful place action when event storage fails and logs only the fixed code", async () => {
    const db = createDb(env.DB);
    const userId = await seedUser(db);
    routeMocks.requireUser.mockResolvedValue({ id: userId });
    const triggerName = `force_product_event_failure_${crypto.randomUUID().replaceAll("-", "")}`;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await env.DB.exec(
      `CREATE TRIGGER ${triggerName} BEFORE INSERT ON product_events BEGIN SELECT RAISE(ABORT, 'member@example.com 35.1595 name'); END`,
    );

    try {
      const form = new FormData();
      form.set("intent", "save");
      form.set("saved", "true");
      const { action } = await import("../../app/routes/place-detail");
      const cardPath = recommendationPlacePath("place-event-test", { variant: "golden" });
      const requestPath = recommendationRequestPath(cardPath, crypto.randomUUID());
      await expect(action({
        request: new Request(`https://retaste.test${requestPath}`, { method: "POST", headers: { Origin: "https://retaste.test" }, body: form }),
        params: { placeSlug: "place-event-test" },
      } as never)).resolves.toEqual({ ok: true });

      expect(routeMocks.setSavedAndRefreshTaste).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith("PRODUCT_EVENT_WRITE_FAILED");
    } finally {
      errorSpy.mockRestore();
      await env.DB.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
    }
  });
});
