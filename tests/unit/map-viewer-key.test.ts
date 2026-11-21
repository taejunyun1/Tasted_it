import { expect, it, vi } from "vitest";

vi.mock("../../app/features/auth/session.server", () => ({
  readSessionId: (request: Request) => /retaste_session=([^;]+)/.exec(request.headers.get("Cookie") ?? "")?.[1] ?? null,
}));
vi.mock("../../app/features/onboarding/guest-session.server", () => ({
  readGuestSessionId: (request: Request) => /retaste_guest=([^;]+)/.exec(request.headers.get("Cookie") ?? "")?.[1] ?? null,
}));

it("binds an opaque display key to member, role and session without exposing them", async () => {
  const { mapViewerKey } = await import("../../app/features/maps/map-viewer-key.server");
  const request = (value: string) => new Request("https://example.test/", { headers: { Cookie: value } });
  const user = { id: "member-a", role: "MEMBER" };
  const first = await mapViewerKey(request("retaste_session=secret-one"), user);
  expect(first).toMatch(/^[a-f0-9]{64}$/);
  expect(first).toBe(await mapViewerKey(request("retaste_session=secret-one"), user));
  expect(first).not.toBe(await mapViewerKey(request("retaste_session=secret-two"), user));
  expect(first).not.toBe(await mapViewerKey(request("retaste_session=secret-one"), { ...user, role: "REVIEWER" }));
  expect(first).not.toBe(await mapViewerKey(request("retaste_session=secret-one"), { ...user, id: "member-b" }));
  expect(first).not.toContain("secret");
  expect(first).not.toContain(user.id);
});

it("separates guest identities and ignores an unauthenticated bearer cookie", async () => {
  const { mapViewerKey } = await import("../../app/features/maps/map-viewer-key.server");
  const request = (value: string) => new Request("https://example.test/", { headers: { Cookie: value } });
  const anonymous = await mapViewerKey(request(""), null);
  expect(anonymous).toBe(await mapViewerKey(request("retaste_session=invalid"), null));
  expect(anonymous).not.toBe(await mapViewerKey(request("retaste_guest=guest-one"), null));
  expect(await mapViewerKey(request("retaste_guest=guest-one"), null)).not.toBe(await mapViewerKey(request("retaste_guest=guest-two"), null));
});
