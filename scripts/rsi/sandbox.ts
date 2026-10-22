import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, normalize } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { z } from "zod";

const policySchema = z.strictObject({
  schemaVersion: z.literal(1), mode: z.literal("LOCAL_SYNTHETIC"),
  image: z.literal("node@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5"),
  imageId: z.literal("sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5"),
  platform: z.literal("linux/arm64"), nodeVersion: z.literal("v22.23.2"),
  dockerVersion: z.literal("29.2.1"), kernelVersion: z.literal("6.8.0-100-generic"), cgroupVersion: z.literal("2"),
  memoryMiB: z.literal(128), tmpfsMiB: z.literal(16), cpus: z.literal(0.5), pids: z.literal(32),
  wallTimeMs: z.literal(3000), watchdogPath: z.literal("/usr/bin/timeout"),
  watchdogSha256: z.literal("3629fa180f625d4de2e3fd3b15b12c5d42315e5733ecae6d1550b306abd7d482"), maxSourceBytes: z.literal(65536), maxInputBytes: z.literal(100000), maxJsonBytes: z.literal(16000),
  maxOutputBytes: z.literal(32768), maxJsonDepth: z.literal(12), maxJsonNodes: z.literal(2048),
});
export const SANDBOX_POLICY = Object.freeze(policySchema.parse(JSON.parse(readFileSync(new URL("./sandbox-policy.json", import.meta.url), "utf8"))));
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const SANDBOX_POLICY_DIGEST = hash(JSON.stringify(SANDBOX_POLICY));
function fail(code: string): never { throw new Error(`RSI_SANDBOX_${code}`); }
export type BoundedJson = null | string | number | boolean | BoundedJson[] | { [key: string]: BoundedJson };
export type BoundedJsonObject = { [key: string]: BoundedJson };

/** Data only: no getters, prototypes, cycles, non-finite values or authority. */
export function parseBoundedJsonObject(value: unknown): BoundedJsonObject {
  let nodes = 0, bytes = 0;
  const ancestors = new Set<object>();
  function visit(item: unknown, depth: number): BoundedJson {
    if (++nodes > SANDBOX_POLICY.maxJsonNodes || depth > SANDBOX_POLICY.maxJsonDepth) fail("INPUT");
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "string") { if ((bytes += Buffer.byteLength(item)) > SANDBOX_POLICY.maxJsonBytes) fail("INPUT"); return item; }
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (typeof item !== "object" || !item || ancestors.has(item)) fail("INPUT");
    const array = Array.isArray(item);
    if (Object.getPrototypeOf(item) !== (array ? Array.prototype : Object.prototype)) fail("INPUT");
    ancestors.add(item);
    const result: BoundedJson[] | BoundedJsonObject = array ? [] : {};
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (Reflect.ownKeys(item).some(key => typeof key !== "string")) fail("INPUT");
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (array && key === "length") continue;
      if ((bytes += Buffer.byteLength(key)) > SANDBOX_POLICY.maxJsonBytes) fail("INPUT");
      if (!descriptor.enumerable || !("value" in descriptor) || ["__proto__", "constructor", "prototype"].includes(key)
        || (array && !/^(0|[1-9][0-9]*)$/.test(key))) fail("INPUT");
      (result as BoundedJsonObject)[key] = visit(descriptor.value, depth + 1);
    }
    if (array && Object.keys(result).length !== (item as unknown[]).length) fail("INPUT");
    ancestors.delete(item); return result;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INPUT");
  const result = visit(value, 0) as BoundedJsonObject;
  if (Buffer.byteLength(JSON.stringify(result)) > SANDBOX_POLICY.maxJsonBytes) fail("INPUT");
  return result;
}
const inputSchema = z.strictObject({ schemaVersion: z.literal(1), taskKind: z.enum(["repair", "improve-agent"]), payload: z.unknown().transform(parseBoundedJsonObject) });
const requestSchema = z.strictObject({ schemaVersion: z.literal(1), source: z.string().min(1).max(SANDBOX_POLICY.maxSourceBytes), input: inputSchema });
const outputSchema = z.strictObject({ schemaVersion: z.literal(1), output: z.unknown().transform(parseBoundedJsonObject) });
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

// This string runs ONLY in the container. Node permissions are defense in depth;
// the Linux namespaces/cgroups/seccomp and absent mounts are the isolation boundary.
const wrapper = `
const stringify = JSON.stringify.bind(JSON), write = process.stdout.write.bind(process.stdout), exit = process.exit.bind(process);
try {
 process.stdin.setEncoding('utf8');
 let raw = ''; for await (const chunk of process.stdin) { raw += chunk; if (Buffer.byteLength(raw) > 100000) exit(71); }
 const request = JSON.parse(raw);
 for (const key of Object.keys(process.env)) delete process.env[key];
 const module = await import('data:text/javascript;base64,' + Buffer.from(request.source).toString('base64'));
 if (typeof module.default !== 'function') exit(72);
 const output = await module.default(request.input);
 write(stringify({schemaVersion:1,output})+'\\n');
} catch { exit(73); }
`;
const runtimeProbe = `
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const read = path => readFileSync(path,'utf8').trim();
const initStatus = read('/proc/1/status');
const status = read('/proc/self/status'), mounts = read('/proc/self/mountinfo').split('\\n');
const mount = path => mounts.find(line=>line.split(' ')[4]===path) ?? '';
const root = mount('/'), tmp = mount('/tmp');
process.stdout.write(JSON.stringify({watchdogDigest:createHash('sha256').update(readFileSync('/usr/bin/timeout')).digest('hex'),watchdogPid:Number(initStatus.match(/^Pid:\\s+(\\d+)/m)?.[1]),watchdogName:initStatus.match(/^Name:\\s+(\\S+)/m)?.[1],parentPid:process.ppid,runtime:process.version+' '+process.platform+' '+process.arch,
 memory:read('/sys/fs/cgroup/memory.max'),swap:read('/sys/fs/cgroup/memory.swap.max'),
 pids:read('/sys/fs/cgroup/pids.max'),cpu:read('/sys/fs/cgroup/cpu.max'),uid:process.getuid(),
 seccomp:Number(status.match(/^Seccomp:\\s+(\\d+)/m)?.[1]),caps:status.match(/^CapEff:\\s+(\\w+)/m)?.[1],noNewPrivileges:/^NoNewPrivs:\\s+1$/m.test(status),
 rootReadOnly:root.split(' ')[5]?.split(',').includes('ro')===true,
 tmpfsBounded:tmp.includes(' - tmpfs ') && tmp.includes('size=16384k') && ['noexec','nosuid','nodev'].every(flag=>tmp.split(' ')[5]?.split(',').includes(flag)),
 networkNone:read('/proc/net/dev').split('\\n').slice(2).every(line=>line.trim().startsWith('lo:'))
})+'\\n');
`;
const isolationSchema = z.strictObject({ watchdogDigest:z.literal(SANDBOX_POLICY.watchdogSha256), watchdogPid:z.literal(1), watchdogName:z.literal("timeout"), parentPid:z.literal(1), runtime: z.literal("v22.23.2 linux arm64"), memory: z.literal("134217728"), swap: z.literal("0"),
  pids: z.literal("32"), cpu: z.literal("50000 100000"), uid: z.literal(65532), seccomp: z.literal(2), caps: z.literal("0000000000000000"),
  noNewPrivileges: z.literal(true), rootReadOnly: z.literal(true), tmpfsBounded: z.literal(true), networkNone: z.literal(true) });
const commandLimits = { timeoutMs: 5000, maxOutputBytes: 65536 };

/** Only this factory grants execution capability; unavailable/unverified is BLOCKED. */
export class DockerSandbox {
  private blocked = false;
  private constructor(private readonly transport: DockerTransport, private readonly runtime: string, private isolation?: z.infer<typeof isolationSchema>) {}
  static async verify(transport: DockerTransport = dockerTransport): Promise<DockerSandbox> {
    try {
      const infoResponse = await transport(["info", "--format", "{{json .}}"], "", commandLimits);
      if (infoResponse.code !== 0) fail("BLOCKED");
      const info = JSON.parse(infoResponse.stdout);
      if (info.ServerVersion !== SANDBOX_POLICY.dockerVersion || info.OSType !== "linux" || !["aarch64", "arm64"].includes(info.Architecture)
        || info.KernelVersion !== SANDBOX_POLICY.kernelVersion || info.CgroupVersion !== SANDBOX_POLICY.cgroupVersion
        || !info.MemoryLimit || !info.SwapLimit || !info.CpuCfsQuota || !info.PidsLimit
        || !Array.isArray(info.SecurityOptions) || !info.SecurityOptions.includes("name=seccomp,profile=builtin")) fail("BLOCKED");
      const inspected = await transport(["image", "inspect", SANDBOX_POLICY.image], "", commandLimits);
      if (inspected.code !== 0) fail("BLOCKED");
      const images = JSON.parse(inspected.stdout), image = images[0];
      if (images.length !== 1 || image.Id !== SANDBOX_POLICY.imageId || !image.RepoDigests?.includes(SANDBOX_POLICY.image)
        || image.Os !== "linux" || image.Architecture !== "arm64" || !image.Config?.Env?.includes("NODE_VERSION=22.23.2")) fail("BLOCKED");
      const runtime = `${SANDBOX_POLICY.nodeVersion} linux arm64`;
      const sandbox = new DockerSandbox(transport, runtime);
      const probe = await sandbox.container(runtimeProbe, "");
      if (probe.code !== 0 || probe.stderr !== "") fail("BLOCKED");
      sandbox.isolation = isolationSchema.parse(JSON.parse(probe.stdout));
      return sandbox;
    } catch { return fail("BLOCKED"); }
  }

  private async container(script: string, stdin: string) {
    const owner = randomUUID(), name = `rsi-${owner}`;
    const p = SANDBOX_POLICY;
    const args = ["create", "--name", name, "--label", `rsi.sandbox.owner=${owner}`, "--pull=never", `--platform=${p.platform}`,
      "--network=none", "--read-only",
      ...["HTTP_PROXY", "HTTPS_PROXY", "FTP_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "ftp_proxy", "all_proxy", "no_proxy"].map(key => `--env=${key}=`), "--user=65532:65532", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--ipc=none",
      `--memory=${p.memoryMiB}m`, `--memory-swap=${p.memoryMiB}m`, `--cpus=${p.cpus}`, `--pids-limit=${p.pids}`,
      `--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=${p.tmpfsMiB}m,mode=1777`, "--shm-size=1m", "--ulimit=nofile=64:64", "--ulimit=core=0:0",
      "--log-driver=none", "--workdir=/tmp", "--interactive", `--entrypoint=${p.watchdogPath}`, p.image,
      "--signal=KILL", `${p.wallTimeMs / 1000}s`, "/usr/local/bin/node", "--permission", ...(script === runtimeProbe ? ["--allow-fs-read=/proc/1/status", "--allow-fs-read=/usr/bin/timeout", "--allow-fs-read=/proc/self/status", "--allow-fs-read=/proc/self/mountinfo", "--allow-fs-read=/proc/net/dev", "--allow-fs-read=/sys/fs/cgroup"] : []), "--max-old-space-size=64", "--input-type=module", "-e", script];
    try {
      const creation = await this.transport(args, "", commandLimits);
      if (creation.code !== 0 || !/^[a-f0-9]{64}\n?$/.test(creation.stdout)) fail("UNAVAILABLE");
      return await this.transport(["start", "--attach", "--interactive", name], stdin, { timeoutMs: p.wallTimeMs, maxOutputBytes: p.maxOutputBytes });
    } finally {
      // Includes uncertain create outcomes. Ownership must match before deletion;
      // never prune, enumerate/remove others, or trust candidate-supplied IDs.
      try {
        const inspection = await this.transport(["inspect", name], "", commandLimits);
        // Missing after an interrupted create is ambiguous: the daemon may
        // still complete it later. Never call that a confirmed cleanup.
        if (inspection.code !== 0) fail("CLEANUP");
        else {
          const rows = JSON.parse(inspection.stdout), row = rows[0];
          if (rows.length !== 1 || row.Name !== `/${name}` || row.Config?.Labels?.["rsi.sandbox.owner"] !== owner || !/^[a-f0-9]{64}$/.test(row.Id)) fail("CLEANUP");
          const removed = await this.transport(["rm", "--force", row.Id], "", commandLimits);
          if (removed.code !== 0) fail("CLEANUP");
        }
      } catch { this.blocked = true; fail("CLEANUP"); }
    }
  }

  async execute(raw: unknown) {
    if (this.blocked) fail("BLOCKED");
    let request: z.infer<typeof requestSchema>;
    try {
      request = requestSchema.parse(raw);
      if (Buffer.byteLength(request.source) > SANDBOX_POLICY.maxSourceBytes || Buffer.byteLength(JSON.stringify(request)) > SANDBOX_POLICY.maxInputBytes) fail("INPUT");
    } catch { return fail("INPUT"); }
    const result = await this.container(wrapper, JSON.stringify(request));
    if (result.code !== 0) fail("EXECUTION");
    try {
      if (Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > SANDBOX_POLICY.maxOutputBytes || result.stderr !== "") fail("IPC");
      const text = result.stdout.endsWith("\n") ? result.stdout.slice(0, -1) : result.stdout;
      const decoded: unknown = JSON.parse(text), parsed = outputSchema.parse(decoded);
      if (JSON.stringify(decoded) !== text) fail("IPC");
      // This proves bounded IPC and process exit, not honest function execution,
      // evaluator success, authorization or the truth of any candidate claim.
      return { untrustedOutput: parsed.output, evidence: { kind: "LOCAL_CONTAINER_RETURN" as const,
        transportKind: this.transport === dockerTransport ? "DOCKER_CLI" as const : "INJECTED_TRANSPORT" as const,
        policyDigest: SANDBOX_POLICY_DIGEST, wrapperDigest: hash(wrapper), sourceDigest: hash(request.source), inputDigest: hash(JSON.stringify(request.input)),
        outputDigest: hash(text), imageDigest: SANDBOX_POLICY.image, runtime: this.runtime, isolation: { ...this.isolation! } } };
    } catch { return fail("IPC"); }
  }
}
