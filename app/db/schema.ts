import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  role: text("role", { enum: ["USER", "REVIEWER", "ADMIN"] })
    .notNull()
    .default("USER"),
  passwordHash: text("password_hash"),
  passwordSalt: text("password_salt"),
  emailVerifiedAt: text("email_verified_at"),
  ...timestamps,
});

export const accountTokens = sqliteTable(
  "account_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    purpose: text("purpose", { enum: ["VERIFY_EMAIL", "RESET_PASSWORD"] }).notNull(),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("account_tokens_user_purpose_idx").on(table.userId, table.purpose, table.expiresAt)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  emoji: text("emoji").notNull(),
  parentId: text("parent_id"),
  description: text("description"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

export const places = sqliteTable(
  "places",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    status: text("status", { enum: ["DRAFT", "PUBLISHED", "HIDDEN"] })
      .notNull()
      .default("DRAFT"),
    address: text("address").notNull(),
    neighborhood: text("neighborhood").notNull(),
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    phone: text("phone"),
    parkingSummary: text("parking_summary"),
    heroImageUrl: text("hero_image_url"),
    kakaoPlaceId: text("kakao_place_id"),
    searchText: text("search_text").notNull(),
    ...timestamps,
  },
  (table) => [
    index("places_status_idx").on(table.status),
    index("places_search_text_idx").on(table.searchText),
  ],
);

export const placeCategories = sqliteTable(
  "place_categories",
  {
    placeId: text("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "cascade" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    isPrimary: integer("is_primary", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => [
    primaryKey({ columns: [table.placeId, table.categoryId] }),
    index("place_categories_category_place_idx").on(
      table.categoryId,
      table.placeId,
    ),
  ],
);

export const voteEvents = sqliteTable(
  "vote_events",
  {
    id: text("id").primaryKey(),
    placeId: text("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    value: integer("value").notNull(),
    eventType: text("event_type", {
      enum: ["CREATE", "CHANGE", "WITHDRAW"],
    }).notNull(),
    previousEventId: text("previous_event_id"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("vote_events_place_user_idx").on(table.placeId, table.userId),
  ],
);

export const currentVotes = sqliteTable(
  "current_votes",
  {
    placeId: text("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventId: text("event_id")
      .notNull()
      .references(() => voteEvents.id, { onDelete: "restrict" }),
    value: integer("value").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.placeId, table.userId] })],
);

export const savedPlaces = sqliteTable(
  "saved_places",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    placeId: text("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.placeId] })],
);

export const businessLicenses = sqliteTable(
  "business_licenses",
  {
    id: text("id").primaryKey(),
    sourceType: text("source_type", { enum: ["GENERAL_RESTAURANT", "REST_CAFE", "BAKERY", "ENTERTAINMENT_BAR"] }).notNull(),
    sourceManagementNo: text("source_management_no").notNull(),
    businessName: text("business_name").notNull(),
    businessSubtype: text("business_subtype"),
    salesStatusCode: text("sales_status_code"),
    salesStatusName: text("sales_status_name"),
    detailStatusCode: text("detail_status_code"),
    detailStatusName: text("detail_status_name"),
    normalizedStatus: text("normalized_status", { enum: ["OPEN", "TEMPORARILY_CLOSED", "CLOSED", "UNKNOWN"] }).notNull(),
    lotAddress: text("lot_address"),
    roadAddress: text("road_address"),
    phone: text("phone"),
    sourceX: real("source_x"),
    sourceY: real("source_y"),
    latitude: real("latitude"),
    longitude: real("longitude"),
    regionCode: text("region_code", { enum: ["GWANGJU", "JEONNAM"] }).notNull(),
    sourceUpdatedAt: text("source_updated_at"),
    rawPayload: text("raw_payload").notNull(),
    reviewStatus: text("review_status", { enum: ["PENDING", "APPROVED", "REJECTED"] }).notNull().default("PENDING"),
    reviewReason: text("review_reason"),
    reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: text("reviewed_at"),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("business_licenses_source_idx").on(table.sourceType, table.sourceManagementNo),
    index("business_licenses_candidate_idx").on(table.normalizedStatus, table.reviewStatus),
    index("business_licenses_region_idx").on(table.regionCode),
  ],
);

export const placeSourceLinks = sqliteTable(
  "place_source_links",
  {
    id: text("id").primaryKey(),
    placeId: text("place_id").notNull().references(() => places.id, { onDelete: "cascade" }),
    businessLicenseId: text("business_license_id").notNull().unique().references(() => businessLicenses.id, { onDelete: "restrict" }),
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("place_source_links_place_idx").on(table.placeId)],
);

export const publicDataSyncRuns = sqliteTable("public_data_sync_runs", {
  id: text("id").primaryKey(),
  sourceType: text("source_type").notNull(),
  regionCode: text("region_code").notNull(),
  addressField: text("address_field").notNull(),
  status: text("status", { enum: ["RUNNING", "COMPLETED", "FAILED"] }).notNull(),
  nextPage: integer("next_page").notNull().default(1),
  totalCount: integer("total_count").notNull().default(0),
  fetchedCount: integer("fetched_count").notNull().default(0),
  insertedCount: integer("inserted_count").notNull().default(0),
  updatedCount: integer("updated_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  errorSummary: text("error_summary"),
  ...timestamps,
});

export const adminAuditLogs = sqliteTable("admin_audit_logs", {
  id: text("id").primaryKey(),
  actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  beforeState: text("before_state"),
  afterState: text("after_state"),
  createdAt: text("created_at").notNull(),
});
