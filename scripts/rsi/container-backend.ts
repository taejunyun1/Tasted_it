import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, normalize } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { z } from "zod";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function fail(code: string): never { throw new Error(`RSI_SANDBOX_${code}`); }
export const containerCleanupFailureSchema = z.strictObject({
  stage: z.enum(["INSPECT_TRANSPORT", "INSPECT_EXIT", "INSPECT_JSON", "INSPECT_OWNERSHIP", "RM_TRANSPORT", "RM_EXIT"]),
  failure: z.enum(["TIMEOUT", "OUTPUT_LIMIT", "UNAVAILABLE", "EXIT", "INVALID_JSON", "OWNERSHIP", "OTHER"]),
});
type CleanupStage = z.infer<typeof containerCleanupFailureSchema>["stage"];
type CleanupFailure = z.infer<typeof containerCleanupFailureSchema>["failure"];
const knownCleanupCauses = new WeakSet<object>();
function cleanupError(stage: CleanupStage, failure: CleanupFailure) {
  const cause = Object.freeze({ stage, failure }); knownCleanupCauses.add(cause);
  return new Error("RSI_SANDBOX_CLEANUP", { cause });
}
function cleanupCause(error: unknown) {
  if (!(error instanceof Error)) return undefined;
  const cause: unknown = Object.getOwnPropertyDescriptor(error, "cause")?.value;
  return cause && typeof cause === "object" && knownCleanupCauses.has(cause) ? cause : undefined;
}
function transportFailure(error: unknown): CleanupFailure {
  const message = error instanceof Error ? error.message : "";
  return message === "RSI_SANDBOX_TIMEOUT" ? "TIMEOUT" : message === "RSI_SANDBOX_OUTPUT_LIMIT" ? "OUTPUT_LIMIT"
    : message === "RSI_SANDBOX_UNAVAILABLE" ? "UNAVAILABLE" : "OTHER";
}

export interface DockerCommandLimits { timeoutMs: number; maxOutputBytes: number }
export type DockerTransport = (args: readonly string[], stdin: string, limits: DockerCommandLimits) => Promise<{ code: number; stdout: string; stderr: string }>;

/** Trusted Docker CLI only. Candidate bytes are stdin, never a shell or argv. */
type DockerCliRunner = (args: readonly string[], stdin: string, limits: DockerCommandLimits, environment: NodeJS.ProcessEnv) => ReturnType<DockerTransport>;
const runDockerCli: DockerCliRunner = (args, stdin, limits, environment) => new Promise((resolve, reject) => {
  const child = spawn("docker", [...args], { shell: false, env: environment, stdio: ["pipe", "pipe", "pipe"] });
  let outputBytes = 0, stdout = "", stderr = "", failure: string | undefined;
  const outDecoder = new StringDecoder("utf8"), errDecoder = new StringDecoder("utf8");
  const stop = (code: string) => { failure ??= code; child.kill("SIGKILL"); };
  const timer = setTimeout(() => stop("TIMEOUT"), limits.timeoutMs);
  child.stdout.on("data", (chunk: Buffer) => { outputBytes += chunk.length; if (outputBytes > limits.maxOutputBytes) stop("OUTPUT_LIMIT"); else stdout += outDecoder.write(chunk); });
  child.stderr.on("data", (chunk: Buffer) => { outputBytes += chunk.length; if (outputBytes > limits.maxOutputBytes) stop("OUTPUT_LIMIT"); else stderr += errDecoder.write(chunk); });
  child.once("error", () => { clearTimeout(timer); reject(new Error("RSI_SANDBOX_UNAVAILABLE")); });
  child.once("close", code => { clearTimeout(timer); if (failure) reject(new Error(`RSI_SANDBOX_${failure}`)); else resolve({ code: code ?? -1, stdout: stdout + outDecoder.end(), stderr: stderr + errDecoder.end() }); });
  child.stdin.on("error", () => {}); child.stdin.end(stdin);
});

/** Resolve local configuration once, then pin all operations to that Unix socket.
 * No candidate may supply this environment/runner; they are trusted test seams.
 * Socket paths and Docker diagnostics are never returned as evidence/errors. */
export function createLocalDockerTransport(environment: NodeJS.ProcessEnv = process.env, runner: DockerCliRunner = runDockerCli): DockerTransport {
  const env = Object.freeze({ PATH: environment.PATH, HOME: environment.HOME, DOCKER_CONFIG: environment.DOCKER_CONFIG });
  const configuredHost = environment.DOCKER_HOST, configuredContext = environment.DOCKER_CONTEXT;
  let selected: Promise<string> | undefined;
  function localEndpoint(value: unknown) {
    if (typeof value !== "string" || !value.startsWith("unix:///") || /[\0\r\n?#%]/.test(value)) fail("BLOCKED");
    const path = value.slice("unix://".length);
    if (!isAbsolute(path) || normalize(path) !== path || path === "/") fail("BLOCKED");
    return value;
  }
  async function select() {
    if (configuredHost) { if (configuredContext) fail("BLOCKED"); return localEndpoint(configuredHost); }
    const context = await runner(["context", "inspect"], "", { timeoutMs: 5000, maxOutputBytes: 65536 }, { ...env, ...(configuredContext ? { DOCKER_CONTEXT: configuredContext } : {}) });
    if (context.code !== 0) fail("BLOCKED");
    const rows = JSON.parse(context.stdout);
    if (!Array.isArray(rows) || rows.length !== 1) fail("BLOCKED");
    return localEndpoint(rows[0]?.Endpoints?.docker?.Host);
  }
  return async (args, stdin, limits) => {
    selected ??= select().catch(() => fail("BLOCKED"));
    const endpoint = await selected;
    return runner(["--host", endpoint, ...args], stdin, limits, env);
  };
}
export const dockerTransport = createLocalDockerTransport();

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
    let createdId: string | undefined;
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
    const inspectOwned = async () => {
      let inspection: Awaited<ReturnType<DockerTransport>>;
      try { inspection = await this.#transport(["inspect", name], "", commandLimits); }
      catch (error) { throw cleanupError("INSPECT_TRANSPORT", transportFailure(error)); }
      if (inspection.code !== 0) throw cleanupError("INSPECT_EXIT", "EXIT");
      let rows: unknown;
      try { rows = JSON.parse(inspection.stdout); } catch { throw cleanupError("INSPECT_JSON", "INVALID_JSON"); }
      const row = Array.isArray(rows) ? rows[0] : undefined;
      if (!Array.isArray(rows) || rows.length !== 1 || !row || row.Name !== `/${name}` || row.Config?.Labels?.["rsi.sandbox.owner"] !== owner
        || !/^[a-f0-9]{64}$/.test(row.Id) || (createdId !== undefined && row.Id !== createdId)) throw cleanupError("INSPECT_OWNERSHIP", "OWNERSHIP");
      return row;
    };
    try {
      const creation = await this.#transport(args, "", commandLimits);
      if (creation.code !== 0 || !/^[a-f0-9]{64}\n?$/.test(creation.stdout)) fail("UNAVAILABLE");
      createdId = creation.stdout.trim();
      const row = await inspectOwned();
      if (!Array.isArray(row.Mounts) || row.Mounts.length !== 0) fail("BLOCKED");
      const result = await this.#transport(["start", "--attach", "--interactive", name], stdin, { timeoutMs: p.wallTimeMs, maxOutputBytes: p.maxOutputBytes });
      if (typeof result.stdout !== "string" || typeof result.stderr !== "string" || !Number.isInteger(result.code)) fail("IPC");
      // Real CLI overflow is OUTPUT_LIMIT; a transport returning an oversized
      // completed response violates IPC (the existing Node adapter contract).
      if (Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > p.maxOutputBytes) fail("IPC");
      return result;
    } finally {
      // Exact ownership and ID, including uncertain create outcomes; no pruning.
      // Missing inspection is ambiguous (a daemon may still complete creation).
      try {
        const row = await inspectOwned();
        let removed: Awaited<ReturnType<DockerTransport>>;
        try { removed = await this.#transport(["rm", "--force", row.Id], "", commandLimits); }
        catch (error) { throw cleanupError("RM_TRANSPORT", transportFailure(error)); }
        if (removed.code !== 0) throw cleanupError("RM_EXIT", "EXIT");
      } catch (error) {
        this.#blocked = true;
        const cause = cleanupCause(error);
        if (cause) throw new Error("RSI_SANDBOX_CLEANUP", { cause });
        throw cleanupError("INSPECT_OWNERSHIP", "OTHER");
      }
    }
  }

  async run(stdin: string) {
    this.assertAvailable();
    if (typeof stdin !== "string" || Buffer.byteLength(stdin) > this.#profile.maxInputBytes) fail("INPUT");
    // Serialize runs so no queued candidate can dispatch after uncertain cleanup.
    const result = this.#tail.then(async () => {
      this.assertAvailable();
      const response = await this.#container(stdin);
      return { ...response, evidence: Object.freeze({ ...this.evidence, kind: "LOCAL_CONTAINER_RETURN" as const,
        stdinDigest: hash(stdin), outputDigest: hash(response.stdout) }) };
    });
    this.#tail = result.catch(() => {});
    return result;
  }
}
