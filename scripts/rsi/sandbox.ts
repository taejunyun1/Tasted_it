import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";

import { VerifiedContainerBackend, dockerTransport, type DockerTransport, type TrustedContainerProfile } from "./container-backend";
export { createLocalDockerTransport, dockerTransport, type DockerCommandLimits, type DockerTransport } from "./container-backend";

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
// Only this trusted adapter constructs the Node profile; candidate envelopes
// are parsed separately and cannot override the entrypoint, image or limits.
const nodeProfile: TrustedContainerProfile = {
  schemaVersion: 1, image: SANDBOX_POLICY.image, imageId: SANDBOX_POLICY.imageId,
  baseImage: SANDBOX_POLICY.image, baseImageId: SANDBOX_POLICY.imageId,
  platform: SANDBOX_POLICY.platform, nodeVersion: SANDBOX_POLICY.nodeVersion,
  dockerVersion: SANDBOX_POLICY.dockerVersion, kernelVersion: SANDBOX_POLICY.kernelVersion, cgroupVersion: SANDBOX_POLICY.cgroupVersion,
  watchdogPath: SANDBOX_POLICY.watchdogPath, watchdogSha256: SANDBOX_POLICY.watchdogSha256,
  memoryMiB: SANDBOX_POLICY.memoryMiB, tmpfsMiB: SANDBOX_POLICY.tmpfsMiB, cpus: SANDBOX_POLICY.cpus, pids: SANDBOX_POLICY.pids,
  wallTimeMs: SANDBOX_POLICY.wallTimeMs, maxOutputBytes: SANDBOX_POLICY.maxOutputBytes, maxInputBytes: SANDBOX_POLICY.maxInputBytes,
  entrypoint: { kind: "inline-node", source: wrapper, sha256: hash(wrapper) },
};

/** Public agent envelope remains separate from the trusted container capability. */
export class DockerSandbox {
  private constructor(private readonly backend: VerifiedContainerBackend) {}
  static async verify(transport: DockerTransport = dockerTransport): Promise<DockerSandbox> {
    return new DockerSandbox(await VerifiedContainerBackend.verify(nodeProfile, transport));
  }
  async execute(raw: unknown) {
    this.backend.assertAvailable();
    let request: z.infer<typeof requestSchema>;
    try {
      request = requestSchema.parse(raw);
      if (Buffer.byteLength(request.source) > SANDBOX_POLICY.maxSourceBytes || Buffer.byteLength(JSON.stringify(request)) > SANDBOX_POLICY.maxInputBytes) fail("INPUT");
    } catch { return fail("INPUT"); }
    const result = await this.backend.run(JSON.stringify(request));
    if (result.code !== 0) fail("EXECUTION");
    try {
      if (Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > SANDBOX_POLICY.maxOutputBytes || result.stderr !== "") fail("IPC");
      const text = result.stdout.endsWith("\n") ? result.stdout.slice(0, -1) : result.stdout;
      const decoded: unknown = JSON.parse(text), parsed = outputSchema.parse(decoded);
      if (JSON.stringify(decoded) !== text) fail("IPC");
      // This proves bounded IPC and process exit, not honest function execution,
      // evaluator success, authorization or the truth of any candidate claim.
      return { untrustedOutput: parsed.output, evidence: { kind: "LOCAL_CONTAINER_RETURN" as const,
        transportKind: result.evidence.transportKind,
        policyDigest: SANDBOX_POLICY_DIGEST, wrapperDigest: hash(wrapper), sourceDigest: hash(request.source), inputDigest: hash(JSON.stringify(request.input)),
        outputDigest: hash(text), imageDigest: SANDBOX_POLICY.image, runtime: result.evidence.runtime, isolation: { ...result.evidence.isolation } } };
    } catch { return fail("IPC"); }
  }
}
