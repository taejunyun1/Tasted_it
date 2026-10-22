import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, normalize } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { types } from "node:util";
import { z } from "zod";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function fail(code: string): never { throw new Error(`RSI_SANDBOX_${code}`); }
const boundedInt = z.number().int().min(0).max(86400000), time = boundedInt.nullable();
const errorCode = z.enum(["EPIPE", "ENOENT", "EACCES", "EPERM", "ECONNRESET", "ABORT_ERR", "OTHER"]);
const signal = z.enum(["SIGKILL", "SIGTERM", "SIGINT", "SIGABRT", "SIGSEGV", "SIGPIPE", "SIGSYS", "SIGHUP", "SIGQUIT", "OTHER"]).nullable();
const phase = z.enum(["SELECT", "VERIFY", "CREATE", "INSPECT", "START", "CLEANUP_INSPECT", "CLEANUP_RM", "OTHER"]);
const pipeSchema = z.strictObject({ bytes: z.number().int().min(0).max(65537), chunks: boundedInt, firstMs: time, lastMs: time, endMs: time, closeMs: time, error: errorCode.nullable() });
const processEventSchema = z.strictObject({ atMs: time, code: z.number().int().min(-2147483648).max(2147483647).nullable(), signal });
export const dockerCommandLifecycleSchema = z.strictObject({
  schemaVersion: z.literal(1), command: z.enum(["CONTEXT", "INFO", "IMAGE_INSPECT", "CREATE", "INSPECT", "START", "RM", "BUILD", "OTHER"]),
  ordinal: z.number().int().min(1).max(1000000), phase, timeoutMs: z.number().int().min(1).max(600000), elapsedMs: boundedInt,
  spawn: z.strictObject({ invoked: z.literal(true), observed: z.boolean().nullable(), error: errorCode.nullable() }),
  stdin: z.strictObject({ endInvoked: z.boolean(), callback: z.boolean().nullable(), finish: z.boolean().nullable(), drainCount: z.number().int().min(0).max(64), error: errorCode.nullable() }),
  stdout: pipeSchema, stderr: pipeSchema, exit: processEventSchema, close: processEventSchema,
  timer: z.strictObject({ firedMs: time }), kill: z.strictObject({ requestedMs: time, returned: z.boolean().nullable(), error: errorCode.nullable() }),
  nativeReady: z.literal("UNOBSERVED"), nativeDispatch: z.literal("UNOBSERVED"), observerError: z.boolean(),
  events: z.array(z.strictObject({ kind: z.enum(["SPAWN_INVOKED", "SPAWN", "SPAWN_ERROR", "STDIN_END", "STDIN_CALLBACK", "STDIN_FINISH", "STDIN_DRAIN", "STDIN_ERROR", "STDOUT_END", "STDOUT_ERROR", "STDOUT_CLOSE", "STDERR_END", "STDERR_ERROR", "STDERR_CLOSE", "EXIT", "CLOSE", "TIMER", "KILL_REQUEST", "KILL_RETURN", "KILL_ERROR"]), atMs: boundedInt })).max(64),
});
export type DockerCommandLifecycle = z.infer<typeof dockerCommandLifecycleSchema>;
export type DockerLifecycleObserver = (snapshot: Readonly<DockerCommandLifecycle>) => unknown;
export const containerFailureFrameSchema = z.strictObject({ frameKind: z.enum(["NONE", "PARTIAL", "INVALID", "PROBE", "DIAGNOSTIC", "EVALUATION"]),
  digest: z.string().regex(/^[a-f0-9]{64}$/).nullable(), completeJSON: z.boolean().nullable(), schemaMatch: z.boolean().nullable(), bindingMatch: z.boolean().nullable() });
export const containerTransportDiagnosticSchema = z.strictObject({ commands: z.array(dockerCommandLifecycleSchema).max(5),
  cleanup: z.strictObject({ inspectReturned: z.boolean().nullable(), nameMatch: z.boolean().nullable(), ownerMatch: z.boolean().nullable(), idMatch: z.boolean().nullable(), rmInvoked: z.boolean(), rmReturned: z.boolean().nullable() }) });
// Descriptor-only snapshot: never execute a proxy trap, accessor, toJSON or coercion.
export function decodeContainerDiagnostic<Schema extends z.ZodType>(schema: Schema, raw: unknown): z.output<Schema> | undefined {
  let budget = 4096;
  function copy(value: unknown, depth = 0): unknown {
    if (--budget < 0 || depth > 9) throw Error();
    if (value === null || typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value === "string" && value.length <= 64) return value;
    if (!value || typeof value !== "object" || types.isProxy(value)) throw Error();
    const array = Array.isArray(value);
    if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) throw Error();
    const length = array ? Object.getOwnPropertyDescriptor(value, "length") : undefined;
    if (array && (!length || !("value" in length) || !Number.isInteger(length.value) || length.value < 0 || length.value > 64)) throw Error();
    const keys = Reflect.ownKeys(value);
    if (keys.length > (array ? 65 : 24) || (array && keys.length !== length!.value + 1)) throw Error();
    const result: Record<string, unknown> | unknown[] = array ? [] : {};
    for (const key of keys) {
      if (array && key === "length") continue;
      if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key) || (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length!.value))) throw Error();
      const item = Object.getOwnPropertyDescriptor(value, key)!;
      if (!item.enumerable || !("value" in item)) throw Error();
      Object.defineProperty(result, key, { value: copy(item.value, depth + 1), enumerable: true, configurable: true, writable: true });
    }
    if (array && length!.value !== (result as unknown[]).length) throw Error();
    return result;
  }
  try { return freezeDiagnostic(schema.parse(copy(raw))); } catch { return undefined; }
}
function freezeDiagnostic<T>(value: T): T {
  if (value && typeof value === "object") { for (const item of Object.values(value)) freezeDiagnostic(item); Object.freeze(value); }
  return value;
}
const failedOutput = new WeakMap<Error, { stdout: string; truncated: boolean }>();
/** @internal Fixed native adapter only. Raw custody is consumed once, never an Error property. */
export function classifyContainerFailure(error: unknown, classifier: (stdout: string, truncated: boolean) => unknown) {
  if (!error || typeof error !== "object" || types.isProxy(error) || !(error instanceof Error)) return undefined;
  const output = failedOutput.get(error); failedOutput.delete(error);
  if (!output) return undefined;
  try { const parsed = decodeContainerDiagnostic(containerFailureFrameSchema, classifier(output.stdout, output.truncated)); return parsed ? freezeDiagnostic(parsed) as z.infer<typeof containerFailureFrameSchema> : undefined; }
  catch { return undefined; }
}
function transferOutput(from: unknown, to: Error) {
  if (from && typeof from === "object" && !types.isProxy(from) && from instanceof Error) { const output = failedOutput.get(from); if (output) { failedOutput.delete(from); failedOutput.set(to, output); } }
  return to;
}
export const containerCommandFailureSchema = z.strictObject({ failure: z.enum(["TIMEOUT", "OUTPUT_LIMIT", "UNAVAILABLE", "EXIT", "OTHER"]),
  stdoutBytes: z.number().int().min(0).max(65537).optional(), stderrBytes: z.number().int().min(0).max(65537).optional(), lifecycle: dockerCommandLifecycleSchema.optional() });
export const containerCleanupFailureSchema = z.strictObject({
  stage: z.enum(["INSPECT_TRANSPORT", "INSPECT_EXIT", "INSPECT_JSON", "INSPECT_OWNERSHIP", "RM_TRANSPORT", "RM_EXIT"]),
  failure: z.enum(["TIMEOUT", "OUTPUT_LIMIT", "UNAVAILABLE", "EXIT", "INVALID_JSON", "OWNERSHIP", "OTHER"]),
  command: containerCommandFailureSchema.optional(), startFailure: containerCommandFailureSchema.optional(), transport: containerTransportDiagnosticSchema.optional(),
});
export const containerFailureDiagnosticSchema = z.union([containerCleanupFailureSchema, z.strictObject({ startFailure: containerCommandFailureSchema, transport: containerTransportDiagnosticSchema.optional() })]);
type CleanupStage = z.infer<typeof containerCleanupFailureSchema>["stage"];
type CleanupFailure = z.infer<typeof containerCleanupFailureSchema>["failure"];
const knownCleanupCauses = new WeakSet<object>();
function diagnosedError(message: string, detail: z.infer<typeof containerFailureDiagnosticSchema>) {
  const cause = freezeDiagnostic(detail); knownCleanupCauses.add(cause);
  return new Error(message, { cause });
}
function cleanupError(stage: CleanupStage, failure: CleanupFailure, command?: z.infer<typeof containerCommandFailureSchema>) {
  return diagnosedError("RSI_SANDBOX_CLEANUP", { stage, failure, ...(command ? { command } : {}) });
}
function cleanupCause(error: unknown) {
  if (!error || typeof error !== "object" || types.isProxy(error) || !(error instanceof Error)) return undefined;
  const cause: unknown = Object.getOwnPropertyDescriptor(error, "cause")?.value;
  return cause && typeof cause === "object" && knownCleanupCauses.has(cause) ? cause : undefined;
}
function transportFailure(error: unknown): CleanupFailure {
  const message = error && typeof error === "object" && !types.isProxy(error) && error instanceof Error ? Object.getOwnPropertyDescriptor(error, "message")?.value : "";
  return message === "RSI_SANDBOX_TIMEOUT" ? "TIMEOUT" : message === "RSI_SANDBOX_OUTPUT_LIMIT" ? "OUTPUT_LIMIT"
    : message === "RSI_SANDBOX_UNAVAILABLE" ? "UNAVAILABLE" : "OTHER";
}
function safeSandboxMessage(error: unknown) {
  const message = error && typeof error === "object" && !types.isProxy(error) && error instanceof Error ? Object.getOwnPropertyDescriptor(error, "message")?.value : undefined;
  return ["RSI_SANDBOX_TIMEOUT", "RSI_SANDBOX_OUTPUT_LIMIT", "RSI_SANDBOX_UNAVAILABLE", "RSI_SANDBOX_BLOCKED", "RSI_SANDBOX_IPC", "RSI_SANDBOX_CLEANUP"].includes(message) ? message as string : "RSI_SANDBOX_UNAVAILABLE";
}
function commandFailure(error: unknown): z.infer<typeof containerCommandFailureSchema> {
  const failure = transportFailure(error) as "TIMEOUT" | "OUTPUT_LIMIT" | "UNAVAILABLE" | "OTHER";
  const cause: unknown = error && typeof error === "object" && !types.isProxy(error) && error instanceof Error ? Object.getOwnPropertyDescriptor(error, "cause")?.value : undefined;
  const parsed = decodeContainerDiagnostic(containerCommandFailureSchema, cause) as z.infer<typeof containerCommandFailureSchema> | undefined;
  if (parsed?.failure === failure) return freezeDiagnostic(parsed);
  return Object.freeze({ failure });
}

export interface DockerCommandLimits { timeoutMs: number; maxOutputBytes: number; diagnosticPhase?: z.infer<typeof phase> }
export type DockerTransport = (args: readonly string[], stdin: string, limits: DockerCommandLimits) => Promise<{ code: number; stdout: string; stderr: string; lifecycle?: DockerCommandLifecycle }>;

/** Trusted Docker CLI only. Candidate bytes are stdin, never a shell or argv. */
type DockerCliRunner = (args: readonly string[], stdin: string, limits: DockerCommandLimits, environment: NodeJS.ProcessEnv, diagnostic?: { ordinal: number; observer?: DockerLifecycleObserver }) => ReturnType<DockerTransport>;
const runDockerCli: DockerCliRunner = (args, stdin, limits, environment, diagnostic) => new Promise((resolve, reject) => {
  const started = performance.now(), now = () => Math.min(86400000, Math.max(0, Math.floor(performance.now() - started)));
  const command = args[0] === "--host" ? args.slice(2) : args;
  const kind = command[0] === "context" ? "CONTEXT" : command[0] === "image" && command[1] === "inspect" ? "IMAGE_INSPECT"
    : ({ info: "INFO", create: "CREATE", inspect: "INSPECT", start: "START", rm: "RM", build: "BUILD" } as const)[command[0] as "info" | "create" | "inspect" | "start" | "rm" | "build"] ?? "OTHER";
  const pipe = () => ({ bytes: 0, chunks: 0, firstMs: null, lastMs: null, endMs: null, closeMs: null, error: null });
  const lifecycle: DockerCommandLifecycle = { schemaVersion: 1, command: kind, ordinal: diagnostic?.ordinal ?? 1,
    phase: limits.diagnosticPhase ?? ({ CONTEXT: "SELECT", INFO: "VERIFY", IMAGE_INSPECT: "VERIFY", CREATE: "CREATE", INSPECT: "INSPECT", START: "START", RM: "CLEANUP_RM", BUILD: "OTHER", OTHER: "OTHER" } as const)[kind],
    timeoutMs: limits.timeoutMs, elapsedMs: 0, spawn: { invoked: true, observed: null, error: null },
    stdin: { endInvoked: false, callback: null, finish: null, drainCount: 0, error: null }, stdout: pipe(), stderr: pipe(),
    exit: { atMs: null, code: null, signal: null }, close: { atMs: null, code: null, signal: null }, timer: { firedMs: null },
    kill: { requestedMs: null, returned: null, error: null }, nativeReady: "UNOBSERVED", nativeDispatch: "UNOBSERVED", observerError: false, events: [] };
  const snapshot = () => { lifecycle.elapsedMs = now(); return freezeDiagnostic(dockerCommandLifecycleSchema.parse(lifecycle)); };
  let notifying = false;
  const observe = () => {
    if (!diagnostic?.observer || notifying) return;
    notifying = true;
    try {
      const returned = diagnostic.observer(snapshot());
      if (types.isPromise(returned)) void Promise.prototype.then.call(returned, undefined, () => { lifecycle.observerError = true; });
    } catch { lifecycle.observerError = true; } finally { notifying = false; }
  };
  const event = (kind: DockerCommandLifecycle["events"][number]["kind"]) => { if (lifecycle.events.length < 64) lifecycle.events.push({ kind, atMs: now() }); observe(); };
  const code = (error: unknown): z.infer<typeof errorCode> => {
    const value = error && typeof error === "object" && !types.isProxy(error) ? Object.getOwnPropertyDescriptor(error, "code")?.value : undefined;
    return errorCode.safeParse(value).success ? value : "OTHER";
  };
  const processEvent = (exitCode: number | null, exitSignal: string | null | undefined) => ({ atMs: now(),
    code: Number.isInteger(exitCode) && exitCode! >= -2147483648 && exitCode! <= 2147483647 ? exitCode : null,
    signal: exitSignal == null ? null : signal.safeParse(exitSignal).success ? exitSignal as z.infer<typeof signal> : "OTHER" as const });
  let outputBytes = 0, stdoutBytes = 0, stderrBytes = 0, stdout = "", stderr = "", stdoutTruncated = false, failure: string | undefined;
  const rejectCommand = (reason: "TIMEOUT" | "OUTPUT_LIMIT" | "UNAVAILABLE") => {
    const error = new Error(`RSI_SANDBOX_${reason}`, { cause: freezeDiagnostic({ failure: reason, stdoutBytes, stderrBytes, lifecycle: snapshot() }) });
    if (kind === "START") failedOutput.set(error, { stdout, truncated: stdoutTruncated }); reject(error);
  };
  event("SPAWN_INVOKED");
  let child: ReturnType<typeof spawn> & { stdin: NonNullable<ReturnType<typeof spawn>["stdin"]>; stdout: NonNullable<ReturnType<typeof spawn>["stdout"]>; stderr: NonNullable<ReturnType<typeof spawn>["stderr"]> };
  try { child = spawn("docker", [...args], { shell: false, env: environment, stdio: ["pipe", "pipe", "pipe"] }); }
  catch (error) { lifecycle.spawn.error = code(error); event("SPAWN_ERROR"); rejectCommand("UNAVAILABLE"); return; }
  const outDecoder = new StringDecoder("utf8"), errDecoder = new StringDecoder("utf8");
  const stop = (reason: string) => {
    failure ??= reason; lifecycle.kill.requestedMs = now(); event("KILL_REQUEST");
    try { lifecycle.kill.returned = child.kill("SIGKILL"); event("KILL_RETURN"); }
    catch (error) { lifecycle.kill.error = code(error); event("KILL_ERROR"); }
  };
  const timer = setTimeout(() => { lifecycle.timer.firedMs = now(); event("TIMER"); stop("TIMEOUT"); }, limits.timeoutMs);
  for (const stream of ["stdout", "stderr"] as const) {
    child[stream].on("data", (chunk: Buffer) => {
      const state = lifecycle[stream]; state.bytes = Math.min(65537, state.bytes + chunk.length); state.chunks = Math.min(86400000, state.chunks + 1); state.firstMs ??= now(); state.lastMs = now();
      if (stream === "stdout") stdoutBytes = Math.min(limits.maxOutputBytes + 1, stdoutBytes + chunk.length); else stderrBytes = Math.min(limits.maxOutputBytes + 1, stderrBytes + chunk.length);
      outputBytes += chunk.length;
      if (outputBytes > limits.maxOutputBytes) { if (stream === "stdout" && chunk.length > 0) stdoutTruncated = true; stop("OUTPUT_LIMIT"); }
      else if (stream === "stdout") stdout += outDecoder.write(chunk); else stderr += errDecoder.write(chunk);
      observe();
    });
    child[stream].once("end", () => { lifecycle[stream].endMs = now(); event(stream === "stdout" ? "STDOUT_END" : "STDERR_END"); });
    child[stream].once("close", () => { lifecycle[stream].closeMs = now(); event(stream === "stdout" ? "STDOUT_CLOSE" : "STDERR_CLOSE"); });
    child[stream].once("error", error => { lifecycle[stream].error = code(error); event(stream === "stdout" ? "STDOUT_ERROR" : "STDERR_ERROR"); });
  }
  child.once("spawn", () => { lifecycle.spawn.observed = true; event("SPAWN"); });
  child.once("error", error => { clearTimeout(timer); lifecycle.spawn.error = code(error); event("SPAWN_ERROR"); rejectCommand("UNAVAILABLE"); });
  child.once("exit", (exitCode, exitSignal) => { lifecycle.exit = processEvent(exitCode, exitSignal); event("EXIT"); });
  child.once("close", (exitCode, exitSignal) => {
    clearTimeout(timer); lifecycle.close = processEvent(exitCode, exitSignal); event("CLOSE");
    if (failure) rejectCommand(failure as "TIMEOUT" | "OUTPUT_LIMIT");
    else resolve({ code: exitCode ?? -1, stdout: stdout + outDecoder.end(), stderr: stderr + errDecoder.end(), lifecycle: snapshot() });
  });
  child.stdin.on("error", error => { lifecycle.stdin.error = code(error); event("STDIN_ERROR"); });
  child.stdin.once("finish", () => { lifecycle.stdin.finish = true; event("STDIN_FINISH"); });
  child.stdin.on("drain", () => { lifecycle.stdin.drainCount = Math.min(64, lifecycle.stdin.drainCount + 1); event("STDIN_DRAIN"); });
  lifecycle.stdin.endInvoked = true; event("STDIN_END");
  try { child.stdin.end(stdin, (error?: Error | null) => { lifecycle.stdin.callback = true; if (error) lifecycle.stdin.error = code(error); event("STDIN_CALLBACK"); }); }
  catch (error) { lifecycle.stdin.error = code(error); event("STDIN_ERROR"); rejectCommand("UNAVAILABLE"); }
});

/** Resolve local configuration once, then pin all operations to that Unix socket.
 * No candidate may supply this environment/runner; they are trusted test seams.
 * Socket paths and Docker diagnostics are never returned as evidence/errors. */
export function createLocalDockerTransport(environment: NodeJS.ProcessEnv = process.env, runner: DockerCliRunner = runDockerCli, observer?: DockerLifecycleObserver): DockerTransport {
  const env = Object.freeze({ PATH: environment.PATH, HOME: environment.HOME, DOCKER_CONFIG: environment.DOCKER_CONFIG });
  const configuredHost = environment.DOCKER_HOST, configuredContext = environment.DOCKER_CONTEXT;
  let selected: Promise<string> | undefined, ordinal = 0;
  const invoke: DockerCliRunner = (args, stdin, limits, env) => runner(args, stdin, limits, env, { ordinal: Math.min(1000000, ++ordinal), observer });
  function localEndpoint(value: unknown) {
    if (typeof value !== "string" || !value.startsWith("unix:///") || /[\0\r\n?#%]/.test(value)) fail("BLOCKED");
    const path = value.slice("unix://".length);
    if (!isAbsolute(path) || normalize(path) !== path || path === "/") fail("BLOCKED");
    return value;
  }
  async function select() {
    if (configuredHost) { if (configuredContext) fail("BLOCKED"); return localEndpoint(configuredHost); }
    const context = await invoke(["context", "inspect"], "", { timeoutMs: 5000, maxOutputBytes: 65536 }, { ...env, ...(configuredContext ? { DOCKER_CONTEXT: configuredContext } : {}) });
    if (context.code !== 0) fail("BLOCKED");
    const rows = JSON.parse(context.stdout);
    if (!Array.isArray(rows) || rows.length !== 1) fail("BLOCKED");
    return localEndpoint(rows[0]?.Endpoints?.docker?.Host);
  }
  return async (args, stdin, limits) => {
    selected ??= select().catch(() => fail("BLOCKED"));
    const endpoint = await selected;
    return invoke(["--host", endpoint, ...args], stdin, limits, env);
  };
}
let defaultLifecycleRegistration: { observer: DockerLifecycleObserver } | undefined;
/** Trusted host diagnostics only. Registration cannot replace the fixed transport. */
export function observeDockerLifecycle(observer: DockerLifecycleObserver): () => void {
  if (typeof observer !== "function" || defaultLifecycleRegistration) fail("BLOCKED");
  const registration = { observer }; defaultLifecycleRegistration = registration;
  return () => { if (defaultLifecycleRegistration === registration) defaultLifecycleRegistration = undefined; };
}
export const dockerTransport = createLocalDockerTransport(process.env, runDockerCli, snapshot => defaultLifecycleRegistration?.observer(snapshot));

// This profile is supplied ONLY by the trusted host supervisor. It is neither
// candidate configuration nor an authorization token. Never merge candidate data.
const baseImageId = "sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5";
const baseImage = `node@${baseImageId}`;
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const imageId = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const profileSchema = z.strictObject({
  schemaVersion: z.literal(1), image: z.string(), imageId,
  baseImage: z.literal(baseImage), baseImageId: z.literal(baseImageId),
  platform: z.literal("linux/arm64"), nodeVersion: z.literal("v22.23.2"),
  dockerVersion: z.literal("29.2.1"), kernelVersion: z.literal("6.8.0-100-generic"), cgroupVersion: z.literal("2"),
  watchdogPath: z.literal("/usr/bin/timeout"),
  watchdogSha256: z.literal("3629fa180f625d4de2e3fd3b15b12c5d42315e5733ecae6d1550b306abd7d482"),
  memoryMiB: z.number().int().min(1).max(512), tmpfsMiB: z.number().int().min(1).max(64),
  cpus: z.number().min(0.01).max(1).refine(n => Number.isInteger(n * 100000)), pids: z.number().int().min(1).max(64),
  wallTimeMs: z.number().int().min(1).max(15000), maxOutputBytes: z.number().int().min(1).max(32768),
  maxInputBytes: z.number().int().min(1).max(100000),
  entrypoint: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("inline-node"), source: z.string().min(1).max(65536), sha256 }),
    z.strictObject({ kind: z.literal("native-file"), path: z.literal("/opt/rsi/native-wrapper.mjs"), sha256 }),
  ]),
}).superRefine((p, ctx) => {
  const valid = p.entrypoint.kind === "inline-node"
    ? p.image === baseImage && p.imageId === baseImageId && Buffer.byteLength(p.entrypoint.source) <= 65536 && hash(p.entrypoint.source) === p.entrypoint.sha256
    : p.image === p.imageId && p.imageId !== baseImageId;
  if (!valid) ctx.addIssue({ code: "custom", message: "Invalid pinned entrypoint/image" });
});
export type TrustedContainerProfile = z.infer<typeof profileSchema>;

// Reject accessors/prototypes before schema parsing; snapshot synchronously before
// the first await so later supervisor mutation cannot change the capability.
function snapshotProfile(value: unknown): Readonly<TrustedContainerProfile> {
  function data(item: unknown, depth = 0): unknown {
    if (depth > 2) fail("BLOCKED");
    if (item === null || typeof item !== "object") { if (["string", "number", "boolean"].includes(typeof item)) return item; fail("BLOCKED"); }
    if (Object.getPrototypeOf(item) !== Object.prototype) fail("BLOCKED");
    const copy: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(item)) {
      if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)) fail("BLOCKED");
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
      if (!descriptor.enumerable || !("value" in descriptor)) fail("BLOCKED");
      copy[key] = data(descriptor.value, depth + 1);
    }
    return copy;
  }
  const p = profileSchema.parse(data(value)); Object.freeze(p.entrypoint); return Object.freeze(p);
}

// Trusted verification program only; no candidate bytes are interpolated.
function runtimeProbe(p: Readonly<TrustedContainerProfile>) { return `
import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
const read = path => readFileSync(path,'utf8').trim();
${p.entrypoint.kind === 'native-file' ? `const entrypointPath='/opt/rsi/native-wrapper.mjs', stat=lstatSync(entrypointPath); const entrypoint={sha256:createHash('sha256').update(readFileSync(entrypointPath)).digest('hex'),regular:stat.isFile(),uid:stat.uid,writable:(stat.mode & 0o222)!==0};` : ''}
const initStatus = read('/proc/1/status');
const status = read('/proc/self/status'), mounts = read('/proc/self/mountinfo').split('\\n');
const mount = path => mounts.find(line=>line.split(' ')[4]===path) ?? '';
const root = mount('/'), tmp = mount('/tmp');
process.stdout.write(JSON.stringify({${p.entrypoint.kind === 'native-file' ? 'entrypoint,' : ''}watchdogDigest:createHash('sha256').update(readFileSync('/usr/bin/timeout')).digest('hex'),watchdogPid:Number(initStatus.match(/^Pid:\\s+(\\d+)/m)?.[1]),watchdogName:initStatus.match(/^Name:\\s+(\\S+)/m)?.[1],parentPid:process.ppid,runtime:process.version+' '+process.platform+' '+process.arch,
 memory:read('/sys/fs/cgroup/memory.max'),swap:read('/sys/fs/cgroup/memory.swap.max'),
 pids:read('/sys/fs/cgroup/pids.max'),cpu:read('/sys/fs/cgroup/cpu.max'),uid:process.getuid(),
 seccomp:Number(status.match(/^Seccomp:\\s+(\\d+)/m)?.[1]),caps:status.match(/^CapEff:\\s+(\\w+)/m)?.[1],noNewPrivileges:/^NoNewPrivs:\\s+1$/m.test(status),
 rootReadOnly:root.split(' ')[5]?.split(',').includes('ro')===true,
 tmpfsBounded:tmp.includes(' - tmpfs ') && tmp.includes('size=${p.tmpfsMiB * 1024}k') && ['noexec','nosuid','nodev'].every(flag=>tmp.split(' ')[5]?.split(',').includes(flag)),
 networkNone:read('/proc/net/dev').split('\\n').slice(2).every(line=>line.trim().startsWith('lo:'))
})+'\\n');
`; }

function isolationSchema(p: Readonly<TrustedContainerProfile>) {
  return z.strictObject({
    watchdogDigest: z.literal(p.watchdogSha256), watchdogPid: z.literal(1), watchdogName: z.literal("timeout"), parentPid: z.literal(1),
    runtime: z.literal(`${p.nodeVersion} linux arm64`), memory: z.literal(String(p.memoryMiB * 1024 * 1024)), swap: z.literal("0"),
    pids: z.literal(String(p.pids)), cpu: z.literal(`${p.cpus * 100000} 100000`), uid: z.literal(65532), seccomp: z.literal(2),
    caps: z.literal("0000000000000000"), noNewPrivileges: z.literal(true), rootReadOnly: z.literal(true), tmpfsBounded: z.literal(true), networkNone: z.literal(true),
    ...(p.entrypoint.kind === "native-file" ? { entrypoint: z.strictObject({ sha256: z.literal(p.entrypoint.sha256), regular: z.literal(true), uid: z.literal(0), writable: z.literal(false) }) } : {}),
  });
}
const commandLimits = Object.freeze({ timeoutMs: 5000, maxOutputBytes: 65536 });
type Isolation = z.infer<ReturnType<typeof isolationSchema>>;
const verifiedConstruction = Symbol("verified container construction");
const probePermissions = ["/proc/1/status", "/usr/bin/timeout", "/proc/self/status", "/proc/self/mountinfo", "/proc/net/dev", "/sys/fs/cgroup"];

/** Verification grants one fixed local capability, never a general command API.
 * Native-file mode verifies a protected supervisor wrapper, not native execution
 * correctness or its future workerd boundary. Synthetic transports prove no OS isolation. */
export class VerifiedContainerBackend {
  #blocked = false;
  #tail: Promise<unknown> = Promise.resolve();
  #isolation!: Readonly<Isolation>;
  #profile: Readonly<TrustedContainerProfile>;
  #transport: DockerTransport;
  private constructor(profile: Readonly<TrustedContainerProfile>, transport: DockerTransport, proof: symbol) {
    if (proof !== verifiedConstruction) fail("BLOCKED");
    this.#profile = profile; this.#transport = transport;
  }

  static async verify(trustedProfile: TrustedContainerProfile, transport: DockerTransport = dockerTransport): Promise<VerifiedContainerBackend> {
    try {
      const p = snapshotProfile(trustedProfile);
      const infoResponse = await transport(["info", "--format", "{{json .}}"], "", commandLimits);
      if (infoResponse.code !== 0) fail("BLOCKED");
      const info = JSON.parse(infoResponse.stdout);
      if (info.ServerVersion !== p.dockerVersion || info.OSType !== "linux" || !["aarch64", "arm64"].includes(info.Architecture)
        || info.KernelVersion !== p.kernelVersion || info.CgroupVersion !== p.cgroupVersion
        || !info.MemoryLimit || !info.SwapLimit || !info.CpuCfsQuota || !info.PidsLimit
        || !Array.isArray(info.SecurityOptions) || !info.SecurityOptions.includes("name=seccomp,profile=builtin")) fail("BLOCKED");
      async function inspectImage(ref: string, id: string, requireRepoDigest: boolean) {
        const inspected = await transport(["image", "inspect", ref], "", commandLimits);
        if (inspected.code !== 0) fail("BLOCKED");
        const images = JSON.parse(inspected.stdout), image = images[0];
        if (!Array.isArray(images) || images.length !== 1 || image.Id !== id || (requireRepoDigest && !image.RepoDigests?.includes(ref))
          || image.Os !== "linux" || image.Architecture !== "arm64" || !image.Config?.Env?.includes("NODE_VERSION=22.23.2")
          || Object.keys(image.Config.Volumes ?? {}).length !== 0) fail("BLOCKED");
        return image;
      }
      const image = await inspectImage(p.image, p.imageId, p.entrypoint.kind === "inline-node");
      if (p.entrypoint.kind === "native-file") {
        const base = await inspectImage(p.baseImage, p.baseImageId, true);
        const baseLayers: unknown = base.RootFS?.Layers, layers: unknown = image.RootFS?.Layers;
        if (!Array.isArray(baseLayers) || baseLayers.length === 0 || !Array.isArray(layers) || layers.length <= baseLayers.length
          || !baseLayers.every((layer, i) => typeof layer === "string" && layers[i] === layer)) fail("BLOCKED");
      }
      const backend = new VerifiedContainerBackend(p, transport, verifiedConstruction);
      const probe = await backend.#container("", true);
      if (probe.code !== 0 || probe.stderr !== "") fail("BLOCKED");
      const isolation = isolationSchema(p).parse(JSON.parse(probe.stdout));
      if (isolation.entrypoint) Object.freeze(isolation.entrypoint);
      backend.#isolation = Object.freeze(isolation);
      return backend;
    } catch (error) {
      const cause = cleanupCause(error);
      if (cause) throw new Error("RSI_SANDBOX_BLOCKED", { cause });
      return fail("BLOCKED");
    }
  }

  assertAvailable() { if (this.#blocked) fail("BLOCKED"); }
  get evidence() {
    const p = this.#profile;
    return Object.freeze({ transportKind: this.#transport === dockerTransport ? "DOCKER_CLI" as const : "INJECTED_TRANSPORT" as const,
      profileDigest: hash(JSON.stringify(p)), entrypointKind: p.entrypoint.kind, entrypointDigest: p.entrypoint.sha256,
      imageDigest: p.image, baseImageDigest: p.baseImage, runtime: `${p.nodeVersion} linux arm64`, isolation: this.#isolation });
  }

  async #container(stdin: string, probe = false) {
    this.assertAvailable();
    const owner = randomUUID(), name = `rsi-${owner}`, p = this.#profile;
    let createdId: string | undefined, startFailure: z.infer<typeof containerCommandFailureSchema> | undefined;
    let completed: Awaited<ReturnType<DockerTransport>> | undefined, primaryError: unknown;
    const commands: DockerCommandLifecycle[] = [];
    const cleanup: z.infer<typeof containerTransportDiagnosticSchema>["cleanup"] = { inspectReturned: null, nameMatch: null, ownerMatch: null, idMatch: null, rmInvoked: false, rmReturned: null };
    const transportDiagnostic = () => commands.length ? freezeDiagnostic(containerTransportDiagnosticSchema.parse({ commands, cleanup })) : undefined;
    const invoke = async (args: readonly string[], input: string, limits: DockerCommandLimits, diagnosticPhase: z.infer<typeof phase>) => {
      try {
        const response = await this.#transport(args, input, { ...limits, diagnosticPhase });
        const lifecycle = decodeContainerDiagnostic(dockerCommandLifecycleSchema, !types.isProxy(response) ? Object.getOwnPropertyDescriptor(response, "lifecycle")?.value : undefined) as DockerCommandLifecycle | undefined;
        if (lifecycle) commands.push(lifecycle);
        return { code: response.code, stdout: response.stdout, stderr: response.stderr, ...(lifecycle ? { lifecycle } : {}) };
      } catch (error) { const lifecycle = commandFailure(error).lifecycle; if (lifecycle) commands.push(lifecycle); throw error; }
    };
    const nodeArgs = probe
      ? ["--permission", ...[...probePermissions, ...(p.entrypoint.kind === "native-file" ? ["/opt/rsi/native-wrapper.mjs"] : [])].map(path => `--allow-fs-read=${path}`), "--max-old-space-size=64", "--input-type=module", "-e", runtimeProbe(p)]
      : p.entrypoint.kind === "inline-node"
        ? ["--permission", "--max-old-space-size=64", "--input-type=module", "-e", p.entrypoint.source]
        : ["--max-old-space-size=64", p.entrypoint.path];
    const args = ["create", "--name", name, "--label", `rsi.sandbox.owner=${owner}`, "--pull=never", `--platform=${p.platform}`,
      "--network=none", "--read-only",
      ...["HTTP_PROXY", "HTTPS_PROXY", "FTP_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "ftp_proxy", "all_proxy", "no_proxy"].map(key => `--env=${key}=`), "--user=65532:65532", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--ipc=none",
      `--memory=${p.memoryMiB}m`, `--memory-swap=${p.memoryMiB}m`, `--cpus=${p.cpus}`, `--pids-limit=${p.pids}`,
      `--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=${p.tmpfsMiB}m,mode=1777`, "--shm-size=1m", "--ulimit=nofile=64:64", "--ulimit=core=0:0",
      "--log-driver=none", "--workdir=/tmp", "--interactive", `--entrypoint=${p.watchdogPath}`, p.image,
      "--signal=KILL", `${p.wallTimeMs / 1000}s`, "/usr/local/bin/node", ...nodeArgs];
    const inspectOwned = async (cleaning = false) => {
      let inspection: Awaited<ReturnType<DockerTransport>>;
      try { inspection = await invoke(["inspect", name], "", commandLimits, cleaning ? "CLEANUP_INSPECT" : "INSPECT"); if (cleaning) cleanup.inspectReturned = true; }
      catch (error) { const command = commandFailure(error); throw cleanupError("INSPECT_TRANSPORT", transportFailure(error), command.stdoutBytes !== undefined ? command : undefined); }
      if (inspection.code !== 0) throw cleanupError("INSPECT_EXIT", "EXIT");
      let rows: unknown;
      try { rows = JSON.parse(inspection.stdout); } catch { throw cleanupError("INSPECT_JSON", "INVALID_JSON"); }
      const row = Array.isArray(rows) ? rows[0] : undefined;
      if (cleaning) { cleanup.nameMatch = row?.Name === `/${name}`; cleanup.ownerMatch = row?.Config?.Labels?.["rsi.sandbox.owner"] === owner; cleanup.idMatch = createdId === undefined ? null : typeof row?.Id === "string" && /^[a-f0-9]{64}$/.test(row.Id) && row.Id === createdId; }
      if (!Array.isArray(rows) || rows.length !== 1 || !row || row.Name !== `/${name}` || row.Config?.Labels?.["rsi.sandbox.owner"] !== owner
        || !/^[a-f0-9]{64}$/.test(row.Id) || (createdId !== undefined && row.Id !== createdId)) throw cleanupError("INSPECT_OWNERSHIP", "OWNERSHIP");
      return row;
    };
    try {
      const creation = await invoke(args, "", commandLimits, "CREATE");
      if (creation.code !== 0 || !/^[a-f0-9]{64}\n?$/.test(creation.stdout)) fail("UNAVAILABLE");
      createdId = creation.stdout.trim();
      const row = await inspectOwned();
      if (!Array.isArray(row.Mounts) || row.Mounts.length !== 0) fail("BLOCKED");
      let result: Awaited<ReturnType<DockerTransport>>;
      try { result = await invoke(["start", "--attach", "--interactive", name], stdin, { timeoutMs: p.wallTimeMs, maxOutputBytes: p.maxOutputBytes }, "START"); }
      catch (error) {
        startFailure = commandFailure(error);
        throw transferOutput(error, diagnosedError(safeSandboxMessage(error), { startFailure }));
      }
      if (typeof result.stdout !== "string" || typeof result.stderr !== "string" || !Number.isInteger(result.code)) fail("IPC");
      if (result.code !== 0) startFailure = freezeDiagnostic({ failure: "EXIT", stdoutBytes: Math.min(65537, Buffer.byteLength(result.stdout)), stderrBytes: Math.min(65537, Buffer.byteLength(result.stderr)), ...(result.lifecycle ? { lifecycle: result.lifecycle } : {}) });
      // Real CLI overflow is OUTPUT_LIMIT; a transport returning an oversized
      // completed response violates IPC (the existing Node adapter contract).
      if (Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > p.maxOutputBytes) fail("IPC");
      completed = result;
    } catch (error) {
      primaryError = error; throw error;
    } finally {
      // Exact ownership and ID, including uncertain create outcomes; no pruning.
      // Missing inspection is ambiguous (a daemon may still complete creation).
      try {
        const row = await inspectOwned(true);
        let removed: Awaited<ReturnType<DockerTransport>>;
        cleanup.rmInvoked = true;
        try { removed = await invoke(["rm", "--force", row.Id], "", commandLimits, "CLEANUP_RM"); cleanup.rmReturned = true; }
        catch (error) { const command = commandFailure(error); throw cleanupError("RM_TRANSPORT", transportFailure(error), command.stdoutBytes !== undefined ? command : undefined); }
        if (removed.code !== 0) throw cleanupError("RM_EXIT", "EXIT");
      } catch (error) {
        this.#blocked = true;
        const cause = cleanupCause(error);
        if (cause) {
          const transport = transportDiagnostic();
          const failure = transferOutput(primaryError, diagnosedError("RSI_SANDBOX_CLEANUP", { ...cause as z.infer<typeof containerCleanupFailureSchema>, ...(startFailure ? { startFailure } : {}), ...(transport ? { transport } : {}) }));
          if (completed && Buffer.byteLength(completed.stdout) <= 32768) failedOutput.set(failure, { stdout: completed.stdout, truncated: false });
          throw failure;
        }
        throw cleanupError("INSPECT_OWNERSHIP", "OTHER");
      }
      if (primaryError && startFailure) {
        const transport = transportDiagnostic();
        throw transferOutput(primaryError, diagnosedError(safeSandboxMessage(primaryError), { startFailure, ...(transport ? { transport } : {}) }));
      }
    }
    const transport = transportDiagnostic();
    return { ...completed!, ...(transport ? { transport } : {}) };
  }

  async run(stdin: string) {
    this.assertAvailable();
    if (typeof stdin !== "string" || Buffer.byteLength(stdin) > this.#profile.maxInputBytes) fail("INPUT");
    // Serialize runs so no queued candidate can dispatch after uncertain cleanup.
    const result = this.#tail.then(async () => {
      this.assertAvailable();
      const response = await this.#container(stdin);
      return { ...response, evidence: Object.freeze({ ...this.evidence, kind: "LOCAL_CONTAINER_RETURN" as const,
        stdinDigest: hash(stdin), outputDigest: hash(response.stdout), ...(response.transport ? { transport: response.transport } : {}) }) };
    });
    this.#tail = result.catch(() => {});
    return result;
  }
}
