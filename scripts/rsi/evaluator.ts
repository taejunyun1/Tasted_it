import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { z } from "zod";
import { RSI_PUBLIC_PATHS, RSI_SCHEMA_VERSION } from "./contracts";
import {
  expectedRsiFixtureResponse, gradeRsiPublicPathCheck, rsiFixtureSchema, rsiPublicPathResultSchema,
  type RsiFixture, type RsiObservedCall,
} from "./oracle";
export type { RsiObservedCall } from "./oracle";

const MANIFEST_HASH = "881e60d08a091d83651fd67a62023a1ab3e160841fb183a654e92764e68d0ce8";
const fixtureSchema = rsiFixtureSchema;
const programSchema = z.enum([
  "BOUND", "UNBOUND", "SKIP_CHECK", "WEAK_SUCCESS", "FALSE_PASS", "ESCAPE_PATH",
  "WRONG_METHOD", "DUPLICATE_PATH", "MALFORMED_RESULT", "THROW", "TIMEOUT",
]);
const manifestSchema = z.strictObject({
  schemaVersion: z.literal(RSI_SCHEMA_VERSION),
  cases: z.array(z.strictObject({
    id: z.uuid(),
    rootCauseFamily: z.enum(["NATIVE_RECEIVER", "NORMAL", "UPSTREAM_HTTP", "UPSTREAM_AUTH"]),
    split: z.enum(["DEVELOPMENT", "SELECTION", "FINAL"]),
    fixture: fixtureSchema,
    expected: z.enum(["REPAIR", "NO_CHANGE"]),
  })).min(1).max(64),
});
export type RsiDevelopmentManifest = z.infer<typeof manifestSchema>;
type Fixture = RsiFixture;
type Program = z.infer<typeof programSchema>;
const family: Record<Fixture, RsiDevelopmentManifest["cases"][number]["rootCauseFamily"]> = {
  NATIVE_RECEIVER: "NATIVE_RECEIVER", NORMAL: "NORMAL", HTTP_FAILURE: "UPSTREAM_HTTP",
  AUTH_REDIRECT_FAILURE: "UPSTREAM_AUTH", AUTH_STATUS_FAILURE: "UPSTREAM_AUTH",
};
const hash = (content: string | Buffer) => createHash("sha256").update(content).digest("hex");

// Trusted curator API only. A caller-supplied digest is content binding, not
// authorization. Execution below always reloads the independently pinned file.
export function validateManifest(input: unknown, expectedHash: unknown): RsiDevelopmentManifest {
  let manifest: RsiDevelopmentManifest;
  let actualHash: string;
  try {
    manifest = manifestSchema.parse(input);
    actualHash = hash(JSON.stringify(input));
  } catch {
    throw new Error("RSI_INVALID_MANIFEST");
  }
  if (typeof expectedHash !== "string" || !/^[a-f0-9]{64}$/.test(expectedHash) || actualHash !== expectedHash) {
    throw new Error("RSI_MANIFEST_HASH_MISMATCH");
  }
  const ids = new Set<string>();
  const splits = new Map<string, string>();
  for (const row of manifest.cases) {
    const id = row.id.toLowerCase();
    if (ids.has(id) || (splits.has(row.rootCauseFamily) && splits.get(row.rootCauseFamily) !== row.split)
      || family[row.fixture] !== row.rootCauseFamily
      || row.expected !== (row.fixture === "NATIVE_RECEIVER" ? "REPAIR" : "NO_CHANGE")
      || (row.rootCauseFamily === "NATIVE_RECEIVER" && row.split !== "DEVELOPMENT")) {
      throw new Error("RSI_INVALID_MANIFEST");
    }
    ids.add(id);
    splits.set(row.rootCauseFamily, row.split);
  }
  return manifest;
}

export function loadDevelopmentManifest(): { manifest: RsiDevelopmentManifest; hash: string } {
  let raw: Buffer;
  let input: unknown;
  try {
    raw = readFileSync(new URL("./fixtures/development-manifest.json", import.meta.url));
    input = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new Error("RSI_INVALID_MANIFEST");
  }
  if (hash(raw) !== MANIFEST_HASH) throw new Error("RSI_MANIFEST_HASH_MISMATCH");
  const manifest = validateManifest(input, hash(JSON.stringify(input)));
  if (manifest.cases.some((row) => row.split !== "DEVELOPMENT")) throw new Error("RSI_INVALID_MANIFEST");
  return { manifest, hash: MANIFEST_HASH };
}

// This is a fixed, reviewed program catalogue, never a source/patch executor.
// The worker does not receive fixture IDs, manifest answers, or oracle state.
function fixedProgram(program: Program): string {
  return `
    const variant = ${JSON.stringify(program)};
    const paths = ["/", "/places", "/login", "/admin", "/robots.txt", "/privacy"];
    export default { async fetch() {
      if (variant === "THROW") throw new Error("FIXED_PROGRAM_ERROR");
      if (variant === "TIMEOUT") await new Promise(resolve => setTimeout(resolve, 60000));
      if (variant === "MALFORMED_RESULT") return Response.json({ ok: true });
      const input = { fetch };
      const fetchPath = input.fetch.bind(globalThis);
      let receiverErrors = 0;
      const selected = variant === "SKIP_CHECK" ? paths.slice(1) : paths;
      const results = await Promise.all(selected.map(async path => {
        const actualPath = variant === "ESCAPE_PATH" && path === "/privacy" ? "/outside"
          : variant === "DUPLICATE_PATH" && path === "/privacy" ? "/" : path;
        const url = new URL(actualPath, "https://rsi.invalid");
        const init = { method: variant === "WRONG_METHOD" ? "POST" : "GET", redirect: "manual" };
        try {
          const response = variant === "UNBOUND" ? await input.fetch(url, init) : await fetchPath(url, init);
          const location = response.headers.get("location") ?? "";
          const ok = variant === "WEAK_SUCCESS" ? response.status < 600
            : response.status === (path === "/admin" ? 302 : 200) && (path !== "/admin" || location === "/login");
          return { path, status: response.status, location, ok: variant === "FALSE_PASS" ? true : ok };
        } catch (error) {
          if (error instanceof TypeError && error.message.includes("Illegal invocation")) receiverErrors++;
          return { path, status: 0, location: "", ok: variant === "FALSE_PASS" };
        }
      }));
      const failed = results.filter(row => !row.ok).length;
      return Response.json({ ok: failed === 0, failed, originHost: "rsi.invalid", results, receiverErrors });
    } };
  `;
}

const resultSchema = rsiPublicPathResultSchema.extend({
  receiverErrors: z.number().int().min(0).max(6),
});
type Reason = "INPUT_REJECTED" | "MANIFEST_REJECTED" | "NATIVE_RECEIVER_REPRODUCED" | "SIX_PATHS_VERIFIED"
  | "NORMAL" | "EXTERNAL_FAILURE" | "ORACLE_MISMATCH" | "EXECUTION_TIMEOUT" | "EXECUTION_ERROR" | "CLEANUP_ERROR";
export type RsiEvaluation = {
  schemaVersion: 1;
  verdict: "PASS" | "FAIL" | "NO_CHANGE" | "INCONCLUSIVE";
  reasonCode: Reason;
  nativeRuntime: "WORKERD" | "NOT_STARTED";
  manifestHash: string | null;
  evaluatorHash: string;
  programHash: string | null;
  redReproduced: boolean;
  greenVerified: boolean;
  expectedNoChange: boolean;
  calls: RsiObservedCall[];
};

// R2 instrumentation adapter only. The four-field app/body and call comparison
// live in the shared oracle; the known fixed UNBOUND RED stays here.
function judge(fixture: Fixture, program: Program, body: unknown, calls: RsiObservedCall[]): Pick<RsiEvaluation, "verdict" | "reasonCode" | "redReproduced" | "greenVerified"> {
  const fail = { verdict: "FAIL", reasonCode: "ORACLE_MISMATCH", redReproduced: false, greenVerified: false } as const;
  const parsed = resultSchema.safeParse(body);
  if (!parsed.success) return fail;
  const { receiverErrors, ...value } = parsed.data;
  if (fixture === "NATIVE_RECEIVER" && program === "UNBOUND" && calls.length === 0
    && new Set(value.results.map((row) => row.path)).size === 6
    && receiverErrors === 6 && value.failed === 6 && !value.ok
    && value.results.every((row) => row.status === 0 && row.location === "" && !row.ok)) {
    return { ...fail, reasonCode: "NATIVE_RECEIVER_REPRODUCED", redReproduced: true };
  }
  if (receiverErrors !== 0) return fail;
  return gradeRsiPublicPathCheck(fixture, value, calls);
}

/** R3 must replace this closed catalogue with a separately approved isolated
 * executor and externally measured receipts; do not widen this input to source. */
export async function evaluateFixedCase(input: unknown): Promise<RsiEvaluation> {
  const result: RsiEvaluation = {
    schemaVersion: RSI_SCHEMA_VERSION, verdict: "FAIL", reasonCode: "INPUT_REJECTED", nativeRuntime: "NOT_STARTED",
    manifestHash: null, evaluatorHash: hash(Buffer.concat([
      readFileSync(new URL("./evaluator.ts", import.meta.url)), readFileSync(new URL("./contracts.ts", import.meta.url)),
      readFileSync(new URL("./oracle.ts", import.meta.url)),
    ])), programHash: null, redReproduced: false, greenVerified: false, expectedNoChange: false, calls: [],
  };
  let request: { fixture: Fixture; program: Program };
  try {
    request = z.strictObject({ fixture: fixtureSchema, program: programSchema }).parse(input);
  } catch { return result; }
  try {
    const loaded = loadDevelopmentManifest();
    result.manifestHash = loaded.hash;
    const row = loaded.manifest.cases.find((entry) => entry.fixture === request.fixture);
    if (!row) throw new Error("RSI_INVALID_MANIFEST");
    result.expectedNoChange = row.expected === "NO_CHANGE";
  } catch { return { ...result, reasonCode: "MANIFEST_REJECTED" }; }

  const script = fixedProgram(request.program);
  result.programHash = hash(script);
  // Existing Wrangler dependency only; no network service, credentials or DB.
  let runtime: { ready: Promise<URL>; dispatchFetch(url: string): Promise<Response>; dispose(): Promise<void> } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    const { Miniflare } = createRequire(import.meta.resolve("wrangler"))("miniflare");
    runtime = new Miniflare({
      modules: true, compatibilityDate: "2026-08-05",
      compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"], script,
      outboundService: (requestOut: Request) => {
        const url = new URL(requestOut.url);
        const path = RSI_PUBLIC_PATHS.find((allowed) => allowed === url.pathname);
        const response = path ? expectedRsiFixtureResponse(request.fixture, path) : { status: 403, location: "" as const };
        result.calls.push({ path: path ?? "OUTSIDE_ALLOWLIST", method: requestOut.method === "GET" ? "GET" : "OTHER",
          ...response, originAllowed: url.origin === "https://rsi.invalid" && !url.search });
        return new Response("synthetic fixture", { status: response.status,
          headers: response.location ? { Location: response.location } : {} });
      },
    });
    // Include native startup, dispatch, and response decoding in one deadline.
    const body = await Promise.race([
      runtime!.ready.then(async () => {
        result.nativeRuntime = "WORKERD";
        const response = await runtime!.dispatchFetch("http://local.test/");
        if (response.status !== 200) throw new Error("FIXED_PROGRAM_ERROR");
        return response.json();
      }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => {
        timedOut = true; reject(new Error("EXECUTION_TIMEOUT"));
      }, 5_000); }),
    ]);
    Object.assign(result, judge(request.fixture, request.program, body, result.calls));
  } catch {
    Object.assign(result, { verdict: "INCONCLUSIVE", reasonCode: timedOut ? "EXECUTION_TIMEOUT" : "EXECUTION_ERROR", redReproduced: false, greenVerified: false });
  } finally {
    if (timer) clearTimeout(timer);
    try { await runtime?.dispose(); } catch {
      Object.assign(result, { verdict: "INCONCLUSIVE", reasonCode: "CLEANUP_ERROR", redReproduced: false, greenVerified: false });
    }
  }
  return result;
}
