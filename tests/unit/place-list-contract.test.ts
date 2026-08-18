import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: { DB: {}, ONBOARDING_ENABLED: "true" as string | undefined },
  getOptionalUser: vi.fn(async (): Promise<{ id: string } | null> => null),
  getGuestOnboardingFromRequest: vi.fn(async (): Promise<{
    completedAt: string | null;
    skippedAt: string | null;
    foodBadgeIds: string[];
    styleBadgeIds: string[];
  } | null> => null),
  getPlaceRecommendationPage: vi.fn(async () => ({
    chips: [],
    selectedBadges: [],
    title: "추천",
    personal: [],
    trusted: [],
    golden: [],
  })),
}));

vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("../../app/db/client.server", () => ({ createDb: () => ({}) }));
vi.mock("../../app/features/auth/session.server", () => ({ getOptionalUser: mocks.getOptionalUser }));
vi.mock("../../app/features/onboarding/guest-session.server", () => ({
  getGuestOnboardingFromRequest: mocks.getGuestOnboardingFromRequest,
}));
vi.mock("../../app/features/maps/map-state", () => ({
  parseMapState: () => ({ bbox: [126.8, 35, 127, 35.3], query: "" }),
}));
vi.mock("../../app/features/places/place-recommendation.server", () => ({
  getPlaceRecommendationPage: mocks.getPlaceRecommendationPage,
}));
vi.mock("../../app/features/places/place.server", () => ({
  listPlaces: vi.fn(async () => []),
  listPublicCategoryGroups: vi.fn(async () => []),
}));

afterEach(() => {
  mocks.env.ONBOARDING_ENABLED = "true";
  mocks.getOptionalUser.mockReset();
  mocks.getOptionalUser.mockResolvedValue(null);
  mocks.getGuestOnboardingFromRequest.mockReset();
  mocks.getGuestOnboardingFromRequest.mockResolvedValue(null);
  mocks.getPlaceRecommendationPage.mockClear();
});

const route = readFileSync("app/routes/place-list.tsx", "utf8");
const controls = readFileSync("app/components/places/PlaceRecommendationControls.tsx", "utf8");
const routes = readFileSync("app/routes.ts", "utf8");
const resource = readFileSync("app/routes/place-recommendations-resource.tsx", "utf8");

describe("place recommendation interaction contract", () => {
  it("uses a resource fetcher instead of navigating the whole page", () => {
    expect(route).toContain("useFetcher");
    expect(route).toContain("/resources/place-recommendations");
    expect(route).toContain("recommendationFetcher.data?.ok");
    expect(resource).toContain("추천을 다시 불러오지 못했어요");
    expect(routes).toContain('route("resources/place-recommendations"');
    expect(route).not.toContain("/onboarding/taste");
  });

  it("exposes pressed state and selection feedback accessibly", () => {
    expect(controls).toContain('aria-pressed={selected.includes(chip.id)}');
    expect(controls).toContain('aria-live="polite"');
    expect(controls).toContain("최대 2개까지 선택할 수 있어요");
  });
});

describe("places onboarding entry contract", () => {
  it("lets an unfinished guest browse places when onboarding is enabled", async () => {
    mocks.getGuestOnboardingFromRequest.mockResolvedValue({
      completedAt: null,
      skippedAt: null,
      foodBadgeIds: [],
      styleBadgeIds: [],
    });
    const { loader } = await import("../../app/routes/place-list");

    await expect(loader({ request: new Request("https://retaste.example/places") } as never))
      .resolves.toMatchObject({ places: [] });
  });

  it("keeps the existing places flow when onboarding is disabled", async () => {
    mocks.env.ONBOARDING_ENABLED = "false";
    const { loader } = await import("../../app/routes/place-list");

    await expect(loader({ request: new Request("https://retaste.example/places") } as never))
      .resolves.toMatchObject({ places: [] });
    expect(mocks.getGuestOnboardingFromRequest).not.toHaveBeenCalled();
  });

  it("does not redirect a logged-in user", async () => {
    mocks.getOptionalUser.mockResolvedValue({ id: "member-1" });
    const { loader } = await import("../../app/routes/place-list");

    await expect(loader({ request: new Request("https://retaste.example/places") } as never))
      .resolves.toMatchObject({ places: [] });
    expect(mocks.getGuestOnboardingFromRequest).not.toHaveBeenCalled();
  });

  it("does not redirect a guest who completed onboarding", async () => {
    mocks.getGuestOnboardingFromRequest.mockResolvedValue({
      completedAt: "2026-08-10T00:00:00.000Z",
      skippedAt: null,
      foodBadgeIds: ["food-gukbap"],
      styleBadgeIds: ["style-old-school"],
    });
    const { loader } = await import("../../app/routes/place-list");

    await expect(loader({ request: new Request("https://retaste.example/places") } as never))
      .resolves.toMatchObject({ places: [] });
    expect(mocks.getPlaceRecommendationPage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tasteBadgeIds: ["food-gukbap", "style-old-school"] }),
    );
  });

  it("keeps guest taste when resource recommendations are reranked", async () => {
    mocks.getGuestOnboardingFromRequest.mockResolvedValue({
      completedAt: "2026-08-10T00:00:00.000Z",
      skippedAt: null,
      foodBadgeIds: ["food-gukbap"],
      styleBadgeIds: ["style-old-school"],
    });
    const { loader } = await import("../../app/routes/place-recommendations-resource");

    await loader({ request: new Request("https://retaste.example/resources/place-recommendations?bbox=126.8,35,127,35.3") } as never);
    expect(mocks.getPlaceRecommendationPage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tasteBadgeIds: ["food-gukbap", "style-old-school"] }),
    );
  });

  it("does not read guest onboarding from the resource when onboarding is disabled", async () => {
    mocks.env.ONBOARDING_ENABLED = "false";
    const { loader } = await import("../../app/routes/place-recommendations-resource");

    await loader({ request: new Request("https://retaste.example/resources/place-recommendations?bbox=126.8,35,127,35.3") } as never);
    expect(mocks.getGuestOnboardingFromRequest).not.toHaveBeenCalled();
  });
});
