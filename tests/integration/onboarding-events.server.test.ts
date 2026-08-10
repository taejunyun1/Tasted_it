import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  getCurrentVote: vi.fn(async () => null),
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

const NOW = "2026-08-10T00:00:00.000Z";

async function seedGuest(db: AppDb, id = `guest-${crypto.randomUUID()}`) {
  await db.insert(guestTasteSessions).values({
    id,
    locationMode: "DEFAULT",
    completedStepsJson: "[]",
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
  intent: "SAVE_STEP" | "SKIP" | "COMPLETE";
  currentStep: "LOCATION" | "FOOD" | "STYLE" | "PREVIEW";
  direction?: OnboardingNavigationDirection;
  foodBadgeIds?: string[];
  styleBadgeIds?: string[];
}) {
  const navigation = onboardingNavigation(input.currentStep, input.direction ?? "FORWARD");
  const form = new FormData();
  form.set("intent", input.intent);
  form.set("currentStep", navigation.currentStep);
  form.set("targetStep", navigation.targetStep);
  form.set("direction", navigation.direction);
  form.set("locationMode", "DEFAULT");
  form.set("returnTo", "/places");
  for (const badgeId of input.foodBadgeIds ?? []) form.append("foodBadgeId", badgeId);
  for (const badgeId of input.styleBadgeIds ?? []) form.append("styleBadgeId", badgeId);
  return form;
}

describe("product event route wiring", () => {
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
    const guestSessionId = await seedGuest(db);
    const { action } = await import("../../app/routes/taste-onboarding");

    await action({
      request: new Request("https://retaste.test/onboarding/taste", {
        method: "POST",
        headers: { Cookie: `retaste_guest=${guestSessionId}` },
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
    const guestSessionId = await seedGuest(db);
    const { action } = await import("../../app/routes/taste-onboarding");

    await action({
      request: new Request("https://retaste.test/onboarding/taste", {
        method: "POST",
        headers: { Cookie: `retaste_guest=${guestSessionId}` },
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

  it("keeps a successful onboarding mutation when event storage fails and logs only the fixed code", async () => {
    const db = createDb(env.DB);
    const guestSessionId = await seedGuest(db);
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
          headers: { Cookie: `retaste_guest=${guestSessionId}` },
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
      request: new Request(`https://retaste.test${requestPath}`, { method: "POST", body: form }),
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
      request: new Request("https://retaste.test/places/place-event-test", { method: "POST", body: form }),
      params: { placeSlug: "place-event-test" },
    } as never);

    await expect(db.select().from(productEvents).where(eq(productEvents.userId, userId)))
      .resolves.toEqual([]);

    form.set("saved", "false");
    await action({
      request: new Request("https://retaste.test/places/place-event-test", { method: "POST", body: form }),
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

  it.each([
    "/places/place-event-test",
    "/places/place-event-test?sourceRail=MAP&discoveryMode=EXPLORATION&recommendationRequestId=7b3c9a17-8064-4d2e-8cf7-857dfc78b86f",
    "/places/place-event-test?sourceRail=PERSONAL&discoveryMode=member%40example.com&recommendationRequestId=7b3c9a17-8064-4d2e-8cf7-857dfc78b86f",
    "/places/place-event-test?sourceRail=GOLDEN&discoveryMode=EXPLORATION&recommendationRequestId=7b3c9a17-8064-4d2e-8cf7-857dfc78b86f",
    "/places/place-event-test?sourceRail=PERSONAL&discoveryMode=EXPLORATION&recommendationRequestId=not-a-uuid",
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
      request: new Request("https://retaste.test/places/place-event-test", { method: "POST", body: form }),
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
        request: new Request(`https://retaste.test${requestPath}`, { method: "POST", body: form }),
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
