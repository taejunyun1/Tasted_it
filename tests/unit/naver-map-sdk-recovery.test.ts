import { afterEach, describe, expect, it, vi } from "vitest";

class Script extends EventTarget {
  id = "";
  src = "";
  async = false;
  constructor(private readonly scripts: Map<string, Script>) { super(); }
  remove() { this.scripts.delete(this.id); }
}

function browser() {
  const scripts = new Map<string, Script>();
  const window = { naver: undefined as unknown };
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", {
    getElementById: (id: string) => scripts.get(id) ?? null,
    createElement: () => new Script(scripts),
    head: { appendChild: (script: Script) => scripts.set(script.id, script) },
  });
  return { scripts, window };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

describe("NAVER SDK recovery", () => {
  it("coalesces callers, removes a failed script, and retries with one fresh script", async () => {
    const { scripts, window } = browser();
    const { loadNaverMaps } = await import("../../app/features/maps/naver-map-sdk");
    const first = loadNaverMaps("synthetic-client");
    expect(loadNaverMaps("synthetic-client")).toBe(first);
    expect(scripts.size).toBe(1);
    const failed = scripts.get("naver-maps-sdk")!;
    const rejection = expect(first).rejects.toThrow("불러오지 못했습니다");
    failed.dispatchEvent(new Event("error"));
    await rejection;
    expect(scripts.size).toBe(0);

    const retry = loadNaverMaps("synthetic-client");
    expect(loadNaverMaps("synthetic-client")).toBe(retry);
    const fresh = scripts.get("naver-maps-sdk")!;
    expect(fresh).not.toBe(failed);
    window.naver = { maps: {} };
    fresh.dispatchEvent(new Event("load"));
    await expect(retry).resolves.toBe(window.naver);
    await expect(loadNaverMaps("synthetic-client")).resolves.toBe(window.naver);
    expect(scripts.size).toBe(1);
  });

  it("bounds a hung script load and makes the next explicit attempt possible", async () => {
    vi.useFakeTimers();
    const { scripts } = browser();
    const { loadNaverMaps } = await import("../../app/features/maps/naver-map-sdk");
    const load = loadNaverMaps("synthetic-client");
    const rejected = load.catch((error: Error) => error.message);
    await vi.runAllTimersAsync();
    expect(scripts.size).toBe(0);
    expect(await rejected).toContain("시간");
  });
});
