import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("app/app.css", "utf8");

describe("reviewer photo interaction styles", () => {
  it("gives active controls a pointer and disabled controls a not-allowed cursor", () => {
    expect(css).toContain("button:not(:disabled){cursor:pointer}");
    expect(css).toContain("button:disabled,[aria-disabled=\"true\"]{cursor:not-allowed}");
    expect(css).toContain(".reviewer-photo-picker[aria-disabled=\"true\"]{cursor:not-allowed");
  });

  it("keeps success and error toasts readable on desktop and mobile", () => {
    expect(css).toContain(".app-toast{position:fixed");
    expect(css).toContain(".app-toast--error");
    expect(css).toContain("@media(max-width:560px){.app-toast");
  });

  it("keeps photo removal and toast dismissal at a 44px touch target", () => {
    expect(css).toContain(".reviewer-photo-list li button{min-width:44px;min-height:44px");
    expect(css).toContain(".app-toast button{width:44px;height:44px");
  });
});
