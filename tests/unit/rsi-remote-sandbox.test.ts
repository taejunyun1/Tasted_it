import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { CloudflareSandbox } from "../../scripts/rsi/remote-sandbox";
import { SANDBOX_POLICY, SANDBOX_POLICY_DIGEST } from "../../scripts/rsi/sandbox";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const ENDPOINT = "https://retaste-rsi-sandbox.example.workers.dev";
const TOKEN = "test-token";
const request = { schemaVersion: 1, source: "export default () => ({ ok: true })", input: { schemaVersion: 1, taskKind: "repair", payload: { k: "v" } } } as const;

function fakeFetch(init?: { status?: number; body?: string | (() => never); throw?: boolean }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (url: string | URL | Request, requestInit?: RequestInit) => {
    calls.push({ url: String(url), init: requestInit });
    if (init?.throw) throw new Error("private transport detail");
    return new Response(typeof init?.body === "string" ? init.body : JSON.stringify({ schemaVersion: 1, output: { ok: true } }),
      { status: init?.status ?? 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("CloudflareSandbox.verify", () => {
  it("rejects non-https endpoints and missing tokens without details", async () => {
    await expect(CloudflareSandbox.verify({ endpoint: "http://x", token: TOKEN })).rejects.toThrow("RSI_SANDBOX_BLOCKED");
    await expect(CloudflareSandbox.verify({ endpoint: ENDPOINT, token: "" })).rejects.toThrow("RSI_SANDBOX_BLOCKED");
    await expect(CloudflareSandbox.verify({ endpoint: "not a url", token: TOKEN })).rejects.toThrow("RSI_SANDBOX_BLOCKED");
  });
  it("accepts a bounded https endpoint and token", async () => {
    const sandbox = await CloudflareSandbox.verify({ endpoint: `${ENDPOINT}/`, token: TOKEN });
    expect(sandbox).toBeInstanceOf(CloudflareSandbox);
  });
});

describe("CloudflareSandbox.execute", () => {
  it("sends the validated envelope with the auth header and returns remote custody evidence", async () => {
    const fake = fakeFetch();
    const sandbox = await CloudflareSandbox.verify({ endpoint: ENDPOINT, token: TOKEN }, fake.fn);
    const result = await sandbox.execute(request);
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0];
    expect(call.url).toBe(`${ENDPOINT}/execute`);
    const headers = new Headers(call.init?.headers);
    expect(headers.get("x-rsi-sandbox-token")).toBe(TOKEN);
    expect(JSON.parse(String(call.init?.body))).toEqual(request);
    expect(result.untrustedOutput).toEqual({ ok: true });
    expect(result.evidence.kind).toBe("REMOTE_SANDBOX_RETURN");
    expect(result.evidence.transportKind).toBe("REMOTE_CLOUDFLARE");
    expect(result.evidence.policyDigest).toBe(SANDBOX_POLICY_DIGEST);
    expect(result.evidence.sourceDigest).toBe(hash(request.source));
    expect(result.evidence.inputDigest).toBe(hash(JSON.stringify(request.input)));
    expect(result.evidence.remote.endpointHost).toBe(new URL(ENDPOINT).host);
  });
  it("fails closed on non-200 responses", async () => {
    const sandbox = await CloudflareSandbox.verify({ endpoint: ENDPOINT, token: TOKEN }, fakeFetch({ status: 502, body: JSON.stringify({ error: "EXECUTION" }) }).fn);
    await expect(sandbox.execute(request)).rejects.toThrow("RSI_SANDBOX_EXECUTION");
  });
  it("fails closed on transport errors without echoing details", async () => {
    const sandbox = await CloudflareSandbox.verify({ endpoint: ENDPOINT, token: TOKEN }, fakeFetch({ throw: true }).fn);
    await expect(sandbox.execute(request)).rejects.toThrow("RSI_SANDBOX_EXECUTION");
  });
  it("rejects malformed and oversized responses", async () => {
    const bad = await CloudflareSandbox.verify({ endpoint: ENDPOINT, token: TOKEN }, fakeFetch({ body: "not json" }).fn);
    await expect(bad.execute(request)).rejects.toThrow("RSI_SANDBOX_IPC");
    const big = await CloudflareSandbox.verify({ endpoint: ENDPOINT, token: TOKEN }, fakeFetch({ body: JSON.stringify({ schemaVersion: 1, output: "x".repeat(SANDBOX_POLICY.maxOutputBytes) }) }).fn);
    await expect(big.execute(request)).rejects.toThrow("RSI_SANDBOX_IPC");
    const extra = await CloudflareSandbox.verify({ endpoint: ENDPOINT, token: TOKEN }, fakeFetch({ body: JSON.stringify({ schemaVersion: 1, output: {}, leak: "raw stderr" }) }).fn);
    await expect(extra.execute(request)).rejects.toThrow("RSI_SANDBOX_IPC");
  });
  it("rejects invalid requests before any network call", async () => {
    const fake = fakeFetch();
    const sandbox = await CloudflareSandbox.verify({ endpoint: ENDPOINT, token: TOKEN }, fake.fn);
    await expect(sandbox.execute({ schemaVersion: 1, source: "x".repeat(SANDBOX_POLICY.maxSourceBytes + 1), input: request.input })).rejects.toThrow("RSI_SANDBOX_INPUT");
    await expect(sandbox.execute({ source: "x" })).rejects.toThrow("RSI_SANDBOX_INPUT");
    expect(fake.calls).toHaveLength(0);
  });
});
