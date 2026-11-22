import { describe, expect, it } from "vitest";
import { readPlaceMutationBrowseReturn, safePlaceMutationBrowseReturn } from "../../app/features/auth/place-detail-return";

const origin = "https://retaste.test";
const slug = "sample-dongmyeong-ramen";
const detail = `/places/${slug}`;
const proof = "sourceRail=TRUSTED&discoveryMode=QUALITY&recommendationRequestId=7b3c9a17-8064-4d2e-8cf7-857dfc78b86f";
const browse = (path: string, target: string) => `${path}?${new URLSearchParams({ q: "동명동", bbox: "126.90,35.14,126.93,35.16", view: "list", selected: "sample-place-1", place: target })}#all-places`;

describe("safePlaceMutationBrowseReturn", () => {
  it("keeps the exact browse URL for an equivalent place detail on each mobile surface", () => {
    for (const path of ["/", "/places", "/places/", "/maps/ramen-detail", "/maps/ramen-detail/"]) {
      const continuation = browse(path, path === "/" ? slug : detail);
      expect(safePlaceMutationBrowseReturn(continuation, `${origin}${detail}`, slug)).toBe(continuation);
    }
  });

  it("matches document and data request paths and preserves the entire nested proof", () => {
    const continuation = browse("/places", `${detail}?${proof}`);
    for (const request of [`${detail}?${proof}`, `${detail}.data?${proof}`, `${detail}.data?${proof}&_routes=routes%2Fplace-detail`])
      expect(safePlaceMutationBrowseReturn(continuation, `${origin}${request}`, slug)).toBe(continuation);
  });

  it("rejects a missing or different nested destination, invalid route or different proof", () => {
    const continuation = browse("/places", `${detail}?${proof}`);
    for (const input of [
      null, "//example.org", `${origin}${continuation}`, browse("/admin", detail), browse("/onboarding/taste", detail),
      browse("/places", "/places/other"), browse("/places", "//other.example"), browse("/places", detail),
      `/places?place=${encodeURIComponent(`${detail}?${proof}`)}&place=other`,
      browse("/places", `${detail}?${proof.replace("7b3c", "8b3c")}`),
    ]) expect(safePlaceMutationBrowseReturn(input, `${origin}${detail}.data?${proof}`, slug)).toBeNull();
    expect(safePlaceMutationBrowseReturn(continuation, `${origin}${detail}.data?${proof}&_routes=routes%2Fmap-category`, slug)).toBeNull();
    expect(safePlaceMutationBrowseReturn(continuation, `${origin}${detail}?${proof}`, "other")).toBeNull();
  });

  it("matches equivalent slug encoding while retaining exact nested proof and continuation", () => {
    const encodedDetail = detail.replace("/sample", "/%73ample");
    const continuation = browse("/places/", `${encodedDetail}?${proof}`);
    expect(safePlaceMutationBrowseReturn(continuation, `${origin}${detail}.data?${proof}`, slug)).toBe(continuation);
    const unencoded = browse("/places", `${detail}?${proof}`);
    expect(safePlaceMutationBrowseReturn(unencoded, `${origin}${encodedDetail}.data?${proof}`, slug)).toBe(unencoded);
    expect(safePlaceMutationBrowseReturn(browse("/places/", `${encodedDetail}%20?${proof}`), `${origin}${detail}.data?${proof}`, slug)).toBeNull();
    const alternateProof = proof.split("&").reverse().join("&");
    expect(safePlaceMutationBrowseReturn(browse("/places/", `${encodedDetail}?${alternateProof}`), `${origin}${detail}.data?${proof}`, slug)).toBeNull();
  });

  it("preserves a real place slug ending in .data", () => {
    const continuation = browse("/places", `${detail}.data`);
    expect(safePlaceMutationBrowseReturn(continuation, `${origin}${detail}.data`, `${slug}.data`)).toBe(continuation);
    expect(safePlaceMutationBrowseReturn(continuation, `${origin}${detail}.data.data`, `${slug}.data`)).toBe(continuation);
  });
});

describe("readPlaceMutationBrowseReturn", () => {
  const continuation = browse("/places/", `${detail}?${proof}`);
  const body = new URLSearchParams({ intent: "save", saved: "true", browseReturnTo: continuation }).toString();
  const request = (payload: BodyInit, type = "application/x-www-form-urlencoded; charset=UTF-8") => new Request(
    `${origin}${detail}.data?${proof}`,
    { method: "POST", body: payload, headers: { "Content-Type": type }, duplex: "half" } as RequestInit,
  );

  it("reads a valid form-urlencoded body", async () => {
    await expect(readPlaceMutationBrowseReturn(request(body), slug)).resolves.toBe(continuation);
  });

  it("leaves unsupported media untouched and rejects malformed or duplicate continuations", async () => {
    for (const type of ["multipart/form-data; boundary=test", "application/x-www-form-urlencoded-extra", "text/plain"]) {
      const unsupported = request(body, type);
      await expect(readPlaceMutationBrowseReturn(unsupported, slug)).resolves.toBeNull();
      expect(unsupported.bodyUsed).toBe(false);
    }
    for (const suffix of ["&extra=%", "&extra=%C0%AF", "&browseReturnTo=%2Fplaces"]) {
      await expect(readPlaceMutationBrowseReturn(request(body + suffix), slug)).resolves.toBeNull();
    }
  });

  it("cancels an oversized stream with no Content-Length before parsing it", async () => {
    let chunksRead = 0;
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        ++chunksRead;
        controller.enqueue(chunksRead === 1 ? new TextEncoder().encode(body) : new Uint8Array(8192));
      },
      cancel() { canceled = true; },
    });
    await expect(readPlaceMutationBrowseReturn(request(stream), slug)).resolves.toBeNull();
    expect(canceled).toBe(true);
    expect(chunksRead).toBeLessThanOrEqual(3);
  });
});
