import { z } from "zod";

const KAKAO_KEYWORD_SEARCH_URL = "https://dapi.kakao.com/v2/local/search/keyword.json";
const KAKAO_SEARCH_TIMEOUT_MS = 3_000;
const KAKAO_SEARCH_SIZE = 5;
const KAKAO_MAX_RADIUS_METERS = 1_000;

const candidateSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  categoryGroupCode: z.string(),
  address: z.string(),
  roadAddress: z.string(),
  longitude: z.number().finite(),
  latitude: z.number().finite(),
  phone: z.string().nullable(),
}).strict();

const responseSchema = z.object({
  documents: z.array(candidateSchema),
}).strict();

export type KakaoPlaceCandidate = z.infer<typeof candidateSchema>;

export class KakaoLocalError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, retryable = false) {
    super(code);
    this.name = "KakaoLocalError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type KakaoPlaceSearchResult = {
  documents: KakaoPlaceCandidate[];
};

export async function searchKakaoPlaces(input: {
  apiKey: string;
  query: string;
  longitude: number;
  latitude: number;
  radius?: number;
  fetchImpl?: typeof fetch;
}): Promise<KakaoPlaceSearchResult> {
  if (!validInput(input)) throw new KakaoLocalError("KAKAO_REQUEST_INVALID");

  const url = new URL(KAKAO_KEYWORD_SEARCH_URL);
  url.search = new URLSearchParams({
    query: input.query,
    x: String(input.longitude),
    y: String(input.latitude),
    radius: String(normalizedRadius(input.radius)),
    size: String(KAKAO_SEARCH_SIZE),
  }).toString();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), KAKAO_SEARCH_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await (input.fetchImpl ?? fetch)(url.toString(), {
        headers: { Authorization: `KakaoAK ${input.apiKey}` },
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) throw new KakaoLocalError("KAKAO_REQUEST_TIMEOUT");
      throw new KakaoLocalError("KAKAO_REQUEST_FAILED");
    }

    if (!response.ok) throw httpError(response.status);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      if (controller.signal.aborted) throw new KakaoLocalError("KAKAO_REQUEST_TIMEOUT");
      throw new KakaoLocalError("KAKAO_RESPONSE_INVALID");
    }

    const parsed = responseSchema.safeParse(projectResponse(body));
    if (!parsed.success) throw new KakaoLocalError("KAKAO_RESPONSE_INVALID");
    return parsed.data;
  } finally {
    clearTimeout(timeout);
  }
}

function validInput(input: { apiKey: string; query: string; longitude: number; latitude: number; radius?: number }) {
  return input.apiKey.trim().length > 0
    && input.query.trim().length > 0
    && Number.isFinite(input.longitude)
    && Number.isFinite(input.latitude)
    && (input.radius === undefined || (Number.isFinite(input.radius) && input.radius > 0));
}

function normalizedRadius(radius: number | undefined) {
  return Math.min(KAKAO_MAX_RADIUS_METERS, Math.round(radius ?? KAKAO_MAX_RADIUS_METERS));
}

function httpError(status: number) {
  if (status === 429) return new KakaoLocalError("KAKAO_RATE_LIMITED", true);
  if (status >= 500 && status <= 599) return new KakaoLocalError("KAKAO_SERVER_ERROR", true);
  if (status === 401 || status === 403) return new KakaoLocalError("KAKAO_AUTH_FAILED");
  return new KakaoLocalError("KAKAO_REQUEST_FAILED");
}

function projectResponse(body: unknown) {
  if (!body || typeof body !== "object" || !("documents" in body) || !Array.isArray(body.documents)) return body;
  return {
    documents: body.documents.map((document) => {
      if (!document || typeof document !== "object") return document;
      const value = document as Record<string, unknown>;
      return {
        id: value.id,
        name: value.place_name,
        categoryGroupCode: value.category_group_code,
        address: value.address_name,
        roadAddress: value.road_address_name,
        longitude: numberValue(value.x),
        latitude: numberValue(value.y),
        phone: typeof value.phone === "string" && value.phone.trim() ? value.phone : null,
      };
    }),
  };
}

function numberValue(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) return Number(value);
  return value;
}
