import { createHash } from "node:crypto";
import { readFile, writeFile, mkdtemp, rm, mkdir, open, lstat, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { types } from "node:util";
import { z } from "zod";
import { VerifiedContainerBackend, dockerTransport, containerFailureDiagnosticSchema, containerTransportDiagnosticSchema, decodeContainerDiagnostic, classifyContainerFailure, type DockerTransport, type TrustedContainerProfile } from "./container-backend";
import { rsiFixtureSchema } from "./oracle";
import { NATIVE_RUNTIME, NATIVE_HARNESS, NATIVE_GUARD } from "./native-wrapper";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);
const tools = createRequire(require.resolve("@react-router/dev/package.json"));
const compiler = createRequire(require.resolve("wrangler"))("esbuild") as {
  transform(source: string, options: Record<string, unknown>): Promise<{ code: string; warnings: unknown[] }>;
  build(options: Record<string, unknown>): Promise<{ outputFiles: { text: string }[]; warnings: unknown[] }>;
};
const parser = tools("@babel/parser") as { parse(source: string, options: Record<string, unknown>): unknown };
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const NATIVE_SOURCE_PATH = "app/features/operations/rsi-self-check.ts" as const;
const candidateSchema = z.strictObject({ path: z.literal(NATIVE_SOURCE_PATH), source: z.string().min(1).max(65536), sourceDigest: digest });
function fail(code: string, cause?: unknown): never { throw new Error(`RSI_NATIVE_${code}`, cause ? { cause } : undefined); }
function nativeCleanupCause(error: unknown) {
  const raw = error && typeof error === "object" && !types.isProxy(error) && error instanceof Error ? Object.getOwnPropertyDescriptor(error, "cause")?.value : undefined;
  return decodeContainerDiagnostic(containerFailureDiagnosticSchema, raw);
}
function plainRequest(raw: unknown) {
  if (!raw || typeof raw !== "object" || Object.getPrototypeOf(raw) !== Object.prototype) fail("INPUT");
  for (const key of Reflect.ownKeys(raw)) {
    const entry = Object.getOwnPropertyDescriptor(raw, key)!;
    if (typeof key !== "string" || !entry.enumerable || !("value" in entry) || typeof entry.value !== "string") fail("INPUT");
  }
  return raw;
}

/** Syntax-only processing. No host import, eval, VM or candidate function call. */
export async function compileNativeCandidate(raw: unknown) {
  let candidate: z.infer<typeof candidateSchema>;
  try { candidate = candidateSchema.parse(plainRequest(raw)); if (Buffer.byteLength(candidate.source) > 65536 || hash(candidate.source) !== candidate.sourceDigest) fail("INPUT"); }
  catch { return fail("INPUT"); }
  let ast: unknown;
  try { ast = parser.parse(candidate.source, { sourceType: "module", plugins: ["typescript"], createImportExpressions: true }); }
  catch { return fail("SYNTAX"); }
  const queue: unknown[] = [ast];
  while (queue.length) {
    const node = queue.pop(); if (!node || typeof node !== "object") continue;
    const value = node as Record<string, unknown>;
    if (["ImportDeclaration", "ImportExpression", "Import", "ExportAllDeclaration", "ExportDefaultDeclaration", "TSImportEqualsDeclaration", "TSImportType"].includes(String(value.type))
      || (value.type === "ExportNamedDeclaration" && value.source)
      || (value.type === "MetaProperty" && (value.meta as { name?: string })?.name === "import")
      || (value.type === "Identifier" && ["require", "eval", "Function"].includes(String(value.name)))) fail("IMPORT_CLOSURE");
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) queue.push(...child); else if (child && typeof child === "object") queue.push(child);
    }
  }
  try {
    const compiled = await compiler.transform(candidate.source, { loader: "ts", format: "esm", target: "es2022", sourcemap: false, legalComments: "none", logLevel: "silent" });
    if (compiled.warnings.length || Buffer.byteLength(compiled.code) > 80000) fail("SYNTAX");
    return Object.freeze({ sourceDigest: candidate.sourceDigest, compiledDigest: hash(compiled.code), script: compiled.code });
  } catch { return fail("SYNTAX"); }
}

const baseId = "sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5";
// Finite initial native ceiling. Actual probes must establish this profile works.
export const NATIVE_LIMITS = Object.freeze({ memoryMiB: 512, tmpfsMiB: 64, cpus: 1, pids: 64, wallTimeMs: 15000, maxOutputBytes: 32768, maxInputBytes: 100000 });
export const NATIVE_BUILD_FLAGS = Object.freeze(["build", "--quiet", "--pull=false", "--platform=linux/arm64", "--network=default",
  ...["HTTP_PROXY", "HTTPS_PROXY", "FTP_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "ftp_proxy", "all_proxy", "no_proxy"].flatMap(key => ["--build-arg", `${key}=`]),
]);
const runtimeSchema = z.strictObject({ node: z.literal(NATIVE_RUNTIME.node), miniflare: z.literal(NATIVE_RUNTIME.miniflare), workerd: z.literal(NATIVE_RUNTIME.workerd), platform: z.literal(NATIVE_RUNTIME.platform),
  workerdBinaryVersion: z.literal(NATIVE_RUNTIME.workerdBinaryVersion),
  supportedCompatibilityDate: z.iso.date(), compatibilityDate: z.literal("2026-08-05"), compatibilityFlags: z.tuple([z.literal("nodejs_compat"), z.literal("global_fetch_strictly_public")]), workerdDigest: digest, publicCaDigest: digest, publicCaCount: z.number().int().min(1).max(10000) });
const artifactSchema = z.strictObject({ packageDigest: digest, lockDigest: digest, wrapperSourceDigest: digest, wrapperDigest: digest, oracleDigest: digest, contractsDigest: digest, dockerfileDigest: digest, harnessDigest: digest, guardDigest: digest });
const manifestSchema = z.strictObject({ schemaVersion: z.literal(1), imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/), baseImage: z.literal(`node@${baseId}`), pnpm: z.literal("10.34.5"), artifacts: artifactSchema, runtime: runtimeSchema });
export type NativeRuntimeManifest = z.infer<typeof manifestSchema>;

// The existing image contains these exact dependencies, not the evolving app's
// package/lock. Pin bytes independently of caller manifests before verify/build.
const nativeDependencies = [
  { name: "package.json", digest: "257692887405a71fbc959353de45509e0e0edd001eaab4698091d51bfbf73ae1", maxBytes: 65536 },
  { name: "pnpm-lock.yaml", digest: "3f88797d9a2e666155555976df0b7f0b772e63e4972e707bfe93beb0e31f3f5d", maxBytes: 524288 },
] as const;
async function pinnedNativeDependency(input: (typeof nativeDependencies)[number]) {
  const directory = join(root, "scripts/rsi/fixtures/native-runtime"), path = join(directory, input.name);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const parent = await lstat(directory);
    if (!parent.isDirectory() || await realpath(directory) !== directory) fail("ARTIFACT_MISMATCH");
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat();
    if (!before.isFile() || before.size > input.maxBytes || before.nlink !== 1) fail("ARTIFACT_MISMATCH");
    const buffer = Buffer.alloc(input.maxBytes + 1); let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const bytes = buffer.subarray(0, length), after = await handle.stat(), entry = await lstat(path), parentAfter = await lstat(directory);
    if (bytes.length > input.maxBytes || hash(bytes) !== input.digest || !entry.isFile()
      || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
      || entry.dev !== after.dev || entry.ino !== after.ino || parent.dev !== parentAfter.dev || parent.ino !== parentAfter.ino
      || !parentAfter.isDirectory() || await realpath(directory) !== directory) fail("ARTIFACT_MISMATCH");
    return bytes.toString("utf8");
  } catch { return fail("ARTIFACT_MISMATCH"); }
  finally { try { await handle?.close(); } catch { fail("ARTIFACT_MISMATCH"); } }
}
async function trustedArtifacts() {
  const files = [...await Promise.all(nativeDependencies.map(pinnedNativeDependency)), ...await Promise.all(["scripts/rsi/native-wrapper.ts", "scripts/rsi/oracle.ts", "scripts/rsi/contracts.ts", "scripts/rsi/fixtures/native-runtime.Dockerfile"].map(path => readFile(join(root, path), "utf8")))];
  const built = await compiler.build({ entryPoints: [join(root, "scripts/rsi/native-wrapper.ts")], bundle: true, packages: "external", platform: "node", format: "esm", target: "node22", write: false, sourcemap: false, legalComments: "none", logLevel: "silent" });
  if (built.warnings.length || built.outputFiles.length !== 1) fail("PREPARATION");
  const wrapper = built.outputFiles[0].text;
  return { files, wrapper, artifacts: { packageDigest: hash(files[0]), lockDigest: hash(files[1]), wrapperSourceDigest: hash(files[2]), wrapperDigest: hash(wrapper), oracleDigest: hash(files[3]), contractsDigest: hash(files[4]), dockerfileDigest: hash(files[5]), harnessDigest: hash(NATIVE_HARNESS), guardDigest: hash(NATIVE_GUARD) } };
}
export async function nativeArtifactDigests() { return (await trustedArtifacts()).artifacts; }
function profile(imageId: string, wrapperDigest: string): TrustedContainerProfile {
  return { schemaVersion: 1, image: imageId, imageId, baseImage: `node@${baseId}`, baseImageId: baseId,
    platform: "linux/arm64", nodeVersion: "v22.23.2", dockerVersion: "29.2.1", kernelVersion: "6.8.0-100-generic", cgroupVersion: "2",
    watchdogPath: "/usr/bin/timeout", watchdogSha256: "3629fa180f625d4de2e3fd3b15b12c5d42315e5733ecae6d1550b306abd7d482", ...NATIVE_LIMITS,
    entrypoint: { kind: "native-file", path: "/opt/rsi/native-wrapper.mjs", sha256: wrapperDigest } };
}
function parseJson(text: string) {
  const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
  const result: unknown = JSON.parse(trimmed);
  if (JSON.stringify(result) !== trimmed) fail("IPC");
  return result;
}
async function probe(backend: VerifiedContainerBackend) {
  const result = await backend.run('{"operation":"probe"}');
  if (result.code) fail(`RUNTIME_PROBE_EXIT_${result.code}`);
  if (result.stderr) fail("RUNTIME_PROBE_STDERR");
  try { return z.strictObject({ schemaVersion: z.literal(1), runtime: runtimeSchema }).parse(parseJson(result.stdout)).runtime; }
  catch { return fail("RUNTIME_PROBE"); }
}

/** Explicit trusted preparation only. No candidate, host mount, secret or app
 * source enters the build context. Retained image is addressed solely by ID. */
export async function prepareNativeRuntimeImage(): Promise<NativeRuntimeManifest> {
  const artifacts = await trustedArtifacts();
  if (JSON.parse(artifacts.files[0]).packageManager !== "pnpm@10.34.5") fail("PREPARATION");
  const context = await mkdtemp(join(tmpdir(), "rsi-native-build-"));
  try {
    await Promise.all([
      writeFile(join(context, "package.json"), artifacts.files[0], { mode: 0o600 }),
      writeFile(join(context, "pnpm-lock.yaml"), artifacts.files[1], { mode: 0o600 }),
      writeFile(join(context, "native-wrapper.mjs"), artifacts.wrapper, { mode: 0o644 }),
      writeFile(join(context, "Dockerfile"), artifacts.files[5], { mode: 0o600 }),
    ]);
    // Same pinned local Unix transport as execution. No automatic pull/update.
    const base = await dockerTransport(["image", "inspect", `node@${baseId}`], "", { timeoutMs: 5000, maxOutputBytes: 65536 });
    if (base.code !== 0 || JSON.parse(base.stdout)[0]?.Id !== baseId) fail("PREPARATION");
    const built = await dockerTransport([...NATIVE_BUILD_FLAGS, "--iidfile", join(context, "image.id"), context], "", { timeoutMs: 600000, maxOutputBytes: 32768 });
    if (built.code !== 0) fail("PREPARATION");
    const imageId = (await readFile(join(context, "image.id"), "utf8")).trim();
    if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) fail("PREPARATION");
    const output = join(root, ".superpowers/sdd/r3-implementation-plan");
    await mkdir(output, { recursive: true });
    await writeFile(join(output, "native-preparation.json"), JSON.stringify({ imageId, artifacts: artifacts.artifacts, status: "IMAGE_BUILT_RUNTIME_UNVERIFIED" }, null, 2) + "\n", { mode: 0o600 });
    const backend = await VerifiedContainerBackend.verify(profile(imageId, artifacts.artifacts.wrapperDigest));
    const runtime = await probe(backend);
    const manifest = manifestSchema.parse({ schemaVersion: 1, imageId, baseImage: `node@${baseId}`, pnpm: "10.34.5", artifacts: artifacts.artifacts, runtime });
    await writeFile(join(output, "native-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
    return manifest;
  } catch (error) {
    if (error instanceof Error && /^RSI_(NATIVE|SANDBOX)_[A-Z_0-9]+$/.test(error.message)) throw error;
    return fail("PREPARATION");
  } finally { await rm(context, { recursive: true, force: true }); }
}

const gradeSchema = z.strictObject({ verdict: z.enum(["PASS", "FAIL", "NO_CHANGE"]), reasonCode: z.enum(["SIX_PATHS_VERIFIED", "NORMAL", "EXTERNAL_FAILURE", "ORACLE_MISMATCH"]), redReproduced: z.literal(false), greenVerified: z.boolean() });
const pipeCustodySchema = z.strictObject({ stdoutEof: z.boolean(), stderrEof: z.boolean(), errorCount: z.number().int().min(0).max(2), prematureCloseCount: z.number().int().min(0).max(2) });
const logSchema = z.strictObject({ valid: z.boolean(), custody: pipeCustodySchema, warningCount: z.number().int().min(0).max(32768), rejectedCount: z.number().int().min(0).max(32768), forbiddenMarkerCount: z.number().int().min(0).max(32768), bytes: z.number().int().min(0).max(32768), digest, warningSourceDigest: digest, rejectionCodes: z.array(z.enum(["FIELDS", "TIMESTAMP", "LEVEL", "SOURCE", "CONTEXT", "MESSAGE", "LATE", "DUPLICATE"])).max(8) });
const receiptSchema = z.strictObject({ schemaVersion: z.literal(1), grade: gradeSchema, runtime: runtimeSchema, sourceDigest: digest, compiledDigest: digest, traceDigest: digest, responseDigest: digest,
  logs: logSchema, childSpawns: z.literal(1), dispatchAttempts: z.literal(1), deadlineExpired: z.boolean(), disposalConfirmed: z.boolean(),
  callCount: z.number().int().min(0).max(6), elapsedMs: z.number().int().min(0).max(15000), peakMemoryBytes: z.number().int().min(1).max(536870912), reason: z.enum(["CANDIDATE_LOG", "OUTBOUND_REJECTED", "RUNTIME_FAILURE", "ORACLE_RESULT", "RESOURCE_DEADLINE"]) });
const executionSchema = candidateSchema.extend({ fixture: rsiFixtureSchema });
const construction = Symbol("native executor");
const startupCategory = z.strictObject({ category: z.enum(["FD_LIMIT", "READ_ONLY", "TEMP_SPACE", "THREAD_LIMIT", "PERMISSION", "LISTENER", "SIGNAL", "CONFIG_PROTOCOL", "OTHER"]), bytes: z.number().int().min(0).max(131072), digest, clues: z.array(z.enum(["TYPE", "MODULE", "SERVICE", "SOCKET", "SYSTEM_CALL", "FILESYSTEM", "SYMBOL", "COMPATIBILITY", "SCHEMA", "V8_ENGINE", "CRYPTOGRAPHY", "NETWORK", "RESOURCE", "UNSUPPORTED", "NOT_FOUND", "EXPECTATION", "TLS", "CERTIFICATES", "ENTROPY", "NODE_COMPAT", "WEB_CRYPTO", "UNKNOWN_FLAG", "CONTRADICTORY_FLAGS"])).max(23), locations: z.array(z.strictObject({ file: z.string().regex(/^(?:workerd\/(?:server|io|api|jsg|util)|kj|v8)\/[a-zA-Z0-9_/-]+\.(?:c\+\+|cc|h)$/), line: z.number().int().min(0).max(9999999) })).max(4) });
const diagnosticSchema = z.strictObject({ schemaVersion: z.literal(1), runtime: runtimeSchema, diagnostic: z.strictObject({ ready: startupCategory.nullable(), disposal: startupCategory.nullable(), startupLogs: z.array(startupCategory).max(8), publicCa: z.strictObject({ directoryPresent: z.boolean(), entries: z.number().int().min(0).max(10000), bundlePresent: z.boolean(), certificates: z.number().int().min(0).max(10000) }), logs: logSchema, childSpawns: z.literal(1), candidateDispatches: z.literal(0), elapsedMs: z.number().int().min(0).max(15000), suppressedBytes: z.number().int().min(0).max(32768), peakMemoryBytes: z.number().int().min(1).max(536870912) }) });
const fatalSchema = z.strictObject({ schemaVersion: z.literal(1), runtime: runtimeSchema, fatal: startupCategory });
// Fixed native schemas only. This classification never supplies a verdict or permission.
function failureFrame(stdout: string, truncated: boolean, manifest: NativeRuntimeManifest, artifact: { sourceDigest: string; compiledDigest: string }) {
  if (Buffer.byteLength(stdout) > 32768) return undefined;
  const metadata = { digest: stdout ? hash(stdout) : null, completeJSON: null as boolean | null, schemaMatch: null as boolean | null, bindingMatch: null as boolean | null };
  if (truncated) return { frameKind: "PARTIAL", ...metadata };
  if (!stdout) return { frameKind: "NONE", ...metadata };
  let parsed: unknown;
  try { parsed = JSON.parse(stdout); metadata.completeJSON = true; }
  catch { return { frameKind: "INVALID", ...metadata, completeJSON: false, schemaMatch: false }; }
  const trimmed = stdout.endsWith("\n") ? stdout.slice(0, -1) : stdout;
  if (JSON.stringify(parsed) !== trimmed) return { frameKind: "INVALID", ...metadata, schemaMatch: false };
  const evaluation = receiptSchema.safeParse(parsed);
  if (evaluation.success) return { frameKind: "EVALUATION", ...metadata, schemaMatch: true,
    bindingMatch: evaluation.data.sourceDigest === artifact.sourceDigest && evaluation.data.compiledDigest === artifact.compiledDigest && JSON.stringify(evaluation.data.runtime) === JSON.stringify(manifest.runtime) };
  const probe = z.strictObject({ schemaVersion: z.literal(1), runtime: runtimeSchema }).safeParse(parsed);
  if (probe.success) return { frameKind: "PROBE", ...metadata, schemaMatch: true, bindingMatch: JSON.stringify(probe.data.runtime) === JSON.stringify(manifest.runtime) };
  const diagnostic = z.union([diagnosticSchema, fatalSchema]).safeParse(parsed);
  if (diagnostic.success) return { frameKind: "DIAGNOSTIC", ...metadata, schemaMatch: true, bindingMatch: JSON.stringify(diagnostic.data.runtime) === JSON.stringify(manifest.runtime) };
  return { frameKind: "INVALID", ...metadata, schemaMatch: false };
}

export class NativeExecutor {
  #backend: VerifiedContainerBackend;
  #manifest: NativeRuntimeManifest;
  private constructor(backend: VerifiedContainerBackend, manifest: NativeRuntimeManifest, proof: symbol) {
    if (proof !== construction) fail("BLOCKED"); this.#backend = backend; this.#manifest = manifest;
  }
  static async verify(trustedManifest: unknown, transport: DockerTransport = dockerTransport) {
    try {
      const manifest = manifestSchema.parse(trustedManifest);
      const artifacts = await trustedArtifacts();
      if (JSON.stringify(manifest.artifacts) !== JSON.stringify(artifacts.artifacts)) fail("ARTIFACT_MISMATCH");
      if (manifest.runtime.supportedCompatibilityDate < manifest.runtime.compatibilityDate) fail("COMPATIBILITY_UNSUPPORTED");
      const backend = await VerifiedContainerBackend.verify(profile(manifest.imageId, manifest.artifacts.wrapperDigest), transport);
      const runtime = await probe(backend);
      if (JSON.stringify(runtime) !== JSON.stringify(manifest.runtime)) fail("ARTIFACT_MISMATCH");
      return new NativeExecutor(backend, manifest, construction);
    } catch (error) {
      if (error instanceof Error && ["RSI_NATIVE_ARTIFACT_MISMATCH", "RSI_NATIVE_COMPATIBILITY_UNSUPPORTED"].includes(error.message)) throw error;
      return fail("BLOCKED", nativeCleanupCause(error));
    }
  }
  /** Fixed trusted worker only: never accepts candidate source or run options. */
  async diagnose(shape: "CURRENT" | "REGRESSION" = "CURRENT") {
    this.#backend.assertAvailable();
    const selected = z.enum(["CURRENT", "REGRESSION"]).parse(shape);
    const result = await this.#backend.run(JSON.stringify({ operation: selected === "CURRENT" ? "diagnostic" : "diagnostic-regression" }));
    if (result.code !== 0) fail(`DIAGNOSTIC_EXIT_${result.code >= 0 && result.code <= 255 ? result.code : "UNKNOWN"}`);
    if (result.stderr) fail("DIAGNOSTIC_STDERR");
    const parsed = parseJson(result.stdout);
    const fatal = fatalSchema.safeParse(parsed);
    if (fatal.success) {
      if (JSON.stringify(fatal.data.runtime) !== JSON.stringify(this.#manifest.runtime)) fail("ARTIFACT_MISMATCH");
      return { fatal: true as const, cause: fatal.data.fatal, candidateDispatches: 0 as const, provenance: result.evidence };
    }
    const receipt = diagnosticSchema.parse(parsed);
    if (JSON.stringify(receipt.runtime) !== JSON.stringify(this.#manifest.runtime)) fail("ARTIFACT_MISMATCH");
    return { fatal: false as const, ...receipt.diagnostic, provenance: result.evidence };
  }
  async evaluate(raw: unknown) {
    this.#backend.assertAvailable();
    let input: z.infer<typeof executionSchema>;
    try { input = executionSchema.parse(plainRequest(raw)); } catch { return fail("INPUT"); }
    const artifact = await compileNativeCandidate({ path: input.path, source: input.source, sourceDigest: input.sourceDigest });
    const identity = { ...this.#backend.evidence, sourceDigest: artifact.sourceDigest, compiledDigest: artifact.compiledDigest,
      manifestDigest: hash(JSON.stringify(this.#manifest)), oracleDigest: this.#manifest.artifacts.oracleDigest, harnessDigest: this.#manifest.artifacts.harnessDigest, guardDigest: this.#manifest.artifacts.guardDigest,
      workerdDigest: this.#manifest.runtime.workerdDigest, fixture: input.fixture, limits: NATIVE_LIMITS };
    const provenance: typeof identity & { transport?: z.infer<typeof containerTransportDiagnosticSchema> } = identity;
    const unknown = (reasonCode: string) => ({ verdict: "UNKNOWN" as const, reasonCode, redReproduced: false, greenVerified: false, provenance });
    try {
      const response = await this.#backend.run(JSON.stringify({ operation: "evaluate", fixture: input.fixture, script: artifact.script, sourceDigest: artifact.sourceDigest, compiledDigest: artifact.compiledDigest }));
      const transport = decodeContainerDiagnostic(containerTransportDiagnosticSchema, Object.getOwnPropertyDescriptor(response.evidence, "transport")?.value) as z.infer<typeof containerTransportDiagnosticSchema> | undefined;
      if (transport) provenance.transport = transport;
      if (response.code !== 0) return unknown(`EXECUTION_EXIT_${response.code >= 0 && response.code <= 255 ? response.code : "UNKNOWN"}`);
      if (response.stderr !== "") return unknown("EXECUTION_STDERR");
      const receipt = receiptSchema.parse(parseJson(response.stdout));
      if (receipt.sourceDigest !== artifact.sourceDigest || receipt.compiledDigest !== artifact.compiledDigest || JSON.stringify(receipt.runtime) !== JSON.stringify(this.#manifest.runtime)) return unknown("RECEIPT_MISMATCH");
      const custody = receipt.logs.custody;
      if (!custody.stdoutEof || !custody.stderrEof || custody.errorCount || custody.prematureCloseCount) return {
        ...unknown("RAW_LOG_CUSTODY_UNVERIFIED"), provenance: { ...provenance, pipeCustody: custody, cleanupConfirmed: true },
      };
      if ((receipt.grade.verdict === "PASS" || receipt.grade.verdict === "NO_CHANGE") && (!receipt.logs.valid || receipt.logs.warningCount !== 1 || receipt.logs.rejectedCount !== 0 || receipt.deadlineExpired || !receipt.disposalConfirmed)) return unknown("RECEIPT_MISMATCH");
      if (!receipt.disposalConfirmed) return unknown("RUNTIME_DISPOSAL_UNVERIFIED");
      if (response.evidence.transportKind !== "DOCKER_CLI") return unknown("INJECTED_TRANSPORT");
      return { ...receipt.grade, reason: receipt.reason, provenance: { ...provenance, receiptDigest: response.evidence.outputDigest, traceDigest: receipt.traceDigest, responseDigest: receipt.responseDigest, callCount: receipt.callCount, logs: receipt.logs, childSpawns: receipt.childSpawns, dispatchAttempts: receipt.dispatchAttempts, deadlineExpired: receipt.deadlineExpired, disposalConfirmed: receipt.disposalConfirmed, elapsedMs: receipt.elapsedMs, peakMemoryBytes: receipt.peakMemoryBytes, cleanupConfirmed: true } };
    } catch (error) {
      const message = error && typeof error === "object" && !types.isProxy(error) && error instanceof Error ? Object.getOwnPropertyDescriptor(error, "message")?.value : "";
      const result = unknown(["RSI_SANDBOX_CLEANUP", "RSI_SANDBOX_TIMEOUT", "RSI_SANDBOX_OUTPUT_LIMIT", "RSI_SANDBOX_BLOCKED"].includes(message) ? message : "EXECUTION_UNVERIFIED");
      const cleanupFailure = nativeCleanupCause(error);
      const frame = classifyContainerFailure(error, (stdout, truncated) => failureFrame(stdout, truncated, this.#manifest, artifact));
      return cleanupFailure || frame ? { ...result, provenance: { ...result.provenance,
        ...(frame ? { failureFrame: frame } : {}),
        ...(cleanupFailure && "transport" in cleanupFailure && cleanupFailure.transport ? { transport: cleanupFailure.transport } : {}),
        ...(cleanupFailure && "stage" in cleanupFailure ? { cleanupFailure } : {}),
        ...(cleanupFailure?.startFailure ? { startFailure: cleanupFailure.startFailure } : {}) } } : result;
    }
  }
}
