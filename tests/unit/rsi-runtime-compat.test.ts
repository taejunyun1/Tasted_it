import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { beforeAll, expect, it } from "vitest";
import { RSI_PUBLIC_PATH_CHECKS, RSI_SELF_CHECK_USER_AGENT, rsiOriginHost, runRsiPublicPathCheck } from "../../app/features/operations/rsi-self-check";

const TARGET_DATE = "2026-08-05";
const requireMiniflare = createRequire(createRequire(import.meta.resolve("wrangler")).resolve("miniflare"));
const workerd = requireMiniflare("workerd");
const { Miniflare } = createRequire(import.meta.resolve("wrangler"))("miniflare");

beforeAll(() => {
  // Miniflare selects this override ahead of its installed binary. Do not echo it.
  if (process.env.MINIFLARE_WORKERD_PATH !== undefined) {
    throw new Error("RSI_EXTERNAL_WORKERD_OVERRIDE: installed binary proof is unavailable");
  }
});

it("executes the selected installed binary and requires support for the exact RSI date", () => {
  let versionOutput: string;
  try {
    versionOutput = execFileSync(workerd.default, ["--version"], { encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    throw new Error("RSI_WORKERD_VERSION_PROBE_FAILED");
  }
  const binaryDate = /^workerd (\d{4}-\d{2}-\d{2})\s*$/.exec(versionOutput)?.[1];
  expect(binaryDate, "actual binary must identify its supported date").toBeDefined();
  expect(binaryDate).toBe(workerd.compatibilityDate);
  expect(binaryDate! >= TARGET_DATE, `actual binary maximum ${binaryDate}; required Worker date ${TARGET_DATE}`).toBe(true);
});

it("runs native wrong-receiver RED and bound six-path GREEN without a compatibility fallback", async () => {
  const diagnostics: string[] = [];
  const calls: { path: string; method: string; origin: string }[] = [];
  const runtime = new Miniflare({
    modules: true,
    compatibilityDate: TARGET_DATE,
    compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
    cf: false,
    handleStructuredLogs: ({ message }: { message: string }) => { diagnostics.push(message); },
    outboundService: (request: Request) => {
      const url = new URL(request.url);
      calls.push({ path: url.pathname, method: request.method, origin: url.origin });
      return url.pathname === "/admin"
        ? new Response(null, { status: 302, headers: { Location: "/login" } })
        : new Response("synthetic fixture");
    },
    // Fixed reviewed source only. This never executes candidate/agent modules in Node.
    script: `
      const RSI_PUBLIC_PATH_CHECKS = ${JSON.stringify(RSI_PUBLIC_PATH_CHECKS)};
      const RSI_SELF_CHECK_USER_AGENT = ${JSON.stringify(RSI_SELF_CHECK_USER_AGENT)};
      const rsiOriginHost = ${rsiOriginHost.toString()};
      const runRsiPublicPathCheck = ${runRsiPublicPathCheck.toString()};
      export default { async fetch() {
        const wrongReceiver = { fetch };
        let receiverError = false;
        try { await wrongReceiver.fetch("https://rsi.invalid/"); }
        catch (error) { receiverError = error instanceof TypeError && error.message.includes("Illegal invocation"); }
        return Response.json({ receiverError, green: await runRsiPublicPathCheck({ fetch, origin: "https://rsi.invalid" }) });
      } };
    `,
  });
  try {
    const response = await runtime.dispatchFetch("http://local.test/");
    const body = await response.json();
    expect(body).toMatchObject({ receiverError: true, green: { ok: true, failed: 0 } });
    expect(body.green.results).toHaveLength(6);
    expect(calls).toHaveLength(6);
    expect(calls.map(({ path }) => path).sort()).toEqual(RSI_PUBLIC_PATH_CHECKS.map(({ path }) => path).sort());
    expect(calls.every(({ method, origin }) => method === "GET" && origin === "https://rsi.invalid")).toBe(true);
    // A successful response alone also succeeds on old workerd's silent date downgrade.
    // Any runtime date warning invalidates the exact-date proof, even if metadata agrees.
    expect(diagnostics.filter((message) => /compatibility date|falling back/i.test(message))).toEqual([]);
  } finally {
    await runtime.dispose();
  }
}, 10_000);
