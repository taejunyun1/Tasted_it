import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { RSI_PUBLIC_PATH_CHECKS, RSI_SELF_CHECK_USER_AGENT, rsiOriginHost, runRsiPublicPathCheck } from "../../app/features/operations/rsi-self-check";

// Use the existing Wrangler runtime; outboundService prevents external traffic.
const { Miniflare } = createRequire(import.meta.resolve("wrangler"))("miniflare");

it("runs all six checks with native Workers fetch rather than a mocked JS function", async () => {
  const runtime = new Miniflare({
    modules: true,
    compatibilityDate: "2026-08-05",
    compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
    outboundService: (request: Request) => new URL(request.url).pathname === "/admin"
      ? new Response(null, { status: 302, headers: { Location: "/login" } }) : new Response("local fixture"),
    script: `
      const RSI_PUBLIC_PATH_CHECKS = ${JSON.stringify(RSI_PUBLIC_PATH_CHECKS)};
      const RSI_SELF_CHECK_USER_AGENT = ${JSON.stringify(RSI_SELF_CHECK_USER_AGENT)};
      const rsiOriginHost = ${rsiOriginHost.toString()};
      const runRsiPublicPathCheck = ${runRsiPublicPathCheck.toString()};
      export default { async fetch() {
        return Response.json(await runRsiPublicPathCheck({ fetch, origin: "https://rsi.invalid" }));
      } };
    `,
  });
  try {
    const response = await runtime.dispatchFetch("http://local.test/");
    expect(await response.json()).toMatchObject({ ok: true, failed: 0, results: expect.any(Array) });
  } finally {
    await runtime.dispose();
  }
}, 10_000);
