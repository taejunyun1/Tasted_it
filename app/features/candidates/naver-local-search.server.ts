import { z } from "zod";

import type { RegionCode } from "./public-data";

const NAVER_LOCAL_SEARCH_URL = "https://openapi.naver.com/v1/search/local.json";
const NAVER_LOCAL_SEARCH_TIMEOUT_MS = 4_000;
const NAVER_LOCAL_SEARCH_RESULT_LIMIT = 5;
const NAVER_WGS84_SCALE = 10_000_000;

const itemSchema = z.object({
  title: z.string(),
  category: z.string(),
  address: z.string(),
  roadAddress: z.string(),
  mapx: z.union([z.string(), z.number()]),
  mapy: z.union([z.string(), z.number()]),
}).strict();

const responseSchema = z.object({
  total: z.number().int().nonnegative(),
  items: z.array(itemSchema).max(NAVER_LOCAL_SEARCH_RESULT_LIMIT),
}).strict();

export type NaverLocalSearchResult = {
  name: string;
  category: string;
  address: string;
  latitude: number;
  longitude: number;
};

export type NaverLocalSearchInput = {
  businessName: string;
  address: string;
  regionCode: RegionCode;
};

export type NaverLocalSearchAdapter = {
  search(input: NaverLocalSearchInput): Promise<NaverLocalSearchResult[]>;
};

export type NaverLocalSearchEnv = Pick<Cloudflare.Env,
  "NAVER_LOCAL_SEARCH_ENABLED" | "NAVER_LOCAL_SEARCH_CLIENT_ID" | "NAVER_LOCAL_SEARCH_CLIENT_SECRET"
>;

export class NaverLocalSearchError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly code:
      | "NAVER_LOCAL_SEARCH_DISABLED"
      | "NAVER_LOCAL_SEARCH_TIMEOUT"
      | "NAVER_LOCAL_SEARCH_QUOTA"
      | "NAVER_LOCAL_SEARCH_REJECTED"
      | "NAVER_LOCAL_SEARCH_UNAVAILABLE"
      | "NAVER_LOCAL_SEARCH_RESPONSE_INVALID",
    retryable = false,
  ) {
    super(code);
    this.name = "NaverLocalSearchError";
    this.retryable = retryable;
  }
}

export function createNaverLocalSearchAdapter(
  env: NaverLocalSearchEnv,
  fetchImpl: typeof fetch = fetch,
): NaverLocalSearchAdapter {
  return {
    async search(input) {
      if (env.NAVER_LOCAL_SEARCH_ENABLED !== "true" || !hasCredentials(env)) {
        throw new NaverLocalSearchError("NAVER_LOCAL_SEARCH_DISABLED");
      }
      if (!validInput(input)) throw new NaverLocalSearchError("NAVER_LOCAL_SEARCH_REJECTED");

      const url = new URL(NAVER_LOCAL_SEARCH_URL);
      url.search = new URLSearchParams({
        query: buildQuery(input),
        display: String(NAVER_LOCAL_SEARCH_RESULT_LIMIT),
        start: "1",
        sort: "random",
      }).toString();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), NAVER_LOCAL_SEARCH_TIMEOUT_MS);
      try {
        let response: Response;
        try {
          response = await fetchImpl(url.toString(), {
            headers: {
              "X-Naver-Client-Id": env.NAVER_LOCAL_SEARCH_CLIENT_ID,
              "X-Naver-Client-Secret": env.NAVER_LOCAL_SEARCH_CLIENT_SECRET,
            },
            signal: controller.signal,
          });
        } catch {
          throw new NaverLocalSearchError(controller.signal.aborted ? "NAVER_LOCAL_SEARCH_TIMEOUT" : "NAVER_LOCAL_SEARCH_UNAVAILABLE", !controller.signal.aborted);
        }

        if (!response.ok) throw httpError(response.status);
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw new NaverLocalSearchError(controller.signal.aborted ? "NAVER_LOCAL_SEARCH_TIMEOUT" : "NAVER_LOCAL_SEARCH_RESPONSE_INVALID");
        }
        const parsed = responseSchema.safeParse(projectResponse(payload));
        if (!parsed.success) throw new NaverLocalSearchError("NAVER_LOCAL_SEARCH_RESPONSE_INVALID");

        const results = parsed.data.items.map(toResult);
        if (results.some((result) => !validCoordinates(result.latitude, result.longitude) || !result.name || !result.category || !result.address)) {
          throw new NaverLocalSearchError("NAVER_LOCAL_SEARCH_RESPONSE_INVALID");
        }
        return results;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function hasCredentials(env: NaverLocalSearchEnv) {
  return env.NAVER_LOCAL_SEARCH_CLIENT_ID.trim().length > 0 && env.NAVER_LOCAL_SEARCH_CLIENT_SECRET.trim().length > 0;
}

function validInput(input: NaverLocalSearchInput) {
  return input.businessName.trim().length > 0 && input.businessName.length <= 120
    && input.address.trim().length > 0 && input.address.length <= 240
    && (input.regionCode === "GWANGJU" || input.regionCode === "JEONNAM");
}

function buildQuery(input: NaverLocalSearchInput) {
  return `${input.businessName.trim()} ${input.address.trim().split(/\s+/).slice(0, 4).join(" ")}`.trim();
}

function httpError(status: number) {
  if (status === 429) return new NaverLocalSearchError("NAVER_LOCAL_SEARCH_QUOTA");
  if (status >= 500 && status <= 599) return new NaverLocalSearchError("NAVER_LOCAL_SEARCH_UNAVAILABLE", true);
  return new NaverLocalSearchError("NAVER_LOCAL_SEARCH_REJECTED");
}

function projectResponse(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("items" in payload) || !Array.isArray(payload.items)) return payload;
  const value = payload as Record<string, unknown>;
  const items = value.items as unknown[];
  return {
    total: value.total,
    items: items.map((item) => {
      if (!item || typeof item !== "object") return item;
      const raw = item as Record<string, unknown>;
      return {
        title: raw.title,
        category: raw.category,
        address: raw.address,
        roadAddress: raw.roadAddress,
        mapx: raw.mapx,
        mapy: raw.mapy,
      };
    }),
  };
}

function toResult(item: z.infer<typeof itemSchema>): NaverLocalSearchResult {
  return {
    name: stripMarkup(item.title).trim(),
    category: item.category.trim(),
    address: (item.roadAddress || item.address).trim(),
    latitude: coordinate(item.mapy),
    longitude: coordinate(item.mapx),
  };
}

function coordinate(value: string | number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return parsed / NAVER_WGS84_SCALE;
}

function validCoordinates(latitude: number, longitude: number) {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

function stripMarkup(value: string) {
  return value.replace(/<[^>]+>/g, "");
}
