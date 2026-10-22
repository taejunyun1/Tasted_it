import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { DockerSandbox, SANDBOX_POLICY, parseBoundedJsonObject, dockerTransport, createLocalDockerTransport, type DockerTransport } from "../../scripts/rsi/sandbox";

import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const runtimeEvidence = { watchdogDigest:"3629fa180f625d4de2e3fd3b15b12c5d42315e5733ecae6d1550b306abd7d482", watchdogPid:1, watchdogName:"timeout", parentPid:1, runtime: "v22.23.2 linux arm64", memory: "134217728", swap: "0", pids: "32", cpu: "50000 100000", uid: 65532, seccomp: 2, caps: "0000000000000000", noNewPrivileges: true, rootReadOnly: true, tmpfsBounded: true, networkNone: true };
const input = { schemaVersion: 1, taskKind: "repair", payload: { count: 1 } };
const request = { schemaVersion: 1, source: "export default x => ({count:x.payload.count+1})", input };
function fakeDocker(overrides: { runtime?: string; image?: string; output?: string; startError?: string; cleanupError?: boolean } = {}) {
  const calls: { args: string[]; stdin: string }[] = [];
  let name = "", label = "", created = false;
  const transport: DockerTransport = async (args, stdin) => {
    calls.push({ args: [...args], stdin });
    const ok = (stdout: string) => ({ code: 0, stdout, stderr: "" });
    if (args[0] === "info") return ok(JSON.stringify({ ServerVersion: "29.2.1", OSType: "linux", Architecture: "aarch64", KernelVersion: "6.8.0-100-generic", CgroupVersion: "2", MemoryLimit: true, SwapLimit: true, CpuCfsQuota: true, PidsLimit: true, SecurityOptions: ["name=seccomp,profile=builtin"] }));
    if (args[0] === "image") return ok(JSON.stringify([{ Id: overrides.image ?? SANDBOX_POLICY.imageId, RepoDigests: [SANDBOX_POLICY.image], Os: "linux", Architecture: "arm64", Config: { Env: ["NODE_VERSION=22.23.2"] } }]));
    if (args[0] === "create") { name = args[args.indexOf("--name") + 1]; label = args[args.indexOf("--label") + 1].split("=")[1]; created = true; return ok("a".repeat(64)); }
    if (args[0] === "start") {
      if (!stdin) return ok(overrides.runtime ?? JSON.stringify(runtimeEvidence)+"\n");
      if (overrides.startError) throw new Error(overrides.startError);
      return ok(overrides.output ?? '{"schemaVersion":1,"output":{"count":2}}\n');
    }
    if (args[0] === "inspect") return ok(JSON.stringify([{ Id: "a".repeat(64), Name: `/${name}`, Config: { Labels: { "rsi.sandbox.owner": label } } }]));
    if (args[0] === "rm") { if (overrides.cleanupError) throw new Error("failure"); created = false; return ok(name); }
    throw new Error("unexpected");
  };
  return { transport, calls, exists: () => created };
}

describe("local-only Docker endpoint", () => {
  it.each(["tcp://127.0.0.1:2375","tcp://remote:2376","ssh://remote","http://remote"])("rejects %s before daemon or candidate traffic", async endpoint => {
    let calls=0;
    const local=createLocalDockerTransport({DOCKER_HOST:endpoint},async()=>{calls++;return {code:0,stdout:"",stderr:""}});
    await expect(local(["info"],"",{timeoutMs:100,maxOutputBytes:1000})).rejects.toThrow("RSI_SANDBOX_BLOCKED");
    expect(calls).toBe(0);
  });
  it("rejects a remote selected context before any daemon request", async () => {
    const calls: string[][]=[];
    const local=createLocalDockerTransport({},async args=>{calls.push([...args]);return {code:0,stdout:JSON.stringify([{Endpoints:{docker:{Host:"ssh://remote"}}}]),stderr:""}});
    await expect(local(["info"],"",{timeoutMs:100,maxOutputBytes:1000})).rejects.toThrow("RSI_SANDBOX_BLOCKED");
    expect(calls).toEqual([["context","inspect"]]);
  });
  it("freezes endpoint and CLI environment across source dispatch and cleanup", async () => {
    const env={DOCKER_CONTEXT:"local-context",HOME:"/synthetic-home",PATH:"/synthetic-bin"};
    const calls: {args:string[];env:NodeJS.ProcessEnv}[]=[];
    const local=createLocalDockerTransport(env,async(args,_stdin,_limits,environment)=>{
      calls.push({args:[...args],env:{...environment}});
      return {code:0,stdout:args[0]==="context"?JSON.stringify([{Endpoints:{docker:{Host:"unix:///synthetic.sock"}}}]):"",stderr:""};
    });
    await local(["info"],"",{timeoutMs:100,maxOutputBytes:1000});
    env.DOCKER_CONTEXT="remote-context";env.HOME="/changed";
    await local(["start","owned"],"candidate",{timeoutMs:100,maxOutputBytes:1000});
    await local(["rm","owned"],"",{timeoutMs:100,maxOutputBytes:1000});
    for(const call of calls.slice(1)) {
      expect(call.args.slice(0,2)).toEqual(["--host","unix:///synthetic.sock"]);
      expect(call.env.DOCKER_CONTEXT).toBeUndefined();expect(call.env.DOCKER_HOST).toBeUndefined();expect(call.env.HOME).toBe("/synthetic-home");
    }
    expect(calls.filter(c=>c.args[0]==="context")).toHaveLength(1);
  });
});

describe("RSI Docker sandbox boundary", () => {
  it("executes source only inside fixed isolated containers and separates untrusted output", async () => {
    const fake = fakeDocker(); const sandbox = await DockerSandbox.verify(fake.transport);
    const result = await sandbox.execute(request);
    expect(result.untrustedOutput).toEqual({ count: 2 });
    expect(result.evidence.kind).toBe("LOCAL_CONTAINER_RETURN");
    expect(result.evidence.transportKind).toBe("INJECTED_TRANSPORT");
    expect(result.evidence.wrapperDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.evidence.policyDigest).toMatch(/^[a-f0-9]{64}$/);
    const creates = fake.calls.filter(c => c.args[0] === "create");
    expect(creates).toHaveLength(2);
    for (const { args } of creates) {
      for (const flag of ["--pull=never", "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--user=65532:65532", "--pids-limit=32", "--memory=128m", "--memory-swap=128m", "--cpus=0.5"]) expect(args).toContain(flag);
      for (const key of ["HTTP_PROXY","HTTPS_PROXY","FTP_PROXY","ALL_PROXY","NO_PROXY","http_proxy","https_proxy","ftp_proxy","all_proxy","no_proxy"]) expect(args).toContain(`--env=${key}=`);
      expect(args).toContain(SANDBOX_POLICY.image);
      expect(args).toContain("--entrypoint=/usr/bin/timeout");expect(args).toContain("--signal=KILL");expect(args).toContain("3s");expect(args).not.toContain("--init");
      expect(args.some(a => /^(--volume|-v|--mount|--privileged|--env-file)$/.test(a))).toBe(false);
      expect(args.join(" ")).not.toContain(request.source);
    }
    expect(fake.exists()).toBe(false);
    expect(fake.calls.filter(c => c.args[0] === "rm")).toHaveLength(2);
  });

  it.each(["image", "runtime"] as const)("blocks an unverified %s before candidate execution", async key => {
    const fake = fakeDocker({ [key]: "wrong" });
    await expect(DockerSandbox.verify(fake.transport)).rejects.toThrow("RSI_SANDBOX_BLOCKED");
    expect(fake.calls.some(c => c.stdin.includes(request.source))).toBe(false);
  });
  it("reports unavailable backend as BLOCKED", async () => {
    await expect(DockerSandbox.verify(async () => { throw new Error("private details"); })).rejects.toThrow("RSI_SANDBOX_BLOCKED");
  });
  it("rejects unknown authority fields and oversized/deep/non-JSON input before transport", async () => {
    const fake = fakeDocker(); const sandbox = await DockerSandbox.verify(fake.transport); const count = fake.calls.length;
    const deep: Record<string, unknown> = {}; let node = deep; for (let i = 0; i < 20; i++) node = node.next = {};
    for (const bad of [{ ...request, image: "evil" }, { ...request, source: "x".repeat(65537) }, { ...request, source: '"'.repeat(65536) }, { ...request, input: { ...input, command: "evil" } }, { ...request, input: { ...input, payload: deep } }, { ...request, input: { ...input, payload: { n: Infinity } } }]) await expect(sandbox.execute(bad)).rejects.toThrow("RSI_SANDBOX_INPUT");
    expect(fake.calls).toHaveLength(count);
    for (const bad of [JSON.parse('{"__proto__":{}}'), { constructor: "x" }, new Date(), { a: undefined }, { n: NaN }]) expect(() => parseBoundedJsonObject(bad)).toThrow();
  });
  it.each(['not json', '{"schemaVersion":1,"output":{},"authorized":true}', '{"schemaVersion":1,"output":{}}\n{"schemaVersion":1,"output":{}}', '{"schemaVersion":1,"schemaVersion":1,"output":{}}', '{"schemaVersion":1,"output":{"__proto__":{}}}'])("rejects malformed/injected IPC and cleans only owned container", async output => {
    const fake = fakeDocker({ output }); const sandbox = await DockerSandbox.verify(fake.transport);
    await expect(sandbox.execute(request)).rejects.toThrow("RSI_SANDBOX_IPC"); expect(fake.exists()).toBe(false);
  });
  it.each(["RSI_SANDBOX_TIMEOUT", "RSI_SANDBOX_OUTPUT_LIMIT"])("cleans up after %s", async startError => {
    const fake = fakeDocker({ startError }); const sandbox = await DockerSandbox.verify(fake.transport);
    await expect(sandbox.execute(request)).rejects.toThrow(startError); expect(fake.exists()).toBe(false);
  });
  it("rejects changed kernel enforcement before granting execution", async () => {
    const fake=fakeDocker({runtime:JSON.stringify({...runtimeEvidence,seccomp:0})+"\n"});
    await expect(DockerSandbox.verify(fake.transport)).rejects.toThrow("RSI_SANDBOX_BLOCKED");
  });
  it("refuses to remove a container whose ownership label differs", async () => {
    const fake=fakeDocker();
    const altered: DockerTransport=async(args,data,limits)=>{
      const result=await fake.transport(args,data,limits);
      if(args[0]==="inspect") {const rows=JSON.parse(result.stdout); rows[0].Config.Labels["rsi.sandbox.owner"]="other";result.stdout=JSON.stringify(rows);}
      return result;
    };
    await expect(DockerSandbox.verify(altered)).rejects.toThrow("RSI_SANDBOX_BLOCKED");
    expect(fake.calls.some(c=>c.args[0]==="rm")).toBe(false);
  });
  it("rejects cycles, excessive nodes, accessor objects, symbolic keys and sparse arrays", () => {
    const cycle: Record<string,unknown>={};cycle.self=cycle;
    const accessor={get secret(){throw new Error("must not run")}};
    const sparse=[];sparse[99]=1;
    for(const value of [cycle,accessor,{[Symbol("x")]:1},{items:sparse},{items:Array.from({length:2049},()=>0)}]) expect(()=>parseBoundedJsonObject(value)).toThrow("RSI_SANDBOX_INPUT");
  });
  it("quarantines a capability after uncertain creation/cleanup rather than dispatching again", async () => {
    const fake=fakeDocker();let broken=false;
    const transport: DockerTransport=async(args,data,limits)=>{
      if(broken && args[0]==="create") throw new Error("RSI_SANDBOX_TIMEOUT");
      if(broken && args[0]==="inspect") return {code:1,stdout:"",stderr:"unavailable"};
      return fake.transport(args,data,limits);
    };
    const sandbox=await DockerSandbox.verify(transport);broken=true;
    await expect(sandbox.execute(request)).rejects.toThrow("RSI_SANDBOX_CLEANUP");
    broken=false;
    await expect(sandbox.execute(request)).rejects.toThrow("RSI_SANDBOX_BLOCKED");
  });
  it("does not accept cleanup failure as a completed run", async () => {
    const fake = fakeDocker(); const sandbox = await DockerSandbox.verify(fake.transport);
    const broken: DockerTransport = async (args, data, limits) => { if (args[0] === "rm") throw new Error("unavailable"); return fake.transport(args, data, limits); };
    // Verification itself must also fail closed if its own container cannot be removed.
    await expect(DockerSandbox.verify(broken)).rejects.toThrow("RSI_SANDBOX_BLOCKED");
    expect(sandbox).toBeDefined();
  });
});

// Explicit opt-in: absence of Docker is a failure here, never an isolation PASS.
if (process.env.RSI_DOCKER_PROBES === "1") describe("actual Docker isolation probes", () => {
  let sandbox: DockerSandbox, markerDir: string;
  const marker = randomUUID();
  const containers = new Set<string>();
  const observed: { args: string[] }[] = [];
  beforeAll(async () => {
    markerDir = await mkdtemp(join(tmpdir(), "rsi-host-marker-"));
    await writeFile(join(markerDir, "marker"), marker);
    process.env.RSI_HOST_MARKER = marker;
    const traced: DockerTransport = async (args, data, limits) => {
      if (args[0] === "create") { containers.add(args[args.indexOf("--name")+1]); observed.push({ args: [...args] }); }
      return dockerTransport(args, data, limits);
    };
    sandbox = await DockerSandbox.verify(traced);
  }, 30000);
  afterAll(async () => {
    delete process.env.RSI_HOST_MARKER;
    if (markerDir) await rm(markerDir, { recursive: true, force: true });
    for (const name of containers) {
      const inspected = await dockerTransport(["inspect", name], "", { timeoutMs: 5000, maxOutputBytes: 65536 });
      expect(inspected.code).not.toBe(0);
    }
  }, 30000);
  async function run(body: string) { return (await sandbox.execute({ ...request, source: "export default async input => {"+body+"}" })).untrustedOutput; }
  it("returns synthetic data and verifies actual kernel memory/swap/CPU/PID/mount/security limits", async () => {
    const direct = await DockerSandbox.verify();
    const result = await direct.execute(request);
    expect(result.evidence.transportKind).toBe("DOCKER_CLI");
    expect(result.untrustedOutput).toEqual({ count: 2 });
    expect(result.evidence.runtime).toBe("v22.23.2 linux arm64");
    expect(result.evidence.isolation).toEqual(runtimeEvidence);
  }, 30000);
  it("cannot read host marker, absolute/relative files, socket or database bindings", async () => {
    const paths = [join(markerDir, "marker"), "/etc/passwd", "../etc/passwd", "/var/run/docker.sock", "/proc/1/environ", "/sys/fs/cgroup/memory.max"];
    const output = await run(`const fs = await import('node:fs'); let denied=0; for(const path of ${JSON.stringify(paths)}) { try {fs.readFileSync(path); } catch {denied++;} } return {denied,envEmpty:Object.keys(process.env).length===0,dbAbsent:!globalThis.DB};`);
    expect(output).toEqual({ denied: paths.length, envEmpty: true, dbAbsent: true });
  }, 30000);
  it("denies symlink creation, root/tmp writes, child process and worker/fork attempts", async () => {
    const output = await run(`const fs=await import('node:fs'), cp=await import('node:child_process'), wt=await import('node:worker_threads'); let denied=0; for(const fn of [()=>fs.symlinkSync('/etc/passwd','/tmp/link'),()=>fs.writeFileSync('/tmp/write','x'),()=>fs.writeFileSync('/root-write','x'),()=>cp.spawn('/bin/sh',['-c','exit 0']),()=>cp.fork('/tmp/no.js'),()=>new wt.Worker('while(true){}',{eval:true})]) {try {fn()}catch {denied++}} return {denied};`);
    expect(output).toEqual({ denied: 6 });
  }, 30000);
  it("blocks host loopback, metadata, GitHub, DNS and database network egress", async () => {
    const output = await run(`const net=await import('node:net'); const targets=[['127.0.0.1',5432],['169.254.169.254',80],['host.docker.internal',80],['github.com',443],['1.1.1.1',53]]; let blocked=0; await Promise.all(targets.map(([host,port])=>new Promise(resolve=>{const socket=net.createConnection({host,port}); let done=false; const end=()=>{if(done)return;done=true;blocked++;socket.destroy();resolve()};socket.setTimeout(250,end);socket.on('error',end);socket.on('connect',()=>{if(done)return;done=true;socket.destroy();resolve()})}))); return {blocked};`);
    expect(output).toEqual({ blocked: 5 });
  }, 30000);
  it("terminates infinite loops within the fixed wall deadline", async () => {
    const started = Date.now();
    await expect(run("while(true){}" )).rejects.toThrow("RSI_SANDBOX_TIMEOUT");
    expect(Date.now()-started).toBeLessThan(12000);
  }, 15000);
  it.each(["SIGSTOP", "SIGKILL", "DETACHED"])("bounds PID1 watchdog tampering %s without host timeout assistance", async mode => {
    const owned: string[]=[];let exitCode: number|undefined, observedAttempt=false;
    const relaxedHostTimer: DockerTransport=async(args,data,limits)=>{
      if(args[0]==="create") owned.push(args[args.indexOf("--name")+1]);
      const result=await dockerTransport(args,data,{...limits,timeoutMs:10000});
      if(args[0]==="start" && data) {exitCode=result.code;observedAttempt=result.stdout.includes("WATCHDOG_ATTEMPT");}
      return result;
    };
    const guarded=await DockerSandbox.verify(relaxedHostTimer);
    const attempt=mode==="DETACHED"
      ? "const cp=await import('node:child_process');try{cp.spawn('/usr/local/bin/node',['-e','while(true){}'],{detached:true,stdio:'ignore'}).unref();}catch(e){if(e.code!=='ERR_ACCESS_DENIED')throw e;}"
      : `try{process.kill(1,'${mode}')}catch{}`;
    const source="export default async()=>{"+attempt+"process.stdout.write('WATCHDOG_ATTEMPT');while(true){}}";
    const started=Date.now();
    await expect(guarded.execute({...request,source})).rejects.toThrow("RSI_SANDBOX_EXECUTION");
    expect(exitCode).toBe(137);expect(observedAttempt).toBe(true);expect(Date.now()-started).toBeLessThan(7000);
    for(const name of owned) expect((await dockerTransport(["inspect",name],"",{timeoutMs:5000,maxOutputBytes:65536})).code).not.toBe(0);
  }, 15000);
  it("bounds memory exhaustion without exposing allocator diagnostics", async () => {
    await expect(run("const blocks=[]; while(true) blocks.push(Buffer.alloc(8*1024*1024,1));")).rejects.toThrow(/RSI_SANDBOX_(EXECUTION|TIMEOUT|OUTPUT_LIMIT)/);
  }, 15000);
  it("stops excessive stdout and rejects injected/malformed IPC", async () => {
    await expect(run("process.stdout.write('x'.repeat(100000));return {};" )).rejects.toThrow("RSI_SANDBOX_OUTPUT_LIMIT");
    await expect(run("process.stdout.write('{bad}\\n');return {};" )).rejects.toThrow("RSI_SANDBOX_IPC");
  }, 15000);
  it("rejects excessive input without starting another container", async () => {
    const before = observed.length;
    await expect(sandbox.execute({ ...request, source: "x".repeat(65537) })).rejects.toThrow("RSI_SANDBOX_INPUT");
    expect(observed).toHaveLength(before);
  });
  it("keeps candidate claims as untrusted data without promotion", async () => {
    const result = await sandbox.execute({ ...request, source: "export default()=>({PASS:true,authorized:true,command:'ignored'})" });
    expect(result.untrustedOutput.PASS).toBe(true);
    expect(result.evidence.kind).toBe("LOCAL_CONTAINER_RETURN");
    expect(result.evidence).not.toHaveProperty("authorized");
  }, 15000);
});
