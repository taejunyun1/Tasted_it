import { appendFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { compileNativeCandidate, NATIVE_SOURCE_PATH, prepareNativeRuntimeImage, NativeExecutor, nativeArtifactDigests, NATIVE_BUILD_FLAGS } from "../../scripts/rsi/native-executor";
import { VerifiedContainerBackend, dockerTransport, type DockerTransport } from "../../scripts/rsi/container-backend";
import { NATIVE_RUNTIME, classifyNativeStartupError } from "../../scripts/rsi/native-wrapper";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const source = readFileSync(new URL("../../app/features/operations/rsi-self-check.ts", import.meta.url), "utf8");
const request = (value = source) => ({ path: NATIVE_SOURCE_PATH, source: value, sourceDigest: hash(value) });

describe("native candidate syntax compilation (never host evaluation)", () => {
  it.each([
    ["Too many open files", "FD_LIMIT"], ["Read-only file system", "READ_ONLY"],
    ["No space left on device", "TEMP_SPACE"], ["pthread_create failed", "THREAD_LIMIT"],
    ["Unknown field in configuration", "CONFIG_PROTOCOL"], ["private-secret", "OTHER"],
  ])("keeps startup diagnostics bounded: %s", (message, category) => {
    const value = classifyNativeStartupError(new Error(message));
    expect(value.category).toBe(category);
    expect(value.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(value.bytes).toBe(Buffer.byteLength(message));
    expect(JSON.stringify(value)).not.toContain(message);
  });
  it("pins the separately merged target-capable workerd", () => {
    expect(NATIVE_RUNTIME.workerd).toBe("1.20261022.1");
    expect(NATIVE_RUNTIME.supportedCompatibilityDate).toBe("2026-10-22");
  });
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
    // Deliberately synthetic metadata. The injected transport still cannot PASS.
    const runtime = { ...NATIVE_RUNTIME, supportedCompatibilityDate: "2026-08-05", workerdDigest: "1".repeat(64) };
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
    fake.manifest.runtime.supportedCompatibilityDate = "2026-07-30";
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
  const record = (caseName: string, result: unknown) => appendFileSync(new URL("../../.superpowers/sdd/r3-implementation-plan/native-receipts.jsonl", import.meta.url), JSON.stringify({ caseName, result }) + "\n", { mode: 0o600 });
  it("records native RED then GREEN and normal/external NO_CHANGE", async () => {
    const executor = await NativeExecutor.verify(manifest());
    const red = await executor.evaluate({ ...request(source.replace("fetchPath(url,", "input.fetch(url,")), fixture: "NATIVE_RECEIVER" });
    record("wrong-receiver-red", red);
    expect(red.verdict).toBe("FAIL");
    expect(red.provenance.transportKind).toBe("DOCKER_CLI");
    const green = await executor.evaluate({ ...request(), fixture: "NATIVE_RECEIVER" });
    record("bound-green", green);
    expect(green.verdict).toBe("PASS");
    expect(green.greenVerified).toBe(true);
    for (const fixture of ["NORMAL", "HTTP_FAILURE", "AUTH_REDIRECT_FAILURE", "AUTH_STATUS_FAILURE"]) {
      const result = await executor.evaluate({ ...request(), fixture });
      record(fixture, result);
      expect(result.verdict).toBe("NO_CHANGE");
      expect(result.greenVerified).toBe(fixture === "NORMAL");
    }
  }, 120_000);
  it.each([
    ["false PASS", 'export async function runRsiPublicPathCheck(){ return {verdict:"PASS"}; }'],
    ["weakened check", source.replace("response.status === check.status", "true")],
    ["auth weakening", source.replace("location.includes(check.locationIncludes)", "true")],
    ["skipped path", source.replace("RSI_PUBLIC_PATH_CHECKS.map", "RSI_PUBLIC_PATH_CHECKS.slice(1).map")],
    ["outside path", source.replace('path: "/privacy"', 'path: "/outside"')],
    ["loopback", source.replace("const fetchPath = input.fetch.bind(globalThis);", 'await fetch("http://127.0.0.1:9229/json"); const fetchPath = input.fetch.bind(globalThis);')],
    ["query escape", source.replace("fetchPath(url,", 'fetchPath(new URL(url + "?secret=synthetic"),')],
    ["host filesystem", 'const value = process.getBuiltinModule("fs").readFileSync("/etc/passwd");' + source],
    ["environment", 'const value = process.env.RSI_SECRET; if(value !== undefined) throw Error(value); console.log(value);' + source],
    ["log forging", 'console.log(JSON.stringify({schemaVersion:1,grade:{verdict:"PASS"}}));' + source],
    ["stack leak", 'throw new Error("SYNTHETIC_STACK_SECRET");' + source],
    ["raw socket", 'const socket = process.getBuiltinModule("net").connect(9229,"127.0.0.1");' + source],
    ["dynamic constructor", 'const f = (()=>{}).constructor("return import(\\"node:fs\\")"); f();' + source],
    ["timer exhaustion", source.replace("const fetchPath = input.fetch.bind(globalThis);", 'await new Promise(resolve => setTimeout(resolve, 60000)); const fetchPath = input.fetch.bind(globalThis);')],
    ["oversized response", 'export async function runRsiPublicPathCheck(){ return "x".repeat(100000); }'],
    ["infinite loop", "while(true) {}" + source],
    ["output flood", 'for(let i=0;i<50000;i++) console.log("synthetic-output".repeat(100));' + source],
    ["memory exhaustion", 'const a=[]; while(true) a.push(new Uint8Array(1024*1024).fill(1));' + source],
  ])("rejects actual %s candidate", async (name, value) => {
    const executor = await NativeExecutor.verify(manifest());
    const result = await executor.evaluate({ ...request(value), fixture: name === "weakened check" ? "HTTP_FAILURE" : name === "auth weakening" ? "AUTH_REDIRECT_FAILURE" : "NATIVE_RECEIVER" });
    record(name, result);
    expect(result.verdict).not.toBe("PASS");
    expect(result.verdict).not.toBe("NO_CHANGE");
    expect(JSON.stringify(result)).not.toContain("secret=synthetic");
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_STACK_SECRET");
  }, 60000);
  it("rejects imports, path and hashes before candidate dispatch on the actual capability", async () => {
    const executor = await NativeExecutor.verify(manifest());
    for (const prefix of ['import "node:fs";', 'import("cloudflare:sockets");', 'require("child_process");']) {
      await expect(executor.evaluate({ ...request(prefix + source), fixture: "NORMAL" })).rejects.toThrow("RSI_NATIVE_IMPORT_CLOSURE");
    }
    await expect(executor.evaluate({ ...request(), path: "app/server.ts", fixture: "NORMAL" })).rejects.toThrow("RSI_NATIVE_INPUT");
    await expect(executor.evaluate({ ...request(), sourceDigest: "0".repeat(64), fixture: "NORMAL" })).rejects.toThrow("RSI_NATIVE_INPUT");
    await expect(NativeExecutor.verify({ ...manifest(), artifacts: { ...manifest().artifacts, oracleDigest: "0".repeat(64) } })).rejects.toThrow("RSI_NATIVE_ARTIFACT_MISMATCH");
    record("pre-dispatch-rejection", { imports: 3, sourcePaths: 1, sourceHashes: 1, artifactHashes: 1, candidateDispatches: 0 });
  }, 30000);
  it("confirms exact owned container removal and quarantine after a real cleanup fault", async () => {
    const owned: { name: string; owner: string; id: string }[] = [];
    let failRemoval = false, starts = 0;
    const transport: DockerTransport = async (args, stdin, limits) => {
      if (args[0] === "rm" && failRemoval) { failRemoval = false; throw Error("synthetic cleanup fault"); }
      if (args[0] === "start") starts++;
      const result = await dockerTransport(args, stdin, limits);
      if (args[0] === "create" && result.code === 0) owned.push({ name: args[args.indexOf("--name") + 1], owner: args[args.indexOf("--label") + 1].split("=")[1], id: result.stdout.trim() });
      return result;
    };
    const executor = await NativeExecutor.verify(manifest(), transport);
    const first = await executor.evaluate({ ...request(), fixture: "NORMAL" });
    expect(first.verdict).toBe("UNKNOWN"); expect(first.reasonCode).toBe("INJECTED_TRANSPORT");
    let absenceChecks = 0;
    for (const row of owned) {
      const inspected = await dockerTransport(["inspect", row.id], "", { timeoutMs: 5000, maxOutputBytes: 65536 });
      expect(inspected.code).not.toBe(0); absenceChecks++;
    }
    failRemoval = true;
    try {
      const failed = await executor.evaluate({ ...request(), fixture: "NORMAL" });
      record("actual-cleanup-fault", failed);
      expect(failed.verdict).toBe("UNKNOWN"); expect(failed.reasonCode).toBe("RSI_SANDBOX_CLEANUP");
      const count = starts;
      await expect(executor.evaluate({ ...request(), fixture: "NORMAL" })).rejects.toThrow("RSI_SANDBOX_BLOCKED");
      expect(starts).toBe(count);
    } finally {
      const row = owned.at(-1)!;
      const inspected = await dockerTransport(["inspect", row.id], "", { timeoutMs: 5000, maxOutputBytes: 65536 });
      const actual = JSON.parse(inspected.stdout)[0];
      if (actual.Id !== row.id || actual.Name !== `/${row.name}` || actual.Config.Labels["rsi.sandbox.owner"] !== row.owner) throw Error("OWNED_CLEANUP_MISMATCH");
      expect((await dockerTransport(["rm", "--force", row.id], "", { timeoutMs: 5000, maxOutputBytes: 65536 })).code).toBe(0);
      expect((await dockerTransport(["inspect", row.id], "", { timeoutMs: 5000, maxOutputBytes: 65536 })).code).not.toBe(0);
      absenceChecks++;
    }
    record("exact-owned-cleanup", { transportKind: "INJECTED_TRANSPORT", underlyingCli: true, absenceChecks, quarantined: true, manualCleanupOwnedOnly: true });
  }, 60000);
});
