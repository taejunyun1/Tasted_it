import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync("app/routes/place-list.tsx", "utf8");
const controls = readFileSync("app/components/places/PlaceRecommendationControls.tsx", "utf8");
const routes = readFileSync("app/routes.ts", "utf8");

describe("place recommendation interaction contract", () => {
  it("uses a resource fetcher instead of navigating the whole page", () => {
    expect(route).toContain("useFetcher");
    expect(route).toContain("/resources/place-recommendations");
    expect(routes).toContain('route("resources/place-recommendations"');
  });

  it("exposes pressed state and selection feedback accessibly", () => {
    expect(controls).toContain('aria-pressed={selected.includes(chip.id)}');
    expect(controls).toContain('aria-live="polite"');
    expect(controls).toContain("최대 2개까지 선택할 수 있어요");
  });
});

