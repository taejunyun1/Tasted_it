import { getTableColumns, getTableName, type Table } from "drizzle-orm";
import * as schema from "../../db/schema";

export type PlaceSnapshot = Record<string, Array<Record<string, unknown>>>;
export type PlaceSnapshotScope = { workItemId?: string; sourcePlaceId?: string; targetPlaceId?: string };
const MAX_ROWS = 1000;
const MAX_BYTES = 768 * 1024;
const ident = (value: string) => `"${value.replaceAll('"', '""')}"`;
type Spec = { key: string; table: Table | string; where: string; fields?: string[]; raw?: Record<string, string>; cap?: number };
const selected = "IN (SELECT id FROM scope)";
const licenses = "IN (SELECT id FROM license_scope)";
const people = "IN (SELECT id FROM people_scope)";

/** One statement observes a coherent, ordered footprint; no row contents are persisted. */
export function placeSnapshotStatement(database: D1Database, input: PlaceSnapshotScope, publishing: boolean) {
  const specs: Spec[] = [
    { key: "places", table: schema.places, where: `id ${selected}` },
    { key: "workItems", table: schema.placeReviewWorkItems, where: `place_id ${selected} OR id=(SELECT work_id FROM ctx)` },
    { key: "licenses", table: schema.businessLicenses, where: `id ${licenses}`, fields: ["id", "sourceType", "businessName", "businessSubtype", "normalizedStatus", "roadAddress", "lotAddress", "latitude", "longitude", "phone", "reviewStatus", "updatedAt"] },
    { key: "sourceLinks", table: schema.placeSourceLinks, where: `place_id ${selected}` },
    { key: "exclusions", table: schema.businessLicenseExclusions, where: `business_license_id ${licenses}` },
    { key: "placeCategories", table: schema.placeCategories, where: `place_id ${selected}` },
    { key: "categories", table: schema.categories, where: "1" },
    { key: "liveness", table: schema.placeLivenessStates, where: `place_id ${selected}` },
    { key: "candidateNaver", table: schema.naverLocalCategoryVerifications, where: `business_license_id ${licenses}`, fields: ["businessLicenseId", "status", "ruleVersion", "expiresAt", "queriedAt", "inputFingerprint", "matchedCategoryPath"] },
    { key: "duplicates", table: schema.placeReviewDuplicateResolutions, where: "work_item_id=(SELECT work_id FROM ctx)" },
    { key: "currentVotes", table: schema.currentVotes, where: `place_id ${selected}` },
    { key: "voteEvents", table: schema.voteEvents, where: "id IN (SELECT event_id FROM current_votes WHERE place_id IN (SELECT id FROM scope))" },
    { key: "invalidations", table: schema.invalidatedVoteEvents, where: "vote_event_id IN (SELECT event_id FROM current_votes WHERE place_id IN (SELECT id FROM scope))" },
    { key: "saveChoices", table: schema.memberSaveChoices, where: `place_id ${selected}` },
    { key: "savedPlaces", table: schema.savedPlaces, where: `place_id ${selected}` },
    { key: "guestSaves", table: schema.guestSavedPlaces, where: `place_id ${selected}` },
    { key: "suggestions", table: schema.placeSuggestions, where: `approved_place_id ${selected}`, fields: ["id", "approvedPlaceId", "status", "updatedAt"] },
    { key: "corrections", table: schema.placeCorrectionRequests, where: `place_id ${selected}`, fields: ["id", "placeId", "status", "updatedAt"] },
    { key: "redirects", table: schema.placeSlugRedirects, where: `place_id ${selected} OR old_slug IN(SELECT slug FROM places WHERE id IN(SELECT id FROM scope))` },
    { key: "reviews", table: schema.reviewerVisitReviews, where: `place_id ${selected}` },
    { key: "photos", table: schema.reviewerVisitPhotos, where: "review_id IN(SELECT id FROM reviewer_visit_reviews WHERE place_id IN(SELECT id FROM scope))" },
    { key: "goldenPicks", table: schema.goldenPickEvents, where: `place_id ${selected}` },
    { key: "flavorRatings", table: schema.flavorRatings, where: `place_id ${selected}` },
    { key: "people", table: schema.users, where: `id ${people}`, fields: ["id", "role", "email", "updatedAt"] },
    { key: "profiles", table: schema.reviewerProfiles, where: `user_id ${people}`, fields: ["userId", "status", "version", "updatedAt"] },
    { key: "access", table: "member_access_restrictions", where: `user_id ${people}`, raw: { userId: "user_id", version: "version", startsAt: "starts_at", expiresAt: "expires_at", liftedAt: "lifted_at", updatedAt: "updated_at" } },
    { key: "tempEntries", table: schema.tempCatalogEntries, where: `place_id ${selected}`, fields: ["id", "batchId", "placeId", "ownsPlace", "updatedAt"] },
    { key: "tempBatches", table: schema.tempCatalogBatches, where: "id IN(SELECT batch_id FROM temp_catalog_entries WHERE place_id IN(SELECT id FROM scope))" },
  ];
  if (publishing) {
    specs.push(
      { key: "catalog", table: schema.places, where: "1", fields: ["id", "name", "address", "latitude", "longitude", "slug"], cap: 2000 },
      { key: "intakeLinks", table: schema.placeIntakeReviewLinks, where: "work_item_id=(SELECT work_id FROM ctx)",
        fields: ["batchId", "position", "mode", "subjectName", "subjectAddress", "subjectLatitude", "subjectLongitude"] },
      { key: "intakeEntries", table: "place_intake_entries",
        where: `(batch_id,position) IN (SELECT l.batch_id,l.position FROM place_intake_review_links l
          JOIN place_intake_batches b ON b.id=l.batch_id WHERE l.work_item_id=(SELECT work_id FROM ctx) AND b.state='READY')`,
        raw: { selection: "selection", kind: "kind", region: "region_code", neighborhood: "neighborhood" } },
    );
  }
  const fragments = specs.map((spec) => {
    const columns = typeof spec.table === "string" ? Object.fromEntries(Object.entries(spec.raw!).map(([key, name]) => [key, { name }])) : getTableColumns(spec.table);
    const fields = spec.fields ?? Object.keys(columns);
    const pairs = fields.flatMap((key) => { if (!columns[key]) throw new Error(`PLACE_SNAPSHOT_COLUMN_${key}`); return [`'${key}'`, ident(columns[key].name)]; });
    const ordering = fields.map((key) => ident(columns[key].name)).join(",");
    return `'${spec.key}',json((SELECT coalesce(json_group_array(json(row_json)),'[]') FROM
      (SELECT json_object(${pairs.join(",")}) AS row_json FROM ${ident(typeof spec.table === "string" ? spec.table : getTableName(spec.table))} WHERE ${spec.where} ORDER BY ${ordering} LIMIT ${(spec.cap ?? MAX_ROWS) + 1})))`;
  });
  const sql = `WITH ctx(work_id,source_id,target_id) AS (VALUES(?,?,?)), scope(id) AS MATERIALIZED
    (SELECT source_id FROM ctx WHERE source_id IS NOT NULL UNION SELECT target_id FROM ctx WHERE target_id IS NOT NULL
     UNION SELECT place_id FROM place_review_work_items WHERE id=(SELECT work_id FROM ctx) AND place_id IS NOT NULL),
    license_scope(id) AS MATERIALIZED (SELECT business_license_id FROM place_review_work_items WHERE id=(SELECT work_id FROM ctx)
     UNION SELECT business_license_id FROM place_source_links WHERE place_id IN(SELECT id FROM scope)),
    people_scope(id) AS MATERIALIZED (SELECT id FROM users WHERE
      id IN(SELECT user_id FROM current_votes WHERE place_id IN(SELECT id FROM scope))
      OR id IN(SELECT user_id FROM member_save_choices WHERE place_id IN(SELECT id FROM scope))
      OR id IN(SELECT user_id FROM saved_places WHERE place_id IN(SELECT id FROM scope))
      OR id IN(SELECT reviewer_user_id FROM reviewer_visit_reviews WHERE place_id IN(SELECT id FROM scope))
      OR id IN(SELECT reviewer_user_id FROM golden_pick_events WHERE place_id IN(SELECT id FROM scope))
      OR id IN(SELECT reviewer_user_id FROM flavor_ratings WHERE place_id IN(SELECT id FROM scope)))
    SELECT json_object(${fragments.join(",")}) AS snapshot`;
  const values = [input.workItemId ?? null, input.sourcePlaceId ?? null, input.targetPlaceId ?? null];
  return {
    async read() {
      const raw = await database.prepare(sql).bind(...values).first<string>("snapshot");
      if (!raw || new TextEncoder().encode(raw).byteLength > MAX_BYTES) throw new Error("PLACE_ADMIN_SNAPSHOT_TOO_LARGE");
      const rows = JSON.parse(raw) as PlaceSnapshot;
      if (specs.some((spec) => rows[spec.key].length > (spec.cap ?? MAX_ROWS))) throw new Error("PLACE_ADMIN_SNAPSHOT_TOO_LARGE");
      return { raw, rows };
    },
    guard(operationId: string, expected: string) {
      return database.prepare(`INSERT INTO admin_operation_checks(operation_id,check_name,passed)
        SELECT ?,'place-footprint',CASE WHEN (${sql})=? THEN 1 ELSE 0 END`).bind(operationId, ...values, expected);
    },
  };
}

export async function placeSnapshotDigest(raw: string) {
  const rows = JSON.parse(raw) as PlaceSnapshot;
  if (!rows.intakeLinks?.length) delete rows.intakeLinks;
  if (!rows.intakeEntries?.length) delete rows.intakeEntries;
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(rows)))), (b) => b.toString(16).padStart(2, "0")).join("");
}
