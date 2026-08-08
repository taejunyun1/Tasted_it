import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("course page contract", () => {
  it("registers the route and preserves every shareable filter", () => {
    const routes = readFileSync("app/routes.ts", "utf8");
    const page = readFileSync("app/routes/course-recommendation.tsx", "utf8");
    expect(routes).toContain('route("courses", "routes/course-recommendation.tsx")');
    for (const name of ["time", "mealCategory", "second", "radiusKm", "parkingMode", "ev", "weather", "child"]) expect(page).toContain(`name="${name}"`);
  });

  it("marks the initial mobile filter and parking fallback accessibly", () => {
    const page = readFileSync("app/routes/course-recommendation.tsx", "utf8");
    expect(page).toContain("data-initial-open");
    expect(page).toContain("주차 정보 준비 중");
    expect(page).toContain("예상 도보거리");
  });
});
