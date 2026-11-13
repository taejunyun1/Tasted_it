import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { placeCategories, places } from "../../app/db/schema";
import { action } from "../../app/routes/admin-import";
import { buildPlaceImportBatch, snapshotPlaceImport } from "../../app/features/places/import-operation.server";
import { commitAdminOperation, prepareAdminOperation } from "../../app/features/operations/admin-operation.server";

async function fixture() {
  const id = crypto.randomUUID(), sid = crypto.randomUUID(), category = `csv-${crypto.randomUUID()}`, now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES(?,?,?,'ADMIN',?,?)").bind(id, `${id}@example.test`, "가져오기 검수", now, now),
    env.DB.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)").bind(sid, id, "2099-01-01T00:00:00.000Z", now),
    env.DB.prepare("INSERT INTO categories(id,slug,name,emoji,created_at,updated_at) VALUES(?,?,?,'🍜',?,?)").bind(category, category, "검수 분류", now, now),
    env.DB.prepare("INSERT INTO admin_session_assurances(session_id,actor_user_id,method,verified_at,expires_at) VALUES(?,?,'PASSWORD',?,?)").bind(sid, id, now, "2099-01-01T00:00:00.000Z"),
  ]);
  const row = { name: "CSV 검수 장소", slug: `csv-${crypto.randomUUID()}`, address: "광주광역시 동구", neighborhood: "동명동", latitude: 35.14, longitude: 126.92, primaryCategory: category, phone: null, parkingSummary: null, kakaoPlaceId: null, heroImageUrl: null, status: "DRAFT" as const, searchText: "csv 검수" };
  const context = { actorUserId: id, sessionId: sid, kind: "CSV_IMPORT" as const, now };
  const prepare = async (rows = [row]) => prepareAdminOperation(env.DB, { ...context, payload: await snapshotPlaceImport(createDb(env.DB), rows), summary: { title: "장소 CSV 가져오기", count: rows.length } });
  const commit = async (operationId: string) => commitAdminOperation(env.DB, { ...context, operationId }, (op) => buildPlaceImportBatch(env.DB, op.id, op.payload, now));
  return { id, sid, category, row, now, prepare, commit };
}

function post(sid: string | null, fields: Record<string, string>, origin = "https://import.test") {
  return new Request("https://import.test/admin/import", { method: "POST", headers: { ...(sid ? { Cookie: `retaste_session=${sid}` } : {}), Origin: origin, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) });
}

describe("admin CSV confirmation", () => {
  it("requires admin before parsing and rejects cross-origin or client-reposted CSV", async () => {
    await expect(action({ request: post(null, { intent: "confirm", csv: "arbitrary" }) } as never)).rejects.toMatchObject({ status: 302 });
    const { sid } = await fixture();
    await expect(action({ request: post(sid, { intent: "confirm", operationId: "anything" }, "https://other.test") } as never)).rejects.toMatchObject({ status: 403 });
    await expect(action({ request: post(sid, { intent: "confirm", csv: "arbitrary" }) } as never)).rejects.toMatchObject({ status: 400 });
  });

  it("commits validated rows once and returns the same receipt on replay", async () => {
    const { row, prepare, commit, id } = await fixture();
    const prepared = await prepare();
    expect(await commit(prepared.operationId)).toMatchObject({ replayed: false, result: { imported: 1 } });
    expect(await commit(prepared.operationId)).toMatchObject({ replayed: true, result: { imported: 1 } });
    expect(await createDb(env.DB).query.places.findFirst({ where: eq(places.slug, row.slug) })).toMatchObject({ status: "DRAFT", name: row.name });
    expect((await env.DB.prepare("SELECT id FROM admin_audit_logs WHERE actor_user_id=? AND action='ADMIN_OPERATION_COMMITTED'").bind(id).all()).results).toHaveLength(1);
  });

  it.each(["place", "links", "category"] as const)("rejects a stale %s snapshot without any partial rows", async (change) => {
    const { row, prepare, commit, category, now } = await fixture();
    const existingId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES(?,?,?,'DRAFT',?,?,?, ?,?,?,?)")
      .bind(existingId, row.slug, row.name, row.address, row.neighborhood, row.latitude, row.longitude, row.searchText, now, now).run();
    const second = { ...row, slug: `csv-${crypto.randomUUID()}` };
    const prepared = await prepare([row, second]);
    if (change === "place") await env.DB.prepare("UPDATE places SET name='동시 수정' WHERE id=?").bind(existingId).run();
    if (change === "links") await createDb(env.DB).insert(placeCategories).values({ placeId: existingId, categoryId: category, isPrimary: false });
    if (change === "category") await env.DB.prepare("UPDATE categories SET is_active=0 WHERE id=?").bind(category).run();
    await expect(commit(prepared.operationId)).rejects.toThrow("ADMIN_OPERATION_CONFLICT");
    expect(await createDb(env.DB).query.places.findFirst({ where: eq(places.slug, second.slug) })).toBeUndefined();
    expect(await env.DB.prepare("SELECT id FROM admin_audit_logs WHERE target_id=?").bind(prepared.operationId).first()).toBeNull();
  });

  it("rejects a newly colliding slug and never overwrites published content", async () => {
    const { row, prepare, commit, now } = await fixture();
    const prepared = await prepare();
    await env.DB.prepare("INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES(?,?,?,'PUBLISHED',?,?,?, ?,?,?,?)")
      .bind(crypto.randomUUID(), row.slug, "기존 공개 내용", row.address, row.neighborhood, row.latitude, row.longitude, row.searchText, now, now).run();
    await expect(commit(prepared.operationId)).rejects.toThrow("ADMIN_OPERATION_CONFLICT");
    await expect(prepare()).rejects.toThrow("PUBLISHED_PLACE_REQUIRES_REVIEW");
    expect(await createDb(env.DB).query.places.findFirst({ where: eq(places.slug, row.slug) })).toMatchObject({ name: "기존 공개 내용", status: "PUBLISHED" });
  });
  it("fits an ordinary 200-place manifest in the bounded receipt and audit", async () => {
    const { row, prepare, commit } = await fixture();
    const rows = Array.from({ length: 200 }, (_, index) => ({ ...row, slug: `csv-limit-${crypto.randomUUID()}-${index}` }));
    const prepared = await prepare(rows);
    const receipt = await commit(prepared.operationId);
    expect(receipt.result).toMatchObject({ imported: 200, placeIds: expect.any(Array) });
    expect((receipt.result as { placeIds: string[] }).placeIds).toHaveLength(200);
    const audit = await env.DB.prepare("SELECT after_state FROM admin_audit_logs WHERE target_id=?").bind(prepared.operationId).first<{ after_state: string }>();
    expect(new TextEncoder().encode(audit!.after_state).byteLength).toBeLessThanOrEqual(8192);
  });

});
