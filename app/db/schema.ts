import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
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
  ...timestamps,
});

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
