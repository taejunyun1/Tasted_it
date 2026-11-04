import { createHash } from "node:crypto";
import { z } from "zod";

import { parseBoundedJsonObject, SANDBOX_POLICY, SANDBOX_POLICY_DIGEST } from "./sandbox";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function fail(code: string): never { throw new Error(`RSI_SANDBOX_${code}`); }

const configSchema = z.strictObject({
  endpoint: z.string().url().startsWith("https://").max(300),
  token: z.string().min(1).max(256),
  requestTimeoutMs: z.number().int().min(1_000).max(30_000).default(8_000),
});
export type RemoteSandboxConfig = z.input<typeof configSchema>;

const inputSchema = z.strictObject({ schemaVersion: z.literal(1), taskKind: z.enum(["repair", "improve-agent"]), payload: z.unknown().transform(parseBoundedJsonObject) });
const requestSchema = z.strictObject({ schemaVersion: z.literal(1), source: z.string().min(1).max(SANDBOX_POLICY.maxSourceBytes), input: inputSchema });
const responseSchema = z.strictObject({ schemaVersion: z.literal(1), output: z.unknown().transform(parseBoundedJsonObject) });

/** Executes candidate envelopes on the dedicated Cloudflare Sandbox lab worker
 * instead of the local Docker daemon. Returns REMOTE_CLOUDFLARE custody on
 * purpose: existing actual-custody checks accept only DOCKER_CLI, so remote
 * evidence can never be promoted as local actual proof without a separate
 * reviewed custody change. */
export class CloudflareSandbox {
  private constructor(private readonly endpoint: string, private readonly token: string,
    private readonly requestTimeoutMs: number, private readonly fetchImpl: typeof fetch) {}
  static async verify(config: RemoteSandboxConfig, fetchImpl: typeof fetch = fetch): Promise<CloudflareSandbox> {
    let parsed: z.output<typeof configSchema>;
    try { parsed = configSchema.parse(config); } catch { return fail("BLOCKED"); }
    return new CloudflareSandbox(parsed.endpoint.replace(/\/+$/, ""), parsed.token, parsed.requestTimeoutMs, fetchImpl);
  }
  async execute(raw: unknown) {
    let request: z.infer<typeof requestSchema>;
    try {
      request = requestSchema.parse(raw);
      if (Buffer.byteLength(request.source) > SANDBOX_POLICY.maxSourceBytes || Buffer.byteLength(JSON.stringify(request)) > SANDBOX_POLICY.maxInputBytes) fail("INPUT");
    } catch { return fail("INPUT"); }
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.endpoint}/execute`, {
        method: "POST", redirect: "manual", signal: AbortSignal.timeout(this.requestTimeoutMs),
        headers: { "content-type": "application/json", "x-rsi-sandbox-token": this.token, "user-agent": "retaste-rsi-supervisor/1" },
        body: JSON.stringify(request),
      });
    } catch { return fail("EXECUTION"); }
    if (response.status !== 200) return fail("EXECUTION");
    let text: string;
    try { text = await response.text(); } catch { return fail("IPC"); }
    try {
      if (Buffer.byteLength(text) > SANDBOX_POLICY.maxOutputBytes) fail("IPC");
      const decoded: unknown = JSON.parse(text), parsed = responseSchema.parse(decoded);
      if (JSON.stringify(decoded) !== text) fail("IPC");
      return { untrustedOutput: parsed.output, evidence: { kind: "REMOTE_SANDBOX_RETURN" as const,
        transportKind: "REMOTE_CLOUDFLARE" as const, policyDigest: SANDBOX_POLICY_DIGEST,
        sourceDigest: hash(request.source), inputDigest: hash(JSON.stringify(request.input)),
        outputDigest: hash(text), remote: { endpointHost: new URL(this.endpoint).host } } };
    } catch { return fail("IPC"); }
  }
}
