import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { action } from "../../app/routes/place-correction";

it("returns bounded retry fields privately without creating a correction when mail is unavailable or limited", async () => {
  const email = `correction-retry-${crypto.randomUUID()}@example.test`;
  const fields = { placeId: "", requestType: "MOVED", relation: "방문자", email, name: "합성 정정 상호", address: "합성 새 주소", phone: "062-000-0000", evidenceNote: "합성 근거", token: "unrelated-input" };
  const submit = () => action({ request: new Request("https://retaste.test/corrections/new", {
    method: "POST", headers: { Origin: "https://retaste.test", "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields),
  }) } as never);
  const first = await submit();
  expect(first).toMatchObject({ data: { ok: false, values: { placeId: "", requestType: "MOVED", email, name: fields.name, evidenceNote: fields.evidenceNote } }, init: { status: 503, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } } });
  expect("values" in first.data && first.data.values).not.toHaveProperty("token");
  await submit(); await submit();
  const limited = await submit();
  expect(limited).toMatchObject({ data: { ok: false, values: { email, requestType: "MOVED" } }, init: { status: 429, headers: { "Retry-After": expect.stringMatching(/^[1-9]\d*$/), "Cache-Control": "private, no-store" } } });
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM place_correction_requests WHERE requester_email=?").bind(email).first("n")).toBe(0);
});
