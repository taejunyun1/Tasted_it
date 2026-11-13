import { eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDb } from "../../db/client.server";
import { categories, placeCategories, places } from "../../db/schema";
import { MAX_ADMIN_CSV_BYTES, MAX_ADMIN_CSV_ROWS } from "./import.server";

const rowSchema = z.object({
  name: z.string().trim().min(1), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  address: z.string().trim().min(1), neighborhood: z.string().trim().min(1),
  latitude: z.number().min(33).max(39), longitude: z.number().min(124).max(132),
  primaryCategory: z.string().min(1), phone: z.string().nullable(), parkingSummary: z.string().nullable(),
  kakaoPlaceId: z.string().nullable(), heroImageUrl: z.url().refine((url) => /^https?:\/\//.test(url)).nullable(),
  status: z.enum(["DRAFT", "HIDDEN"]), searchText: z.string(),
});

const snapshotSchema = z.object({
  version: z.literal(1),
  entries: z.array(z.object({
    row: rowSchema,
    placeId: z.string().min(1),
    existing: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).nullable(),
    category: z.object({ id: z.string(), slug: z.string(), updatedAt: z.string(), isActive: z.boolean() }),
    links: z.string(),
  })).min(1).max(MAX_ADMIN_CSV_ROWS),
});
export type ImportSnapshot = z.infer<typeof snapshotSchema>;

export function parseImportSnapshot(value: unknown): ImportSnapshot {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_ADMIN_CSV_BYTES) throw new Error("IMPORT_PAYLOAD_TOO_LARGE");
  const snapshot = snapshotSchema.parse(value);
  if (new Set(snapshot.entries.map(({ row }) => row.slug)).size !== snapshot.entries.length) throw new Error("IMPORT_DUPLICATE_SLUG");
  if (snapshot.entries.some(({ existing, placeId, row }) => existing && (existing.id !== placeId || existing.slug !== row.slug || !["DRAFT", "HIDDEN"].includes(String(existing.status))))) throw new Error("IMPORT_TARGET_INVALID");
  return snapshot;
}

export async function snapshotPlaceImport(db: AppDb, rows: unknown): Promise<ImportSnapshot> {
  const validRows = z.array(rowSchema).min(1).max(MAX_ADMIN_CSV_ROWS).parse(rows);
  const entries: ImportSnapshot["entries"] = [];
  for (const row of validRows) {
    const category = await db.query.categories.findFirst({ where: eq(categories.slug, row.primaryCategory) });
    if (!category?.isActive) throw new Error(`PRIMARY_CATEGORY_NOT_FOUND:${row.primaryCategory}`);
    const existing = await db.query.places.findFirst({ where: eq(places.slug, row.slug) });
    if (existing?.status === "PUBLISHED") throw new Error(`PUBLISHED_PLACE_REQUIRES_REVIEW:${row.slug}`);
    const links = existing ? await db.select().from(placeCategories).where(eq(placeCategories.placeId, existing.id)) : [];
    entries.push({
      row, placeId: existing?.id ?? crypto.randomUUID(),
      existing: existing ? Object.fromEntries(Object.entries(existing).map(([key, value]) => [key, value])) : null,
      category: { id: category.id, slug: category.slug, updatedAt: category.updatedAt, isActive: category.isActive },
      links: JSON.stringify(links.sort((a, b) => a.categoryId < b.categoryId ? -1 : a.categoryId > b.categoryId ? 1 : 0).map((link) => [link.categoryId, link.isPrimary ? 1 : 0])),
    });
  }
  return parseImportSnapshot({ version: 1, entries });
}

// Every target is checked inside the same transaction as every row mutation.
// This includes category membership, so an editor cannot lose a concurrent tag edit.
export function buildPlaceImportBatch(database: D1Database, operationId: string, payload: unknown, now: string) {
  const snapshot = parseImportSnapshot(payload);
  const checks: D1PreparedStatement[] = [];
  const statements: D1PreparedStatement[] = [];
  for (const [index, entry] of snapshot.entries.entries()) {
    const { row, category, existing, placeId } = entry;
    const categoryGuard = "EXISTS (SELECT 1 FROM categories WHERE id=? AND slug=? AND updated_at=? AND is_active=1)";
    const categoryValues = [category.id, category.slug, category.updatedAt];
    let targetGuard: string;
    let targetValues: (string | number | null)[];
    if (existing) {
      const columns: Record<string, string> = { id: "id", slug: "slug", name: "name", status: "status", address: "address", neighborhood: "neighborhood", latitude: "latitude", longitude: "longitude", phone: "phone", parkingSummary: "parking_summary", heroImageUrl: "hero_image_url", kakaoPlaceId: "kakao_place_id", searchText: "search_text", lastVerifiedAt: "last_verified_at", closedAt: "closed_at", createdAt: "created_at", updatedAt: "updated_at" };
      targetGuard = `EXISTS (SELECT 1 FROM places WHERE ${Object.values(columns).map((column) => `${column} IS ?`).join(" AND ")} AND status IN ('DRAFT','HIDDEN')) AND (SELECT json_group_array(json_array(category_id,is_primary)) FROM (SELECT category_id,is_primary FROM place_categories WHERE place_id=? ORDER BY category_id))=?`;
      targetValues = [...Object.keys(columns).map((key) => existing[key]), placeId, entry.links];
    } else {
      targetGuard = "NOT EXISTS (SELECT 1 FROM places WHERE slug=? OR id=?)";
      targetValues = [row.slug, placeId];
    }
    checks.push(database.prepare(`INSERT INTO admin_operation_checks (operation_id,check_name,passed) SELECT ?,?,CASE WHEN ${categoryGuard} AND ${targetGuard} THEN 1 ELSE 0 END`)
      .bind(operationId, `csv-target-${index}`, ...categoryValues, ...targetValues));
    if (existing) {
      statements.push(database.prepare("UPDATE places SET name=?,status=?,address=?,neighborhood=?,latitude=?,longitude=?,phone=?,parking_summary=?,hero_image_url=?,kakao_place_id=?,search_text=?,updated_at=? WHERE id=?")
        .bind(row.name, row.status, row.address, row.neighborhood, row.latitude, row.longitude, row.phone, row.parkingSummary, row.heroImageUrl, row.kakaoPlaceId, row.searchText, now, placeId));
    } else {
      statements.push(database.prepare("INSERT INTO places (id,slug,name,status,address,neighborhood,latitude,longitude,phone,parking_summary,hero_image_url,kakao_place_id,search_text,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(placeId, row.slug, row.name, row.status, row.address, row.neighborhood, row.latitude, row.longitude, row.phone, row.parkingSummary, row.heroImageUrl, row.kakaoPlaceId, row.searchText, now, now));
    }
    statements.push(database.prepare("UPDATE place_categories SET is_primary=0 WHERE place_id=?").bind(placeId));
    statements.push(database.prepare("INSERT INTO place_categories (place_id,category_id,is_primary) VALUES (?,?,1) ON CONFLICT (place_id,category_id) DO UPDATE SET is_primary=1").bind(placeId, category.id));
  }
  return { checks, statements, result: { imported: snapshot.entries.length } };
}
