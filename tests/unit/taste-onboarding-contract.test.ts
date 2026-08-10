import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";

const mocks = vi.hoisted(() => ({
  env: { DB: {}, ONBOARDING_ENABLED: "true" },
  getOptionalUser: vi.fn(async () => null),
  getOrCreateGuestSession: vi.fn(async () => ({ session: { id: "guest-1" }, setCookie: null })),
  getWritableGuestSessionFromRequest: vi.fn(async () => ({ id: "guest-1" })),
  claimGuestOnboardingDocument: vi.fn(async () => ({
    sessionId: "guest-1",
    selectionEpoch: 1,
    selectionRevision: 0,
    step: "LOCATION",
    locationMode: "DEFAULT",
    foodBadgeIds: [],
    styleBadgeIds: [],
    expiresAt: "2026-09-09T00:00:00.000Z",
    completedAt: null,
    skippedAt: null,
  })),
  getGuestOnboarding: vi.fn(async () => ({
    sessionId: "guest-1",
    selectionEpoch: 1,
    selectionRevision: 0,
    step: "LOCATION",
    locationMode: "DEFAULT",
    foodBadgeIds: [],
    styleBadgeIds: [],
    expiresAt: "2026-09-09T00:00:00.000Z",
    completedAt: null,
    skippedAt: null,
  })),
  saveGuestOnboarding: vi.fn(async () => undefined),
  db: { update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })) },
}));

vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("../../app/db/client.server", () => ({ createDb: () => mocks.db }));
vi.mock("../../app/features/auth/session.server", () => ({ getOptionalUser: mocks.getOptionalUser }));
vi.mock("../../app/features/onboarding/guest-session.server", () => ({
  claimGuestOnboardingDocument: mocks.claimGuestOnboardingDocument,
  getOrCreateGuestSession: mocks.getOrCreateGuestSession,
  getWritableGuestSessionFromRequest: mocks.getWritableGuestSessionFromRequest,
  getGuestOnboarding: mocks.getGuestOnboarding,
  saveGuestOnboarding: mocks.saveGuestOnboarding,
}));

afterEach(() => {
  mocks.env.ONBOARDING_ENABLED = "true";
  mocks.getOrCreateGuestSession.mockClear();
  mocks.saveGuestOnboarding.mockReset();
  mocks.saveGuestOnboarding.mockResolvedValue(undefined);
  mocks.getWritableGuestSessionFromRequest.mockReset();
  mocks.getWritableGuestSessionFromRequest.mockResolvedValue({ id: "guest-1" });
});

describe("taste onboarding contract", () => {
  it("registers the route and exposes pressed badge buttons", () => {
    expect(fs.readFileSync("app/routes.ts", "utf8")).toContain('route("onboarding/taste", "routes/taste-onboarding.tsx")');
    const component = fs.readFileSync("app/components/onboarding/TasteOnboarding.tsx", "utf8");
    expect(component).toContain("aria-pressed");
    expect(component).toContain("나중에 할게요");
    expect(component).toContain("44px");
  });

  it("submits and restores exactly one onboarding step at a time", async () => {
    const component = await import("../../app/components/onboarding/TasteOnboarding");
    expect(component.onboardingNavigation).toBeTypeOf("function");

    expect(component.onboardingNavigation("LOCATION", "FORWARD")).toEqual({
      currentStep: "LOCATION",
      targetStep: "FOOD",
      direction: "FORWARD",
    });
    expect(component.onboardingNavigation("STYLE", "BACK")).toEqual({
      currentStep: "STYLE",
      targetStep: "FOOD",
      direction: "BACK",
    });

    const source = fs.readFileSync("app/components/onboarding/TasteOnboarding.tsx", "utf8");
    expect(source).toContain('name="currentStep"');
    expect(source).toContain('name="targetStep"');
    expect(source).toContain('name="direction"');
    expect(source).toContain('name="selectionEpoch"');
    expect(source).toContain('name="selectionRevision"');

    const router = createMemoryRouter([{
      path: "/onboarding/taste",
      element: createElement(component.TasteOnboarding, {
        initialState: {
          step: "FOOD",
          selectionEpoch: 1,
          selectionRevision: 0,
          locationMode: "DEFAULT",
          foodBadgeIds: [],
          styleBadgeIds: [],
        },
        foodBadges: [],
        styleBadges: [],
        returnTo: "/places",
      }),
    }], { initialEntries: ["/onboarding/taste"] });
    const html = renderToStaticMarkup(createElement(RouterProvider, { router }));
    expect(html).toContain('name="currentStep" value="FOOD"');
    expect(html).toContain('name="targetStep" value="STYLE"');
    expect(html).toContain('name="direction" value="FORWARD"');
  });

  it("announces step progress with progressbar semantics", () => {
    const component = fs.readFileSync("app/components/onboarding/TasteOnboarding.tsx", "utf8");
    expect(component).toContain('role="progressbar"');
    expect(component).toContain("aria-valuenow");
    expect(component).toContain("headingRef.current?.focus()");
  });

  it("uses the same location bbox for preview loading and the places destination", async () => {
    const component = await import("../../app/components/onboarding/TasteOnboarding") as unknown as {
      onboardingRecommendationPath?: (location: { bbox: [number, number, number, number] }) => string;
      onboardingPlacesDestination?: (
        returnTo: string,
        location: { bbox: [number, number, number, number] },
      ) => string;
    };
    const location = { bbox: [126.8, 35, 127, 35.3] as [number, number, number, number] };

    expect(component.onboardingRecommendationPath).toBeTypeOf("function");
    expect(component.onboardingPlacesDestination).toBeTypeOf("function");
    expect(component.onboardingRecommendationPath!(location))
      .toBe("/resources/place-recommendations?bbox=126.8%2C35%2C127%2C35.3");
    expect(component.onboardingPlacesDestination!("/places?category=korean", location))
      .toBe("/places?category=korean&bbox=126.8%2C35%2C127%2C35.3");
  });

  it("loads and renders preview recommendations with retry feedback", () => {
    const component = fs.readFileSync("app/components/onboarding/TasteOnboarding.tsx", "utf8");
    expect(component).toContain("useFetcher<typeof recommendationLoader>");
    expect(component).toContain("recommendationFetcher.load(onboardingRecommendationPath(location))");
    expect(component).toContain("recommendations.personal.slice(0, 8)");
    expect(component).toContain("<PlaceCard");
    expect(component).toContain("다시 불러오기");
    expect(component).toContain("readOnboardingLocation() ?? defaultOnboardingLocation()");
  });

  it("persists the current step selection on page exit without advancing", async () => {
    const component = fs.readFileSync("app/components/onboarding/TasteOnboarding.tsx", "utf8");
    expect(component).toContain('window.addEventListener("pagehide"');
    expect(component).toContain('form.set("intent", "SAVE_SELECTION")');

    const form = new FormData();
    form.set("intent", "SAVE_SELECTION");
    form.set("currentStep", "STYLE");
    form.set("targetStep", "STYLE");
    form.set("direction", "FORWARD");
    form.set("selectionEpoch", "1");
    form.set("selectionRevision", "1");
    form.set("locationMode", "DEFAULT");
    form.append("foodBadgeId", "food-gukbap");
    form.append("styleBadgeId", "style-old-school");
    const { action } = await import("../../app/routes/taste-onboarding");

    const response = await action({
      request: new Request("https://retaste.example/onboarding/taste", { method: "POST", body: form }),
    } as never);

    expect(response).toMatchObject({ data: { ok: true } });
    expect(mocks.saveGuestOnboarding).toHaveBeenCalledWith(
      mocks.db,
      expect.objectContaining({
        sessionId: "guest-1",
        step: "STYLE",
        foodBadgeIds: ["food-gukbap"],
        styleBadgeIds: ["style-old-school"],
      }),
    );
    expect(mocks.getOrCreateGuestSession).not.toHaveBeenCalled();
  });

  it("does not create a guest session for a beacon without an existing writable cookie session", async () => {
    mocks.getWritableGuestSessionFromRequest.mockResolvedValueOnce(null);
    const form = new FormData();
    form.set("intent", "SAVE_SELECTION");
    form.set("currentStep", "STYLE");
    form.set("targetStep", "STYLE");
    form.set("direction", "FORWARD");
    form.set("selectionEpoch", "1");
    form.set("selectionRevision", "1");
    const { action } = await import("../../app/routes/taste-onboarding");

    await expect(action({
      request: new Request("https://retaste.example/onboarding/taste", { method: "POST", body: form }),
    } as never)).resolves.toMatchObject({ data: { ok: true, ignored: true } });
    expect(mocks.getOrCreateGuestSession).not.toHaveBeenCalled();
    expect(mocks.saveGuestOnboarding).not.toHaveBeenCalled();
  });

  it.each(["//evil.example/path", "/\\evil.example/path", "/%5Cevil.example/path", "https://evil.example/path"])(
    "loader rejects malicious returnTo %s",
    async (returnTo) => {
      mocks.env.ONBOARDING_ENABLED = "false";
      const { loader } = await import("../../app/routes/taste-onboarding");
      const response = await loader({ request: new Request(`https://retaste.example/onboarding/taste?returnTo=${encodeURIComponent(returnTo)}`) } as never);
      expect(response).toBeInstanceOf(Response);
      expect((response as Response).headers.get("Location")).toBe("/places");
    },
  );

  it("action rejects a malicious returnTo before redirecting", async () => {
    const { action } = await import("../../app/routes/taste-onboarding");
    const form = new FormData();
    form.set("intent", "COMPLETE");
    form.set("currentStep", "PREVIEW");
    form.set("targetStep", "PREVIEW");
    form.set("direction", "FORWARD");
    form.set("selectionEpoch", "1");
    form.set("selectionRevision", "1");
    form.set("returnTo", "/%5Cevil.example/path");
    const response = await action({ request: new Request("https://retaste.example/onboarding/taste", { method: "POST", body: form }) } as never);
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).headers.get("Location")).toBe("/places");
  });

  it("returns 400 for outdated badge IDs without masking unexpected failures", async () => {
    const { action } = await import("../../app/routes/taste-onboarding");
    const request = () => {
      const form = new FormData();
      form.set("intent", "SAVE_STEP");
      form.set("currentStep", "FOOD");
      form.set("targetStep", "STYLE");
      form.set("direction", "FORWARD");
      form.set("selectionEpoch", "1");
      form.set("selectionRevision", "1");
      form.append("foodBadgeId", "food-outdated");
      return new Request("https://retaste.example/onboarding/taste", { method: "POST", body: form });
    };

    mocks.saveGuestOnboarding.mockRejectedValueOnce(new Error("GUEST_ONBOARDING_BADGES_INVALID"));
    const invalid = await action({ request: request() } as never);
    expect(invalid).toMatchObject({ init: { status: 400 } });

    mocks.saveGuestOnboarding.mockRejectedValueOnce(new Error("D1_UNAVAILABLE"));
    await expect(action({ request: request() } as never)).rejects.toThrow("D1_UNAVAILABLE");
  });
});
