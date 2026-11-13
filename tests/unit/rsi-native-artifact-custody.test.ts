import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nativeArtifactDigests, NativeExecutor, prepareNativeRuntimeImage } from "../../scripts/rsi/native-executor";
import { VerifiedContainerBackend, dockerTransport } from "../../scripts/rsi/container-backend";

const fault = vi.hoisted(() => ({ name: "", kind: "", opens: [] as { path: string; flags: number }[] }));
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const selected = (path: unknown) => String(path).endsWith("/fixtures/native-runtime/" + fault.name);
  return { ...actual,
    realpath: async (...args: Parameters<typeof actual.realpath>) => {
      const result = await actual.realpath(...args);
      return fault.kind === "PARENT_SYMLINK" && String(args[0]).endsWith("/fixtures/native-runtime") ? String(result) + "-redirect" : result;
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      if (!String(args[0]).includes("/fixtures/native-runtime/")) return actual.open(...args);
      fault.opens.push({ path: String(args[0]), flags: Number(args[1]) });
      if (selected(args[0]) && ["ABSENT", "FINAL_SYMLINK"].includes(fault.kind)) throw Object.assign(Error("private path"), { code: fault.kind === "ABSENT" ? "ENOENT" : "ELOOP" });
      const handle = await actual.open(...args);
      return { close: () => handle.close(),
        stat: async () => {
          const stat = await handle.stat();
          if (selected(args[0]) && fault.kind === "OVERSIZE") return { ...stat, isFile: () => true, size: 524289 };
          if (selected(args[0]) && ["DIRECTORY", "FIFO"].includes(fault.kind)) return { ...stat, isFile: () => false };
          return stat;
        },
        read: async (...readArgs: Parameters<typeof handle.read>) => {
          const result = await handle.read(...readArgs);
          if (selected(args[0]) && fault.kind === "TAMPER" && result.bytesRead) (readArgs[0] as Buffer)[0] ^= 1;
          return result;
        },
      } as unknown as typeof handle;
    },
  };
});
vi.mock("../../scripts/rsi/container-backend", async importOriginal => ({
  ...await importOriginal<typeof import("../../scripts/rsi/container-backend")>(),
  dockerTransport: vi.fn(async () => { throw Error("unexpected Docker call"); }),
}));
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const manifest = async () => JSON.parse(await readFile(new URL("../../scripts/rsi/fixtures/native-manifest.pinned.json", import.meta.url), "utf8"));
afterEach(() => { fault.kind = ""; fault.name = ""; fault.opens.length = 0; vi.restoreAllMocks(); vi.mocked(dockerTransport).mockClear(); });

describe("fixed native dependency custody", () => {
  it("keeps the original image dependency artifacts separate from the evolving app", async () => {
    const artifacts = await nativeArtifactDigests(), pinned = await manifest();
    expect(artifacts.packageDigest).toBe(pinned.artifacts.packageDigest);
    expect(artifacts.lockDigest).toBe(pinned.artifacts.lockDigest);
    expect(artifacts).toEqual(pinned.artifacts);
    expect(hash(await readFile(new URL("../../package.json", import.meta.url), "utf8"))).not.toBe(artifacts.packageDigest);
    expect(fault.opens).toHaveLength(2);
    expect(fault.opens.every(p => p.flags === (constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK))).toBe(true);
    expect(dockerTransport).not.toHaveBeenCalled();
  });
  it.each(["package.json", "pnpm-lock.yaml"])("refuses changed, absent or redirected %s before backend verification or build", async name => {
    const pinned = await manifest(), backend = vi.spyOn(VerifiedContainerBackend, "verify");
    fault.name = name;
    for (const kind of ["TAMPER", "ABSENT", "FINAL_SYMLINK", "PARENT_SYMLINK", "OVERSIZE", "DIRECTORY", "FIFO"]) {
      fault.kind = kind;
      await expect(nativeArtifactDigests()).rejects.toThrow("RSI_NATIVE_ARTIFACT_MISMATCH");
      await expect(NativeExecutor.verify(pinned)).rejects.toThrow("RSI_NATIVE_ARTIFACT_MISMATCH");
      await expect(prepareNativeRuntimeImage()).rejects.toThrow("RSI_NATIVE_ARTIFACT_MISMATCH");
      expect(backend).not.toHaveBeenCalled(); expect(dockerTransport).not.toHaveBeenCalled();
    }
  });
});
