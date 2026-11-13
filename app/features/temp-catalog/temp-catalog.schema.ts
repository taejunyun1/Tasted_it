import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const tempCatalogBatches = sqliteTable("temp_catalog_batches", {
  id: text("id").primaryKey(),
  sourceHash: text("source_hash").notNull(),
  manifestHash: text("manifest_hash").notNull(),
  status: text("status", { enum: ["STAGED", "PUBLISHED", "WITHDRAWN"] }).notNull(),
  version: integer("version").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const tempCatalogEntries = sqliteTable("temp_catalog_entries", {
  id: text("id").primaryKey(),
  batchId: text("batch_id").notNull(),
  sourceId: text("source_id").notNull(),
  placeId: text("place_id").unique(),
  ownsPlace: integer("owns_place", { mode: "boolean" }).notNull().default(false),
  payloadJson: text("payload_json").notNull(),
  latitude: real("latitude"),
  longitude: real("longitude"),
  geoStatus: text("geo_status", { enum: ["PENDING", "CLAIMED", "MATCHED", "FAILED"] }).notNull().default("PENDING"),
  geoCode: text("geo_code"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
