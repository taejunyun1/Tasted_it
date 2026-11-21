import { describe, expect, it, vi } from "vitest";

const skipped = [{ workItemId: "missing-one", code: "NOT_ACTIVE" }, { workItemId: "stale-two", code: "STALE_WORK_ITEM" }];
vi.mock("cloudflare:workers", () => ({ env: { REVIEW_CONFIDENT_ADVANCE_ENABLED: "true" } }));
vi.mock("../../app/db/client.server", () => ({ createDb: () => ({}) }));
vi.mock("../../app/features/auth/session.server", () => ({ requireAdminSession: async () => ({ user: { id: "synthetic-admin" }, sessionId: "synthetic-session" }) }));
vi.mock("../../app/features/places/place-review-work-items.server", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../app/features/places/place-review-work-items.server")>(),
  advancePlaceReviewWorkItems: async (_db: unknown, input: { workItemIds: string[] }) => ({ advanced: [], skipped: skipped.filter(item => input.workItemIds.includes(item.workItemId)) }),
  updateReviewItemAddresses: async () => ({ changed: [], skipped }),
}));

import { action } from "../../app/routes/admin-place-operations";

describe("review actions with every item skipped", () => {
  it.each([
    ["advance-review-items", "SOURCE_REVIEW"],
    ["approve-manual-review-evidence", "NAVER_VERIFICATION"],
    ["update-review-item-addresses", "NAVER_VERIFICATION"],
  ])("preserves each skipped ID for %s", async (intent, expectedStage) => {
    const form = new URLSearchParams({ intent, expectedStage, reason: "합성 검수의 충분한 길이를 가진 확인 근거입니다.", "address:missing-one": "광주광역시 동구 합성로 1", "address:stale-two": "광주광역시 동구 합성로 2" });
    form.append("workItem", "missing-one|1");
    form.append("workItem", "stale-two|1");
    const result = await action({ request: new Request("https://example.com/admin/place-operations", { method: "POST", headers: { Origin: "https://example.com" }, body: form }) } as never);
    expect(result).toMatchObject({ init: { status: 400 }, data: { ok: false, skipped } });
  });

  it("keeps the failed sequential request identity without calling a provider", async () => {
    const form = new URLSearchParams({ intent: "auto-verify-review-item-with-naver", expectedStage: "SOURCE_REVIEW", workItem: "missing-one|1", batchId: "synthetic-batch:0" });
    const result = await action({ request: new Request("https://example.com/admin/place-operations", { method: "POST", headers: { Origin: "https://example.com" }, body: form }) } as never);
    expect(result).toMatchObject({ init: { status: 400 }, data: { ok: false, batchId: "synthetic-batch:0", skipped: skipped.slice(0, 1) } });
  });
});
