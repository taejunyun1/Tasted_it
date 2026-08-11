import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: { DB: {}, ONBOARDING_ENABLED: "true" as string | undefined },
  getOptionalUser: vi.fn(async (): Promise<{ id: string } | null> => null),
  getGuestOnboardingFromRequest: vi.fn(async (): Promise<{
    foodBadgeIds: string[];
    styleBadgeIds: string[];
  } | null> => null),
  getHomeCurationPage: vi.fn(async () => ({
    status: "READY",
    places: [],
    mode: "now",
    timeSlot: "lunch",
    radiusMeters: 3_000,
  })),
}));

vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("../../app/db/client.server", () => ({ createDb: () => ({}) }));
vi.mock("../../app/features/auth/session.server", () => ({ getOptionalUser: mocks.getOptionalUser }));
vi.mock("../../app/features/onboarding/guest-session.server", () => ({
  getGuestOnboardingFromRequest: mocks.getGuestOnboardingFromRequest,
}));
vi.mock("../../app/features/places/home-curation.server", () => ({
  getHomeCurationPage: mocks.getHomeCurationPage,
}));

afterEach(() => {
  mocks.env.ONBOARDING_ENABLED = "true";
  mocks.getOptionalUser.mockReset();
  mocks.getOptionalUser.mockResolvedValue(null);
  mocks.getGuestOnboardingFromRequest.mockReset();
  mocks.getGuestOnboardingFromRequest.mockResolvedValue(null);
  mocks.getHomeCurationPage.mockReset();
  mocks.getHomeCurationPage.mockResolvedValue({
    status: "READY",
    places: [],
    mode: "now",
    timeSlot: "lunch",
    radiusMeters: 3_000,
  });
});

describe("home recommendations resource", () => {
  it("로그인 회원의 큐레이션 요청을 엄격한 bbox 중심으로 전달한다", async () => {
    mocks.getOptionalUser.mockResolvedValue({ id: "member-1" });
    const { loader } = await import("../../app/routes/home-recommendations-resource");
    const result = await loader({
      request: new Request("https://retaste.example/resources/home-recommendations?mode=golden&bbox=126.8,35,127,35.3"),
    } as never);

    expect(result).toMatchObject({ data: { ok: true } });
    expect(mocks.getHomeCurationPage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      userId: "member-1",
      tasteBadgeIds: [],
      mode: "golden",
      bbox: [126.8, 35, 127, 35.3],
      center: { latitude: 35.15, longitude: 126.9 },
    }));
    expect(mocks.getGuestOnboardingFromRequest).not.toHaveBeenCalled();
  });

  it("비회원에게는 완료된 게스트 음식·스타일 취향을 함께 적용한다", async () => {
    mocks.getGuestOnboardingFromRequest.mockResolvedValue({
      foodBadgeIds: ["food-gukbap"],
      styleBadgeIds: ["style-old-school"],
    });
    const { loader } = await import("../../app/routes/home-recommendations-resource");
    await loader({
      request: new Request("https://retaste.example/resources/home-recommendations?mode=now&bbox=126.8,35,127,35.3"),
    } as never);

    expect(mocks.getHomeCurationPage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      tasteBadgeIds: ["food-gukbap", "style-old-school"],
    }));
  });

  it("잘못된 요청은 계산하지 않고 400으로 거부한다", async () => {
    const { loader } = await import("../../app/routes/home-recommendations-resource");
    const result = await loader({
      request: new Request("https://retaste.example/resources/home-recommendations?mode=now&bbox=126.8,35,127,35.3&debug=1"),
    } as never);

    expect(result).toMatchObject({ data: { ok: false }, init: { status: 400 } });
    expect(mocks.getHomeCurationPage).not.toHaveBeenCalled();
  });

  it("서버 오류는 기존 결과 유지 메시지와 503을 반환한다", async () => {
    mocks.getHomeCurationPage.mockRejectedValue(new Error("D1_UNAVAILABLE"));
    const { loader } = await import("../../app/routes/home-recommendations-resource");
    const result = await loader({
      request: new Request("https://retaste.example/resources/home-recommendations?mode=now&bbox=126.8,35,127,35.3"),
    } as never);

    expect(result).toMatchObject({
      data: { ok: false, message: "추천을 다시 불러오지 못했어요. 기존 결과를 유지합니다." },
      init: { status: 503 },
    });
  });
});
