import { describe, expect, it } from "vitest";
import { loadPlaceDetailSafely, mutatePlaceDetailSafely } from "../../app/features/places/place-detail-client";

describe("place detail client failure boundary", () => {
  it("returns successful data and known action outcomes unchanged", async () => {
    const detail = { place: { id: "place-a" }, saved: false };
    expect(await loadPlaceDetailSafely(async () => detail)).toBe(detail);
    const conflict = { ok: false, error: "VOTE_VERSION_CONFLICT", message: "새로고침해 주세요." };
    expect(await mutatePlaceDetailSafely(async () => conflict)).toBe(conflict);
  });

  it("keeps missing and forbidden details distinct without copying internal errors", async () => {
    for (const status of [403, 404]) {
      const result = await loadPlaceDetailSafely(async () => { throw new Response("private database details", { status }); });
      expect(result).toEqual({ detailError: true, status });
      expect(JSON.stringify(result)).not.toContain("private");
    }
    expect(await loadPlaceDetailSafely(async () => { throw new TypeError("secret network address"); }))
      .toEqual({ detailError: true, status: 503 });
  });

  it("does not turn redirects into a failed or successful detail", async () => {
    const redirect = new Response(null, { status: 302, headers: { Location: "/login" } });
    await expect(loadPlaceDetailSafely(async () => { throw redirect; })).rejects.toBe(redirect);
    await expect(mutatePlaceDetailSafely(async () => { throw redirect; })).rejects.toBe(redirect);
  });

  it("requires a fresh read after a mutation result is lost", async () => {
    const result = await mutatePlaceDetailSafely(async () => { throw new TypeError("internal address"); });
    expect(result).toEqual({ ok: false, resultUnknown: true, status: 503 });
    expect(JSON.stringify(result)).not.toContain("internal");
  });

  it("does not describe an explicit authorization or input rejection as an unknown write", async () => {
    for (const status of [400, 401, 403, 404]) {
      expect(await mutatePlaceDetailSafely(async () => { throw new Response("private", { status }); }))
        .toEqual({ ok: false, resultUnknown: false, status });
    }
  });
});
