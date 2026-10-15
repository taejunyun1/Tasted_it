import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { consumeStudentWriteLimit, ensureStudentWorkspace, readStudentForm } from "../../app/features/students/http.server";

function post(body: string, origin: string | null = "https://retaste.test") {
  return new Request("https://retaste.test/student/join", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...(origin ? { Origin: origin } : {}) }, body });
}
describe("student request limits", () => {
  it("fails closed while the feature switch is absent or disabled", () => {
    for (const value of [undefined, "false", "TRUE"]) expect(() => ensureStudentWorkspace(value)).toThrow(expect.objectContaining({ status: 404 }));
  });
  it("requires a same-origin request and rejects duplicate form fields", async () => {
    await expect(readStudentForm(post("intent=accept", null))).rejects.toMatchObject({ status: 403 });
    await expect(readStudentForm(post("intent=accept", "https://evil.test"))).rejects.toMatchObject({ status: 403 });
    await expect(readStudentForm(post("intent=accept&intent=invite"))).rejects.toMatchObject({ status: 400 });
  });
  it("bounds the actual streamed body even when Content-Length is missing", async () => {
    await expect(readStudentForm(post(`note=${"x".repeat(16_384)}`))).rejects.toMatchObject({ status: 413 });
  });
  it("does not assign prototype properties from an untrusted form", async () => {
    const values = await readStudentForm(post("__proto__=ADMIN&intent=accept"));
    expect(Object.getPrototypeOf(values)).toBe(Object.prototype);
    expect(Object.hasOwn(values, "__proto__")).toBe(true);
    expect(({} as { role?: string }).role).toBeUndefined();
  });
  it("limits invitation attempts per user independently of work and resets by window", async () => {
    const db = createDb(env.DB); const userId = crypto.randomUUID(); const now = new Date("2026-10-15T01:00:00.000Z");
    for (let n = 0; n < 10; n++) await consumeStudentWriteLimit(db, userId, now, "JOIN");
    await expect(consumeStudentWriteLimit(db, userId, now, "JOIN")).rejects.toMatchObject({ status: 429 });
    await expect(consumeStudentWriteLimit(db, userId, now, "WORK")).resolves.toBeUndefined();
    await expect(consumeStudentWriteLimit(db, userId, new Date("2026-10-15T01:15:00.000Z"), "JOIN")).resolves.toBeUndefined();
  });
});
