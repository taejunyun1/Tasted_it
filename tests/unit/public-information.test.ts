import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { informationDate, publicOperatingDays } from "../../app/features/places/public-information";
import { PlaceInformation } from "../../app/components/places/PlaceInformation";
import type { PlaceDetail } from "../../app/features/places/place.types";

describe("recorded public place information", () => {
  it("formats KST dates and does not expose invalid source values", () => {
    expect(informationDate("2026-11-17T18:30:00.000Z")).toBe("2026-11-18");
    expect(informationDate("2026-11-17")).toBe("2026-11-17");
    for (const value of [null, "", "internal source error", "2026-02-30", "2026-02-30T12:00:00Z"]) expect(informationDate(value)).toBeNull();
  });

  it("separates recorded overnight hours, closed days and unknown/conflicting days", () => {
    const base = { lastVerifiedAt: "2026-11-17T18:30:00Z", opensAt: "18:00", closesAt: "02:00", isClosed: false };
    expect(publicOperatingDays([
      { ...base, weekday: 1 },
      { ...base, weekday: 2, opensAt: null, closesAt: null, isClosed: true },
      { ...base, weekday: 3, opensAt: "25:00" },
      { ...base, weekday: 4 }, { ...base, weekday: 4, opensAt: null, closesAt: null, isClosed: true },
      { ...base, weekday: 8 },
    ])).toEqual([
      { weekday: 1, summary: "18:00–다음 날 02:00", verifiedOn: "2026-11-18" },
      { weekday: 2, summary: "휴무", verifiedOn: "2026-11-18" },
      { weekday: 3, summary: "정보 미확인", verifiedOn: null },
      { weekday: 4, summary: "정보 미확인", verifiedOn: null },
    ]);
  });

  it("uses the oldest supporting date for multiple intervals and rejects undated hours", () => {
    const base = { weekday: 1, opensAt: "11:00", closesAt: "14:00", isClosed: false, lastVerifiedAt: "2026-11-17" };
    expect(publicOperatingDays([base, { ...base, opensAt: "17:00", closesAt: "20:00", lastVerifiedAt: "2026-11-16" }]))
      .toEqual([{ weekday: 1, summary: "11:00–14:00, 17:00–20:00", verifiedOn: "2026-11-16" }]);
    expect(publicOperatingDays([{ ...base, lastVerifiedAt: "" }]))
      .toEqual([{ weekday: 1, summary: "정보 미확인", verifiedOn: null }]);
  });

  it("renders unknown fields explicitly without claiming current opening or completed verification", () => {
    const html = renderToStaticMarkup(createElement(PlaceInformation, { place: { address: "합성 주소", phone: null, parkingSummary: " " } as PlaceDetail }));
    expect(html).toContain("확인 기록 없음");
    expect(html).toContain("정보 미제공");
    expect(html).toContain("정보 미확인");
    expect(html).toContain("현재 영업 여부는 방문 전에 매장에 확인");
    expect(html).not.toMatch(/검수 완료|영업중|영업 중/);
  });
});
