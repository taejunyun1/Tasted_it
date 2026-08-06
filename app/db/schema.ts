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
    lastVerifiedAt: text("last_verified_at"),
    closedAt: text("closed_at"),
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

export const reviewerApplications = sqliteTable(
  "reviewer_applications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["APPLIED", "REVIEWING", "APPROVED", "REJECTED"] }).notNull().default("APPLIED"),
    statement: text("statement").notNull(),
    occupation: text("occupation").notNull(),
    tasteDirection: text("taste_direction").notNull(),
    regionCode: text("region_code", { enum: ["GWANGJU", "JEONNAM"] }).notNull(),
    specialtySlugs: text("specialty_slugs").notNull(),
    approvedSuggestionCount: integer("approved_suggestion_count").notNull().default(0),
    overrideReason: text("override_reason"),
    adminNote: text("admin_note"),
    reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: text("reviewed_at"),
    ...timestamps,
  },
  (table) => [
    index("reviewer_applications_user_status_idx").on(table.userId, table.status),
    index("reviewer_applications_status_created_idx").on(table.status, table.createdAt),
  ],
);

export const reviewerProfiles = sqliteTable(
  "reviewer_profiles",
  {
    userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
    slug: text("slug").notNull().unique(),
    status: text("status", { enum: ["ACTIVE", "DORMANT", "SUSPENDED"] }).notNull().default("ACTIVE"),
    occupation: text("occupation").notNull(),
    tasteDirection: text("taste_direction").notNull(),
    regionCode: text("region_code", { enum: ["GWANGJU", "JEONNAM"] }).notNull(),
    specialtySlugs: text("specialty_slugs").notNull(),
    lastActivityAt: text("last_activity_at").notNull(),
    approvedAt: text("approved_at").notNull(),
    approvedBy: text("approved_by").references(() => users.id, { onDelete: "set null" }),
    statusReason: text("status_reason"),
    ...timestamps,
  },
  (table) => [index("reviewer_profiles_status_activity_idx").on(table.status, table.lastActivityAt)],
);

export const ratingConfigs = sqliteTable("rating_configs", {
  id: text("id").primaryKey(),
  algorithmVersion: text("algorithm_version").notNull().unique(),
  minimumVisibleSamples: integer("minimum_visible_samples").notNull(),
  alphaPrior: real("alpha_prior").notNull(),
  betaPrior: real("beta_prior").notNull(),
  reviewerMaxShare: real("reviewer_max_share").notNull(),
  settingsJson: text("settings_json").notNull(),
  activeFrom: text("active_from").notNull(),
  activeUntil: text("active_until"),
  ...timestamps,
});

export const ratingSnapshots = sqliteTable(
  "rating_snapshots",
  {
    id: text("id").primaryKey(),
    placeId: text("place_id").notNull().references(() => places.id, { onDelete: "cascade" }),
    configId: text("config_id").notNull().references(() => ratingConfigs.id, { onDelete: "restrict" }),
    inputHash: text("input_hash").notNull(),
    overallScore: integer("overall_score"),
    userScore: integer("user_score"),
    reviewerScore: integer("reviewer_score"),
    overallSampleCount: integer("overall_sample_count").notNull(),
    userSampleCount: integer("user_sample_count").notNull(),
    reviewerSampleCount: integer("reviewer_sample_count").notNull(),
    reviewerRawWeight: real("reviewer_raw_weight").notNull(),
    reviewerCombinedWeight: real("reviewer_combined_weight").notNull(),
    reviewerWeightShare: real("reviewer_weight_share").notNull(),
    reasonsJson: text("reasons_json").notNull(),
    isStale: integer("is_stale", { mode: "boolean" }).notNull().default(false),
    computedAt: text("computed_at").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("rating_snapshots_input_idx").on(table.placeId, table.configId, table.inputHash),
    index("rating_snapshots_place_computed_idx").on(table.placeId, table.computedAt),
    index("rating_snapshots_stale_idx").on(table.isStale, table.computedAt),
  ],
);

export const reviewerReliabilitySnapshots = sqliteTable(
  "reviewer_reliability_snapshots",
  {
    id: text("id").primaryKey(),
    reviewerUserId: text("reviewer_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    configId: text("config_id").notNull().references(() => ratingConfigs.id, { onDelete: "restrict" }),
    inputHash: text("input_hash").notNull(),
    eligibleCount: integer("eligible_count").notNull(),
    correctCount: integer("correct_count").notNull(),
    posteriorAccuracy: real("posterior_accuracy").notNull(),
    reliabilityWeight: real("reliability_weight").notNull(),
    calibrationStatus: text("calibration_status", { enum: ["CALIBRATING", "ACTIVE"] }).notNull(),
    computedAt: text("computed_at").notNull(),
  },
  (table) => [index("reviewer_reliability_user_computed_idx").on(table.reviewerUserId, table.computedAt), uniqueIndex("reviewer_reliability_input_idx").on(table.reviewerUserId, table.configId, table.inputHash)],
);

export const reviewerSimilarityEdges = sqliteTable(
  "reviewer_similarity_edges",
  {
    id: text("id").primaryKey(),
    configId: text("config_id").notNull().references(() => ratingConfigs.id, { onDelete: "cascade" }),
    leftReviewerUserId: text("left_reviewer_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    rightReviewerUserId: text("right_reviewer_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    overlapCount: integer("overlap_count").notNull(),
    agreementRate: real("agreement_rate").notNull(),
    clusterId: text("cluster_id").notNull(),
    damping: real("damping").notNull(),
    computedAt: text("computed_at").notNull(),
  },
  (table) => [
    uniqueIndex("reviewer_similarity_pair_config_idx").on(table.configId, table.leftReviewerUserId, table.rightReviewerUserId),
    index("reviewer_similarity_cluster_idx").on(table.clusterId),
  ],
);

export const ratingRecomputeJobs = sqliteTable(
  "rating_recompute_jobs",
  {
    id: text("id").primaryKey(),
    placeId: text("place_id").references(() => places.id, { onDelete: "cascade" }),
    configId: text("config_id").notNull().references(() => ratingConfigs.id, { onDelete: "restrict" }),
    scope: text("scope", { enum: ["PLACE", "ALL"] }).notNull(),
    status: text("status", { enum: ["PENDING", "RUNNING", "COMPLETED", "FAILED"] }).notNull().default("PENDING"),
    reason: text("reason").notNull(),
    attempts: integer("attempts").notNull().default(0),
    errorSummary: text("error_summary"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    ...timestamps,
  },
  (table) => [index("rating_recompute_jobs_status_created_idx").on(table.status, table.createdAt)],
);

export const goldenPickEvents = sqliteTable(
  "golden_pick_events",
  {
    id: text("id").primaryKey(),
    reviewerUserId: text("reviewer_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    placeId: text("place_id").notNull().references(() => places.id, { onDelete: "restrict" }),
    eventType: text("event_type", { enum: ["GRANT", "WITHDRAW", "EXPIRE"] }).notNull(),
    previousEventId: text("previous_event_id"),
    reason: text("reason"),
    effectiveAt: text("effective_at").notNull(),
    expiresAt: text("expires_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("golden_pick_reviewer_effective_idx").on(table.reviewerUserId, table.effectiveAt), index("golden_pick_place_effective_idx").on(table.placeId, table.effectiveAt)],
);

export const flavorTemplates = sqliteTable(
  "flavor_templates",
  {
    id: text("id").primaryKey(),
    categoryId: text("category_id").notNull().references(() => categories.id, { onDelete: "restrict" }),
    version: text("version").notNull(),
    dimensionsJson: text("dimensions_json").notNull(),
    status: text("status", { enum: ["DRAFT", "ACTIVE", "ARCHIVED"] }).notNull().default("DRAFT"),
    approvedBy: text("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: text("approved_at"),
    ...timestamps,
  },
  (table) => [uniqueIndex("flavor_templates_category_version_idx").on(table.categoryId, table.version)],
);

export const flavorRatings = sqliteTable(
  "flavor_ratings",
  {
    id: text("id").primaryKey(),
    placeId: text("place_id").notNull().references(() => places.id, { onDelete: "cascade" }),
    reviewerUserId: text("reviewer_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    templateId: text("template_id").notNull().references(() => flavorTemplates.id, { onDelete: "restrict" }),
    valuesJson: text("values_json").notNull(),
    confidence: text("confidence", { enum: ["LOW", "MEDIUM", "HIGH"] }).notNull(),
    status: text("status", { enum: ["ACTIVE", "WITHDRAWN"] }).notNull().default("ACTIVE"),
    ...timestamps,
  },
  (table) => [uniqueIndex("flavor_ratings_place_reviewer_template_idx").on(table.placeId, table.reviewerUserId, table.templateId)],
);

export const placeDailyMetrics = sqliteTable(
  "place_daily_metrics",
  {
    placeId: text("place_id").notNull().references(() => places.id, { onDelete: "cascade" }),
    metricDate: text("metric_date").notNull(),
    detailViews: integer("detail_views").notNull().default(0),
    directionClicks: integer("direction_clicks").notNull().default(0),
    saveActions: integer("save_actions").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.placeId, table.metricDate] })],
);

export const integrityCases = sqliteTable(
  "integrity_cases",
  {
    id: text("id").primaryKey(),
    signalType: text("signal_type").notNull(),
    subjectType: text("subject_type", { enum: ["USER", "PLACE", "REVIEWER_CLUSTER"] }).notNull(),
    subjectId: text("subject_id").notNull(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    status: text("status", { enum: ["OPEN", "REVIEWING", "DISMISSED", "CONFIRMED"] }).notNull().default("OPEN"),
    evidenceJson: text("evidence_json").notNull(),
    resolutionReason: text("resolution_reason"),
    reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: text("reviewed_at"),
    ...timestamps,
  },
  (table) => [index("integrity_cases_status_created_idx").on(table.status, table.createdAt)],
);

export const invalidatedVoteEvents = sqliteTable("invalidated_vote_events", {
  voteEventId: text("vote_event_id").primaryKey().references(() => voteEvents.id, { onDelete: "restrict" }),
  integrityCaseId: text("integrity_case_id").notNull().references(() => integrityCases.id, { onDelete: "restrict" }),
  reason: text("reason").notNull(),
  invalidatedBy: text("invalidated_by").references(() => users.id, { onDelete: "set null" }),
  invalidatedAt: text("invalidated_at").notNull(),
});

export const placeSuggestions = sqliteTable("place_suggestions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  status: text("status", { enum: ["SUBMITTED", "NEEDS_INFO", "REVIEWING", "APPROVED", "REJECTED", "DUPLICATE"] }).notNull().default("SUBMITTED"),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  address: text("address").notNull(),
  normalizedAddress: text("normalized_address").notNull(),
  neighborhood: text("neighborhood").notNull(),
  latitude: real("latitude"),
  longitude: real("longitude"),
  phone: text("phone"),
  categoryId: text("category_id").notNull().references(() => categories.id, { onDelete: "restrict" }),
  description: text("description"),
  duplicateOverrideReason: text("duplicate_override_reason"),
  approvedPlaceId: text("approved_place_id").references(() => places.id, { onDelete: "set null" }),
  reviewReason: text("review_reason"),
  reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: text("reviewed_at"),
  ...timestamps,
}, (table) => [index("place_suggestions_user_status_idx").on(table.userId, table.status), index("place_suggestions_status_created_idx").on(table.status, table.createdAt)]);

export const placeCorrectionRequests = sqliteTable("place_correction_requests", {
  id: text("id").primaryKey(),
  placeId: text("place_id").references(() => places.id, { onDelete: "set null" }),
  requesterUserId: text("requester_user_id").references(() => users.id, { onDelete: "set null" }),
  requesterEmail: text("requester_email").notNull(),
  requesterRelation: text("requester_relation").notNull(),
  requestType: text("request_type", { enum: ["INFORMATION", "MOVED", "TEMPORARILY_CLOSED", "CLOSED", "RIGHTS", "OTHER"] }).notNull(),
  status: text("status", { enum: ["PENDING_VERIFICATION", "SUBMITTED", "REVIEWING", "APPLIED", "REJECTED"] }).notNull().default("PENDING_VERIFICATION"),
  requestedChangesJson: text("requested_changes_json").notNull(),
  evidenceNote: text("evidence_note"),
  verificationTokenHash: text("verification_token_hash").unique(),
  verificationExpiresAt: text("verification_expires_at"),
  verifiedAt: text("verified_at"),
  adminResponse: text("admin_response"),
  reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: text("reviewed_at"),
  ...timestamps,
}, (table) => [index("place_corrections_status_created_idx").on(table.status, table.createdAt), index("place_corrections_place_idx").on(table.placeId)]);

export const placeDuplicateCandidates = sqliteTable("place_duplicate_candidates", {
  id: text("id").primaryKey(),
  suggestionId: text("suggestion_id").references(() => placeSuggestions.id, { onDelete: "cascade" }),
  leftPlaceId: text("left_place_id").references(() => places.id, { onDelete: "cascade" }),
  rightPlaceId: text("right_place_id").notNull().references(() => places.id, { onDelete: "cascade" }),
  confidence: text("confidence", { enum: ["EXACT", "HIGH", "MEDIUM"] }).notNull(),
  distanceMeters: real("distance_meters"),
  reasonsJson: text("reasons_json").notNull(),
  status: text("status", { enum: ["OPEN", "DISMISSED", "MERGED"] }).notNull().default("OPEN"),
  resolvedBy: text("resolved_by").references(() => users.id, { onDelete: "set null" }),
  resolvedAt: text("resolved_at"),
  ...timestamps,
}, (table) => [index("place_duplicates_status_confidence_idx").on(table.status, table.confidence)]);

export const placeSlugRedirects = sqliteTable("place_slug_redirects", {
  oldSlug: text("old_slug").primaryKey(),
  placeId: text("place_id").notNull().references(() => places.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull(),
});

export const placeRevisions = sqliteTable("place_revisions", {
  id: text("id").primaryKey(),
  placeId: text("place_id").notNull().references(() => places.id, { onDelete: "cascade" }),
  actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action", { enum: ["CREATE_FROM_SUGGESTION", "CORRECTION", "MERGE", "RESTORE", "STATUS_CHANGE"] }).notNull(),
  reason: text("reason").notNull(),
  beforeJson: text("before_json"),
  afterJson: text("after_json").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("place_revisions_place_created_idx").on(table.placeId, table.createdAt)]);

export const placeRevalidationCases = sqliteTable("place_revalidation_cases", {
  id: text("id").primaryKey(),
  placeId: text("place_id").notNull().references(() => places.id, { onDelete: "cascade" }),
  reasonType: text("reason_type", { enum: ["CLOSED", "TEMPORARILY_CLOSED", "UNKNOWN", "SOURCE_CONFLICT", "STALE_90D"] }).notNull(),
  status: text("status", { enum: ["OPEN", "REVIEWING", "RESOLVED"] }).notNull().default("OPEN"),
  evidenceJson: text("evidence_json").notNull(),
  resolution: text("resolution"),
  reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: text("reviewed_at"),
  ...timestamps,
}, (table) => [index("place_revalidation_status_reason_idx").on(table.status, table.reasonType), index("place_revalidation_place_reason_idx").on(table.placeId, table.reasonType)]);
