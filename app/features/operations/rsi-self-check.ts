export const RSI_LIVE_ORIGIN = "https://retaste-beta.retaste-beta.workers.dev";
export const RSI_ON_DEMAND_PATH = "/internal/rsi-self-check";
export const RSI_CHECK_TOKEN_HEADER = "x-rsi-check-token";
export const MAINTENANCE_CRON = "17 18 * * *";
export const RSI_CRON = "47 */6 * * *";

export function isRsiCron(cron: string) {
  return cron === RSI_CRON;
}
export const RSI_SELF_CHECK_USER_AGENT =
  "Mozilla/5.0 (compatible; ReTasteCloudflareSelfCheck/1.0; +https://github.com/taejunyun1/Tasted_it)";

export const RSI_PUBLIC_PATH_CHECKS = [
  { path: "/", status: 200 },
  { path: "/places", status: 200 },
  { path: "/login", status: 200 },
  { path: "/admin", status: 302, locationIncludes: "/login" },
  { path: "/robots.txt", status: 200 },
  { path: "/privacy", status: 200 },
] as const;

export type RsiPublicPathCheck = (typeof RSI_PUBLIC_PATH_CHECKS)[number];

export type RsiPathResult = {
  path: string;
  status: number;
  location: string;
  ok: boolean;
};

export type RsiSelfCheckResult = {
  ok: boolean;
  failed: number;
  originHost: string;
  results: RsiPathResult[];
};

export function isRsiCloudflareEnabled(value?: string | null) {
  return value === "true";
}

export function resolveRsiOrigin(input: { appBaseUrl?: string | null; requestOrigin?: string | null }) {
  const fromEnv = input.appBaseUrl?.trim().replace(/\/$/, "") ?? "";
  if (fromEnv) return fromEnv;
  const fromRequest = input.requestOrigin?.trim().replace(/\/$/, "") ?? "";
  if (fromRequest) return fromRequest;
  return null;
}

export function rsiOriginHost(origin: string) {
  try {
    return new URL(origin).host;
  } catch {
    return "invalid-origin";
  }
}

export async function runRsiPublicPathCheck(input: {
  fetch: typeof fetch;
  origin: string;
}): Promise<RsiSelfCheckResult> {
  const headers = {
    Accept: "text/html,text/plain;q=0.9,*/*;q=0.8",
    "User-Agent": RSI_SELF_CHECK_USER_AGENT,
  };

  const results = await Promise.all(
    RSI_PUBLIC_PATH_CHECKS.map(async (check) => {
      const url = new URL(check.path, `${input.origin}/`);
      try {
        const response = await input.fetch(url, {
          method: "GET",
          redirect: "manual",
          headers,
          signal: AbortSignal.timeout(8_000),
        });
        const location = response.headers.get("location") ?? "";
        const ok =
          response.status === check.status &&
          (!("locationIncludes" in check) || location.includes(check.locationIncludes));
        return { path: check.path, status: response.status, location, ok };
      } catch {
        // Status 0 represents a network/timeout failure, without upstream details.
        return { path: check.path, status: 0, location: "", ok: false };
      }
    }),
  );

  const failed = results.filter((result) => !result.ok).length;
  return {
    ok: failed === 0,
    failed,
    originHost: rsiOriginHost(input.origin),
    results,
  };
}
