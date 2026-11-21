import { describe, expect, it, vi } from "vitest";
import { inspectEmailDomain, repairEmailDomain, senderDomain } from "../../app/features/auth/email-domain.server";

const id = "2dde7bcf-cb0a-4ea1-a213-052fb2e2fb03";
const fixture = { id, name: "mail.example.com", status: "pending", api_key: "must-not-return",
  records: [{ name: "resend._domainkey", type: "TXT", value: "p=public-key", status: "pending", secret: "must-not-return" }] };
const input = { apiKey: "re_private-test-key", targetDomain: "mail.example.com" };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("bounded email domain repair", () => {
  it("returns only the selected domain and its public DNS fields", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ has_more: false, data: [fixture] })).mockResolvedValueOnce(response(fixture));
    const result = await inspectEmailDomain({ ...input, fetcher });
    expect(result.domain?.name).toBe(input.targetDomain);
    expect(JSON.stringify(result)).not.toContain("must-not-return");
    expect(JSON.stringify(result)).not.toContain(input.apiKey);
    expect(fetcher.mock.calls[0][0]).toBe("https://api.resend.com/domains?limit=100");
  });
  it("does not reveal unrelated domain records or declare incomplete lists absent", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ has_more: false, data: [{ ...fixture, name: "other.example.com" }] }));
    await expect(inspectEmailDomain({ ...input, fetcher })).resolves.toEqual({ domain: null });
    await expect(inspectEmailDomain({ ...input, fetcher: vi.fn(async () => response({ has_more: true, data: [] })) }))
      .rejects.toThrow("EMAIL_DOMAIN_LIST_INCOMPLETE");
  });
  it("rejects another domain's ID before verification", async () => {
    const fetcher = vi.fn(async () => response({ ...fixture, name: "other.example.com" }));
    await expect(repairEmailDomain({ ...input, intent: "verify", domainId: id, fetcher })).rejects.toThrow("EMAIL_DOMAIN_MISMATCH");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1]?.method).toBe("GET");
  });
  it("creates only the configured domain and omits credentials from its result", async () => {
    const fetcher = vi.fn(async () => response(fixture));
    const result = await repairEmailDomain({ ...input, intent: "create", fetcher });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ name: input.targetDomain });
    expect(JSON.stringify(result)).not.toContain("must-not-return");
  });
  it("rejects a same-name response with a different provider identity", async () => {
    const wrong = { ...fixture, id: "00000000-0000-4000-8000-000000000001" };
    const inspect = vi.fn().mockResolvedValueOnce(response({ has_more: false, data: [fixture] })).mockResolvedValueOnce(response(wrong));
    await expect(inspectEmailDomain({ ...input, fetcher: inspect })).rejects.toThrow("EMAIL_DOMAIN_MISMATCH");
    const verify = vi.fn(async () => response(wrong));
    await expect(repairEmailDomain({ ...input, intent: "verify", domainId: id, fetcher: verify })).rejects.toThrow("EMAIL_DOMAIN_MISMATCH");
    expect(verify).toHaveBeenCalledOnce();
  });
  it("keeps API permission failures sanitized", async () => {
    const fetcher = vi.fn(async () => response({ name: "restricted_api_key", message: "owner@example.com only sending access" }, 401));
    await expect(inspectEmailDomain({ ...input, fetcher })).rejects.toThrow("RESEND_SEND_FAILED:401:API_KEY_RESTRICTED");
  });
  it("rejects URL targets and parses only a sender domain", async () => {
    const fetcher = vi.fn();
    await expect(inspectEmailDomain({ ...input, targetDomain: "https://private.invalid/path", fetcher })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    expect(senderDomain("Re:Taste <noreply@mail.example.com>")).toBe("mail.example.com");
    expect(senderDomain("not-an-email")).toBeNull();
  });
});
