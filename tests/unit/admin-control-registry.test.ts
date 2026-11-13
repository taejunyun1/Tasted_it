import { describe, expect, it } from "vitest";
import { ADMIN_CONTROL_AREAS, ADMIN_CONTROL_REGISTRY, parseAdminControlArea } from "../../app/features/operations/admin-control-registry";

describe("admin control registry", () => {
  it("covers the 34 planned controls without presenting missing controls as available", () => {
    expect(ADMIN_CONTROL_REGISTRY.map((entry) => entry.id)).toEqual(Array.from({ length: 34 }, (_, index) => `A${String(index + 1).padStart(2, "0")}`));
    for (const entry of ADMIN_CONTROL_REGISTRY) {
      expect(ADMIN_CONTROL_AREAS.some((area) => area.id === entry.area)).toBe(true);
      expect(entry.task).not.toBe("");
      expect(entry.nextStep).not.toBe("");
      expect(entry.operatingState).toBe("UNVERIFIED");
      if (entry.href) expect(entry.href).toMatch(/^\/admin(?:\/|$)/);
      if (entry.status === "NOT_IMPLEMENTED") expect(entry.href).toBeNull();
    }
  });

  it("only accepts known area filters", () => {
    expect(parseAdminControlArea("content")).toBe("content");
    expect(parseAdminControlArea("https://outside.test")).toBe("all");
    expect(parseAdminControlArea(null)).toBe("all");
  });
});
