import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const studentReviewPilotPhotos = sqliteTable("student_review_pilot_photos", {
  id: text("id").primaryKey().notNull(),
  reviewId: text("review_id").notNull(),
  authorUserId: text("author_user_id").notNull(),
  placeId: text("place_id").notNull(),
  placeName: text("place_name").notNull(),
  placeAddress: text("place_address").notNull(),
  contentVersion: integer("content_version").notNull(),
  objectKey: text("object_key").notNull(),
  byteSize: integer("byte_size").notNull(),
  caption: text("caption").notNull(),
  takenOn: text("taken_on").notNull(),
  status: text("status", { enum: ["UPLOADING", "PENDING", "APPROVED", "RETIRED"] }).notNull(),
  sealed: integer("sealed", { mode: "boolean" }).notNull().default(false),
  decisionId: text("decision_id"),
  createdAt: text("created_at").notNull(),
  uploadExpiresAt: text("upload_expires_at").notNull(),
  cleanupAfter: text("cleanup_after").notNull(),
});
