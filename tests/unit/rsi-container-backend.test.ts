import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { VerifiedContainerBackend, type DockerTransport, type TrustedContainerProfile } from "../../scripts/rsi/container-backend";
import { createLocalDockerTransport as legacyLocal, dockerTransport as legacyTransport } from "../../scripts/rsi/sandbox";
import { createLocalDockerTransport, dockerTransport, observeDockerLifecycle, containerFailureDiagnosticSchema, decodeContainerDiagnostic, classifyContainerFailure, type DockerCommandLifecycle } from "../../scripts/rsi/container-backend";

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
      expect(error.cause).toMatchObject({ failure, stdoutBytes: 3, stderrBytes: 2, lifecycle: { command: "START", timeoutMs: 10 } });
      expect(Object.isFrozen(error.cause)).toBe(true);
      expect(JSON.stringify(error.cause)).not.toContain("abc");
      expect(JSON.stringify(error.cause)).not.toContain("synthetic.sock");
    } finally { spawn.mockRestore(); syncBuiltinESMExports(); vi.useRealTimers(); }
  });
  it("observes exit before pipe EOF/close without settling or exposing command data", async () => {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: vi.fn(() => true) });
    const spawn = vi.spyOn(childProcess, "spawn").mockReturnValue(child as unknown as ReturnType<typeof childProcess.spawn>); syncBuiltinESMExports();
    const snapshots: Readonly<DockerCommandLifecycle>[] = [];
    try {
      const transport = createLocalDockerTransport({ DOCKER_HOST: "unix:///SYNTHETIC_PRIVATE.sock", SECRET: "SYNTHETIC_SECRET" }, undefined, snapshot => { snapshots.push(snapshot); });
      let settled = false;
      const pending = transport(["start", "SYNTHETIC_PRIVATE_ARGV"], "SYNTHETIC_SOURCE", { timeoutMs: 15000, maxOutputBytes: 32768 }).then(value => { settled = true; return value; });
      await vi.advanceTimersByTimeAsync(0); child.emit("spawn");
      child.stdout.write("abc"); await vi.advanceTimersByTimeAsync(7); child.stdout.write("def"); child.stderr.write("x");
      child.emit("exit", 0, null); await vi.advanceTimersByTimeAsync(3);
      expect(settled).toBe(false); expect(snapshots.at(-1)!.exit.atMs).toBe(7); expect(snapshots.at(-1)!.close.atMs).toBeNull();
      child.stdout.end(); child.stderr.end(); await vi.advanceTimersByTimeAsync(0); child.emit("close", 0, null);
      const result = await pending;
      expect(result.lifecycle).toMatchObject({ schemaVersion: 1, command: "START", ordinal: 1, timeoutMs: 15000, elapsedMs: 10,
        spawn: { invoked: true, observed: true, error: null }, stdin: { endInvoked: true, callback: true, finish: true },
        stdout: { bytes: 6, chunks: 2, firstMs: 0, lastMs: 7, endMs: 10 }, stderr: { bytes: 1 },
        exit: { code: 0, signal: null, atMs: 7 }, close: { code: 0, signal: null, atMs: 10 }, nativeReady: "UNOBSERVED", nativeDispatch: "UNOBSERVED" });
      expect(result.lifecycle!.events.length).toBeLessThanOrEqual(64); expect(Object.isFrozen(snapshots[0])).toBe(true);
      const events = result.lifecycle!.events.map(event => event.kind);
      expect(events.indexOf("EXIT")).toBeLessThan(events.indexOf("STDOUT_END"));
      expect(events.indexOf("STDOUT_END")).toBeLessThan(events.indexOf("STDOUT_CLOSE"));
      expect(events.indexOf("STDERR_CLOSE")).toBeLessThan(events.indexOf("CLOSE"));
      expect(JSON.stringify(snapshots)).not.toMatch(/SYNTHETIC_PRIVATE|SYNTHETIC_SOURCE|SYNTHETIC_SECRET|abc|def/);
    } finally { spawn.mockRestore(); syncBuiltinESMExports(); vi.useRealTimers(); }
  });
  it.each(["false", "throw"])("keeps a timed-out command pending without close after kill %s", async mode => {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(),
      kill: vi.fn(() => { if (mode === "throw") throw Object.assign(Error("SYNTHETIC_PRIVATE"), { code: "EPERM" }); return false; }) });
    const spawn = vi.spyOn(childProcess, "spawn").mockReturnValue(child as unknown as ReturnType<typeof childProcess.spawn>); syncBuiltinESMExports();
    const snapshots: Readonly<DockerCommandLifecycle>[] = [];
    try {
      const transport = createLocalDockerTransport({ DOCKER_HOST: "unix:///synthetic.sock" }, undefined, snapshot => { snapshots.push(snapshot); throw Error("SYNTHETIC_OBSERVER"); });
      let settled = false;
      const pending = transport(["start"], "", { timeoutMs: 10, maxOutputBytes: 32 }).catch(error => { settled = true; return error; });
      await vi.advanceTimersByTimeAsync(100);
      expect(settled).toBe(false); expect(child.kill).toHaveBeenCalledOnce();
      expect(snapshots.at(-1)).toMatchObject({ timer: { firedMs: 10 }, kill: { requestedMs: 10, returned: mode === "false" ? false : null, error: mode === "throw" ? "EPERM" : null }, close: { atMs: null } });
      child.emit("close", null, "SIGKILL");
      expect((await pending).cause.lifecycle.observerError).toBe(true);
    } finally { child.emit("close", null); spawn.mockRestore(); syncBuiltinESMExports(); vi.useRealTimers(); }
  });
  it.each(["sync", "event"])("redacts %s spawn failure and leaves absent spawn/exit observations null", async mode => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: vi.fn() });
    const spawn = vi.spyOn(childProcess, "spawn").mockImplementation(() => {
      const error = Object.assign(Error("SYNTHETIC_SECRET_STACK"), { code: "ENOENT" });
      if (mode === "sync") throw error;
      queueMicrotask(() => child.emit("error", error)); return child as unknown as ReturnType<typeof childProcess.spawn>;
    }); syncBuiltinESMExports();
    try {
      const error = await createLocalDockerTransport({ DOCKER_HOST: "unix:///synthetic.sock" })(["start"], "", { timeoutMs: 5000, maxOutputBytes: 32 }).catch(error => error);
      expect(error.message).toBe("RSI_SANDBOX_UNAVAILABLE");
      expect(error.cause.lifecycle).toMatchObject({ spawn: { invoked: true, observed: null, error: "ENOENT" }, exit: { atMs: null }, close: { atMs: null } });
      expect(JSON.stringify(error)).not.toContain("SYNTHETIC_SECRET_STACK");
    } finally { child.emit("close", null); spawn.mockRestore(); syncBuiltinESMExports(); }
  });
  it("caps event history and ignores rejected observer promises", async () => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: vi.fn() });
    const spawn = vi.spyOn(childProcess, "spawn").mockReturnValue(child as unknown as ReturnType<typeof childProcess.spawn>); syncBuiltinESMExports();
    try {
      const pending = createLocalDockerTransport({ DOCKER_HOST: "unix:///synthetic.sock" }, undefined, () => Promise.reject(Error("SYNTHETIC_PRIVATE")))(["start"], "", { timeoutMs: 5000, maxOutputBytes: 32 });
      await Promise.resolve(); await Promise.resolve();
      for (let i = 0; i < 100; i++) child.stdin.emit("drain");
      child.stdout.emit("error", Object.assign(Error("SYNTHETIC_PRIVATE"), { code: "ECONNRESET" })); child.stdout.emit("close"); await Promise.resolve(); child.emit("close", 0, null);
      const result = await pending;
      expect(result.lifecycle).toMatchObject({ observerError: true, stdin: { drainCount: 64 }, stdout: { error: "ECONNRESET", endMs: null } });
      expect(result.lifecycle!.events).toHaveLength(64);
    } finally { spawn.mockRestore(); syncBuiltinESMExports(); }
  });
  it("rejects diagnostic proxies, accessors, prototypes, extra keys and oversized collections without executing them", () => {
    let touched = 0;
    const valid = { startFailure: { failure: "TIMEOUT", stdoutBytes: 2, stderrBytes: 0 } };
    expect(decodeContainerDiagnostic(containerFailureDiagnosticSchema, valid)).toEqual(valid);
    const proxy = new Proxy(valid, { getPrototypeOf() { touched++; throw Error(); }, ownKeys() { touched++; throw Error(); } });
    const accessor = { startFailure: { get failure() { touched++; return "TIMEOUT"; } } };
    for (const value of [proxy, accessor, Object.assign(Object.create(valid), valid), { ...valid, raw: "SYNTHETIC_PRIVATE" }, { ...valid, transport: { commands: Array(66).fill({}), cleanup: {} } }]) {
      expect(decodeContainerDiagnostic(containerFailureDiagnosticSchema, value)).toBeUndefined();
    }
    expect(touched).toBe(0);
  });
  it("observes the default CLI adapter without changing its identity or allowing a second observer", async () => {
    const fake = fakeDocker(), snapshots: Readonly<DockerCommandLifecycle>[] = [];
    let currentChild: { stdin: EventEmitter } | undefined, observed = 0;
    const spawn = vi.spyOn(childProcess, "spawn").mockImplementation((_file, args) => {
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: vi.fn() });
      currentChild = child;
      const command = args![0] === "--host" ? args!.slice(2) : args!;
      void (command[0] === "context" ? Promise.resolve({ code: 0, stdout: JSON.stringify([{ Endpoints: { docker: { Host: "unix:///SYNTHETIC_PRIVATE.sock" } } }]), stderr: "" }) : fake.transport(command, "", { timeoutMs: 5000, maxOutputBytes: 65536 })).then(result => {
        child.stdout.write(result.stdout); child.stderr.write(result.stderr); child.emit("close", result.code, null);
      });
      return child as unknown as ReturnType<typeof childProcess.spawn>;
    }); syncBuiltinESMExports();
    let detach: (() => void) | undefined;
    try {
      detach = observeDockerLifecycle(snapshot => {
        snapshots.push(snapshot);
        if (snapshot.stdin.endInvoked && snapshot.close.atMs === null) currentChild?.stdin.emit("drain");
        if (++observed % 3 === 0) throw Error("SYNTHETIC_PRIVATE_OBSERVER");
        if (observed % 3 === 1) return Promise.reject(Error("SYNTHETIC_PRIVATE_OBSERVER"));
        return { verdict: "PASS" };
      });
      expect(() => observeDockerLifecycle(() => {})).toThrow("RSI_SANDBOX_BLOCKED");
      const backend = await VerifiedContainerBackend.verify(profile());
      const result = await backend.run("synthetic");
      expect(result.evidence.transportKind).toBe("DOCKER_CLI");
      expect(result.evidence.transport!.commands.map(command => command.command)).toEqual(["CREATE", "INSPECT", "START", "INSPECT", "RM"]);
      expect(result.evidence.transport!.commands.map(command => command.phase)).toEqual(["CREATE", "INSPECT", "START", "CLEANUP_INSPECT", "CLEANUP_RM"]);
      expect(result.evidence.transport!.cleanup).toEqual({ inspectReturned: true, nameMatch: true, ownerMatch: true, idMatch: true, rmInvoked: true, rmReturned: true });
      expect(result.evidence.transport!.commands.every(command => command.observerError)).toBe(true);
      expect(JSON.stringify(snapshots)).not.toContain("SYNTHETIC_PRIVATE");
      const staleDetach = detach; detach(); detach = undefined; const count = snapshots.length; await backend.run("synthetic"); expect(snapshots).toHaveLength(count);
      const next: Readonly<DockerCommandLifecycle>[] = []; detach = observeDockerLifecycle(snapshot => { next.push(snapshot); });
      staleDetach(); await backend.run("synthetic"); expect(next.length).toBeGreaterThan(0);
      // Mocked spawn remains synthetic evidence, regardless of the fixed identity tag.
    } finally { detach?.(); spawn.mockRestore(); syncBuiltinESMExports(); }
  });
  it("binds completed START output to cleanup failure only through the internal one-use seam", async () => {
    const fake = fakeDocker(); let enabled = false;
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: vi.fn() });
    const spawn = vi.spyOn(childProcess, "spawn").mockImplementation(() => {
      queueMicrotask(() => { child.stdout.write("SYNTHETIC_PRIVATE_FRAME"); child.emit("close", 0, null); });
      return child as unknown as ReturnType<typeof childProcess.spawn>;
    }); syncBuiltinESMExports();
    try {
      const cli = createLocalDockerTransport({ DOCKER_HOST: "unix:///synthetic.sock" });
      const transport: DockerTransport = async (args, stdin, limits) => enabled && args[0] === "start" ? cli(args, stdin, limits) : fake.transport(args, stdin, limits);
      const backend = await VerifiedContainerBackend.verify(profile(), transport); enabled = true; fake.state.cleanupError = true;
      const error = await backend.run("data").catch(error => error);
      expect(error.message).toBe("RSI_SANDBOX_CLEANUP"); expect(JSON.stringify(error)).not.toContain("SYNTHETIC_PRIVATE_FRAME");
      expect(error.cause.transport).toMatchObject({ commands: [{ command: "START" }], cleanup: { inspectReturned: true, ownerMatch: true, nameMatch: true, idMatch: true, rmInvoked: true, rmReturned: null } });
      const classify = vi.fn((stdout: string) => ({ frameKind: "INVALID", digest: digest(stdout), completeJSON: false, schemaMatch: false, bindingMatch: null }));
      expect(classifyContainerFailure(error, classify)).toMatchObject({ frameKind: "INVALID", digest: digest("SYNTHETIC_PRIVATE_FRAME") });
      expect(classify).toHaveBeenCalledOnce(); expect(classifyContainerFailure(error, classify)).toBeUndefined();
    } finally { spawn.mockRestore(); syncBuiltinESMExports(); }
  });
  it("starts an independent 5s RM timer after the unchanged 15s START timeout", async () => {
    vi.useFakeTimers();
    const children: Array<EventEmitter & { stdin: EventEmitter; kill: ReturnType<typeof vi.fn> }> = [];
    const spawn = vi.spyOn(childProcess, "spawn").mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: vi.fn(() => { queueMicrotask(() => child.emit("close", null, "SIGKILL")); return true; }) });
      children.push(child); return child as unknown as ReturnType<typeof childProcess.spawn>;
    }); syncBuiltinESMExports();
    try {
      const p = profile(); p.wallTimeMs = 15000; const fake = fakeDocker(p); let enabled = false;
      const cli = createLocalDockerTransport({ DOCKER_HOST: "unix:///synthetic.sock" }, undefined, () => {
        children.at(-1)?.stdin.emit("drain"); // Reentrant event cannot recurse into the observer.
        return Promise.reject(Error("SYNTHETIC_OBSERVER"));
      });
      const transport: DockerTransport = (args, stdin, limits) => enabled && ["start", "rm"].includes(args[0]) ? cli(args, stdin, limits) : fake.transport(args, stdin, limits);
      const backend = await VerifiedContainerBackend.verify(p, transport); enabled = true;
      const pending = backend.run("data").catch(error => error);
      await vi.advanceTimersByTimeAsync(14999); expect(children).toHaveLength(1); expect(children[0].kill).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1); expect(children[0].kill).toHaveBeenCalledOnce(); expect(children).toHaveLength(2); expect(children[1].kill).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(4999); expect(children[1].kill).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1); const error = await pending;
      expect(error.cause).toMatchObject({ stage: "RM_TRANSPORT", failure: "TIMEOUT", command: { lifecycle: { command: "RM", phase: "CLEANUP_RM", timeoutMs: 5000, timer: { firedMs: 5000 } } }, startFailure: { lifecycle: { command: "START", timeoutMs: 15000, timer: { firedMs: 15000 } } } });
      expect(error.cause.transport.commands.map((entry: DockerCommandLifecycle) => entry.ordinal)).toEqual([1, 2]);
      expect(error.cause.command.lifecycle.observerError).toBe(true); expect(children[1].kill).toHaveBeenCalledOnce();
    } finally { children.forEach(child => child.emit("close", null)); spawn.mockRestore(); syncBuiltinESMExports(); vi.useRealTimers(); }
  });
  it.each(["before", "after"])("records stdin EPIPE %s finish without converting it to completion", async timing => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new EventEmitter() as EventEmitter & { end: ReturnType<typeof vi.fn> }, kill: vi.fn(() => true) });
    let callback!: (error?: Error) => void;
    child.stdin.end = vi.fn((_value, done) => { callback = done; });
    const spawn = vi.spyOn(childProcess, "spawn").mockReturnValue(child as unknown as ReturnType<typeof childProcess.spawn>); syncBuiltinESMExports();
    try {
      const pending = createLocalDockerTransport({ DOCKER_HOST: "unix:///synthetic.sock" })(["start"], "data", { timeoutMs: 5000, maxOutputBytes: 32 });
      await Promise.resolve(); await Promise.resolve();
      if (timing === "after") { callback(); child.stdin.emit("finish"); }
      child.stdin.emit("error", Object.assign(Error("SYNTHETIC_PRIVATE"), { code: "EPIPE" })); child.stdin.emit("drain"); child.emit("close", 0, null);
      const result = await pending;
      expect(result.lifecycle!.stdin).toMatchObject({ endInvoked: true, error: "EPIPE", callback: timing === "after" ? true : null, finish: timing === "after" ? true : null, drainCount: 1 });
    } finally { spawn.mockRestore(); syncBuiltinESMExports(); }
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
