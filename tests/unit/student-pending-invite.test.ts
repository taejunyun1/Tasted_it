import { describe, expect, it } from "vitest";
import { clearPendingInvite, parseStudentInviteInput, recoverPendingInvite } from "../../app/features/students/pending-invite";

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
describe("tab-scoped pending student invitation", () => {
  it("restores the original invitation after the URL fragment is removed and expires it after one hour", () => {
    const tab = storage(); const token = "A".repeat(43);
    expect(recoverPendingInvite(tab, `#${token}`, 1000)).toBe(token);
    expect(recoverPendingInvite(tab, "", 2000)).toBe(token);
    expect(recoverPendingInvite(tab, "", 3_601_000)).toBe("");
  });
  it("replaces a previous token and never falls back to it after an invalid new fragment", () => {
    const tab = storage();
    recoverPendingInvite(tab, `#${"A".repeat(43)}`, 1000);
    expect(recoverPendingInvite(tab, `#${"B".repeat(43)}`, 2000)).toBe("B".repeat(43));
    expect(recoverPendingInvite(tab, "#invalid", 3000)).toBe("");
    expect(recoverPendingInvite(tab, "", 3001)).toBe("");
  });
  it("clears after successful workspace access and tolerates blocked browser storage", () => {
    const tab = storage(); recoverPendingInvite(tab, `#${"A".repeat(43)}`, 1000);
    clearPendingInvite(tab); expect(recoverPendingInvite(tab, "", 2000)).toBe("");
    const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
    expect(recoverPendingInvite(blocked, `#${"B".repeat(43)}`, 1000)).toBe("B".repeat(43));
    expect(recoverPendingInvite(blocked, "", 2000)).toBe("");
    expect(() => clearPendingInvite(blocked)).not.toThrow();
  });
});

describe("pasted invitation recovery", () => {
  const token = "A".repeat(43);
  const origin = "https://retaste.test";
  it("recovers only the token from an existing same-origin invitation link or code", () => {
    expect(parseStudentInviteInput(` ${origin}/student/join#${token} `, origin)).toBe(token);
    expect(parseStudentInviteInput(`${origin}/student/join/?utm_source=message#${token}`, origin)).toBe(token);
    expect(parseStudentInviteInput(token, origin)).toBe(token);
  });
  it.each([
    "https://evil.test/student/join#TOKEN", "https://retaste.test.evil.test/student/join#TOKEN",
    "https://user:password@retaste.test/student/join#TOKEN", "http://retaste.test/student/join#TOKEN",
    "https://retaste.test/student#TOKEN", "https://retaste.test/login#TOKEN",
    "https://retaste.test/student/join", "javascript:alert(1)", "bad", "",
  ])("rejects unrelated, incomplete, or unsafe pasted text: %s", (input) => {
    expect(parseStudentInviteInput(input.replace("TOKEN", token), origin)).toBe("");
  });
});
