import { getSandbox, Sandbox } from "@cloudflare/sandbox";
export { Sandbox };
import { z } from "zod";

// Dedicated lab worker for the RSI candidate-execution backend. It only runs
// the one-shot node wrapper; PASS promotion, ledgers and oracles stay local.
// See docs/superpowers/plans/2026-11-04-rsi-cloudflare-sandbox.md.

const MAX_REQUEST_BYTES = 100_000;
const MAX_SOURCE_BYTES = 65_536;
const MAX_OUTPUT_BYTES = 32_768;
const WALL_TIME_MS = 3_000;

const requestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  source: z.string().min(1).max(MAX_SOURCE_BYTES),
  input: z.strictObject({
    schemaVersion: z.literal(1),
    taskKind: z.enum(["repair", "improve-agent"]),
    payload: z.unknown(),
  }),
});

const runner = `import { readFileSync } from "node:fs";
const stringify = JSON.stringify.bind(JSON), write = process.stdout.write.bind(process.stdout), exit = process.exit.bind(process);
try {
  const request = JSON.parse(readFileSync("/workspace/request.json", "utf8"));
  for (const key of Object.keys(process.env)) delete process.env[key];
  const module = await import("data:text/javascript;base64," + Buffer.from(request.source).toString("base64"));
  if (typeof module.default !== "function") exit(72);
  const output = await module.default(request.input);
  write(stringify({ schemaVersion: 1, output }) + "\\n");
} catch { exit(73); }
`;

type Env = { Sandbox: DurableObjectNamespace<Sandbox>; RSI_LAB_TOKEN?: string };

function log(entry: Record<string, unknown>) {
  console.log(JSON.stringify({ tag: "RSI_SANDBOX_EXEC", ...entry }));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.RSI_LAB_TOKEN) return new Response("Not found", { status: 404 });
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/execute") return new Response("Not found", { status: 404 });
    if (request.headers.get("x-rsi-sandbox-token") !== env.RSI_LAB_TOKEN) return new Response("Not found", { status: 404 });
    const raw = await request.text();
    if (Buffer.byteLength(raw) > MAX_REQUEST_BYTES) return Response.json({ error: "INPUT" }, { status: 400 });
    let parsed: z.infer<typeof requestSchema>;
    try { parsed = requestSchema.parse(JSON.parse(raw)); }
    catch { return Response.json({ error: "INPUT" }, { status: 400 }); }
    const started = Date.now();
    const sandbox = getSandbox(env.Sandbox, `rsi-${crypto.randomUUID()}`);
    let status: number, body: string;
    try {
      await sandbox.writeFile("/workspace/request.json", raw);
      await sandbox.writeFile("/workspace/runner.mjs", runner);
      const result = await sandbox.exec("node /workspace/runner.mjs", { timeout: WALL_TIME_MS });
      const stdout = result.stdout ?? "", stderr = result.stderr ?? "";
      if (!result.success || result.exitCode !== 0 || stderr !== "") { status = 502; body = JSON.stringify({ error: "EXECUTION" }); }
      else if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) { status = 502; body = JSON.stringify({ error: "IPC" }); }
      else { status = 200; body = stdout.endsWith("\n") ? stdout.slice(0, -1) : stdout; }
    } catch { status = 502; body = JSON.stringify({ error: "EXECUTION" }); }
    try { await sandbox.destroy(); }
    catch { status = 502; body = JSON.stringify({ error: "CLEANUP" }); }
    log({ status, elapsedMs: Date.now() - started, requestBytes: Buffer.byteLength(raw), sourceBytes: Buffer.byteLength(parsed.source) });
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  },
};
