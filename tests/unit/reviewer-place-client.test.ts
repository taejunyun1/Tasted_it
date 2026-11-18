import { expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: { DB: {} } }));
vi.mock("../../app/db/client.server", () => ({ createDb: vi.fn() }));
vi.mock("../../app/features/auth/session.server", () => ({ requireUser: vi.fn() }));
vi.mock("../../app/features/ratings/reviewer-place-search.server", () => ({ listReviewerPlacePage: vi.fn() }));

const request = new Request("https://retaste.test/resources/reviewer-places?requestKey=search-9");

it.each([301, 302, 303, 307, 308])("preserves an actual %i redirect Response from the single-fetch server loader", async (status) => {
  const { clientLoader } = await import("../../app/routes/reviewer-places-resource");
  const redirect = new Response(null, { status, headers: { Location: "/login?returnTo=%2Freviewer%2Fratings" } });
  const serverLoader = vi.fn(async () => { throw redirect; });
  await expect(clientLoader({ request, serverLoader } as never)).rejects.toBe(redirect);
  expect(serverLoader).toHaveBeenCalledTimes(1);
});

it("keeps a network failure retryable without exposing its internal error", async () => {
  const { clientLoader } = await import("../../app/routes/reviewer-places-resource");
  const result = await clientLoader({ request, serverLoader: async () => { throw new TypeError("private transport detail"); } } as never);
  expect(result).toMatchObject({ ok: false, requestKey: "search-9" });
  expect(JSON.stringify(result)).not.toContain("private transport detail");
});
