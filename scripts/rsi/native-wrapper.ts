/** Trusted image entrypoint. This module never imports/evaluates candidate code
 * in Node: the only candidate execution sink is workerd's explicit module list. */
import { createHash } from "node:crypto";
import childProcess, { execFileSync } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { existsSync, readdirSync, readFileSync, realpathSync, lstatSync } from "node:fs";
import { rootCertificates } from "node:tls";
import { createRequire } from "node:module";
import { RSI_PUBLIC_PATHS } from "./contracts";
import { expectedRsiFixtureResponse, gradeRsiPublicPathCheck, rsiFixtureSchema, type RsiObservedCall } from "./oracle";

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
/** Compare against the pinned Node binary's embedded Mozilla snapshot, never
 * environment/system/default CA selection. The public bytes are not emitted. */
export function verifyNativePublicCa(bundle: Buffer) {
  const expected = Buffer.from(rootCertificates.join("\n") + "\n");
  if (!rootCertificates.length || !bundle.equals(expected)) throw new Error("RSI_NATIVE_PUBLIC_CA");
  return { publicCaDigest: hash(expected), publicCaCount: rootCertificates.length };
}
/** Trusted callbacks only. Keep the deadline through dispatch, disposal and
 * child pipe closure; an unresolved shutdown still fails at the outer watchdog. */
export async function withNativeWorkerdDeadline<T>(operation: () => Promise<T>, terminate: () => void) {
  let deadlineExpired = false;
  const timer = setTimeout(() => { deadlineExpired = true; terminate(); }, 12000);
  try { return { value: await operation(), deadlineExpired }; }
  finally { clearTimeout(timer); }
}
/** Observe workerd's raw pipes before Miniflare's presentation filters. A JS
 * console record cannot supply the C++ logger's top-level source field. The
 * fixed warning must still occur exactly once; matching extra records fail. */
export function createNativeLogGate(expectedSourceDigest = "92e682819efef622f66f2610b473213c00b60311f53e0d3a41c280bbb7fe25a2") {
  const decoders = { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") };
  const pending = { stdout: "", stderr: "" };
  const digest = createHash("sha256");
  let bytes = 0, warningCount = 0, rejectedCount = 0, forbiddenMarkerCount = 0, ready = false, finished = false, warningSourceDigest = "0".repeat(64);
  const rejectionCodes: string[] = [];
  return {
    push(stream: "stdout" | "stderr", chunk: Buffer) {
      if (finished) throw new Error("RSI_NATIVE_LOG_CLOSED");
      bytes += chunk.length;
      if (bytes > 32768) throw new Error("RSI_NATIVE_LOG_LIMIT");
      digest.update(chunk); pending[stream] += decoders[stream].write(chunk);
      for (;;) {
        const end = pending[stream].indexOf("\n"); if (end < 0) break;
        const line = pending[stream].slice(0, end); pending[stream] = pending[stream].slice(end + 1);
        try {
          const entry = JSON.parse(line);
          if (typeof entry?.message === "string" && hash(entry.message) === hash("RSI_NATIVE_FORBIDDEN_API")) forbiddenMarkerCount++;
          if (typeof entry?.source === "string" && hash(String(entry.message)) === "64fece35c0759aa79ea14d8c6eaa120bb1c9ea4f7c96dfc86e7399b3c80fc4a2") warningSourceDigest = hash(entry.source);
          const bad = !entry || !Object.keys(entry).every(key => ["timestamp", "level", "source", "message", "context_depth"].includes(key)) ? "FIELDS"
            : !/^(?:0|[1-9][0-9]{0,15})$/.test(String(entry.timestamp)) ? "TIMESTAMP"
            : entry.level !== "warn" ? "LEVEL"
            : typeof entry.source !== "string" || hash(entry.source) !== expectedSourceDigest ? "SOURCE"
            : entry.context_depth !== undefined && entry.context_depth !== 0 ? "CONTEXT"
            : typeof entry.message !== "string" || Buffer.byteLength(entry.message) !== 134 || hash(entry.message) !== "64fece35c0759aa79ea14d8c6eaa120bb1c9ea4f7c96dfc86e7399b3c80fc4a2" ? "MESSAGE" : "";
          const known = bad === "";
          if (known) { warningCount++; warningSourceDigest = hash(entry.source); }
          if (!known || ready || warningCount !== 1) { rejectedCount++; if (rejectionCodes.length < 8) rejectionCodes.push(bad || (ready ? "LATE" : "DUPLICATE")); }
        } catch { rejectedCount++; }
      }
    },
    markReady() { ready = true; },
    finish() {
      if (finished) throw new Error("RSI_NATIVE_LOG_CLOSED");
      finished = true;
      for (const stream of ["stdout", "stderr"] as const) if (pending[stream] + decoders[stream].end()) rejectedCount++;
      return { valid: warningCount === 1 && rejectedCount === 0, warningCount, rejectedCount, forbiddenMarkerCount, bytes, digest: digest.digest("hex"), warningSourceDigest, rejectionCodes };
    },
  };
}
/** Categories are clues only, never a root-cause claim. No raw text leaves Node. */
export function classifyNativeStartupError(error: unknown) {
  const message = error instanceof Error ? error.message.slice(0, 32768) : "";
  const clues = [
    ["TYPE", /TypeError/], ["MODULE", /\bmodule\b/i], ["SERVICE", /\bservice\b/i],
    ["SOCKET", /\bsocket\b/i], ["SYSTEM_CALL", /syscall|prctl|mmap|mprotect|memfd|seccomp/i],
    ["FILESYSTEM", /file|directory|path/i], ["SYMBOL", /symbol|GLIBC/i],
    ["COMPATIBILITY", /compatibility|flag/i], ["SCHEMA", /schema|capnp/i],
    ["V8_ENGINE", /\bv8\b|isolate|heap/i], ["CRYPTOGRAPHY", /ssl|tls|certificate|crypto|entropy/i],
    ["NETWORK", /network|dns|host|address/i], ["RESOURCE", /resource|limit|thread|memory/i],
    ["UNSUPPORTED", /not supported|unsupported|not implemented|unimplemented/i],
    ["NOT_FOUND", /not found|no such|missing/i], ["EXPECTATION", /expected|assert/i],
    ["TLS", /\btls\b|\bssl\b|boringssl/i], ["CERTIFICATES", /certificat/i],
    ["ENTROPY", /entropy|random/i], ["NODE_COMPAT", /nodejs_compat|node:crypto|nodejsCrypto/i],
    ["WEB_CRYPTO", /webcrypto|web.crypto|strict_crypto/i],
    ["UNKNOWN_FLAG", /no such compatibility flag|unrecognized.*flag|unknown.*flag/i],
    ["CONTRADICTORY_FLAGS", /mutually contradictory|flag specified multiple times/i],
  ] as const;
  const category = /too many open files|EMFILE|ENFILE/i.test(message) ? "FD_LIMIT"
    : /read-only file system|EROFS/i.test(message) ? "READ_ONLY"
    : /no space left on device|ENOSPC/i.test(message) ? "TEMP_SPACE"
    : /pthread_create|unable to create.*thread|thread.*resource temporarily unavailable/i.test(message) ? "THREAD_LIMIT"
    : /operation not permitted|permission denied|\bEPERM\b|\bEACCES\b/i.test(message) ? "PERMISSION"
    : /address family not supported|cannot assign requested address|network is unreachable|EADDRNOTAVAIL|EAFNOSUPPORT|\bIPv6\b|\blisten\b|\bbind\b/i.test(message) ? "LISTENER"
    : /SIGSYS|SIGILL|SIGABRT|\babort(?:ed)?\b/i.test(message) ? "SIGNAL"
    : /unknown field|unknown.*configuration|unsupported.*protocol|unrecognized.*flag|unknown.*flag|schema mismatch|no such module|does not export|SyntaxError|ReferenceError/i.test(message) ? "CONFIG_PROTOCOL" : "OTHER";
  const locations = [...message.matchAll(/\b((?:workerd\/(?:server|io|api|jsg|util)|kj|v8)\/[a-zA-Z0-9_/-]+\.(?:c\+\+|cc|h))[:(](\d{1,7})\b/g)].slice(0, 4).map(match => ({ file: match[1], line: Number(match[2]) }));
  return { category, bytes: Buffer.byteLength(message), digest: hash(message), clues: clues.filter(([, pattern]) => pattern.test(message)).map(([name]) => name), locations };
}
export const NATIVE_RUNTIME = Object.freeze({ node: "v22.23.2", miniflare: "5.20260730.0-alpha", workerd: "1.20261022.1", workerdBinaryVersion: "workerd 2026-10-22", platform: "linux/arm64", supportedCompatibilityDate: "2026-10-22", compatibilityDate: "2026-08-05", compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"] });
/** First dependency of the trusted entry module. Its lexical references never
 * enter the candidate module; the pristine bound logger survives mutation of
 * candidate globals/prototypes and makes caught forbidden calls observable. */
export const NATIVE_GUARD = `import process from 'node:process';
const define = Object.defineProperty;
const prototype = Object.getPrototypeOf;
const notify = console.warn.bind(console);
const GuardError = Error;
const deny = () => { notify('RSI_NATIVE_FORBIDDEN_API'); throw new GuardError('RSI_NATIVE_FORBIDDEN_API'); };
const constructors = [Function, prototype(async function(){}).constructor, prototype(function*(){}).constructor, prototype(async function*(){}).constructor];
for (const constructor of constructors) {
  define(constructor.prototype, 'constructor', {value:deny, writable:false, configurable:false});
}
define(process, 'getBuiltinModule', {value:deny, writable:false, configurable:false});
define(globalThis, 'Function', {value:deny, writable:false, configurable:false});
define(globalThis, 'eval', {value:deny, writable:false, configurable:false});`;
export const NATIVE_HARNESS = `import './guard.mjs';
import {runRsiPublicPathCheck} from './candidate.mjs';
export default { async fetch() {
  return Response.json(await runRsiPublicPathCheck({fetch, origin:'https://rsi.invalid'}));
}};`;
// Fixed bootstrap phases only; never include exception messages or stacks.
let failureExit = 73;

async function main() {
  const write = process.stdout.write.bind(process.stdout);
  const exit = process.exit.bind(process);
  let suppressedBytes = 0;
  // Never forward candidate logs, stacks or workerd diagnostics to host IPC.
  const discard = (chunk: unknown) => {
    suppressedBytes += Buffer.byteLength(typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk : "");
    if (suppressedBytes > 32768) exit(74);
    return true;
  };
  process.stdout.write = discard as typeof process.stdout.write;
  process.stderr.write = discard as typeof process.stderr.write;
  for (const key of Object.keys(process.env)) delete process.env[key];
  process.env.TMPDIR = "/tmp";
  process.env.HOME = "/tmp";
  const require = createRequire(import.meta.url);
  const fromWrangler = createRequire(require.resolve("wrangler"));
  const fromMiniflare = createRequire(fromWrangler.resolve("miniflare"));
  const workerdPath = realpathSync(fromMiniflare("workerd").default);
  if (!workerdPath.startsWith("/opt/rsi/node_modules/") || !workerdPath.endsWith("/bin/workerd")) exit(75);
  const caPath = "/etc/ssl/certs/ca-certificates.crt";
  const caStat = lstatSync(caPath);
  if (!caStat.isFile() || caStat.uid !== 0 || (caStat.mode & 0o777) !== 0o444) exit(75);
  const publicCaIdentity = verifyNativePublicCa(readFileSync(caPath));
  const runtime = {
    ...publicCaIdentity,
    ...NATIVE_RUNTIME, node: process.version, platform: `${process.platform}/${process.arch}`,
    miniflare: fromWrangler("miniflare/package.json").version,
    workerd: fromMiniflare("workerd/package.json").version,
    workerdBinaryVersion: execFileSync(workerdPath, ["--version"], { env: {}, timeout: 2000, maxBuffer: 1024, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(),
    supportedCompatibilityDate: fromMiniflare("workerd").compatibilityDate,
    workerdDigest: hash(readFileSync(workerdPath)),
  };
  if (runtime.node !== NATIVE_RUNTIME.node || runtime.miniflare !== NATIVE_RUNTIME.miniflare || runtime.workerd !== NATIVE_RUNTIME.workerd || runtime.platform !== NATIVE_RUNTIME.platform
    || runtime.workerdBinaryVersion !== NATIVE_RUNTIME.workerdBinaryVersion || runtime.supportedCompatibilityDate !== NATIVE_RUNTIME.supportedCompatibilityDate) exit(75);
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) { raw += chunk; if (Buffer.byteLength(raw) > 100000) exit(71); }
  const request = JSON.parse(raw);
  if (request.operation === "probe" && Object.keys(request).length === 1) {
    write(JSON.stringify({ schemaVersion: 1, runtime }) + "\n"); return;
  }
  const diagnostic = ["diagnostic", "diagnostic-regression"].includes(request.operation) && Object.keys(request).length === 1;
  if (!diagnostic && (request.operation !== "evaluate" || typeof request.script !== "string" || Buffer.byteLength(request.script) > 80000
    || hash(request.script) !== request.compiledDigest || !/^[a-f0-9]{64}$/.test(request.sourceDigest))) exit(71);
  const fixture = rsiFixtureSchema.parse(diagnostic ? "NORMAL" : request.fixture);
  // Loaded only in the immutable container, never while importing this host module.
  failureExit = 76;
  const logGate = createNativeLogGate();
  const originalSpawn = childProcess.spawn;
  let spawned = 0;
  let workerdChild: ReturnType<typeof childProcess.spawn> | undefined;
  let childClosed: Promise<void> | undefined;
  childProcess.spawn = ((...args: Parameters<typeof childProcess.spawn>) => {
    if (args[0] !== workerdPath || spawned !== 0) throw new Error("RSI_NATIVE_CHILD_REJECTED");
    spawned++;
    const child = Reflect.apply(originalSpawn, childProcess, args) as ReturnType<typeof childProcess.spawn>;
    workerdChild = child;
    if (!child.stdout || !child.stderr) throw new Error("RSI_NATIVE_CHILD_PIPES");
    for (const stream of ["stdout", "stderr"] as const) child[stream]!.on("data", (chunk: Buffer) => {
      try { logGate.push(stream, chunk); } catch { exit(74); }
    });
    childClosed = new Promise(resolve => child.once("close", () => resolve()));
    return child;
  }) as typeof childProcess.spawn;
  try {
  const { Miniflare, Log, LogLevel } = fromWrangler("miniflare");
  const calls: RsiObservedCall[] = [];
  let rejectedCall = false, candidateLog = false, runtimeError = false;
  const started = performance.now();
  const startupLogs: ReturnType<typeof classifyNativeStartupError>[] = [];
  const observeLog = (entry: { message: string }) => {
    if (diagnostic && startupLogs.length < 8) startupLogs.push(classifyNativeStartupError(new Error(entry.message)));
    // Presentation callback is diagnostic only: Miniflare can filter records.
    // Security accounting happens on the raw child pipes above.
  };
  if (diagnostic) process.once("uncaughtException", error => {
    write(JSON.stringify({ schemaVersion: 1, runtime, fatal: classifyNativeStartupError(error) }) + "\n");
    exit(0); // Diagnostic only. Backend removal is still mandatory; no candidate verdict.
  });
  failureExit = 77;
  const mf = new Miniflare(request.operation === "diagnostic-regression" ? {
    modules: true, script: 'export default {fetch(){return new Response("trusted-bootstrap");}};',
    compatibilityDate: NATIVE_RUNTIME.compatibilityDate, compatibilityFlags: NATIVE_RUNTIME.compatibilityFlags,
    cf: false, handleStructuredLogs: observeLog,
    handleUncaughtError: () => { runtimeError = true; },
    log: new Log(LogLevel.NONE),
    outboundService: () => new Response("synthetic fixture"),
  } : {
    modulesRoot: "/virtual", modules: diagnostic ? [
      { type: "ESModule", path: "/virtual/entry.mjs", contents: 'export default {fetch(){return new Response("trusted-bootstrap");}};' },
    ] : [
      { type: "ESModule", path: "/virtual/entry.mjs", contents: NATIVE_HARNESS },
      { type: "ESModule", path: "/virtual/guard.mjs", contents: NATIVE_GUARD },
      { type: "ESModule", path: "/virtual/candidate.mjs", contents: request.script },
    ],
    compatibilityDate: NATIVE_RUNTIME.compatibilityDate, compatibilityFlags: NATIVE_RUNTIME.compatibilityFlags,
    cf: false, telemetry: { enabled: false }, logRequests: false,
    log: new Log(LogLevel.NONE), inspectorPort: undefined,
    unsafeDevRegistryPath: undefined, unsafeLocalExplorer: false,
    handleStructuredLogs: observeLog,
    handleUncaughtError: () => { runtimeError = true; },
    outboundService: (request: Request) => {
      // Parse but never retain/return original URL, query, headers, body or error.
      const url = new URL(request.url);
      const path = RSI_PUBLIC_PATHS.find(path => path === url.pathname);
      const allowed = url.origin === "https://rsi.invalid" && url.search === "" && url.username === "" && url.password === "";
      if (calls.length >= 6) { rejectedCall = true; return new Response(null, { status: 403 }); }
      const expected = path && allowed && request.method === "GET"
        ? expectedRsiFixtureResponse(fixture, path) : { status: 403, location: "" as const };
      calls.push({ path: path ?? "OUTSIDE_ALLOWLIST", method: request.method === "GET" ? "GET" : "OTHER", status: expected.status, location: expected.location, originAllowed: allowed });
      if (!path || !allowed || request.method !== "GET") rejectedCall = true;
      return new Response(null, { status: expected.status, headers: expected.location ? { Location: expected.location } : {} });
    },
  });
  if (diagnostic) {
    let ready: ReturnType<typeof classifyNativeStartupError> | null = null;
    let disposal: ReturnType<typeof classifyNativeStartupError> | null = null;
    try { await mf.ready; logGate.markReady(); } catch (error) { ready = classifyNativeStartupError(error); }
    try { await mf.dispose(); } catch (error) { disposal = classifyNativeStartupError(error); }
    await childClosed;
    const logs = logGate.finish();
    const publicCa = { directoryPresent: existsSync("/etc/ssl/certs"), entries: 0,
      bundlePresent: existsSync("/etc/ssl/certs/ca-certificates.crt"), certificates: 0 };
    if (publicCa.directoryPresent) publicCa.entries = readdirSync("/etc/ssl/certs").length;
    if (publicCa.bundlePresent) publicCa.certificates = (readFileSync("/etc/ssl/certs/ca-certificates.crt", "utf8").match(/-----BEGIN CERTIFICATE-----/g) ?? []).length;
    write(JSON.stringify({ schemaVersion: 1, runtime, diagnostic: { ready, disposal, startupLogs, publicCa,
      candidateDispatches: 0, elapsedMs: Math.ceil(performance.now() - started), suppressedBytes, logs, childSpawns: spawned,
      peakMemoryBytes: Number(readFileSync("/sys/fs/cgroup/memory.peak", "utf8").trim()) } }) + "\n");
    return;
  }
  failureExit = 88;
  try { await mf.ready; logGate.markReady(); } catch { try { await mf.dispose(); } catch { /* backend still removes the container */ } throw new Error("RSI_NATIVE_READY"); }
  let body: unknown = null, dispatchAttempts = 0, deadlineExpired = false, disposalConfirmed = true;
  failureExit = 78;
  // This inner workerd deadline leaves bounded disposal time inside the
  // unchanged 15s container watchdog. Only the verified child is terminated.
  const execution = await withNativeWorkerdDeadline(async () => {
  try {
    dispatchAttempts++;
    const response = await mf.dispatchFetch("http://local.invalid/");
    const reader = response.body?.getReader();
    let text = "", bytes = 0;
    if (reader) for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength; if (bytes > 16000) { await reader.cancel(); throw new Error("BOUNDED"); }
      text += new TextDecoder().decode(value);
    }
    body = JSON.parse(text);
  } catch { runtimeError = true; }
  finally {
    failureExit = 79;
    try { await mf.dispose(); } catch { disposalConfirmed = false; runtimeError = true; }
  }
  await childClosed;
  }, () => { workerdChild?.kill("SIGKILL"); });
  deadlineExpired = execution.deadlineExpired;
  const logs = logGate.finish();
  candidateLog = !logs.valid || spawned !== 1;
  failureExit = 80;
  const grade = gradeRsiPublicPathCheck(fixture, body, calls);
  if (rejectedCall || candidateLog || runtimeError || deadlineExpired || suppressedBytes > 0) {
    grade.verdict = "FAIL"; grade.reasonCode = "ORACLE_MISMATCH"; grade.greenVerified = false;
  }
  write(JSON.stringify({ schemaVersion: 1, grade, runtime, sourceDigest: request.sourceDigest, compiledDigest: request.compiledDigest,
    traceDigest: hash(JSON.stringify(calls)), responseDigest: hash(JSON.stringify(body)),
    callCount: calls.length, dispatchAttempts, deadlineExpired, disposalConfirmed, logs, childSpawns: spawned, elapsedMs: Math.ceil(performance.now() - started),
    peakMemoryBytes: Number(readFileSync("/sys/fs/cgroup/memory.peak", "utf8").trim()),
    reason: deadlineExpired ? "RESOURCE_DEADLINE" : candidateLog ? "CANDIDATE_LOG" : rejectedCall ? "OUTBOUND_REJECTED" : runtimeError ? "RUNTIME_FAILURE" : "ORACLE_RESULT" }) + "\n");
  } finally { childProcess.spawn = originalSpawn; }
}

if (process.argv[1] === "/opt/rsi/native-wrapper.mjs") {
  main().catch((error: unknown) => {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    const categories = ["EACCES", "EROFS", "EMFILE", "ENOENT", "ERR_RUNTIME_FAILURE", "EADDRNOTAVAIL", "ENOSPC"];
    const index = categories.indexOf(typeof code === "string" ? code : "");
    process.exit(index < 0 ? failureExit : 81 + index);
  });
}
