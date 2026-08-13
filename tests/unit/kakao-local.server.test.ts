import { describe, expect, it, vi } from "vitest";

import {
  KakaoLocalError,
  searchKakaoPlaces,
} from "../../app/features/places/kakao-local.server";

const input = {
  apiKey: "test-key",
  query: "테스트식당 광주광역시 동구 테스트로 1",
  longitude: 126.9,
  latitude: 35.1,
};

function kakaoResponse(documents: unknown[] = [
  {
    id: "123",
    place_name: "테스트식당",
    category_group_code: "FD6",
    address_name: "광주광역시 동구 테스트동 1",
    road_address_name: "광주광역시 동구 테스트로 1",
    x: "126.9",
    y: "35.1",
    phone: "062-123-4567",
    place_url: "https://place.map.kakao.com/123",
  },
]) {
  return new Response(JSON.stringify({ documents }));
}

function errorDetails(error: unknown) {
  expect(error).toBeInstanceOf(KakaoLocalError);
  return error as KakaoLocalError;
}

describe("searchKakaoPlaces", () => {
  it("performs one constrained request and returns only the required candidate fields", async () => {
    const fetchImpl = vi.fn(async () => kakaoResponse());

    const result = await searchKakaoPlaces({ ...input, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [requestUrl, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const url = new URL(requestUrl);
    expect(url.origin + url.pathname).toBe("https://dapi.kakao.com/v2/local/search/keyword.json");
    expect(Object.fromEntries(url.searchParams)).toEqual({ query: input.query, x: "126.9", y: "35.1", radius: "1000", size: "5" });
    const headers = new Headers(requestInit.headers);
    expect([...headers.keys()]).toEqual(["authorization"]);
    expect(headers.get("Authorization")).toBe("KakaoAK test-key");
    expect(result.documents).toEqual([{
      id: "123",
      name: "테스트식당",
      categoryGroupCode: "FD6",
      address: "광주광역시 동구 테스트동 1",
      roadAddress: "광주광역시 동구 테스트로 1",
      longitude: 126.9,
      latitude: 35.1,
      phone: "062-123-4567",
    }]);
  });

  it("caps a supplied radius at 1000 and accepts empty documents", async () => {
    const fetchImpl = vi.fn(async () => kakaoResponse([]));

    await expect(searchKakaoPlaces({ ...input, radius: 2_000, fetchImpl })).resolves.toEqual({ documents: [] });
    const [requestUrl] = fetchImpl.mock.calls[0] as [string];
    expect(new URL(requestUrl).searchParams.get("radius")).toBe("1000");
  });

  it.each([
    [429, "KAKAO_RATE_LIMITED", true],
    [500, "KAKAO_SERVER_ERROR", true],
    [401, "KAKAO_AUTH_FAILED", false],
  ])("maps HTTP %i to a safe retry policy", async (status, code, retryable) => {
    const fetchImpl = vi.fn(async () => new Response(null, { status }));

    await expect(searchKakaoPlaces({ ...input, fetchImpl })).rejects.toSatisfy((error: unknown) => {
      const details = errorDetails(error);
      return details.code === code && details.retryable === retryable;
    });
  });

  it("aborts the single request after three seconds", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const pending = searchKakaoPlaces({ ...input, fetchImpl });
    const rejection = expect(pending).rejects.toSatisfy((error: unknown) => {
      const details = errorDetails(error);
      return details.code === "KAKAO_REQUEST_TIMEOUT" && details.retryable === false;
    });

    await vi.advanceTimersByTimeAsync(3_000);

    await rejection;
    vi.useRealTimers();
  });

  it("rejects malformed JSON without exposing request data", async () => {
    const fetchImpl = vi.fn(async () => new Response("not-json"));

    await expect(searchKakaoPlaces({ ...input, fetchImpl })).rejects.toSatisfy((error: unknown) => {
      const details = errorDetails(error);
      const rendered = JSON.stringify(details);
      return details.code === "KAKAO_RESPONSE_INVALID"
        && details.retryable === false
        && !rendered.includes(input.query)
        && !rendered.includes(input.apiKey)
        && !rendered.includes("dapi.kakao.com");
    });
  });
});
