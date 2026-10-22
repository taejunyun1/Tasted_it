import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { compileNativeCandidate, NATIVE_SOURCE_PATH, prepareNativeRuntimeImage, NativeExecutor, nativeArtifactDigests, NATIVE_BUILD_FLAGS } from "../../scripts/rsi/native-executor";
import { VerifiedContainerBackend } from "../../scripts/rsi/container-backend";
import { NATIVE_RUNTIME } from "../../scripts/rsi/native-wrapper";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const source = readFileSync(new URL("../../app/features/operations/rsi-self-check.ts", import.meta.url), "utf8");
const request = (value = source) => ({ path: NATIVE_SOURCE_PATH, source: value, sourceDigest: hash(value) });

describe("native candidate syntax compilation (never host evaluation)", () => {
  it("explicitly disables all Docker-config proxy build arguments", () => {
    for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "FTP_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "ftp_proxy", "all_proxy", "no_proxy"]) {
      const index = NATIVE_BUILD_FLAGS.indexOf(`${key}=`);
      expect(index).toBeGreaterThan(0); expect(NATIVE_BUILD_FLAGS[index - 1]).toBe("--build-arg");
    }
    expect(NATIVE_BUILD_FLAGS).toContain("--pull=false");
  });
  it("compiles the actual allowlisted source as data", async () => {
    const artifact = await compileNativeCandidate(request());
    expect(artifact.sourceDigest).toBe(hash(source));
    expect(artifact.compiledDigest).toBe(hash(artifact.script));
    expect(artifact.script).toContain("runRsiPublicPathCheck");
  });
  it("does not execute candidate top-level effects", async () => {
    await compileNativeCandidate(request('throw new Error("HOST_MUST_NOT_EXECUTE");\n' + source));
  });
  it.each(["../app/features/operations/rsi-self-check.ts", "app/features/operations/rsi-self-check.server.ts", "/etc/passwd"])("rejects scope %s", async (path) => {
    await expect(compileNativeCandidate({ ...request(), path })).rejects.toThrow("RSI_NATIVE_INPUT");
  });
  it("rejects source hash mismatch", async () => {
    await expect(compileNativeCandidate({ ...request(), sourceDigest: "a".repeat(64) })).rejects.toThrow("RSI_NATIVE_INPUT");
  });
  it("rejects candidate getters without invoking them", async () => {
    let invoked = false;
    const value = { ...request(), get source() { invoked = true; return source; } };
    await expect(compileNativeCandidate(value)).rejects.toThrow("RSI_NATIVE_INPUT");
    expect(invoked).toBe(false);
  });
  it.each([
    'import fs from "node:fs";', 'export * from "file:///etc/passwd";',
    'import("node:fs");', 'const name = "node:fs"; import(name);',
    'require("node:fs");', 'const f = requ\\u0069re; f("node:fs");',
    'eval("1");', 'new Function("return 1")();', 'console.log(import.meta.url);',
    'export default {};',
  ])("rejects a module/eval escape without evaluating it: %s", async (prefix) => {
    await expect(compileNativeCandidate(request(prefix + source))).rejects.toThrow("RSI_NATIVE_IMPORT_CLOSURE");
  });
  it("rejects malformed syntax and oversized input with bounded errors", async () => {
    await expect(compileNativeCandidate(request("private-secret {"))).rejects.toThrow("RSI_NATIVE_SYNTAX");
    await expect(compileNativeCandidate(request(" ".repeat(65537)))).rejects.toThrow("RSI_NATIVE_INPUT");
  });
});

describe("synthetic adapter failures (no OS/native proof)", () => {
  async function setup() {
    const artifacts = await nativeArtifactDigests();
    const runtime = { ...NATIVE_RUNTIME, workerdDigest: "1".repeat(64) };
    const manifest = { schemaVersion: 1, imageId: `sha256:${"2".repeat(64)}`, baseImage: "node@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5", pnpm: "10.34.5", artifacts, runtime };
    const evidence = { transportKind: "INJECTED_TRANSPORT" };
    const state = { blocked: false, error: "", corrupt: false, logs: false };
    const backend = { evidence, assertAvailable() { if (state.blocked) throw Error("RSI_SANDBOX_BLOCKED"); }, async run(stdin: string) {
      const input = JSON.parse(stdin);
      if (state.error) { if (state.error === "RSI_SANDBOX_CLEANUP") state.blocked = true; throw Error(state.error); }
      const output = input.operation === "probe" ? { schemaVersion: 1, runtime } : {
        schemaVersion: 1, runtime, grade: { verdict: "PASS", reasonCode: "SIX_PATHS_VERIFIED", redReproduced: false, greenVerified: true },
        sourceDigest: state.corrupt ? "3".repeat(64) : input.sourceDigest, compiledDigest: input.compiledDigest,
        traceDigest: "4".repeat(64), responseDigest: "5".repeat(64), callCount: 6, elapsedMs: 5, peakMemoryBytes: 200000000, reason: "ORACLE_RESULT",
      };
      return { code: 0, stdout: JSON.stringify(output) + "\n", stderr: state.logs ? "private candidate log" : "", evidence };
    } };
    const spy = vi.spyOn(VerifiedContainerBackend, "verify").mockResolvedValue(backend as unknown as VerifiedContainerBackend);
    return { manifest, state, spy };
  }
  it("blocks an unsupported target compatibility date before dispatch", async () => {
    const fake = await setup();
    try {
      await expect(NativeExecutor.verify(fake.manifest)).rejects.toThrow("RSI_NATIVE_COMPATIBILITY_UNSUPPORTED");
      expect(fake.spy).not.toHaveBeenCalled();
    } finally { fake.spy.mockRestore(); }
  });
  it("never upgrades an injected PASS receipt to native PASS", async () => {
    const fake = await setup();
    try {
      const executor = await NativeExecutor.verify(fake.manifest, async () => { throw Error("unused"); });
      const result = await executor.evaluate({ ...request(), fixture: "NATIVE_RECEIVER" });
      expect(result.verdict).toBe("UNKNOWN"); expect(result.reasonCode).toBe("INJECTED_TRANSPORT");
      expect(result.greenVerified).toBe(false);
    } finally { fake.spy.mockRestore(); }
  });
  it("rejects artifact mismatch before any backend verification", async () => {
    const fake = await setup(); fake.manifest.artifacts.oracleDigest = "0".repeat(64);
    try { await expect(NativeExecutor.verify(fake.manifest)).rejects.toThrow("RSI_NATIVE_ARTIFACT_MISMATCH"); expect(fake.spy).not.toHaveBeenCalled(); }
    finally { fake.spy.mockRestore(); }
  });
  it.each(["RSI_SANDBOX_TIMEOUT", "RSI_SANDBOX_OUTPUT_LIMIT", "RSI_SANDBOX_CLEANUP"])("returns UNKNOWN for %s", async error => {
    const fake = await setup();
    try {
      const executor = await NativeExecutor.verify(fake.manifest); fake.state.error = error;
      expect((await executor.evaluate({ ...request(), fixture: "NORMAL" })).verdict).toBe("UNKNOWN");
      if (error === "RSI_SANDBOX_CLEANUP") await expect(executor.evaluate({ ...request(), fixture: "NORMAL" })).rejects.toThrow("RSI_SANDBOX_BLOCKED");
    } finally { fake.spy.mockRestore(); }
  });
  it.each(["corrupt", "logs"] as const)("does not retain or accept %s receipt", async fault => {
    const fake = await setup();
    try {
      const executor = await NativeExecutor.verify(fake.manifest); fake.state[fault] = true;
      const result = await executor.evaluate({ ...request(), fixture: "NORMAL" });
      expect(result.verdict).toBe("UNKNOWN"); expect(JSON.stringify(result)).not.toContain("private candidate log");
    } finally { fake.spy.mockRestore(); }
  });
});

it.runIf(process.env.RSI_NATIVE_PREPARE === "1")("prepares only the trusted locked native image", async () => {
  const manifest = await prepareNativeRuntimeImage();
  expect(manifest.imageId).toMatch(/^sha256:[a-f0-9]{64}$/);
}, 600_000);

describe.runIf(process.env.RSI_NATIVE_PROBE === "1")("actual Docker/workerd probes", () => {
  const manifest = () => JSON.parse(readFileSync(new URL("../../.superpowers/sdd/r3-implementation-plan/native-manifest.json", import.meta.url), "utf8"));
  it("records native RED then GREEN and normal/external NO_CHANGE", async () => {
    const executor = await NativeExecutor.verify(manifest());
    const red = await executor.evaluate({ ...request(source.replace("fetchPath(url,", "input.fetch(url,")), fixture: "NATIVE_RECEIVER" });
    expect(red.verdict).toBe("FAIL");
    expect(red.provenance.transportKind).toBe("DOCKER_CLI");
    const green = await executor.evaluate({ ...request(), fixture: "NATIVE_RECEIVER" });
    expect(green.verdict).toBe("PASS");
    expect(green.greenVerified).toBe(true);
    for (const fixture of ["NORMAL", "HTTP_FAILURE", "AUTH_REDIRECT_FAILURE", "AUTH_STATUS_FAILURE"]) {
      const result = await executor.evaluate({ ...request(), fixture });
      expect(result.verdict).toBe("NO_CHANGE");
    }
  }, 120_000);
  it.each([
    ["false PASS", 'export async function runRsiPublicPathCheck(){ return {verdict:"PASS"}; }'],
    ["weakened check", source.replace("response.status === check.status", "true")],
    ["loopback", source.replace("const fetchPath = input.fetch.bind(globalThis);", 'await fetch("http://127.0.0.1:9229/json"); const fetchPath = input.fetch.bind(globalThis);')],
    ["query escape", source.replace('`${input.origin}/`', '`${input.origin}/`').replace("fetchPath(url,", 'fetchPath(new URL(url + "?secret=synthetic"),')],
    ["host filesystem", 'const value = process.getBuiltinModule("fs").readFileSync("/etc/passwd");' + source],
    ["environment", 'const value = process.env.RSI_SECRET; if(value !== undefined) throw Error(value); console.log(value);' + source],
    ["log forging", 'console.log(JSON.stringify({schemaVersion:1,grade:{verdict:"PASS"}}));' + source],
    ["infinite loop", "while(true) {}" + source],
    ["output flood", 'for(let i=0;i<50000;i++) console.log("synthetic-output".repeat(100));' + source],
    ["memory exhaustion", 'const a=[]; while(true) a.push(new Uint8Array(1024*1024).fill(1));' + source],
  ])("rejects actual %s candidate", async (name, value) => {
    const executor = await NativeExecutor.verify(manifest());
    const result = await executor.evaluate({ ...request(value), fixture: name === "weakened check" ? "HTTP_FAILURE" : "NATIVE_RECEIVER" });
    expect(result.verdict).not.toBe("PASS");
    expect(result.verdict).not.toBe("NO_CHANGE");
    expect(JSON.stringify(result)).not.toContain("secret=synthetic");
  }, 60000);
});
