import {
  isRsiCloudflareEnabled,
  resolveRsiOrigin,
  RSI_CHECK_TOKEN_HEADER,
  RSI_ON_DEMAND_PATH,
  runRsiPublicPathCheck,
  type RsiSelfCheckResult,
} from "./rsi-self-check";

type RsiEnv = Env & {
  RSI_CLOUDFLARE_ENABLED?: string;
  RSI_CHECK_TOKEN?: string;
  APP_BASE_URL?: string;
};

function rsiEnv(env: Env): RsiEnv {
  return env as RsiEnv;
}

function configuredCheckToken(env: Env) {
  return rsiEnv(env).RSI_CHECK_TOKEN?.trim() ?? "";
}

export function rsiTokensMatch(provided: string, expected: string) {
  if (!expected || !provided) return false;
  const encoder = new TextEncoder();
  const left = encoder.encode(provided);
  const right = encoder.encode(expected);
  if (left.byteLength !== right.byteLength) return false;
  let diff = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    diff |= left[index]! ^ right[index]!;
  }
  return diff === 0;
}

function logRsiSelfCheck(
  trigger: "scheduled" | "on-demand",
  outcome:
    | { skipped: true; reason: "disabled" | "missing_origin" }
    | ({ skipped?: false } & RsiSelfCheckResult),
) {
  if ("skipped" in outcome && outcome.skipped) {
    console.info("RSI_SELF_CHECK", { trigger, skipped: true, reason: outcome.reason });
    return;
  }
  console.info("RSI_SELF_CHECK", {
    trigger,
    ok: outcome.ok,
    failed: outcome.failed,
    originHost: outcome.originHost,
    paths: outcome.results.map((result) => ({ path: result.path, status: result.status, ok: result.ok })),
  });
}

export async function runScheduledRsiSelfCheck(env: Env) {
  try {
    if (!isRsiCloudflareEnabled(rsiEnv(env).RSI_CLOUDFLARE_ENABLED)) {
      logRsiSelfCheck("scheduled", { skipped: true, reason: "disabled" });
      return { skipped: true as const, reason: "disabled" as const };
    }
    const origin = resolveRsiOrigin({ appBaseUrl: rsiEnv(env).APP_BASE_URL });
    if (!origin) {
      logRsiSelfCheck("scheduled", { skipped: true, reason: "missing_origin" });
      return { skipped: true as const, reason: "missing_origin" as const };
    }
    const result = await runRsiPublicPathCheck({ fetch, origin });
    logRsiSelfCheck("scheduled", result);
    return result;
  } catch (error) {
    console.error("RSI_SELF_CHECK_UNCAUGHT", {
      trigger: "scheduled",
      message: error instanceof Error ? error.message : "unknown",
    });
    return { ok: false, failed: -1, originHost: "uncaught", results: [] };
  }
}

export async function handleRsiOnDemandRequest(request: Request, env: Env) {
  const url = new URL(request.url);
  if (url.pathname !== RSI_ON_DEMAND_PATH) return null;

  const expected = configuredCheckToken(env);
  const provided = request.headers.get(RSI_CHECK_TOKEN_HEADER) ?? "";
  if (
    request.method !== "GET" ||
    !isRsiCloudflareEnabled(rsiEnv(env).RSI_CLOUDFLARE_ENABLED) ||
    !rsiTokensMatch(provided, expected)
  ) {
    return new Response(null, { status: 404 });
  }

  const origin = resolveRsiOrigin({
    appBaseUrl: rsiEnv(env).APP_BASE_URL,
    requestOrigin: url.origin,
  });
  if (!origin) {
    logRsiSelfCheck("on-demand", { skipped: true, reason: "missing_origin" });
    return Response.json({ skipped: true, reason: "missing_origin" }, { status: 503 });
  }

  try {
    const result = await runRsiPublicPathCheck({ fetch, origin });
    logRsiSelfCheck("on-demand", result);
    return Response.json(result, { status: result.ok ? 200 : 503 });
  } catch (error) {
    console.error("RSI_SELF_CHECK_UNCAUGHT", {
      trigger: "on-demand",
      message: error instanceof Error ? error.message : "unknown",
    });
    return Response.json({ ok: false, failed: -1 }, { status: 503 });
  }
}
