import { describe, expect, it } from "vitest";
import { shouldOpenPlaceDetailSheet } from "../../app/features/places/place-detail-sheet";

describe("shouldOpenPlaceDetailSheet", () => {
  it("intercepts an ordinary mobile click", () => {
    expect(shouldOpenPlaceDetailSheet({ mobile: true, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false })).toBe(true);
  });

  it("keeps desktop and modified link navigation intact", () => {
    expect(shouldOpenPlaceDetailSheet({ mobile: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false })).toBe(false);
    expect(shouldOpenPlaceDetailSheet({ mobile: true, button: 0, metaKey: true, ctrlKey: false, shiftKey: false, altKey: false })).toBe(false);
  });
});
