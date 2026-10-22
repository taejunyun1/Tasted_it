import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { VerifiedContainerBackend, type DockerTransport, type TrustedContainerProfile } from "../../scripts/rsi/container-backend";
import { createLocalDockerTransport as legacyLocal, dockerTransport as legacyTransport } from "../../scripts/rsi/sandbox";
import { createLocalDockerTransport, dockerTransport } from "../../scripts/rsi/container-backend";

const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const baseId = "sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5";
const nativeId = `sha256:${"b".repeat(64)}`;
const wrapper = "process.stdout.write('synthetic');";
function profile(): TrustedContainerProfile {
  return {
    schemaVersion: 1, image: `node@${baseId}`, imageId: baseId,
    baseImage: `node@${baseId}`, baseImageId: baseId,
    platform: "linux/arm64", nodeVersion: "v22.23.2", dockerVersion: "29.2.1", kernelVersion: "6.8.0-100-generic", cgroupVersion: "2",
    watchdogPath: "/usr/bin/timeout", watchdogSha256: "3629fa180f625d4de2e3fd3b15b12c5d42315e5733ecae6d1550b306abd7d482",
    memoryMiB: 128, tmpfsMiB: 16, cpus: 0.5, pids: 32, wallTimeMs: 3000, maxOutputBytes: 32768, maxInputBytes: 100000,
    entrypoint: { kind: "inline-node", source: wrapper, sha256: digest(wrapper) },
  };
}
const isolation = { watchdogDigest: profile().watchdogSha256, watchdogPid: 1, watchdogName: "timeout", parentPid: 1, runtime: "v22.23.2 linux arm64", memory: "134217728", swap: "0", pids: "32", cpu: "50000 100000", uid: 65532, seccomp: 2, caps: "0000000000000000", noNewPrivileges: true, rootReadOnly: true, tmpfsBounded: true, networkNone: true };
function fakeDocker(p = profile()) {
  const calls: { args: string[]; stdin: string; limits: { timeoutMs: number; maxOutputBytes: number } }[] = [];
  let name = "", owner = "", id = "", serial = 0;
  const state = { probe: { ...isolation } as Record<string, unknown>, imageId: p.imageId, volumes: {}, mounts: [] as unknown[], wrongId: false, cleanupError: false, replay: false, baseLayers: ["sha256:base"], imageLayers: ["sha256:base", "sha256:derived"], output: "synthetic" };
  if (p.entrypoint.kind === "native-file") state.probe.entrypoint = { sha256: p.entrypoint.sha256, regular: true, uid: 0, writable: false };
  const transport: DockerTransport = async (args, stdin, limits) => {
    calls.push({ args: [...args], stdin, limits: { ...limits } });
    const ok = (stdout: string) => ({ code: 0, stdout, stderr: "" });
    if (args[0] === "info") return ok(JSON.stringify({ ServerVersion: "29.2.1", OSType: "linux", Architecture: "aarch64", KernelVersion: "6.8.0-100-generic", CgroupVersion: "2", MemoryLimit: true, SwapLimit: true, CpuCfsQuota: true, PidsLimit: true, SecurityOptions: ["name=seccomp,profile=builtin"] }));
    if (args[0] === "image") {
      const base = args[2] === p.baseImage;
      return ok(JSON.stringify([{ Id: base ? baseId : state.imageId, RepoDigests: base ? [p.baseImage] : [], Os: "linux", Architecture: "arm64", Config: { Env: ["NODE_VERSION=22.23.2"], Volumes: state.volumes }, RootFS: { Layers: base ? state.baseLayers : state.imageLayers } }]));
    }
    if (args[0] === "create") { serial++; name = args[args.indexOf("--name") + 1]; owner = args[args.indexOf("--label") + 1].split("=")[1]; id = serial.toString(16).padStart(64, "0"); return ok(id); }
    if (args[0] === "start") return ok(stdin ? state.output : JSON.stringify(state.probe));
    if (args[0] === "inspect") return ok(JSON.stringify([{ Id: state.wrongId ? "c".repeat(64) : id, Name: `/${name}`, Config: { Labels: { "rsi.sandbox.owner": state.replay ? "previous-owner" : owner } }, Mounts: state.mounts }]));
    if (args[0] === "rm") { if (state.cleanupError) throw Error("private daemon detail"); return ok(id); }
    throw Error("unexpected");
  };
  return { transport, calls, state };
}

describe("trusted container backend", () => {
  it.each(["TIMEOUT", "OUTPUT_LIMIT"])("counts both CLI pipes without retaining partial output on %s", async failure => {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(),
      kill: vi.fn(() => { queueMicrotask(() => child.emit("close", null)); return true; }) });
    const spawn = vi.spyOn(childProcess, "spawn").mockReturnValue(child as unknown as ReturnType<typeof childProcess.spawn>);
    syncBuiltinESMExports();
    try {
      const transport = createLocalDockerTransport({ DOCKER_HOST: "unix:///synthetic.sock" });
      const pending = transport(["start", "synthetic"], "", { timeoutMs: 10, maxOutputBytes: failure === "OUTPUT_LIMIT" ? 4 : 32 }).catch(error => error);
      await vi.advanceTimersByTimeAsync(0);
      child.stdout.write(Buffer.from("abc")); child.stderr.write(Buffer.from("de"));
      await vi.advanceTimersByTimeAsync(10);
      const error = await pending;
      expect(error.message).toBe(`RSI_SANDBOX_${failure}`);
      expect(error.cause).toEqual({ failure, stdoutBytes: 3, stderrBytes: 2 });
      expect(Object.isFrozen(error.cause)).toBe(true);
      expect(JSON.stringify(error.cause)).not.toContain("abc");
      expect(JSON.stringify(error.cause)).not.toContain("synthetic.sock");
    } finally { spawn.mockRestore(); syncBuiltinESMExports(); vi.useRealTimers(); }
  });
  it("preserves transport imports and returns bounded untrusted local evidence", async () => {
    expect(legacyLocal).toBe(createLocalDockerTransport); expect(legacyTransport).toBe(dockerTransport);
    const fake = fakeDocker(); const backend = await VerifiedContainerBackend.verify(profile(), fake.transport);
    const result = await backend.run("candidate data");
    expect(result.stdout).toBe("synthetic"); expect(result.evidence.kind).toBe("LOCAL_CONTAINER_RETURN");
    expect(result.evidence.transportKind).toBe("INJECTED_TRANSPORT");
    expect(result.evidence.entrypointKind).toBe("inline-node"); expect(result.evidence.entrypointDigest).toBe(digest(wrapper));
    expect(result.evidence.profileDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.evidence.isolation).toEqual(isolation);
    expect(fake.calls.filter(c => c.args[0] === "create").every(c => !c.args.includes("candidate data"))).toBe(true);
  });
  it("does not grant a capability by bypassing the TypeScript private constructor", () => {
    const fake = fakeDocker();
    expect(() => Reflect.construct(VerifiedContainerBackend, [profile(), fake.transport])).toThrow("RSI_SANDBOX_BLOCKED");
    expect(fake.calls).toHaveLength(0);
  });
  it("snapshots and freezes the profile before any asynchronous verification", async () => {
    const trusted = profile(), fake = fakeDocker();
    const pending = VerifiedContainerBackend.verify(trusted, fake.transport);
    trusted.memoryMiB = 512; trusted.wallTimeMs = 15000;
    trusted.entrypoint = { kind: "inline-node", source: "malicious", sha256: digest("malicious") };
    const backend = await pending; const first = await backend.run("data");
    expect(() => { (first.evidence.isolation as { uid: number }).uid = 0; }).toThrow();
    const second = await backend.run("data"); expect(second.evidence.profileDigest).toBe(first.evidence.profileDigest);
    for (const call of fake.calls.filter(c => c.args[0] === "create")) { expect(call.args).toContain("--memory=128m"); expect(call.args).toContain("3s"); expect(call.args).not.toContain("malicious"); }
  });
  it.each([
    { image: "node:latest" }, { image: "evil@" + baseId }, { imageId: nativeId }, { baseImageId: nativeId },
    { platform: "linux/amd64" }, { nodeVersion: "v24.0.0" }, { kernelVersion: "new" },
    { memoryMiB: 513 }, { memoryMiB: 0 }, { tmpfsMiB: 65 }, { cpus: 1.01 }, { cpus: NaN }, { pids: 65 }, { pids: 1.5 },
    { wallTimeMs: 15001 }, { maxOutputBytes: 32769 }, { maxInputBytes: 100001 },
    { command: ["/bin/sh"] }, { mounts: ["/home:/host"] }, { network: "host" }, { env: { SECRET: "bad" } },
    { entrypoint: { kind: "inline-node", source: wrapper, sha256: "0".repeat(64) } },
    { entrypoint: { kind: "native-file", path: "/tmp/wrapper.mjs", sha256: "0".repeat(64) } },
  ])("rejects closed profile violations before transport: %j", async patch => {
    const fake = fakeDocker(); await expect(VerifiedContainerBackend.verify({ ...profile(), ...patch } as TrustedContainerProfile, fake.transport)).rejects.toThrow("RSI_SANDBOX_BLOCKED");
    expect(fake.calls).toHaveLength(0);
  });
  it("rejects profile accessors without invoking them", async () => {
    const p = profile(); let invoked = false;
    Object.defineProperty(p, "memoryMiB", { get() { invoked = true; return 128; }, enumerable: true });
    const fake = fakeDocker(); await expect(VerifiedContainerBackend.verify(p, fake.transport)).rejects.toThrow("RSI_SANDBOX_BLOCKED");
    expect(invoked).toBe(false); expect(fake.calls).toHaveLength(0);
  });
  it.each(["parentPid", "watchdogDigest", "memory", "cpu", "seccomp", "networkNone", "tmpfsBounded", "uid"])("fails closed on mismatched probe %s", async field => {
    const fake = fakeDocker(); fake.state.probe[field] = "wrong";
    await expect(VerifiedContainerBackend.verify(profile(), fake.transport)).rejects.toThrow("RSI_SANDBOX_BLOCKED");
  });
  it("rejects image-defined volumes and unexpected mounts before starting", async () => {
    for (const field of ["volumes", "mounts"] as const) {
      const fake = fakeDocker(); if (field === "volumes") fake.state.volumes = { "/data": {} }; else fake.state.mounts = [{ Type: "bind", Source: "/private", Destination: "/data" }];
      await expect(VerifiedContainerBackend.verify(profile(), fake.transport)).rejects.toThrow("RSI_SANDBOX_BLOCKED");
      expect(fake.calls.some(c => c.args[0] === "start")).toBe(false);
    }
  });
  it.each(["wrongId", "replay", "cleanupError"] as const)("quarantines on %s and never removes another owner's container", async fault => {
    const fake = fakeDocker(); const backend = await VerifiedContainerBackend.verify(profile(), fake.transport);
    fake.state[fault] = true; const prior = fake.calls.length;
    await expect(backend.run("data")).rejects.toThrow("RSI_SANDBOX_CLEANUP");
    if (fault !== "cleanupError") expect(fake.calls.slice(prior).some(c => c.args[0] === "rm")).toBe(false);
    fake.state[fault] = false; const count = fake.calls.length;
    await expect(backend.run("data")).rejects.toThrow("RSI_SANDBOX_BLOCKED"); expect(fake.calls).toHaveLength(count);
  });
  it("rejects non-string/oversized stdin before creating containers", async () => {
    const fake = fakeDocker(); const backend = await VerifiedContainerBackend.verify(profile(), fake.transport); const count = fake.calls.length;
    for (const data of ["x".repeat(100001), {}]) await expect(backend.run(data as string)).rejects.toThrow("RSI_SANDBOX_INPUT");
    expect(fake.calls).toHaveLength(count);
  });
  it("does not trust injected output bounds", async () => {
    const fake = fakeDocker(); const backend = await VerifiedContainerBackend.verify(profile(), fake.transport); fake.state.output = "x".repeat(32769);
    await expect(backend.run("data")).rejects.toThrow("RSI_SANDBOX_IPC");
    expect(fake.calls.at(-1)?.args[0]).toBe("rm");
  });
  it("pins the entire verification/run/cleanup lifecycle despite ambient endpoint pollution", async () => {
    const env = { DOCKER_HOST: "unix:///synthetic.sock", HOME: "/synthetic", PATH: "/synthetic-bin", HTTP_PROXY: "private-proxy" };
    const fake = fakeDocker(); const calls: string[][] = [];
    const transport = createLocalDockerTransport(env, async (args, stdin, limits, frozenEnv) => {
      calls.push([...args]); expect(args.slice(0, 2)).toEqual(["--host", "unix:///synthetic.sock"]);
      expect(frozenEnv.HOME).toBe("/synthetic"); expect(frozenEnv.HTTP_PROXY).toBeUndefined(); expect(frozenEnv.DOCKER_HOST).toBeUndefined();
      env.DOCKER_HOST = "ssh://remote"; env.HOME = "/changed";
      return fake.transport(args.slice(2), stdin, limits);
    });
    const backend = await VerifiedContainerBackend.verify(profile(), transport); await backend.run("data");
    expect(new Set(calls.map(args => args[2]))).toEqual(new Set(["info", "image", "create", "inspect", "start", "rm"]));
  });
  it("permanently blocks queued runs after uncertain create and cleanup", async () => {
    const fake = fakeDocker(); let broken = false; let afterFailure = 0;
    const transport: DockerTransport = async (args, stdin, limits) => {
      if (broken) { afterFailure++; throw Error("RSI_SANDBOX_TIMEOUT"); }
      return fake.transport(args, stdin, limits);
    };
    const backend = await VerifiedContainerBackend.verify(profile(), transport); broken = true;
    const results = await Promise.allSettled([backend.run("one"), backend.run("two")]);
    expect(results.map(result => result.status === "rejected" ? result.reason.message : "returned")).toEqual(["RSI_SANDBOX_CLEANUP", "RSI_SANDBOX_BLOCKED"]);
    expect(afterFailure).toBe(2); broken = false;
    await expect(backend.run("three")).rejects.toThrow("RSI_SANDBOX_BLOCKED");
  });
  it.each([
    ["INSPECT_TRANSPORT", "TIMEOUT"], ["INSPECT_EXIT", "EXIT"],
    ["INSPECT_JSON", "INVALID_JSON"], ["INSPECT_OWNERSHIP", "OWNERSHIP"],
    ["RM_TRANSPORT", "OTHER"], ["RM_EXIT", "EXIT"],
  ])("retains only bounded cleanup stage %s while quarantining", async (stage, failure) => {
    const fake = fakeDocker(); let enabled = false, inspections = 0;
    const transport: DockerTransport = async (args, stdin, limits) => {
      if (enabled && args[0] === "inspect" && ++inspections === 2) {
        if (stage === "INSPECT_TRANSPORT") throw Error("RSI_SANDBOX_TIMEOUT");
        if (stage === "INSPECT_EXIT") return { code: 1, stdout: "", stderr: "SYNTHETIC_PRIVATE_DAEMON" };
        if (stage === "INSPECT_JSON") return { code: 0, stdout: "SYNTHETIC_PRIVATE_DAEMON", stderr: "" };
        if (stage === "INSPECT_OWNERSHIP") return { code: 0, stdout: JSON.stringify([{ Id: "x", Name: "SYNTHETIC_PRIVATE_DAEMON" }]), stderr: "" };
      }
      if (enabled && args[0] === "rm") {
        if (stage === "RM_TRANSPORT") throw Error("SYNTHETIC_PRIVATE_DAEMON");
        if (stage === "RM_EXIT") return { code: 1, stdout: "", stderr: "SYNTHETIC_PRIVATE_DAEMON" };
      }
      return fake.transport(args, stdin, limits);
    };
    const backend = await VerifiedContainerBackend.verify(profile(), transport); enabled = true;
    const error = await backend.run("data").catch(error => error);
    expect(error.message).toBe("RSI_SANDBOX_CLEANUP");
    expect(error.cause).toEqual({ stage, failure });
    expect(Object.isFrozen(error.cause)).toBe(true);
    expect(JSON.stringify(error.cause)).not.toContain("SYNTHETIC_PRIVATE_DAEMON");
    const count = fake.calls.length;
    await expect(backend.run("queued")).rejects.toThrow("RSI_SANDBOX_BLOCKED");
    expect(fake.calls).toHaveLength(count);
  });
  it("preserves bounded cleanup diagnosis when admission itself is blocked", async () => {
    const fake = fakeDocker(); fake.state.cleanupError = true;
    const error = await VerifiedContainerBackend.verify(profile(), fake.transport).catch(error => error);
    expect(error.message).toBe("RSI_SANDBOX_BLOCKED");
    expect(error.cause).toEqual({ stage: "RM_TRANSPORT", failure: "OTHER" });
    expect(JSON.stringify(error.cause)).not.toContain("private");
  });
  it.each([false, true])("preserves failed START byte counts when cleanup also fails: %s", async cleanupFails => {
    const fake = fakeDocker(); let enabled = false;
    const transport: DockerTransport = async (args, stdin, limits) => {
      if (enabled && args[0] === "start") throw new Error("RSI_SANDBOX_TIMEOUT", { cause: { failure: "TIMEOUT", stdoutBytes: 103, stderrBytes: 0 } });
      if (enabled && cleanupFails && args[0] === "rm") throw new Error("RSI_SANDBOX_TIMEOUT", { cause: { failure: "TIMEOUT", stdoutBytes: 0, stderrBytes: 0 } });
      return fake.transport(args, stdin, limits);
    };
    const backend = await VerifiedContainerBackend.verify(profile(), transport); enabled = true;
    const error = await backend.run("data").catch(error => error);
    expect(error.message).toBe(cleanupFails ? "RSI_SANDBOX_CLEANUP" : "RSI_SANDBOX_TIMEOUT");
    expect(error.cause.startFailure).toEqual({ failure: "TIMEOUT", stdoutBytes: 103, stderrBytes: 0 });
    if (cleanupFails) {
      expect(error.cause).toMatchObject({ stage: "RM_TRANSPORT", failure: "TIMEOUT", command: { failure: "TIMEOUT", stdoutBytes: 0, stderrBytes: 0 } });
      await expect(backend.run("queued")).rejects.toThrow("RSI_SANDBOX_BLOCKED");
    }
    expect(JSON.stringify(error.cause)).not.toContain("data");
  });
  it("rejects raw or out-of-bounds command diagnostics", async () => {
    const fake = fakeDocker(); let enabled = false;
    const transport: DockerTransport = async (args, stdin, limits) => {
      if (enabled && args[0] === "start") throw new Error("RSI_SANDBOX_TIMEOUT", { cause: { failure: "TIMEOUT", stdoutBytes: 100000, stderrBytes: 0, raw: "SYNTHETIC_PRIVATE_DAEMON" } });
      return fake.transport(args, stdin, limits);
    };
    const backend = await VerifiedContainerBackend.verify(profile(), transport); enabled = true;
    const error = await backend.run("data").catch(error => error);
    expect(error.message).toBe("RSI_SANDBOX_TIMEOUT");
    expect(error.cause).toEqual({ startFailure: { failure: "TIMEOUT" } });
    expect(JSON.stringify(error.cause)).not.toContain("SYNTHETIC_PRIVATE_DAEMON");
  });
  it("supports only a pinned local native image and protected fixed file, as injected evidence only", async () => {
    const p = profile(); p.image = nativeId; p.imageId = nativeId;
    p.entrypoint = { kind: "native-file", path: "/opt/rsi/native-wrapper.mjs", sha256: digest("future trusted wrapper") };
    p.memoryMiB = 512; p.tmpfsMiB = 64; p.cpus = 1; p.pids = 64; p.wallTimeMs = 15000;
    const fake = fakeDocker(p); Object.assign(fake.state.probe, { memory: "536870912", pids: "64", cpu: "100000 100000" });
    const backend = await VerifiedContainerBackend.verify(p, fake.transport); const result = await backend.run("synthetic");
    expect(result.evidence.entrypointKind).toBe("native-file"); expect(result.evidence.transportKind).toBe("INJECTED_TRANSPORT");
    const command = fake.calls.filter(c => c.args[0] === "create").at(-1)!.args;
    expect(command.slice(-2)).toEqual(["--max-old-space-size=64", "/opt/rsi/native-wrapper.mjs"]);
    expect(command).not.toContain("--permission"); expect(command).toContain("15s"); expect(command).toContain(nativeId);
    for (const change of [{ sha256: "wrong" }, { regular: false }, { uid: 65532 }, { writable: true }]) {
      const bad = fakeDocker(p); Object.assign(bad.state.probe, { memory: "536870912", pids: "64", cpu: "100000 100000" });
      Object.assign(bad.state.probe.entrypoint as object, change);
      await expect(VerifiedContainerBackend.verify(p, bad.transport)).rejects.toThrow("RSI_SANDBOX_BLOCKED");
    }
    const wrong = fakeDocker(p); wrong.state.imageId = baseId;
    await expect(VerifiedContainerBackend.verify(p, wrong.transport)).rejects.toThrow("RSI_SANDBOX_BLOCKED");
    const ancestry = fakeDocker(p); ancestry.state.imageLayers = ["sha256:other"];
    await expect(VerifiedContainerBackend.verify(p, ancestry.transport)).rejects.toThrow("RSI_SANDBOX_BLOCKED");
  });
});
