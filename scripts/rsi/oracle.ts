import { z } from "zod";
import { RSI_PUBLIC_PATHS } from "./contracts";

export const rsiFixtureSchema = z.enum([
  "NATIVE_RECEIVER", "NORMAL", "HTTP_FAILURE", "AUTH_REDIRECT_FAILURE", "AUTH_STATUS_FAILURE",
]);
export type RsiFixture = z.infer<typeof rsiFixtureSchema>;
type Path = (typeof RSI_PUBLIC_PATHS)[number];

const observedCallSchema = z.strictObject({
  path: z.enum([...RSI_PUBLIC_PATHS, "OUTSIDE_ALLOWLIST"]),
  method: z.enum(["GET", "OTHER"]), status: z.number().int().min(0).max(599),
  location: z.enum(["", "/login", "/not-login"]), originAllowed: z.boolean(),
});
export type RsiObservedCall = z.infer<typeof observedCallSchema>;
const callsSchema = z.array(observedCallSchema).length(6);

// The app result has exactly four fields. R2-only receiver instrumentation is
// added and removed by its adapter, never required from a native app candidate.
export const rsiPublicPathResultSchema = z.strictObject({
  ok: z.boolean(), failed: z.number().int().min(0).max(6), originHost: z.literal("rsi.invalid"),
  results: z.array(z.strictObject({
    path: z.enum(RSI_PUBLIC_PATHS), status: z.number().int().min(0).max(599),
    location: z.enum(["", "/login", "/not-login"]), ok: z.boolean(),
  })).length(6),
});

export type RsiOracleGrade = {
  verdict: "PASS" | "FAIL" | "NO_CHANGE";
  reasonCode: "SIX_PATHS_VERIFIED" | "NORMAL" | "EXTERNAL_FAILURE" | "ORACLE_MISMATCH";
  redReproduced: false;
  greenVerified: boolean;
};

/** Fixed synthetic responses for trusted fixture brokers, never a live fetch. */
export function expectedRsiFixtureResponse(fixture: RsiFixture, path: Path): Pick<RsiObservedCall, "status" | "location"> {
  if (fixture === "AUTH_STATUS_FAILURE" && path === "/admin") return { status: 200, location: "" };
  if (fixture === "HTTP_FAILURE" && path === "/places") return { status: 503, location: "" };
  if (path === "/admin") return { status: 302, location: fixture === "AUTH_REDIRECT_FAILURE" ? "/not-login" : "/login" };
  return { status: 200, location: "" };
}

/** Pure comparison only: callers must separately establish trace custody and
 * native execution provenance. A fabricated matching body/trace can pass this
 * function; its return value is not a trusted execution receipt or R2 RED. */
export function gradeRsiPublicPathCheck(fixture: RsiFixture, body: unknown, calls: unknown): RsiOracleGrade {
  const fail: RsiOracleGrade = { verdict: "FAIL", reasonCode: "ORACLE_MISMATCH", redReproduced: false, greenVerified: false };
  try {
    if (!rsiFixtureSchema.safeParse(fixture).success) return fail;
    const parsed = rsiPublicPathResultSchema.safeParse(body);
    const trace = callsSchema.safeParse(calls);
    if (!parsed.success || !trace.success) return fail;
    const value = parsed.data;
    if (new Set(value.results.map((row) => row.path)).size !== 6) return fail;
    let failed = 0;
    for (const path of RSI_PUBLIC_PATHS) {
      const observed = trace.data.filter((call) => call.path === path);
      if (observed.length !== 1) return fail;
      const call = observed[0];
      const expected = expectedRsiFixtureResponse(fixture, path);
      if (!call.originAllowed || call.method !== "GET" || call.status !== expected.status || call.location !== expected.location) return fail;
      const row = value.results.find((result) => result.path === path)!;
      const ok = call.status === (path === "/admin" ? 302 : 200) && (path !== "/admin" || call.location === "/login");
      if (row.status !== call.status || row.location !== call.location || row.ok !== ok) return fail;
      if (!ok) failed++;
    }
    if (value.failed !== failed || value.ok !== (failed === 0)) return fail;
    return {
      verdict: fixture === "NATIVE_RECEIVER" ? "PASS" : "NO_CHANGE",
      reasonCode: fixture === "NATIVE_RECEIVER" ? "SIX_PATHS_VERIFIED" : fixture === "NORMAL" ? "NORMAL" : "EXTERNAL_FAILURE",
      redReproduced: false, greenVerified: failed === 0,
    };
  } catch {
    // Malformed caller objects can throw while being read; never echo input.
    return fail;
  }
}
