import { appendFileSync, readFileSync, readSync, lstatSync, realpathSync, writeFileSync, renameSync, openSync, closeSync } from "node:fs";
import { spawn } from "node:child_process";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createHash } from "node:crypto";
import { rootCertificates } from "node:tls";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { types } from "node:util";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { compileNativeCandidate, NATIVE_SOURCE_PATH, prepareNativeRuntimeImage, NativeExecutor, nativeArtifactDigests, NATIVE_BUILD_FLAGS } from "../../scripts/rsi/native-executor";
import { VerifiedContainerBackend, dockerTransport, createLocalDockerTransport, observeDockerLifecycle, decodeContainerDiagnostic, containerFailureDiagnosticSchema, containerTransportDiagnosticSchema, containerFailureFrameSchema, dockerCommandLifecycleSchema, type DockerCommandLifecycle, type DockerTransport, type TrustedContainerProfile } from "../../scripts/rsi/container-backend";
import { NATIVE_RUNTIME, classifyNativeStartupError, verifyNativePublicCa, createNativeLogGate, withNativeWorkerdDeadline, observeNativeWorkerdPipes } from "../../scripts/rsi/native-wrapper";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const source = readFileSync(new URL("../../app/features/operations/rsi-self-check.ts", import.meta.url), "utf8");
const request = (value = source) => ({ path: NATIVE_SOURCE_PATH, source: value, sourceDigest: hash(value) });
const duringCheck = (prefix: string) => source.replace("const fetchPath = input.fetch.bind(globalThis);", prefix + "\nconst fetchPath = input.fetch.bind(globalThis);");
const startupWarning = 'service core:user:: The compatibility flag nodejs_compat became the default as of 2026-08-04 so does not need to be specified anymore.';
const nativeLog = (message = startupWarning, extra: Record<string, unknown> = {}) => Buffer.from(JSON.stringify({ timestamp: "1", level: "warn", source: "workerd/server/workerd-api.c++:1", message, ...extra }) + "\n");
// Pure parser seam only; the immutable wrapper uses its pinned measured source.
const syntheticLogGate = () => createNativeLogGate(hash("workerd/server/workerd-api.c++:1"));
const completePipes = { stdoutEof: true, stderrEof: true, errorCount: 0, prematureCloseCount: 0 };

// Fixed trusted child only. Synchronously reading fd3 keeps data callbacks queued
// until the child confirms its synchronous pipe write; no candidate code runs.
function queuedTrustedWriter(stream: "stdout" | "stderr", payload: string) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", `import {writeSync} from 'node:fs'; writeSync(${stream === "stdout" ? 1 : 2}, ${JSON.stringify(payload)}); writeSync(3,'1'); setInterval(()=>{},1000);`],
    { stdio: ["ignore", "pipe", "pipe", "pipe"], env: {} });
  const control = child.stdio[3] as unknown as { _handle: { fd: number }; destroy(): void };
  const started = performance.now(), byte = Buffer.alloc(1);
  try {
    for (;;) {
      try { if (readSync(control._handle.fd, byte, 0, 1, null) === 1) break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EAGAIN") throw error; }
      if (performance.now() - started > 2000) throw Error("TRUSTED_WRITER_CONTROL_TIMEOUT");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);
    }
  } catch (error) { child.kill("SIGKILL"); control.destroy(); throw error; }
  return { child, control, writerConfirmed: byte[0] === 49 };
}

describe("verified workerd pipe EOF custody", () => {
  it("reproduces written bytes lost by destroy/kill/close without claiming a native bypass", async () => {
    const { child, control, writerConfirmed } = queuedTrustedWriter("stdout", "queued-line\n");
    let observedBytes = 0;
    child.stdout!.on("data", chunk => { observedBytes += chunk.length; });
    const closed = new Promise<void>(resolve => child.once("close", () => resolve()));
    child.stdout!.destroy(); child.stderr!.destroy(); control.destroy(); child.kill("SIGKILL");
    await closed;
    expect({ writerConfirmed, writtenBytes: 12, observedBytes }).toEqual({ writerConfirmed: true, writtenBytes: 12, observedBytes: 0 });
  });
  it.each(["stdout", "stderr"] as const)("drains queued trusted bytes on %s before accepting child close", async stream => {
    const { child, control, writerConfirmed } = queuedTrustedWriter(stream, "queued-line\n");
    let observedBytes = 0;
    try {
      const closed = observeNativeWorkerdPipes(child, (_stream, chunk) => { observedBytes += chunk.length; });
      expect(observedBytes).toBe(0);
      child.stdout!.destroy(); child.stderr!.destroy(); control.destroy(); child.kill("SIGKILL");
      expect(await closed).toEqual(completePipes);
      expect({ writerConfirmed, observedBytes }).toEqual({ writerConfirmed: true, observedBytes: 12 });
    } finally { child.kill("SIGKILL"); control.destroy(); }
  });
  it("includes an already-written forbidden marker in the final gate", async () => {
    const payload = nativeLog("RSI_NATIVE_FORBIDDEN_API", { source: undefined }).toString();
    const { child, control } = queuedTrustedWriter("stderr", payload);
    const gate = syntheticLogGate(); gate.push("stderr", nativeLog()); gate.markReady();
    try {
      const closed = observeNativeWorkerdPipes(child, (stream, chunk) => gate.push(stream, chunk));
      child.stdout!.destroy(); child.stderr!.destroy(); control.destroy(); child.kill("SIGKILL");
      expect(gate.finish(await closed)).toMatchObject({ valid: false, forbiddenMarkerCount: 1, custody: completePipes });
    } finally { child.kill("SIGKILL"); control.destroy(); }
  });
  it.each(["stdout", "stderr"] as const)("does not replace %s error destruction or treat it as EOF", async stream => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
    const closed = observeNativeWorkerdPipes(child, () => {});
    child[stream].destroy(Error("SYNTHETIC_STREAM_ERROR"));
    await new Promise<void>(resolve => child[stream].once("close", resolve));
    child.emit("close");
    const custody = await closed;
    expect(custody).toMatchObject({ [`${stream}Eof`]: false, errorCount: 1, prematureCloseCount: 1 });
    expect(child[stream].destroyed).toBe(true);
    const gate = syntheticLogGate(); gate.push("stderr", nativeLog());
    expect(gate.finish(custody).valid).toBe(false);
    child.stdout.destroy(); child.stderr.destroy();
  });
  it("rejects child close without both natural pipe ends", async () => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
    const closed = observeNativeWorkerdPipes(child, () => {});
    child.stdout.emit("close"); child.emit("close");
    const custody = await closed;
    expect(custody).toEqual({ stdoutEof: false, stderrEof: false, errorCount: 0, prematureCloseCount: 1 });
    const gate = syntheticLogGate(); gate.push("stderr", nativeLog());
    expect(gate.finish(custody).valid).toBe(false);
    child.stdout.destroy(); child.stderr.destroy();
  });
  it("cannot finish a baseline-only gate with missing EOF custody", () => {
    const gate = syntheticLogGate(); gate.push("stderr", nativeLog());
    expect(gate.finish({ ...completePipes, stderrEof: false }).valid).toBe(false);
  });
});

describe("fixed workerd deadline spans shutdown", () => {
  it.each(["dispose", "stream close"])("keeps the 12s deadline active while awaiting %s", async phase => {
    vi.useFakeTimers();
    try {
      let release!: () => void;
      const pending = new Promise<void>(resolve => { release = resolve; });
      const terminate = vi.fn();
      const result = withNativeWorkerdDeadline(async () => {
        await Promise.resolve(); // dispatch completed
        if (phase === "dispose") await pending;
        await Promise.resolve(); // disposal completed
        if (phase === "stream close") await pending;
      }, terminate);
      await vi.advanceTimersByTimeAsync(11999); expect(terminate).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1); expect(terminate).toHaveBeenCalledOnce();
      release(); expect((await result).deadlineExpired).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it("clears the deadline only after the full operation completes or rejects", async () => {
    vi.useFakeTimers();
    try {
      const terminate = vi.fn();
      expect(await withNativeWorkerdDeadline(async () => "complete", terminate)).toEqual({ value: "complete", deadlineExpired: false });
      await expect(withNativeWorkerdDeadline(async () => { throw Error("fixed failure"); }, terminate)).rejects.toThrow("fixed failure");
      await vi.advanceTimersByTimeAsync(15000); expect(terminate).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});

describe("native raw log custody before Miniflare filtering", () => {
  it("accepts one exact runtime warning, split across chunks, before ready", () => {
    const gate = syntheticLogGate();
    const line = nativeLog();
    gate.push("stderr", line.subarray(0, 17)); gate.push("stderr", line.subarray(17)); gate.markReady();
    expect(gate.finish(completePipes)).toMatchObject({ valid: true, warningCount: 1, rejectedCount: 0, bytes: line.length });
  });
  it.each(["duplicate", "candidate mimic", "after ready", "filtered internal", "TLS", "malformed", "unterminated"])("rejects %s output", fault => {
    const gate = syntheticLogGate(); gate.push("stderr", nativeLog());
    if (fault === "after ready") gate.markReady();
    const extra = fault === "candidate mimic" ? nativeLog(startupWarning, { source: undefined })
      : fault === "filtered internal" ? nativeLog("took recursive isolate lock", { source: undefined, level: "log" })
      : fault === "TLS" ? nativeLog("TLS certificate initialization failure")
      : fault === "malformed" ? Buffer.from("{broken}\n")
      : fault === "unterminated" ? Buffer.from("unterminated") : nativeLog();
    gate.push("stdout", extra);
    expect(gate.finish(completePipes).valid).toBe(false);
  });
  it("requires the mandatory startup warning and bounds both streams together", () => {
    expect(createNativeLogGate().finish(completePipes).valid).toBe(false);
    const gate = createNativeLogGate(); gate.push("stdout", Buffer.alloc(20000));
    expect(() => gate.push("stderr", Buffer.alloc(12769))).toThrow("RSI_NATIVE_LOG_LIMIT");
  });
  it("rejects a source that differs from the pinned measured C++ logger source", () => {
    const gate = createNativeLogGate(); gate.push("stderr", nativeLog());
    expect(gate.finish(completePipes)).toMatchObject({ valid: false, rejectionCodes: ["SOURCE"] });
  });
});

describe("native candidate syntax compilation (never host evaluation)", () => {
  it.each([
    ["Too many open files", "FD_LIMIT"], ["Read-only file system", "READ_ONLY"],
    ["No space left on device", "TEMP_SPACE"], ["pthread_create failed", "THREAD_LIMIT"],
    ["Operation not permitted", "PERMISSION"], ["Address family not supported", "LISTENER"],
    ["SIGSYS", "SIGNAL"], ["Unrecognized compatibility flag", "CONFIG_PROTOCOL"],
    ["Unknown field in configuration", "CONFIG_PROTOCOL"], ["private-secret", "OTHER"],
  ])("keeps startup diagnostics bounded: %s", (message, category) => {
    const value = classifyNativeStartupError(new Error(message));
    expect(value.category).toBe(category);
    expect(value.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(value.bytes).toBe(Buffer.byteLength(message));
    expect(JSON.stringify(value)).not.toContain(message);
  });
  it("accepts only exact pinned Node embedded public roots", () => {
    const bundle = Buffer.from(rootCertificates.join("\n") + "\n");
    expect(verifyNativePublicCa(bundle)).toEqual({ publicCaDigest: hash(bundle.toString()), publicCaCount: rootCertificates.length });
    expect(() => verifyNativePublicCa(Buffer.from(""))).toThrow("RSI_NATIVE_PUBLIC_CA");
    expect(() => verifyNativePublicCa(Buffer.concat([bundle, Buffer.from("\n")]))).toThrow("RSI_NATIVE_PUBLIC_CA");
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

const transportDiagnosticName = "records one pinned transport lifecycle diagnostic without retry";
const transportDiagnosticPattern = `^${transportDiagnosticName}$`;
function transportDiagnosticRuntimePattern(): unknown {
  // Pinned Vitest 4.1.10 supplies this own-data state to its worker threads.
  // Missing or changed runner representation blocks the opt-in before Docker.
  const data = (value: unknown, key: string) => value && typeof value === "object" && !types.isProxy(value) ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
  return data(data(data(globalThis, "__vitest_worker__"), "config"), "testNamePattern");
}
function transportDiagnosticSelected(environment: NodeJS.ProcessEnv, pattern: unknown) {
  if (!pattern || typeof pattern !== "object" || types.isProxy(pattern) || Object.getPrototypeOf(pattern) !== RegExp.prototype
    || Reflect.ownKeys(pattern).some(key => key !== "lastIndex")) return false;
  return environment.RSI_NATIVE_TRANSPORT_DIAGNOSTIC === "1"
    && Object.keys(environment).filter(key => key.startsWith("RSI_NATIVE_")).every(key => key === "RSI_NATIVE_TRANSPORT_DIAGNOSTIC")
    && Object.getOwnPropertyDescriptor(RegExp.prototype, "source")!.get!.call(pattern) === transportDiagnosticPattern
    && Object.getOwnPropertyDescriptor(RegExp.prototype, "flags")!.get!.call(pattern) === "";
}
function transportDiagnosticTraceComplete(commands: readonly DockerCommandLifecycle[], containers: 2 | 3) {
  const ordered = [...commands].sort((a, b) => a.ordinal - b.ordinal);
  const minimum = 3 + containers * 5;
  return ordered.length >= minimum && ordered.length <= minimum + 1 && ordered.every((item, index) => item.ordinal === index + 1
    && item.close.atMs !== null && item.close.code === 0 && item.timer.firedMs === null && item.kill.requestedMs === null && !item.observerError
    && item.stdout.endMs !== null && item.stderr.endMs !== null && item.stdout.error === null && item.stderr.error === null && item.stdin.error === null)
    && ordered.filter(item => item.command === "CREATE").length === containers && ordered.filter(item => item.command === "START").length === containers && ordered.filter(item => item.command === "RM").length === containers;
}

describe("one-shot transport diagnostic admission", () => {
  const pattern = "^records one pinned transport lifecycle diagnostic without retry$";
  it("requires the independent flag and exact selector with every legacy flag absent", () => {
    expect(transportDiagnosticSelected({ RSI_NATIVE_TRANSPORT_DIAGNOSTIC: "1" }, new RegExp(pattern))).toBe(true);
    for (const environment of [{}, { RSI_NATIVE_TRANSPORT_DIAGNOSTIC: "0" },
      ...["PREPARE", "PROBE", "SHUTDOWN_CONTROL", "CAUSE_COLLECTION", "DIAGNOSIS"].map(flag => ({ RSI_NATIVE_TRANSPORT_DIAGNOSTIC: "1", [`RSI_NATIVE_${flag}`]: "0" }))]) {
      expect(transportDiagnosticSelected(environment, new RegExp(pattern))).toBe(false);
    }
    for (const selector of [undefined, pattern, /.*/, new RegExp(pattern, "i"), new Proxy(new RegExp(pattern), {}), Object.defineProperty(new RegExp(pattern), "source", { value: "private" })]) {
      expect(transportDiagnosticSelected({ RSI_NATIVE_TRANSPORT_DIAGNOSTIC: "1" }, selector)).toBe(false);
    }
  });
  it("reads actual serialized selector from the pinned runner", () => {
    const pattern = transportDiagnosticRuntimePattern();
    expect(pattern === undefined || pattern instanceof RegExp).toBe(true);
    const expected = process.env.RSI_TRANSPORT_GUARD_PATTERN;
    if (expected !== undefined) {
      expect(pattern instanceof RegExp).toBe(true);
      expect(Object.getOwnPropertyDescriptor(RegExp.prototype, "source")!.get!.call(pattern)).toBe(expected);
    }
  });
  it("requires complete admission custody before a third container can be selected", () => {
    const pipe = { bytes: 0, chunks: 0, firstMs: null, lastMs: null, endMs: 1, closeMs: 1, error: null };
    const commands = ["CONTEXT", "INFO", "IMAGE_INSPECT", "IMAGE_INSPECT", "CREATE", "INSPECT", "START", "INSPECT", "RM", "CREATE", "INSPECT", "START", "INSPECT", "RM"] as const;
    const admission = commands.map((command, index) => dockerCommandLifecycleSchema.parse({ schemaVersion: 1, command, ordinal: index + 1, phase: "OTHER", timeoutMs: 5000, elapsedMs: 1,
      spawn: { invoked: true, observed: true, error: null }, stdin: { endInvoked: true, callback: true, finish: true, drainCount: 0, error: null }, stdout: pipe, stderr: pipe,
      exit: { atMs: 1, code: 0, signal: null }, close: { atMs: 1, code: 0, signal: null }, timer: { firedMs: null }, kill: { requestedMs: null, returned: null, error: null },
      nativeReady: "UNOBSERVED", nativeDispatch: "UNOBSERVED", observerError: false, events: [] }));
    expect(transportDiagnosticTraceComplete(admission, 2)).toBe(true);
    expect(transportDiagnosticTraceComplete(admission.slice(1).map((item, index) => ({ ...item, ordinal: index + 1 })), 2)).toBe(true);
    const missingCommand = admission.filter(item => item.ordinal !== 7);
    const missingTerminal = admission.map(item => item.ordinal === 7 ? { ...item, close: { ...item.close, atMs: null } } : item);
    const missingEof = admission.map(item => item.ordinal === 7 ? { ...item, stdout: { ...item.stdout, endMs: null } } : item);
    const missingProbe = admission.map(item => item.ordinal === 12 ? { ...item, command: "INFO" as const } : item);
    for (const incomplete of [[], missingCommand, missingTerminal, missingEof, missingProbe]) expect(transportDiagnosticTraceComplete(incomplete, 2)).toBe(false);
  });
});

// Independent of the legacy PREPARE/PROBE suite. Registration performs no I/O.
// Only the private outer watchdog starts this case; it suppresses raw test output.
it.runIf(process.env.RSI_NATIVE_TRANSPORT_DIAGNOSTIC === "1")(transportDiagnosticName, async () => {
  const root = realpathSync(fileURLToPath(new URL("../../", import.meta.url)));
  const directory = join(root, ".superpowers/operations/rsi-transport-20261023-diagnostic");
  const digest = z.string().regex(/^[a-f0-9]{64}$/);
  const closurePaths = ["package.json", "pnpm-lock.yaml", "vitest.config.ts", "scripts/rsi/container-backend.ts", "scripts/rsi/native-executor.ts", "scripts/rsi/native-wrapper.ts", "scripts/rsi/oracle.ts", "scripts/rsi/contracts.ts", "scripts/rsi/fixtures/native-runtime.Dockerfile", "tests/unit/rsi-native-executor.test.ts", "docs/testing/rsi-evaluation-protocol.md", "docs/main-change-history.md"] as const;
  const privatePaths = ["supervisor.py", "watchdog.py", "prepare-inputs.mjs", "input-digests.json"] as const;
  const planSchema = z.strictObject({ schemaVersion: z.literal(1), measurementId: z.literal("transport-20261023-one-shot"),
    task1Commit: z.literal("7109495122d2ab1f5eeb9249736543201bf5c814"), diagnosticCommit: z.string().regex(/^[a-f0-9]{40}$/), mainCommit: z.string().regex(/^[a-f0-9]{40}$/),
    sourceDigest: z.literal("286873f23839d8587d91ddf9650ec46e8b9b6be0f7e2a7b18e63a4cdeaa85561"), compiledDigest: z.literal("8988dcc713e76fed9e0684b41a71e09c612dbd4c85c73d1ccc1f7f6c985b2d60"),
    manifestCanonicalDigest: z.literal("605ad858ec0c49edda87c5b733d06bf04c954388bb619a1e81664400d20627ae"), manifestRawDigest: digest,
    imageId: z.literal("sha256:b035afe75a5453408f0e878a9405d9f621203acad47763b82372f01d4c958d4b"), nodeDigest: digest, pythonDigest: digest, dockerClientDigest: digest, hostNodeVersion: z.string().regex(/^v[0-9]+\.[0-9]+\.[0-9]+$/),
    fixture: z.literal("AUTH_REDIRECT_FAILURE"), flag: z.literal("RSI_NATIVE_TRANSPORT_DIAGNOSTIC=1"), testName: z.literal(transportDiagnosticName), selector: z.literal(transportDiagnosticPattern),
    maxContainers: z.literal(3), maxCommands: z.literal(19), postStopDockerQueries: z.literal(0), verifyCalls: z.literal(1), evaluateCalls: z.literal(1),
    outer: z.strictObject({ termMs: z.literal(140000), killMs: z.literal(145000), drainMs: z.literal(150000) }),
    closure: z.array(z.strictObject({ path: z.enum(closurePaths), digest })).length(closurePaths.length),
    privateArtifacts: z.array(z.strictObject({ path: z.enum(privatePaths), digest })).length(privatePaths.length) });
  const fileHash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const privateRead = (name: string) => {
    const path = join(directory, name), stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.size > 131072 || realpathSync(path) !== path) throw Error("DIAGNOSTIC_INPUT");
    return readFileSync(path, "utf8");
  };
  let plan: z.infer<typeof planSchema>;
  let candidate: string;
  let manifest: unknown;
  try {
    if (!transportDiagnosticSelected(process.env, transportDiagnosticRuntimePattern()) || process.env.RSI_TRANSPORT_SUPERVISED !== "GROUP_BOUND") throw Error("DIAGNOSTIC_GUARD");
    const stat = lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory() || (stat.mode & 0o777) !== 0o700 || realpathSync(directory) !== directory) throw Error("DIAGNOSTIC_DIRECTORY");
    plan = planSchema.parse(JSON.parse(privateRead("run-plan.json")));
    const git = (...args: string[]) => childProcess.execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 131072 });
    if (git("rev-parse", "HEAD").toString().trim() !== plan.diagnosticCommit || git("status", "--porcelain", "--untracked-files=no").length) throw Error("DIAGNOSTIC_CODE");
    for (const [paths, values, base] of [[closurePaths, plan.closure, root], [privatePaths, plan.privateArtifacts, directory]] as const) {
      if (new Set(values.map(item => item.path)).size !== paths.length) throw Error("DIAGNOSTIC_CLOSURE");
      for (const item of values) if (lstatSync(join(base, item.path)).isSymbolicLink() || fileHash(join(base, item.path)) !== item.digest) throw Error("DIAGNOSTIC_CLOSURE");
    }
    if (fileHash(process.execPath) !== plan.nodeDigest || process.version !== plan.hostNodeVersion) throw Error("DIAGNOSTIC_RUNTIME");
    candidate = privateRead("source.ts");
    const compiled = await compileNativeCandidate({ path: NATIVE_SOURCE_PATH, source: candidate, sourceDigest: plan.sourceDigest });
    if (hash(candidate) !== plan.sourceDigest || hash(privateRead("compiled.mjs")) !== plan.compiledDigest || compiled.compiledDigest !== plan.compiledDigest || compiled.script !== privateRead("compiled.mjs")
      || createHash("sha256").update(git("show", `${plan.mainCommit}:${NATIVE_SOURCE_PATH}`)).digest("hex") !== plan.sourceDigest) throw Error("DIAGNOSTIC_BINDING");
    const raw = privateRead("manifest.json"); manifest = JSON.parse(raw);
    if (hash(raw) !== plan.manifestRawDigest || hash(JSON.stringify(manifest)) !== plan.manifestCanonicalDigest || (manifest as { imageId?: unknown }).imageId !== plan.imageId) throw Error("DIAGNOSTIC_MANIFEST");
    // NativeExecutor.verify performs the unchanged strict manifest/artifact/runtime admission.
    closeSync(openSync(join(directory, "case-started.lock"), "wx", 0o600));
  } catch { throw Error("RSI_TRANSPORT_PREACTUAL_BLOCKED"); }

  const bindings = { measurementId: plan.measurementId, diagnosticCommit: plan.diagnosticCommit, mainCommit: plan.mainCommit,
    closureDigest: hash(JSON.stringify(plan.closure)), privateArtifactsDigest: hash(JSON.stringify(plan.privateArtifacts)), sourceDigest: plan.sourceDigest,
    compiledDigest: plan.compiledDigest, manifestRawDigest: plan.manifestRawDigest, manifestCanonicalDigest: plan.manifestCanonicalDigest, imageId: plan.imageId,
    hostNodeVersion: process.version, nodeDigest: plan.nodeDigest, pythonDigest: plan.pythonDigest, dockerClientDigest: plan.dockerClientDigest, dockerClientVersion: "UNOBSERVED" };
  const snapshots = new Map<number, DockerCommandLifecycle>();
  let observerError = false, persistenceError = false;
  let phase: "VERIFY" | "EVALUATE" | "STOPPED" = "VERIFY";
  const persist = (name: "metadata.json" | "result.json", value: unknown): void => {
    const path = join(directory, name), temporary = `${path}.tmp`;
    // The private directory was created exclusively for this attempt; no append or shared ledger.
    const data = JSON.stringify(value);
    if (Buffer.byteLength(data) > 262144) throw Error("DIAGNOSTIC_METADATA_LIMIT");
    writeFileSync(temporary, data + "\n", { mode: 0o600, flag: "wx" }); renameSync(temporary, path);
  };
  const flush = (): void => persist("metadata.json", { schemaVersion: 1, bindings, phase, observerError, persistenceError,
    commands: [...snapshots.values()].sort((a, b) => a.ordinal - b.ordinal), postStopAbsence: "UNOBSERVED", nativeReady: "UNOBSERVED", nativeDispatch: "UNOBSERVED" });
  const observer = (raw: Readonly<DockerCommandLifecycle>): void => {
    try {
      const snapshot = decodeContainerDiagnostic(dockerCommandLifecycleSchema, raw) as DockerCommandLifecycle | undefined;
      if (!snapshot || snapshot.ordinal > 19 || snapshot.observerError || (!snapshots.has(snapshot.ordinal) && snapshots.size >= 19)) { observerError = true; return; }
      snapshots.set(snapshot.ordinal, snapshot); flush();
    } catch { observerError = true; persistenceError = true; }
  };
  let release: (() => void) | undefined;
  let normalControl = false;
  let record: Record<string, unknown> = { schemaVersion: 1, bindings, status: "UNKNOWN", rootCause: "UNKNOWN", controlVerdict: null,
    stopReason: "ADMISSION_FAILED", postStopAbsence: "UNOBSERVED", quarantineRequired: true, backendQuarantineConfirmed: null };
  try {
    release = observeDockerLifecycle(observer); flush();
    const executor = await NativeExecutor.verify(manifest);
    if (observerError || persistenceError) { record.stopReason = "OBSERVER_INTEGRITY"; throw Error("DIAGNOSTIC_OBSERVER"); }
    if (!transportDiagnosticTraceComplete([...snapshots.values()], 2)) { record.stopReason = "ADMISSION_TRACE_UNVERIFIED"; throw Error("DIAGNOSTIC_ADMISSION_TRACE"); }
    phase = "EVALUATE"; flush();
    const result = await executor.evaluate({ path: NATIVE_SOURCE_PATH, source: candidate, sourceDigest: plan.sourceDigest, fixture: "AUTH_REDIRECT_FAILURE" });
    const provenance = result.provenance;
    const transport = decodeContainerDiagnostic(containerTransportDiagnosticSchema, Object.getOwnPropertyDescriptor(provenance, "transport")?.value);
    const failureFrame = decodeContainerDiagnostic(containerFailureFrameSchema, Object.getOwnPropertyDescriptor(provenance, "failureFrame")?.value);
    const cleanupFailure = decodeContainerDiagnostic(containerFailureDiagnosticSchema, Object.getOwnPropertyDescriptor(provenance, "cleanupFailure")?.value);
    const startFailure = decodeContainerDiagnostic(containerFailureDiagnosticSchema, { startFailure: Object.getOwnPropertyDescriptor(provenance, "startFailure")?.value });
    const receiptSchema = z.strictObject({ callCount: z.number().int().min(0).max(6), childSpawns: z.literal(1), dispatchAttempts: z.literal(1), deadlineExpired: z.boolean(), disposalConfirmed: z.boolean(), cleanupConfirmed: z.boolean(),
      logs: z.strictObject({ valid: z.boolean(), warningCount: z.number().int().min(0).max(32768), rejectedCount: z.number().int().min(0).max(32768),
        stdoutEof: z.boolean(), stderrEof: z.boolean(), errorCount: z.number().int().min(0).max(2), prematureCloseCount: z.number().int().min(0).max(2) }) });
    const known = provenance as typeof provenance & { callCount?: number; childSpawns?: number; dispatchAttempts?: number; deadlineExpired?: boolean; disposalConfirmed?: boolean; cleanupConfirmed?: boolean;
      receiptDigest?: string; traceDigest?: string; responseDigest?: string;
      logs?: { valid: boolean; warningCount: number; rejectedCount: number; custody: { stdoutEof: boolean; stderrEof: boolean; errorCount: number; prematureCloseCount: number } } };
    const evidenceDigests = z.strictObject({ receiptDigest: digest, traceDigest: digest, responseDigest: digest, sourceDigest: digest, compiledDigest: digest, manifestDigest: digest }).safeParse({
      receiptDigest: known.receiptDigest, traceDigest: known.traceDigest, responseDigest: known.responseDigest,
      sourceDigest: known.sourceDigest, compiledDigest: known.compiledDigest, manifestDigest: known.manifestDigest });
    const receipt = receiptSchema.safeParse({ callCount: known.callCount, childSpawns: known.childSpawns, dispatchAttempts: known.dispatchAttempts,
      deadlineExpired: known.deadlineExpired, disposalConfirmed: known.disposalConfirmed, cleanupConfirmed: known.cleanupConfirmed,
      logs: known.logs ? { valid: known.logs.valid, warningCount: known.logs.warningCount, rejectedCount: known.logs.rejectedCount, ...known.logs.custody } : undefined });
    const reasonCode = z.enum(["NORMAL", "EXTERNAL_FAILURE", "SIX_PATHS_VERIFIED", "ORACLE_MISMATCH", "RSI_SANDBOX_CLEANUP", "RSI_SANDBOX_TIMEOUT", "RSI_SANDBOX_OUTPUT_LIMIT", "RSI_SANDBOX_BLOCKED", "EXECUTION_UNVERIFIED", "EXECUTION_STDERR", "RECEIPT_MISMATCH", "RAW_LOG_CUSTODY_UNVERIFIED", "RUNTIME_DISPOSAL_UNVERIFIED", "INJECTED_TRANSPORT"]).safeParse(result.reasonCode);
    const completeTrace = transportDiagnosticTraceComplete([...snapshots.values()], 3);
    normalControl = result.verdict === "NO_CHANGE" && result.reasonCode === "EXTERNAL_FAILURE" && provenance.transportKind === "DOCKER_CLI"
      && evidenceDigests.success && evidenceDigests.data.sourceDigest === plan.sourceDigest && evidenceDigests.data.compiledDigest === plan.compiledDigest && evidenceDigests.data.manifestDigest === plan.manifestCanonicalDigest
      && receipt.success && receipt.data.callCount === 6 && receipt.data.dispatchAttempts === 1 && !receipt.data.deadlineExpired && receipt.data.disposalConfirmed && receipt.data.cleanupConfirmed
      && receipt.data.logs.valid && receipt.data.logs.warningCount === 1 && receipt.data.logs.rejectedCount === 0 && receipt.data.logs.stdoutEof && receipt.data.logs.stderrEof && !receipt.data.logs.errorCount && !receipt.data.logs.prematureCloseCount
      && !!transport && transport.cleanup.inspectReturned === true && transport.cleanup.nameMatch === true && transport.cleanup.ownerMatch === true && transport.cleanup.idMatch === true && transport.cleanup.rmInvoked && transport.cleanup.rmReturned === true
      && completeTrace && !observerError && !persistenceError;
    record = { ...record, status: normalControl ? "CONTROL_OBSERVED" : "UNKNOWN", stopReason: normalControl ? "COMPLETED_ONCE" : "FIRST_UNVERIFIED_EXECUTION",
      controlVerdict: result.verdict, reasonCode: reasonCode.success ? reasonCode.data : "OPAQUE", transportKind: provenance.transportKind === "DOCKER_CLI" ? "DOCKER_CLI" : "UNVERIFIED",
      redReproduced: result.redReproduced, greenVerified: result.greenVerified,
      ...(evidenceDigests.success ? { evidenceDigests: evidenceDigests.data } : {}), ...(receipt.success ? { receipt: receipt.data } : {}), ...(transport ? { transport } : {}), ...(failureFrame ? { failureFrame } : {}),
      ...(cleanupFailure ? { cleanupFailure } : {}), ...(startFailure?.startFailure ? { startFailure: startFailure.startFailure } : {}),
      quarantineRequired: !normalControl, backendQuarantineConfirmed: cleanupFailure ? true : null };
  } catch (error) {
    const diagnostic = decodeContainerDiagnostic(containerFailureDiagnosticSchema, error instanceof Error ? Object.getOwnPropertyDescriptor(error, "cause")?.value : undefined);
    record = { ...record, ...(diagnostic ? { admissionDiagnostic: diagnostic } : {}) };
  } finally {
    release?.(); phase = "STOPPED";
    try { flush(); persist("result.json", { ...record, observerError, persistenceError, commandCountObserved: snapshots.size,
      containersObserved: [...snapshots.values()].filter(item => item.command === "CREATE").length }); }
    catch { persistenceError = true; normalControl = false; }
  }
  // A terminal UNKNOWN is retained and fails this opt-in case; exit 0 is separate evidence.
  expect(normalControl && !observerError && !persistenceError).toBe(true);
}, 150000);

describe("synthetic adapter failures (no OS/native proof)", () => {
  async function setup() {
    const artifacts = await nativeArtifactDigests();
    // Deliberately synthetic metadata. The injected transport still cannot PASS.
    const runtime = { ...NATIVE_RUNTIME, supportedCompatibilityDate: "2026-08-05", workerdDigest: "1".repeat(64), publicCaDigest: "6".repeat(64), publicCaCount: 100 };
    const manifest = { schemaVersion: 1, imageId: `sha256:${"2".repeat(64)}`, baseImage: "node@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5", pnpm: "10.34.5", artifacts, runtime };
    const evidence = { transportKind: "INJECTED_TRANSPORT" };
    const state = { blocked: false, error: "", corrupt: false, logs: false, custody: { ...completePipes }, cleanupCause: undefined as unknown,
      failureFactory: undefined as ((output: string) => Promise<{ code: number; stdout: string; stderr: string; evidence: typeof evidence }>) | undefined };
    const backend = { evidence, assertAvailable() { if (state.blocked) throw Error("RSI_SANDBOX_BLOCKED"); }, async run(stdin: string) {
      const input = JSON.parse(stdin);
      const output = input.operation === "probe" ? { schemaVersion: 1, runtime } : {
        schemaVersion: 1, runtime, grade: { verdict: "PASS", reasonCode: "SIX_PATHS_VERIFIED", redReproduced: false, greenVerified: true },
        sourceDigest: state.corrupt ? "3".repeat(64) : input.sourceDigest, compiledDigest: input.compiledDigest,
        traceDigest: "4".repeat(64), responseDigest: "5".repeat(64), callCount: 6, elapsedMs: 5, peakMemoryBytes: 200000000, reason: "ORACLE_RESULT",
        logs: { valid: true, custody: state.custody, warningCount: 1, rejectedCount: 0, forbiddenMarkerCount: 0, bytes: 200, digest: "7".repeat(64), warningSourceDigest: "8".repeat(64), rejectionCodes: [] }, childSpawns: 1, dispatchAttempts: 1, deadlineExpired: false, disposalConfirmed: true,
      };
      if (state.failureFactory) return state.failureFactory(JSON.stringify(output) + "\n");
      if (state.error) { if (state.error === "RSI_SANDBOX_CLEANUP") state.blocked = true; throw new Error(state.error, { cause: state.cleanupCause }); }
      return { code: 0, stdout: JSON.stringify(output) + "\n", stderr: state.logs ? "private candidate log" : "", evidence };
    } };
    const spy = vi.spyOn(VerifiedContainerBackend, "verify").mockResolvedValue(backend as unknown as VerifiedContainerBackend);
    return { manifest, state, spy, evidence };
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
  it.each(["stdoutEof", "stderrEof", "errorCount", "prematureCloseCount"] as const)("returns UNKNOWN for incomplete raw-pipe custody: %s", async field => {
    const fake = await setup();
    try {
      const executor = await NativeExecutor.verify(fake.manifest);
      Object.assign(fake.state.custody, { [field]: field.endsWith("Eof") ? false : 1 });
      const result = await executor.evaluate({ ...request(), fixture: "NORMAL" });
      expect(result.verdict).toBe("UNKNOWN"); expect(result.reasonCode).toBe("RAW_LOG_CUSTODY_UNVERIFIED");
      expect(result.provenance).toMatchObject({ pipeCustody: fake.state.custody, cleanupConfirmed: true });
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
  it.each(["valid", "extra", "accessor"])("revalidates bounded cleanup diagnosis: %s", async shape => {
    const fake = await setup(); let invoked = false;
    try {
      const executor = await NativeExecutor.verify(fake.manifest);
      fake.state.error = "RSI_SANDBOX_CLEANUP";
      fake.state.cleanupCause = shape === "valid" ? { stage: "RM_TRANSPORT", failure: "TIMEOUT" }
        : shape === "extra" ? { stage: "RM_TRANSPORT", failure: "TIMEOUT", raw: "SYNTHETIC_PRIVATE_DAEMON" }
        : { get stage() { invoked = true; return "RM_TRANSPORT"; }, failure: "TIMEOUT" };
      const result = await executor.evaluate({ ...request(), fixture: "NORMAL" });
      expect(result.verdict).toBe("UNKNOWN"); expect(result.reasonCode).toBe("RSI_SANDBOX_CLEANUP");
      if (shape === "valid") expect(result.provenance).toMatchObject({ cleanupFailure: { stage: "RM_TRANSPORT", failure: "TIMEOUT" } });
      else expect(result.provenance).not.toHaveProperty("cleanupFailure");
      expect(invoked).toBe(false); expect(JSON.stringify(result)).not.toContain("SYNTHETIC_PRIVATE_DAEMON");
    } finally { fake.spy.mockRestore(); }
  });
  it.each([false, true])("keeps START failure metadata separate from cleanup: %s", async cleanup => {
    const fake = await setup();
    try {
      const executor = await NativeExecutor.verify(fake.manifest);
      fake.state.error = cleanup ? "RSI_SANDBOX_CLEANUP" : "RSI_SANDBOX_TIMEOUT";
      fake.state.cleanupCause = { ...(cleanup ? { stage: "RM_TRANSPORT", failure: "TIMEOUT" } : {}), startFailure: { failure: "TIMEOUT", stdoutBytes: 103, stderrBytes: 0 } };
      const result = await executor.evaluate({ ...request(), fixture: "NORMAL" });
      expect(result.verdict).toBe("UNKNOWN");
      expect(result.provenance).toHaveProperty("startFailure", { failure: "TIMEOUT", stdoutBytes: 103, stderrBytes: 0 });
      if ("startFailure" in result.provenance) expect(Object.isFrozen(result.provenance.startFailure)).toBe(true);
      expect(JSON.stringify(result)).not.toContain("private");
    } finally { fake.spy.mockRestore(); }
  });
  it.each([
    ["stdout", false], ["stderr", false], ["stdout", true], ["stderr", true],
  ] as const)("keeps a valid frame UNKNOWN after host %s read error with cleanup uncertainty %s", async (stream, cleanup) => {
    const fake = await setup(); const spawned: EventEmitter[] = [];
    const spawn = vi.spyOn(childProcess, "spawn").mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: vi.fn() });
      spawned.push(child); return child as unknown as ReturnType<typeof childProcess.spawn>;
    }); syncBuiltinESMExports();
    let frameDigest = "";
    try {
      const executor = await NativeExecutor.verify(fake.manifest);
      // Synthetic evidence only: permit the success branch so a missing CLI rejection cannot hide behind INJECTED_TRANSPORT.
      fake.evidence.transportKind = "DOCKER_CLI";
      fake.state.failureFactory = async output => {
        frameDigest = hash(output);
        const pending = createLocalDockerTransport({ DOCKER_HOST: "unix:///synthetic.sock" })(["start"], "", { timeoutMs: 15000, maxOutputBytes: 32768 }).catch(error => {
          // Preserve the real backend's START wrapper and existing cleanup-only quarantine boundary.
          Object.defineProperty(error, "cause", { value: { ...(cleanup ? { stage: "RM_TRANSPORT", failure: "TIMEOUT" } : {}), startFailure: error.cause } });
          if (cleanup) { Object.defineProperty(error, "message", { value: "RSI_SANDBOX_CLEANUP" }); fake.state.blocked = true; }
          throw error;
        });
        await Promise.resolve(); await Promise.resolve();
        const child = spawned.at(-1) as EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> };
        child.stdout.write(output);
        child[stream].emit("error", Object.assign(Error("SYNTHETIC_PRIVATE_READ_ERROR"), { code: "ECONNRESET" }));
        child.emit("close", 0, null);
        expect(child.kill).not.toHaveBeenCalled();
        return { ...await pending, evidence: fake.evidence };
      };
      const result = await executor.evaluate({ ...request(), fixture: "NORMAL" });
      expect(result.verdict).toBe("UNKNOWN"); expect(result.greenVerified).toBe(false);
      expect(result.reasonCode).toBe(cleanup ? "RSI_SANDBOX_CLEANUP" : "EXECUTION_UNVERIFIED");
      expect(result.provenance).toHaveProperty("startFailure", expect.objectContaining({ failure: "UNAVAILABLE", lifecycle: expect.objectContaining({ [stream]: expect.objectContaining({ error: "ECONNRESET" }), close: expect.objectContaining({ code: 0 }) }) }));
      expect(result.provenance).toHaveProperty("failureFrame", { frameKind: "EVALUATION", digest: frameDigest, completeJSON: true, schemaMatch: true, bindingMatch: true });
      expect(fake.state.blocked).toBe(cleanup);
      if (cleanup) await expect(executor.evaluate({ ...request(), fixture: "NORMAL" })).rejects.toThrow("RSI_SANDBOX_BLOCKED");
      expect(JSON.stringify(result)).not.toMatch(/SYNTHETIC_PRIVATE|SIX_PATHS_VERIFIED|"grade"/);
    } finally { spawned.forEach(child => child.emit("close", 0, null)); spawn.mockRestore(); syncBuiltinESMExports(); fake.spy.mockRestore(); }
  });
  it.each(["EVALUATION", "MISMATCH", "PROBE", "DIAGNOSTIC", "INVALID", "INCOMPLETE", "PARTIAL", "NONE", "STDERR_ONLY_LIMIT", "TIMEOUT_THEN_STDOUT_LIMIT"])("classifies failed stdout as %s without authorizing PASS or retaining raw data", async shape => {
    const fake = await setup(); const spawned: EventEmitter[] = [];
    vi.useFakeTimers();
    const spawn = vi.spyOn(childProcess, "spawn").mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: vi.fn(() => { if (shape !== "TIMEOUT_THEN_STDOUT_LIMIT") queueMicrotask(() => child.emit("close", null, "SIGKILL")); return true; }) });
      spawned.push(child); return child as unknown as ReturnType<typeof childProcess.spawn>;
    }); syncBuiltinESMExports();
    let raw = "";
    try {
      const executor = await NativeExecutor.verify(fake.manifest);
      fake.state.failureFactory = async output => {
        const evaluated = JSON.parse(output);
        raw = shape === "PROBE" ? JSON.stringify({ schemaVersion: 1, runtime: fake.manifest.runtime }) + "\n"
          : shape === "DIAGNOSTIC" ? JSON.stringify({ schemaVersion: 1, runtime: fake.manifest.runtime, fatal: { category: "OTHER", bytes: 12, digest: "a".repeat(64), clues: [], locations: [] } }) + "\n"
          : shape === "MISMATCH" ? JSON.stringify({ ...evaluated, sourceDigest: "0".repeat(64) }) + "\n"
          : shape === "INVALID" ? "SYNTHETIC_PRIVATE_FRAME" : shape === "INCOMPLETE" ? '{"SYNTHETIC_PRIVATE_FRAME":' : shape === "NONE" ? "" : output;
        const cli = createLocalDockerTransport({ DOCKER_HOST: "unix:///SYNTHETIC_PRIVATE.sock" });
        const maxOutputBytes = ["PARTIAL", "TIMEOUT_THEN_STDOUT_LIMIT"].includes(shape) ? 4 : shape === "STDERR_ONLY_LIMIT" ? Buffer.byteLength(raw) : 32768;
        const pending = cli(["start", "SYNTHETIC_ARGV"], "SYNTHETIC_SOURCE", { timeoutMs: 10, maxOutputBytes }).catch(error => {
          // Same opaque Error retains CLI custody while a cleanup error dominates.
          Object.defineProperty(error, "message", { value: "RSI_SANDBOX_CLEANUP" });
          Object.defineProperty(error, "cause", { value: { stage: "RM_TRANSPORT", failure: "TIMEOUT", startFailure: error.cause } });
          throw error;
        });
        await Promise.resolve(); await Promise.resolve();
        const child = spawned.at(-1) as EventEmitter & { stdout: PassThrough; stderr: PassThrough };
        if (shape === "TIMEOUT_THEN_STDOUT_LIMIT") {
          child.stdout.write(raw.slice(0, 4));
          setTimeout(() => { child.stdout.write(raw.slice(4)); child.emit("close", null, "SIGKILL"); }, 11);
        } else {
          child.stdout.write(raw);
          if (shape === "STDERR_ONLY_LIMIT") child.stderr.write("SYNTHETIC_PRIVATE_STDERR");
        }
        return pending;
      };
      const pending = executor.evaluate({ ...request(), fixture: "NORMAL" });
      // Compilation is asynchronous and intentionally does not use fake wall time.
      await vi.waitFor(() => expect(spawned).toHaveLength(1)); await vi.advanceTimersByTimeAsync(10);
      const result = await pending;
      expect(result.verdict).toBe("UNKNOWN"); expect(result.greenVerified).toBe(false); expect(result.reasonCode).toBe("RSI_SANDBOX_CLEANUP");
      const frameKind = ["MISMATCH", "STDERR_ONLY_LIMIT"].includes(shape) ? "EVALUATION" : shape === "INCOMPLETE" ? "INVALID" : shape === "TIMEOUT_THEN_STDOUT_LIMIT" ? "PARTIAL" : shape;
      expect(result.provenance).toHaveProperty("failureFrame", expect.objectContaining({ frameKind }));
      if (["EVALUATION", "PROBE", "DIAGNOSTIC", "MISMATCH", "STDERR_ONLY_LIMIT"].includes(shape)) expect(result.provenance).toHaveProperty("failureFrame", expect.objectContaining({ completeJSON: true, schemaMatch: true, bindingMatch: shape !== "MISMATCH" }));
      if (shape === "STDERR_ONLY_LIMIT") {
        expect(result.provenance).toHaveProperty("startFailure", expect.objectContaining({ failure: "OUTPUT_LIMIT", stdoutBytes: Buffer.byteLength(raw) }));
        expect(result.provenance).toHaveProperty("failureFrame", expect.objectContaining({ digest: hash(raw) }));
      }
      if (shape === "TIMEOUT_THEN_STDOUT_LIMIT") {
        expect(result.provenance).toHaveProperty("startFailure", expect.objectContaining({ failure: "TIMEOUT" }));
        expect(result.provenance).toHaveProperty("failureFrame", expect.objectContaining({ digest: hash(raw.slice(0, 4)), completeJSON: null, schemaMatch: null, bindingMatch: null }));
      }
      if (shape === "INCOMPLETE") expect(result.provenance).toHaveProperty("failureFrame", expect.objectContaining({ completeJSON: false, bindingMatch: null }));
      expect(JSON.stringify(result)).not.toMatch(/SYNTHETIC_PRIVATE|SYNTHETIC_ARGV|SYNTHETIC_SOURCE|SIX_PATHS_VERIFIED|"grade"/);
      expect(JSON.stringify(result)).not.toContain(raw || "SYNTHETIC_UNUSED");
    } finally { spawned.forEach(child => child.emit("close", null)); spawn.mockRestore(); syncBuiltinESMExports(); fake.spy.mockRestore(); vi.useRealTimers(); }
  });
  it.each(["valid", "proxy", "getter", "extra", "oversize", "prototype"])("revalidates nested lifecycle provenance without evaluating %s data", async shape => {
    const fake = await setup(); let touched = 0;
    try {
      const executor = await NativeExecutor.verify(fake.manifest);
      const pipe = { bytes: 0, chunks: 0, firstMs: null, lastMs: null, endMs: null, closeMs: null, error: null };
      const lifecycle = dockerCommandLifecycleSchema.parse({ schemaVersion: 1, command: "START", ordinal: 1, phase: "START", timeoutMs: 15000, elapsedMs: 15000,
        spawn: { invoked: true, observed: null, error: null }, stdin: { endInvoked: true, callback: null, finish: null, drainCount: 0, error: null }, stdout: pipe, stderr: pipe,
        exit: { atMs: null, code: null, signal: null }, close: { atMs: null, code: null, signal: null }, timer: { firedMs: 15000 }, kill: { requestedMs: 15000, returned: false, error: null }, nativeReady: "UNOBSERVED", nativeDispatch: "UNOBSERVED", observerError: false, events: [{ kind: "TIMER", atMs: 15000 }] });
      const command = { failure: "TIMEOUT", stdoutBytes: 0, stderrBytes: 0, lifecycle };
      const transport = { commands: [lifecycle], cleanup: { inspectReturned: true, nameMatch: true, ownerMatch: true, idMatch: true, rmInvoked: true, rmReturned: null } };
      const valid = { stage: "RM_TRANSPORT", failure: "TIMEOUT", command, startFailure: command, transport };
      fake.state.cleanupCause = shape === "valid" ? JSON.parse(JSON.stringify(valid))
        : shape === "proxy" ? new Proxy(valid, { getPrototypeOf() { touched++; throw Error(); }, ownKeys() { touched++; throw Error(); } })
        : shape === "getter" ? { ...valid, transport: { get commands() { touched++; return []; } } }
        : shape === "extra" ? { ...valid, transport: { ...transport, raw: "SYNTHETIC_PRIVATE" } }
        : shape === "oversize" ? { ...valid, transport: { ...transport, commands: Array(6).fill(lifecycle) } }
        : Object.assign(Object.create({}), valid);
      fake.state.error = "RSI_SANDBOX_CLEANUP";
      const result = await executor.evaluate({ ...request(), fixture: "NORMAL" });
      expect(result.verdict).toBe("UNKNOWN");
      if (shape === "valid") {
        expect(result.provenance).toHaveProperty("cleanupFailure", valid); expect(result.provenance).toHaveProperty("transport", transport);
        expect(Object.isFrozen((result.provenance as { transport: typeof transport }).transport.commands[0].stdin)).toBe(true);
      } else expect(result.provenance).not.toHaveProperty("cleanupFailure");
      expect(touched).toBe(0); expect(JSON.stringify(result)).not.toContain("SYNTHETIC_PRIVATE");
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
  // One immutable capability, fresh container per run. A cleanup uncertainty
  // quarantines the remaining campaign instead of being hidden by re-verifying.
  let capability: Promise<NativeExecutor> | undefined;
  const actualExecutor = () => capability ??= NativeExecutor.verify(manifest());
  it.runIf(process.env.RSI_NATIVE_SHUTDOWN_CONTROL === "1")("runs shutdown correction controls once each", async () => {
    const executor = await NativeExecutor.verify(manifest());
    const normal = await executor.evaluate({ ...request(), fixture: "NORMAL" });
    record("shutdown-correction-NORMAL-once", normal);
    expect(normal.verdict).toBe("NO_CHANGE");
    expect(normal.provenance).toMatchObject({ callCount: 6, dispatchAttempts: 1, deadlineExpired: false, disposalConfirmed: true, cleanupConfirmed: true });
    const skipped = await executor.evaluate({ ...request(source.replace("RSI_PUBLIC_PATH_CHECKS.map", "RSI_PUBLIC_PATH_CHECKS.slice(1).map")), fixture: "NATIVE_RECEIVER" });
    record("shutdown-correction-skipped-path-once", skipped);
    expect(skipped.verdict).toBe("FAIL"); expect(skipped.reason).toBe("ORACLE_RESULT");
    expect(skipped.provenance).toMatchObject({ callCount: 5, dispatchAttempts: 1, deadlineExpired: false, disposalConfirmed: true, cleanupConfirmed: true });
  }, 45000);
  it.runIf(process.env.RSI_NATIVE_CAUSE_COLLECTION === "1")("collects one bounded cause batch without retrying a failed lifecycle", async () => {
    const started = Date.now(), end = started + 120000;
    const results: { index: number; fixture: string; result: unknown }[] = [];
    let stopped = "COUNT_BOUND", admission: { reason: string; diagnostic?: unknown } | undefined;
    try {
      const executor = await NativeExecutor.verify(manifest());
      for (let index = 0; index < 32; index++) {
        // Reserve the unchanged worst-case create/inspect/start/inspect/rm bounds.
        if (end - Date.now() < 35000) { stopped = "WALL_BOUND"; break; }
        const fixture = index % 2 === 0 ? "NORMAL" : "NATIVE_RECEIVER";
        const value = index % 2 === 0 ? source : 'try { (function*(){})["constr"+"uctor"]("yield import(\\"node:fs\\")")(); } catch {}' + source;
        const result = await executor.evaluate({ ...request(value), fixture });
        results.push({ index, fixture, result });
        if (result.verdict === "UNKNOWN") { stopped = "FIRST_UNVERIFIED_EXECUTION"; break; }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const cause = error instanceof Error ? Object.getOwnPropertyDescriptor(error, "cause")?.value : undefined;
      admission = { reason: /^RSI_(NATIVE|SANDBOX)_[A-Z_0-9]+$/.test(message) ? message : "OPAQUE", diagnostic: cause };
      stopped = "ADMISSION_FAILED";
    }
    record("bounded-cause-collection-only", { purpose: "CAUSE_COLLECTION_ONLY", transportKind: "DOCKER_CLI", imageId: manifest().imageId,
      startedUtc: new Date(started).toISOString(), endedUtc: new Date().toISOString(), elapsedMs: Date.now() - started,
      maxCandidates: 32, totalBudgetMs: 120000, stopped, admission, results });
    expect(results.length).toBeLessThanOrEqual(32);
    expect(Date.now() - started).toBeLessThanOrEqual(120000);
  }, 125000);
  it("independently matches public roots from the pinned base Node binary", async () => {
    const policy = JSON.parse(readFileSync(new URL("../../scripts/rsi/sandbox-policy.json", import.meta.url), "utf8"));
    const fixedSource = 'import {rootCertificates} from "node:tls"; import {createHash} from "node:crypto"; const bundle=rootCertificates.join("\\n")+"\\n"; console.log(JSON.stringify({publicCaDigest:createHash("sha256").update(bundle).digest("hex"),publicCaCount:rootCertificates.length}));';
    const keys = ["schemaVersion", "image", "imageId", "platform", "nodeVersion", "dockerVersion", "kernelVersion", "cgroupVersion", "memoryMiB", "tmpfsMiB", "cpus", "pids", "wallTimeMs", "watchdogPath", "watchdogSha256", "maxInputBytes", "maxOutputBytes"];
    const profile = { ...Object.fromEntries(keys.map(key => [key, policy[key]])), baseImage: policy.image, baseImageId: policy.imageId,
      entrypoint: { kind: "inline-node", source: fixedSource, sha256: hash(fixedSource) } } as TrustedContainerProfile;
    const backend = await VerifiedContainerBackend.verify(profile);
    const result = await backend.run("");
    expect(result.code).toBe(0); expect(result.stderr).toBe("");
    const roots = JSON.parse(result.stdout);
    expect(roots).toEqual({ publicCaDigest: manifest().runtime.publicCaDigest, publicCaCount: manifest().runtime.publicCaCount });
    record("independent-pinned-base-public-roots", { ...roots, provenance: result.evidence });
  }, 15000);
  it("diagnoses fixed trusted worker startup without candidate dispatch", async () => {
    const executor = await actualExecutor();
    const results = [];
    for (const shape of ["CURRENT", "REGRESSION"] as const) {
      const result = await executor.diagnose(shape);
      record(`trusted-bootstrap-${shape}`, result);
      results.push(result);
    }
    for (const result of results) {
      expect(result.candidateDispatches).toBe(0);
      expect(result.fatal).toBe(false);
      if (result.fatal) continue;
      expect(result.ready).toBeNull();
      expect(result.disposal).toBeNull();
      expect(result.logs.valid).toBe(true);
      expect(result.logs.warningCount).toBe(1);
    }
  }, 30000);
  it("records native RED then GREEN and normal/external NO_CHANGE", async () => {
    const executor = await actualExecutor();
    const red = await executor.evaluate({ ...request(source.replace("fetchPath(url,", "input.fetch(url,")), fixture: "NATIVE_RECEIVER" });
    record("wrong-receiver-red", red);
    expect(red.verdict).toBe("FAIL");
    expect(red.provenance.transportKind).toBe("DOCKER_CLI");
    expect(red.reason).toBe("ORACLE_RESULT");
    expect(red.provenance).toMatchObject({ callCount: 0, logs: { valid: true }, cleanupConfirmed: true });
    const green = await executor.evaluate({ ...request(), fixture: "NATIVE_RECEIVER" });
    record("bound-green", green);
    expect(green.verdict).toBe("PASS");
    expect(green.greenVerified).toBe(true);
    expect(green.provenance).toMatchObject({ callCount: 6, childSpawns: 1, logs: { valid: true, warningCount: 1, rejectedCount: 0 }, cleanupConfirmed: true });
    for (const fixture of ["NORMAL", "HTTP_FAILURE", "AUTH_REDIRECT_FAILURE", "AUTH_STATUS_FAILURE"]) {
      const result = await executor.evaluate({ ...request(), fixture });
      record(fixture, result);
      expect(result.verdict).toBe("NO_CHANGE");
      expect(result.greenVerified).toBe(fixture === "NORMAL");
      expect(result.provenance).toMatchObject({ callCount: 6, logs: { valid: true }, cleanupConfirmed: true });
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
    ["host filesystem", duringCheck('const value = process.getBuiltinModule("fs").readFileSync("/etc/passwd");')],
    ["environment", 'const value = process.env.RSI_SECRET; if(value !== undefined) throw Error(value); console.log(value);' + source],
    ["log forging", 'console.log(JSON.stringify({schemaVersion:1,grade:{verdict:"PASS"}}));' + source],
    ["startup warning mimic", `console.warn(${JSON.stringify(startupWarning)});` + source],
    ["late startup warning mimic", source.replace("const fetchPath = input.fetch.bind(globalThis);", `console.warn(${JSON.stringify(startupWarning)}); const fetchPath = input.fetch.bind(globalThis);`)],
    ["Miniflare filtered console", 'console.log("took recursive isolate lock");' + source],
    ["structured warning forgery", `console.log(${JSON.stringify(nativeLog().toString())});` + source],
    ["raw stdout forgery", duringCheck(`process.stdout.write(${JSON.stringify(nativeLog().toString())});`)],
    ["raw stderr malformed", duringCheck('process.stderr.write("{malformed}\\n");')],
    ["stack leak", duringCheck('throw new Error("SYNTHETIC_STACK_SECRET");')],
    ["raw socket", duringCheck('const socket = process.getBuiltinModule("net").connect(9229,"127.0.0.1");')],
    ["caught computed builtin", 'try { globalThis["pro"+"cess"]["getBuiltin"+"Module"]("net"); } catch {}' + source],
    ["late caught builtin", source.replace("const fetchPath = input.fetch.bind(globalThis);", 'try { process.getBuiltinModule("fs"); } catch {} const fetchPath = input.fetch.bind(globalThis);')],
    ["dynamic constructor", duringCheck('const f = (()=>{}).constructor("return import(\\"node:fs\\")"); f();')],
    ["caught computed constructor", 'try { (()=>{})["constr"+"uctor"]("return import(\\"node:fs\\")")(); } catch {}' + source],
    ["async constructor", 'try { (async()=>{})["constr"+"uctor"]("return import(\\"node:fs\\")")(); } catch {}' + source],
    ["generator constructor", 'try { (function*(){})["constr"+"uctor"]("yield import(\\"node:fs\\")")(); } catch {}' + source],
    ["async generator constructor", 'try { (async function*(){})["constr"+"uctor"]("yield import(\\"node:fs\\")")(); } catch {}' + source],
    ["caught indirect eval", 'try { globalThis["ev"+"al"]("import(\\"node:fs\\")"); } catch {}' + source],
    ["console override then caught builtin", 'globalThis.console = {warn(){},log(){}}; try { process.getBuiltinModule("net"); } catch {}' + source],
    ["prototype mutation then caught builtin", 'Object.getPrototypeOf(()=>{}).bind = ()=>()=>{}; Object.getPrototypeOf(()=>{}).call = ()=>{}; try { process.getBuiltinModule("net"); } catch {}' + source],
    ["guard marker mimic", 'console.warn("RSI_NATIVE_FORBIDDEN_API");' + source],
    ["late caught constructor", source.replace("const fetchPath = input.fetch.bind(globalThis);", 'try { (()=>{})["constr"+"uctor"]("return 1")(); } catch {} const fetchPath = input.fetch.bind(globalThis);')],
    ["timer exhaustion", source.replace("const fetchPath = input.fetch.bind(globalThis);", 'await new Promise(resolve => setTimeout(resolve, 60000)); const fetchPath = input.fetch.bind(globalThis);')],
    ["oversized response", 'export async function runRsiPublicPathCheck(){ return "x".repeat(100000); }'],
    ["infinite loop", source.replace("const fetchPath = input.fetch.bind(globalThis);", "while(true) {} const fetchPath = input.fetch.bind(globalThis);")],
    ["output flood", 'for(let i=0;i<50000;i++) console.log("synthetic-output".repeat(100));' + source],
    ["memory exhaustion", source.replace("const fetchPath = input.fetch.bind(globalThis);", 'const a=[]; while(true) a.push(new Uint8Array(1024*1024).fill(1)); const fetchPath = input.fetch.bind(globalThis);')],
  ])("rejects actual %s candidate", async (name, value) => {
    const executor = await actualExecutor();
    const result = await executor.evaluate({ ...request(value), fixture: name === "weakened check" ? "HTTP_FAILURE" : name === "auth weakening" ? "AUTH_REDIRECT_FAILURE" : "NATIVE_RECEIVER" });
    record(name, result);
    expect(result.verdict).not.toBe("PASS");
    expect(result.verdict).not.toBe("NO_CHANGE");
    expect(JSON.stringify(result)).not.toContain("secret=synthetic");
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_STACK_SECRET");
    if (["timer exhaustion", "infinite loop"].includes(name)) {
      expect(result.verdict).toBe("FAIL"); expect(result.reason).toBe("RESOURCE_DEADLINE");
      expect(result.provenance).toMatchObject({ dispatchAttempts: 1, deadlineExpired: true, disposalConfirmed: true, cleanupConfirmed: true });
    } else if (name === "output flood") {
      expect(result.verdict).toBe("UNKNOWN"); expect(result.reasonCode).toBe("EXECUTION_EXIT_74");
    } else if (name === "memory exhaustion") {
      expect(result.verdict === "FAIL" || (result.verdict === "UNKNOWN" && /^EXECUTION_EXIT_(79|124|137)$|^RSI_SANDBOX_TIMEOUT$/.test(result.reasonCode))).toBe(true);
    } else {
      expect(result.verdict).toBe("FAIL");
      expect(result.provenance).toMatchObject({ childSpawns: 1, dispatchAttempts: 1, cleanupConfirmed: true });
      if (/builtin|constructor|indirect eval|host filesystem|raw socket/.test(name)) {
        expect(result.reason).toBe("CANDIDATE_LOG");
        expect(result.provenance.logs.forbiddenMarkerCount).toBeGreaterThan(0);
      }
    }
  }, 60000);
  it("rejects imports, path and hashes before candidate dispatch on the actual capability", async () => {
    const executor = await actualExecutor();
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
  it("records bounded command phases and exact absence for a startup-failure remeasurement", async () => {
    const commands: { command: string; elapsedMs: number; code?: number; failure?: string; stdoutBytes?: number; stderrBytes?: number; stdoutDigest?: string; stderrDigest?: string; deadlineMs: number }[] = [];
    const owned: { name: string; owner: string; id: string }[] = [];
    const transport: DockerTransport = async (args, stdin, limits) => {
      const started = performance.now();
      try {
        const value = await dockerTransport(args, stdin, limits);
        commands.push({ command: args[0], elapsedMs: Math.ceil(performance.now() - started), code: value.code, deadlineMs: limits.timeoutMs,
          stdoutBytes: Buffer.byteLength(value.stdout), stderrBytes: Buffer.byteLength(value.stderr), stdoutDigest: hash(value.stdout), stderrDigest: hash(value.stderr) });
        if (args[0] === "create" && value.code === 0) owned.push({ name: args[args.indexOf("--name") + 1], owner: args[args.indexOf("--label") + 1].split("=")[1], id: value.stdout.trim() });
        return value;
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        commands.push({ command: args[0], elapsedMs: Math.ceil(performance.now() - started), failure: /^RSI_SANDBOX_[A-Z_]+$/.test(message) ? message : "OPAQUE", deadlineMs: limits.timeoutMs });
        throw error;
      }
    };
    const executor = await NativeExecutor.verify(manifest(), transport);
    const result = await executor.evaluate({ ...request('throw new Error("SYNTHETIC_STACK_SECRET");' + source), fixture: "NATIVE_RECEIVER" });
    record("stack-failure-injected-remeasurement", { result, commands, owned, underlyingCli: true });
    expect(result.verdict).toBe("UNKNOWN"); expect(result.reasonCode).toBe("EXECUTION_EXIT_88");
    let absenceChecks = 0;
    for (const row of owned) {
      expect((await dockerTransport(["inspect", row.id], "", { timeoutMs: 5000, maxOutputBytes: 65536 })).code).not.toBe(0); absenceChecks++;
    }
    record("stack-failure-injected-exact-absence", { absenceChecks, ownedIds: owned.map(row => row.id), underlyingCli: true });
  }, 45000);
  it("distinguishes an unexecuted late timer from a blocked API invocation", async () => {
    const executor = await actualExecutor();
    const value = duringCheck('setTimeout(()=>process.getBuiltinModule("net"),60000);');
    const result = await executor.evaluate({ ...request(value), fixture: "NATIVE_RECEIVER" });
    record("late-timer-not-observed-before-disposal", result);
    expect(result.verdict).toBe("PASS");
    expect(result.provenance).toMatchObject({ callCount: 6, logs: { valid: true, rejectedCount: 0 }, cleanupConfirmed: true });
  }, 30000);
  it.runIf(process.env.RSI_NATIVE_DIAGNOSIS === "1")("diagnoses at most eight fixed NORMAL lifecycles with bounded command phases", async () => {
    const commands: Record<string, unknown>[] = [];
    const owned = new Map<string, { id: string; name: string; owner: string }>();
    const transport: DockerTransport = async (args, stdin, limits) => {
      const start = performance.now();
      try {
        const result = await dockerTransport(args, stdin, limits);
        const row: Record<string, unknown> = { command: args[0], elapsedMs: Math.ceil(performance.now() - start), deadlineMs: limits.timeoutMs, code: result.code, stdoutBytes: Buffer.byteLength(result.stdout), stderrBytes: Buffer.byteLength(result.stderr), stdoutDigest: hash(result.stdout), stderrDigest: hash(result.stderr) };
        if (args[0] === "create" && result.code === 0) {
          const name = args[args.indexOf("--name") + 1];
          owned.set(name, { id: result.stdout.trim(), name, owner: args[args.indexOf("--label") + 1].split("=")[1] });
        }
        if (args[0] === "inspect") {
          const expected = owned.get(args[1]);
          try {
            const parsed = JSON.parse(result.stdout), actual = parsed[0];
            row.jsonValid = true; row.singleRow = Array.isArray(parsed) && parsed.length === 1;
            row.nameMatches = actual?.Name === `/${expected?.name}`; row.idMatches = actual?.Id === expected?.id;
            row.ownerMatches = actual?.Config?.Labels?.["rsi.sandbox.owner"] === expected?.owner;
          } catch { row.jsonValid = false; }
        }
        commands.push(row); return result;
      } catch (error) {
        const code = error instanceof Error ? error.message : "";
        commands.push({ command: args[0], elapsedMs: Math.ceil(performance.now() - start), deadlineMs: limits.timeoutMs, failure: /^RSI_SANDBOX_[A-Z_]+$/.test(code) ? code : "OPAQUE" });
        throw error;
      }
    };
    const results: { verdict: string; reasonCode: string }[] = [];
    let failure = "", absenceChecks = 0;
    try {
      const executor = await NativeExecutor.verify(manifest(), transport);
      for (let count = 0; count < 8; count++) {
        const result = await executor.evaluate({ ...request(), fixture: "NORMAL" });
        results.push({ verdict: result.verdict, reasonCode: result.reasonCode });
        if (result.reasonCode === "RSI_SANDBOX_CLEANUP") break;
      }
    } catch (error) { failure = error instanceof Error && /^RSI_[A-Z_]+$/.test(error.message) ? error.message : "OPAQUE"; }
    finally {
      for (const row of owned.values()) {
        const current = await dockerTransport(["inspect", row.id], "", { timeoutMs: 5000, maxOutputBytes: 65536 });
        if (current.code === 0) {
          const actual = JSON.parse(current.stdout)[0];
          if (actual.Id !== row.id || actual.Name !== `/${row.name}` || actual.Config?.Labels?.["rsi.sandbox.owner"] !== row.owner) throw Error("OWNED_CLEANUP_MISMATCH");
          expect((await dockerTransport(["rm", "--force", row.id], "", { timeoutMs: 5000, maxOutputBytes: 65536 })).code).toBe(0);
        }
        expect((await dockerTransport(["inspect", row.id], "", { timeoutMs: 5000, maxOutputBytes: 65536 })).code).not.toBe(0); absenceChecks++;
      }
      record("bounded-normal-lifecycle-diagnosis", { transportKind: "INJECTED_TRANSPORT", underlyingCli: true, results, failure, commands, owned: [...owned.values()], absenceChecks });
    }
    expect(failure).toBe("");
    expect(results).toHaveLength(8);
    expect(results.every(row => row.reasonCode === "INJECTED_TRANSPORT")).toBe(true);
  }, 180000);
});
