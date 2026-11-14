import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const tempPhotoSupplementBatches = sqliteTable("temp_photo_supplement_batches", {
  id: text("id").primaryKey(),
  targetBatchId: text("target_batch_id").notNull().unique(),
  manifestHash: text("manifest_hash").notNull().unique(),
  manifestJson: text("manifest_json").notNull(),
  targetVersion: integer("target_version").notNull(),
  canonicalVersion: integer("canonical_version").notNull(),
  status: text("status", { enum: ["ACTIVE", "WITHDRAWN"] }).notNull(),
  version: integer("version").notNull().default(0),
  createdBy: text("created_by").notNull(),
  updatedBy: text("updated_by").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export const tempPhotoSupplements = sqliteTable("temp_photo_supplements", {
  entryId: text("entry_id").primaryKey(),
  supplementBatchId: text("supplement_batch_id").notNull(),
  payloadJson: text("payload_json").notNull(),
  objectKey: text("object_key").notNull().unique(),
  createdAt: text("created_at").notNull(),
});
