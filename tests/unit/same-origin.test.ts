import { describe, expect, it } from "vitest";

import { isSameOriginMutation } from "../../app/features/http/same-origin";

describe("isSameOriginMutation", () => {
  it("accepts only a request that declares the route origin", () => {
    expect(isSameOriginMutation(new Request("https://retaste.test/admin/place-operations", { method: "POST", headers: { Origin: "https://retaste.test" } }))).toBe(true);
    expect(isSameOriginMutation(new Request("https://retaste.test/admin/place-operations", { method: "POST", headers: { Origin: "https://elsewhere.invalid" } }))).toBe(false);
    expect(isSameOriginMutation(new Request("https://retaste.test/admin/place-operations", { method: "POST" }))).toBe(false);
  });
});
