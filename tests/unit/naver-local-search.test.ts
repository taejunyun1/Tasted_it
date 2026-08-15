import { describe, expect, it, vi } from "vitest";

import {
  NaverLocalSearchError,
  assertNaverLocalSearchEnabled,
  createNaverLocalSearchAdapter,
} from "../../app/features/candidates/naver-local-search.server";

const enabledEnv = {
  NAVER_LOCAL_SEARCH_ENABLED: "true",
  NAVER_API_HUB_KEY_ID: "test-api-key-id",
  NAVER_API_HUB_KEY: "test-api-key",
};

const searchInput = {
  businessName: "인생역전",
  address: "광주광역시 광산구 임방울대로 825",
  regionCode: "GWANGJU" as const,
};

function localResponse(items: unknown[] = [
  {
    title: "<b>인생역전</b>",
    link: "https://example.invalid/place/never-store",
    category: "음식점>술집>포장마차",
    description: "never-store-this-description",
    telephone: "",
    address: "광주광역시 광산구 쌍암동 1",
    roadAddress: "광주광역시 광산구 임방울대로 825",
    mapx: "1268498900",
    mapy: "352209100",
  },
]) {
  return new Response(JSON.stringify({ lastBuildDate: "", total: items.length, start: 1, display: items.length, items }));
}

function errorDetails(error: unknown) {
  expect(error).toBeInstanceOf(NaverLocalSearchError);
  return error as NaverLocalSearchError;
}

describe("NAVER 지역검색 서버 어댑터", () => {
  it("rejects a disabled feature before an admin batch run is created", () => {
    expect(() => assertNaverLocalSearchEnabled({ ...enabledEnv, NAVER_LOCAL_SEARCH_ENABLED: "false" }))
      .toThrow("NAVER_LOCAL_SEARCH_DISABLED");
  });

  it("sends one bounded request and projects only matcher-safe fields", async () => {
    const fetcher = vi.fn(async () => localResponse());
    const adapter = createNaverLocalSearchAdapter(enabledEnv, fetcher);

    await expect(adapter.search(searchInput)).resolves.toEqual([{
      name: "인생역전",
      category: "음식점>술집>포장마차",
      address: "광주광역시 광산구 임방울대로 825",
      latitude: 35.22091,
      longitude: 126.84989,
    }]);

    expect(fetcher).toHaveBeenCalledOnce();
    const [requestUrl, init] = fetcher.mock.calls[0] as [string, RequestInit];
    const url = new URL(requestUrl);
    expect(url.origin + url.pathname).toBe("https://naverapihub.apigw.ntruss.com/search/v1/local");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      query: "인생역전 광주광역시 광산구 임방울대로 825",
      display: "5",
      start: "1",
      sort: "random",
    });
    const headers = new Headers(init.headers);
    expect(headers.get("X-NCP-APIGW-API-KEY-ID")).toBe("test-api-key-id");
    expect(headers.get("X-NCP-APIGW-API-KEY")).toBe("test-api-key");
  });

  it("fails closed when the feature is disabled without calling NAVER", async () => {
    const fetcher = vi.fn();
    const adapter = createNaverLocalSearchAdapter({ ...enabledEnv, NAVER_LOCAL_SEARCH_ENABLED: "false" }, fetcher);

    await expect(adapter.search(searchInput)).rejects.toSatisfy((error: unknown) => errorDetails(error).code === "NAVER_LOCAL_SEARCH_DISABLED");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [401, "NAVER_LOCAL_SEARCH_REJECTED", false],
    [403, "NAVER_LOCAL_SEARCH_REJECTED", false],
    [429, "NAVER_LOCAL_SEARCH_QUOTA", false],
    [500, "NAVER_LOCAL_SEARCH_UNAVAILABLE", true],
  ])("maps HTTP %i to a safe error contract", async (status, code, retryable) => {
    const adapter = createNaverLocalSearchAdapter(enabledEnv, vi.fn(async () => new Response("{}", { status })));

    await expect(adapter.search(searchInput)).rejects.toSatisfy((error: unknown) => {
      const details = errorDetails(error);
      return details.code === code && details.retryable === retryable;
    });
  });

  it("rejects malformed provider responses without exposing an original payload", async () => {
    const originalPayload = "not-a-safe-provider-payload";
    const adapter = createNaverLocalSearchAdapter(enabledEnv, vi.fn(async () => new Response(JSON.stringify({ total: 1, items: [{ title: originalPayload }] }))));

    await expect(adapter.search(searchInput)).rejects.toSatisfy((error: unknown) => {
      const details = errorDetails(error);
      return details.code === "NAVER_LOCAL_SEARCH_RESPONSE_INVALID"
        && !String(details.message).includes(originalPayload)
        && !JSON.stringify(details).includes(originalPayload);
    });
  });

  it("turns a timed out request into a safe non-retryable error", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const adapter = createNaverLocalSearchAdapter(enabledEnv, fetcher);
    const rejected = expect(adapter.search(searchInput)).rejects.toSatisfy((error: unknown) => {
      const details = errorDetails(error);
      return details.code === "NAVER_LOCAL_SEARCH_TIMEOUT" && details.retryable === false;
    });

    await vi.advanceTimersByTimeAsync(4_000);
    await rejected;
    vi.useRealTimers();
  });
});
