import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { publicVenueVisibilityCondition } from "../../app/features/places/public-venue-visibility.server";
import {
  NON_RESTAURANT_PUBLIC_NAME_TERMS,
  NON_RESTAURANT_PUBLIC_NAME_PREFIXES,
  NON_RESTAURANT_SOURCE_SUBTYPE_TERMS,
} from "../../app/features/places/food-venue-policy";
const now = "2026-11-13T00:00:00.000Z";
const databases: DatabaseSync[] = [];
function database() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql") && f < "0040")
    .sort())
    db.exec(readFileSync(`drizzle/${file}`, "utf8"));
  return db;
}
function user(db: DatabaseSync, id: string) {
  db.prepare(
    "INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES (?,?,'synthetic','USER',?,?)",
  ).run(id, `${id}@example.test`, now, now);
}
function place(db: DatabaseSync, id: string, name = id) {
  db.prepare(
    "INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES (?,?,?,'PUBLISHED','synthetic','synthetic',35,126,?,?,?)",
  ).run(id, id, name, name, now, now);
}
function review(db: DatabaseSync, id: string, placeId: string, extra = "") {
  db.exec(
    `INSERT INTO reviewer_visit_reviews(id,place_id,reviewer_user_id,category_id,evaluation,badges_json,photo_count,published_at,created_at,updated_at${extra ? ",is_current" : ""}) VALUES ('${id}','${placeId}','legacy-author','cat-ramen','RECOMMEND','[]',0,'${now}','${now}','${now}'${extra ? ",1" : ""})`,
  );
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("reviewer moderation add-only migration", () => {
  it("preserves legacy content, refuses implicit approval and freezes the provenance of downgraded reviewers", () => {
    const db = database();
    user(db, "legacy-author");
    user(db, "ordinary");
    place(db, "legacy-place");
    db.prepare(
      "INSERT INTO reviewer_profiles(user_id,slug,status,occupation,taste_direction,region_code,specialty_slugs,last_activity_at,approved_at,created_at,updated_at) VALUES ('legacy-author','legacy-author','DORMANT','synthetic','synthetic','GWANGJU','[]',?,?,?,?)",
    ).run(now, now, now, now);
    review(db, "legacy-one", "legacy-place");
    review(db, "legacy-two", "legacy-place");
    db.prepare(
      "INSERT INTO reviewer_visit_photos(id,review_id,object_key,content_type,byte_size,position,created_at,updated_at) VALUES ('legacy-photo','legacy-one','reviews/legacy-one/photo.jpg','image/jpeg',4,0,?,?)",
    ).run(now, now);
    db.prepare(
      "INSERT INTO vote_events(id,place_id,user_id,value,event_type,created_at) VALUES ('legacy-vote','legacy-place','legacy-author',1,'CREATE',?)",
    ).run(now);
    db.prepare(
      "INSERT INTO vote_events(id,place_id,user_id,value,event_type,created_at) VALUES ('ordinary-vote','legacy-place','ordinary',-1,'CREATE',?)",
    ).run(now);
    db.exec(readFileSync("drizzle/0040_reviewer_moderation.sql", "utf8"));
    expect(
      db
        .prepare(
          "SELECT id,status,is_current,badges_json FROM reviewer_visit_reviews ORDER BY id",
        )
        .all(),
    ).toEqual([
      {
        id: "legacy-one",
        status: "LEGACY_UNREVIEWED",
        is_current: 0,
        badges_json: "[]",
      },
      {
        id: "legacy-two",
        status: "LEGACY_UNREVIEWED",
        is_current: 0,
        badges_json: "[]",
      },
    ]);
    expect(
      db
        .prepare(
          "SELECT object_key,taken_on,rights_basis,privacy_checked FROM reviewer_visit_photos WHERE id='legacy-photo'",
        )
        .get(),
    ).toEqual({
      object_key: "reviews/legacy-one/photo.jpg",
      taken_on: null,
      rights_basis: null,
      privacy_checked: 0,
    });
    expect(
      db.prepare("SELECT source FROM vote_events WHERE id='legacy-vote'").get(),
    ).toEqual({ source: "LEGACY_REVIEWER" });
    expect(
      db
        .prepare("SELECT source FROM vote_events WHERE id='ordinary-vote'")
        .get(),
    ).toEqual({ source: "GENERAL" });
    expect(() =>
      db.exec("UPDATE vote_events SET source='GENERAL' WHERE id='legacy-vote'"),
    ).toThrow();
    expect(() =>
      db.exec("UPDATE vote_events SET value=-1 WHERE id='legacy-vote'"),
    ).toThrow();
    expect(
      db.prepare("SELECT count(*) n FROM reviewer_review_transitions").get(),
    ).toEqual({ n: 0 });
    review(db, "new-one", "legacy-place", "current");
    expect(() => review(db, "new-two", "legacy-place", "current")).toThrow();
  });

  it("keeps the shallow SQL view equivalent to the current venue policy vocabulary", () => {
    const db = database();
    user(db, "legacy-author");
    db.exec(readFileSync("drizzle/0040_reviewer_moderation.sql", "utf8"));
    const query = new SQLiteSyncDialect().sqlToQuery(
      publicVenueVisibilityCondition(),
    );
    const names = [
      "독립 라멘집",
      "Curry 식당",
      "CU한국점",
      "cu123점",
      "cu",
      ...NON_RESTAURANT_PUBLIC_NAME_TERMS.map((t) => `독립 ${t} 업소`),
      ...NON_RESTAURANT_PUBLIC_NAME_PREFIXES.map((t) => `${t} 독립점`),
    ];
    for (const [i, name] of names.entries()) {
      const id = `venue-${i}`;
      place(db, id, name);
      review(db, `review-${i}`, id, "current");
      const expected = Boolean(
        db
          .prepare(
            `SELECT places.id FROM places WHERE places.id=? AND (${query.sql})`,
          )
          .get(id, ...(query.params as string[])),
      );
      expect(
        Boolean(
          db
            .prepare("SELECT id FROM reviewer_public_place_ids WHERE id=?")
            .get(id),
        ),
        name,
      ).toBe(expected);
    }
    for (const [i, subtype] of NON_RESTAURANT_SOURCE_SUBTYPE_TERMS.entries()) {
      const id = `source-${i}`;
      place(db, id);
      review(db, `source-review-${i}`, id, "current");
      db.prepare(
        "INSERT INTO business_licenses(id,source_type,source_management_no,business_name,business_subtype,normalized_status,region_code,raw_payload,review_status,first_seen_at,last_seen_at,created_at,updated_at) VALUES (?,'GENERAL_RESTAURANT',?,?,?,'OPEN','GWANGJU','{}','PENDING',?,?,?,?)",
      ).run(id, id, "독립 업소", subtype, now, now, now, now);
      db.prepare(
        "INSERT INTO place_source_links(id,place_id,business_license_id,created_at) VALUES (?,?,?,?)",
      ).run(id, id, id, now);
      const expected = Boolean(
        db
          .prepare(
            `SELECT places.id FROM places WHERE places.id=? AND (${query.sql})`,
          )
          .get(id, ...(query.params as string[])),
      );
      expect(
        Boolean(
          db
            .prepare("SELECT id FROM reviewer_public_place_ids WHERE id=?")
            .get(id),
        ),
        subtype,
      ).toBe(expected);
    }
  });
});
