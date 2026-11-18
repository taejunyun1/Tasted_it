import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildB17FreezeStatements,
  getB17BaselineCatalogQuery,
  verifyB17IsolatedD1,
} from "../../scripts/b17-isolated-d1.mjs";

// This file deliberately does not import the normal integration setup: both
// bindings start empty and receive only the real migrations through 0049.
const bindings = env as unknown as {
  DB: D1Database;
  MIGRATION_DB: D1Database;
  TEST_MIGRATIONS: D1Migration[];
};
const source = bindings.DB;
const candidate = bindings.MIGRATION_DB;
const NOW = "2026-11-18T00:00:00.000Z";
const LATER = "2100-01-01T00:00:00.000Z";
const PRIVATE_TEXT = "synthetic B17 원문\n검증 전용";
const MIGRATION_NAMES = [
  "0000_week1.sql", "0001_public_data_candidates.sql", "0002_category_taxonomy.sql",
  "0003_member_accounts.sql", "0004_reviewer_management.sql", "0005_rating_foundation.sql",
  "0006_place_operations.sql", "0007_ai_operations.sql", "0008_ai_usage_quota.sql",
  "0009_category_semantic_taxonomy.sql", "0010_chain_store_exclusions.sql",
  "0011_backfill_chain_store_exclusions.sql", "0012_repair_category_slugs.sql",
  "0013_expand_candidate_exclusions.sql", "0014_parking_foundation.sql", "0015_google_oauth.sql",
  "0016_naver_oidc_auth.sql", "0017_profile_taste_badges.sql", "0018_app_first_taste_onboarding.sql",
  "0019_taste_learning_state.sql", "0020_product_event_lifecycle_uniqueness.sql",
  "0021_guest_onboarding_selection_revision.sql", "0022_guest_onboarding_selection_epoch.sql",
  "0023_onboarding_data_lifecycle.sql", "0024_reviewer_visit_reviews.sql",
  "0025_place_liveness_states.sql", "0026_reviewer_visit_photos.sql",
  "0027_reviewer_photo_cleanup_jobs.sql", "0028_rate_limit_windows.sql",
  "0029_auto_not_restaurant_exclusion.sql", "0030_naver_local_category_verification.sql",
  "0031_place_category_v5_profiles.sql", "0031_remove_workers_ai.sql", "0032_place_course_context.sql",
  "0033_naver_place_liveness.sql", "0034_place_review_pipeline.sql", "0035_naver_run_region_code.sql",
  "0036_local_dining_evidence.sql", "0037_student_invitations.sql", "0038_student_tasks.sql",
  "0039_student_invite_aliases.sql", "0040_reviewer_moderation.sql", "0041_guest_saved_places.sql",
  "0042_admin_operation_contract.sql", "0043_admin_session_assurance.sql", "0044_temp_public_catalog.sql",
  "0045_admin_activity_read_indexes.sql", "0046_temp_photo_supplements.sql", "0047_member_access.sql",
  "0048_admin_people_contract.sql", "0049_admin_place_contract.sql",
] as const;

type SchemaRow = { type: string; name: string; tbl_name: string; sql: string | null };
type CatalogRow = { kind: string; type: string; name: string; table_name: string };
type FreezeStatement = { name: string; table: string; event: string; sql: string };
let freeze: { statements: FreezeStatement[]; statementCount: number };
let baselineSchemaSha256: string;
let baselineRowCount: number;

async function schemaSha256(db: D1Database) {
  const { results } = await db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name<>'d1_migrations'
    ORDER BY type,name`).all<SchemaRow>();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(results)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function fixture(db: D1Database) {
  // applyD1Migrations uses Wrangler's ledger shape. Recreate it explicitly so
  // wall-clock application times cannot make the two synthetic copies differ.
  await applyD1Migrations(db, bindings.TEST_MIGRATIONS);
  await db.prepare('DROP TABLE "d1_migrations"').run();
  await db.prepare(`CREATE TABLE "d1_migrations"(id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)`).run();
  await db.batch(MIGRATION_NAMES.map((name, index) => db.prepare(
    'INSERT INTO "d1_migrations"(id,name,applied_at) VALUES(?,?,?)',
  ).bind(index + 1, name, "2026-11-18 00:00:00")));

  await db.batch([
    db.prepare(`INSERT INTO users(rowid,id,email,display_name,role,created_at,updated_at,
      password_hash,password_salt,email_verified_at) VALUES(-17,'b17-admin','b17-admin@example.invalid',
      ?,'ADMIN',?,?,x'0001027fff',NULL,?)`).bind(PRIVATE_TEXT, NOW, NOW, NOW),
    db.prepare(`INSERT INTO users(id,email,display_name,role,created_at,updated_at)
      VALUES('b17-reviewer','b17-reviewer@example.invalid','synthetic reviewer','REVIEWER',?,?),
      ('b17-student','b17-student@example.invalid','synthetic student','USER',?,?)`).bind(NOW, NOW, NOW, NOW),
    db.prepare(`INSERT INTO sessions(rowid,id,user_id,expires_at,created_at)
      VALUES(-18,'b17-session','b17-admin',?,?)`).bind(LATER, NOW),
    db.prepare(`INSERT INTO categories(id,slug,name,emoji,created_at,updated_at)
      VALUES('b17-category','b17-category','synthetic category','🍲',?,?)`).bind(NOW, NOW),
    db.prepare(`INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,
      search_text,created_at,updated_at) VALUES('b17-place','b17-place','synthetic place','PUBLISHED',
      'synthetic address','synthetic area',35.123456,126.987654,'synthetic',?,?)`).bind(NOW, NOW),
    db.prepare(`INSERT INTO place_categories(place_id,category_id,is_primary)
      VALUES('b17-place','b17-category',1)`),
    db.prepare(`INSERT INTO reviewer_profiles(user_id,slug,occupation,taste_direction,region_code,
      specialty_slugs,last_activity_at,approved_at,approved_by,created_at,updated_at)
      VALUES('b17-reviewer','b17-reviewer','synthetic','synthetic','GWANGJU','[]',?,?,
      'b17-admin',?,?)`).bind(NOW, NOW, NOW, NOW),
    db.prepare(`INSERT INTO reviewer_visit_reviews(id,place_id,reviewer_user_id,category_id,evaluation,
      badges_json,photo_count,published_at,created_at,updated_at,status,is_current)
      VALUES('b17-review','b17-place','b17-reviewer','b17-category','RECOMMEND','[]',1,?,?,?,'PENDING',1)`)
      .bind(NOW, NOW, NOW),
    db.prepare(`INSERT INTO reviewer_visit_photos(id,review_id,object_key,content_type,byte_size,position,
      created_at,updated_at,rights_basis,caption) VALUES('b17-photo','b17-review',
      'reviews/b17-review/b17-photo.jpg','image/jpeg',7,0,?,?,'OWN_WORK','synthetic caption')`).bind(NOW, NOW),
    db.prepare(`UPDATE student_seats SET user_id='b17-student',updated_at=? WHERE code='A'`).bind(NOW),
    db.prepare(`INSERT INTO student_tasks(id,kind,target_id,title,assigned_seat,checker_seat,
      created_by,created_at,updated_at) VALUES('b17-task','QA','b17-place','synthetic QA','A','B',
      'b17-admin',?,?)`).bind(NOW, NOW),
    db.prepare(`INSERT INTO admin_operations(rowid,id,kind,actor_user_id,session_id,payload_json,
      payload_hash,summary_json,requires_recent_auth,created_at,expires_at)
      VALUES(-19,'b17-operation','PLACE_ADMIN_CHANGE','b17-admin','b17-session','{}',
      'synthetic-hash','{}',0,?,?)`).bind(NOW, LATER),
    db.prepare(`INSERT INTO admin_operation_commits(rowid,operation_id,actor_user_id,session_id,kind,
      committed_at) VALUES(-20,'b17-operation','b17-admin','b17-session','PLACE_ADMIN_CHANGE',?)`).bind(NOW),
    db.prepare(`INSERT INTO admin_operation_checks(rowid,operation_id,check_name,passed)
      VALUES(-21,'b17-operation','synthetic-check',1)`),
    db.prepare(`UPDATE admin_operations SET status='COMMITTED',payload_json=NULL,result_json='{}',
      committed_at=? WHERE id='b17-operation'`).bind(NOW),
    db.prepare(`INSERT INTO vote_events(id,place_id,user_id,value,event_type,created_at)
      VALUES('b17-vote','b17-place','b17-student',1,'CREATE',?)`).bind(NOW),
    db.prepare(`INSERT INTO current_votes(place_id,user_id,event_id,value,updated_at)
      VALUES('b17-place','b17-student','b17-vote',1,?)`).bind(NOW),
    // Bindings turn JS numbers into doubles. Use a SQL integer literal, then
    // inspect CAST(... AS TEXT), so this test cannot silently round 2^53+1.
    db.prepare(`INSERT INTO rating_recompute_jobs(id,place_id,config_id,scope,reason,attempts,
      created_at,updated_at) VALUES('b17-job','b17-place','rating-config-v2','PLACE','synthetic',
      9007199254740993,?,?)`).bind(NOW, NOW),
  ]);
}

async function verify() {
  return verifyB17IsolatedD1({ source, candidate });
}

async function rejectsSanitized(operation: Promise<unknown>) {
  try {
    await operation;
    throw new Error("EXPECTED_B17_REJECTION");
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/^B17_ISOLATED_[A-Z_]+$/);
    expect((error as Error).message).not.toContain(PRIVATE_TEXT);
  }
}

async function mismatch(mutate: string, restore: string, table: string, column?: string) {
  await candidate.prepare(mutate).run();
  try {
    const report = await verify();
    expect(report.ok, mutate).toBe(false);
    expect(report.mismatchCount, mutate).toBeGreaterThan(0);
    expect(report.mismatches, mutate).toEqual(expect.arrayContaining([
      expect.objectContaining({ table, ...(column ? { column } : {}) }),
    ]));
    expect(JSON.stringify(report)).not.toContain(PRIVATE_TEXT);
    expect(JSON.stringify(report)).not.toContain("b17-admin@example.invalid");
    for (const entry of report.mismatches) {
      expect(Object.keys(entry).sort()).toEqual(["column", "rowid", "table"]);
    }
  } finally {
    await candidate.prepare(restore).run();
  }
}

describe("B17 isolated D1: real 0049 source and candidate", () => {
  beforeAll(async () => {
    expect(bindings.TEST_MIGRATIONS.map(migration => migration.name)).toEqual(MIGRATION_NAMES);
    await Promise.all([fixture(source), fixture(candidate)]);
    const schemas = await Promise.all([schemaSha256(source), schemaSha256(candidate)]);
    expect(schemas[0]).toBe(schemas[1]);
    baselineSchemaSha256 = schemas[0];

    const { results: catalog } = await source.prepare(getB17BaselineCatalogQuery()).all<CatalogRow>();
    const tables = catalog.filter(row => row.type === "table" && row.name !== "d1_migrations");
    expect(tables).toHaveLength(82);
    baselineRowCount = 0;
    for (const table of tables) {
      const result = await source.prepare(`SELECT count(*) AS count FROM "${table.name.replaceAll('"', '""')}"`)
        .first<{ count: number }>();
      baselineRowCount += result!.count;
    }
    freeze = buildB17FreezeStatements(catalog);
    expect(freeze.statementCount).toBe(246);
    expect(freeze.statements).toHaveLength(246);
    await source.batch(freeze.statements.map(statement => source.prepare(statement.sql)));
  }, 30_000);

  it("preserves rowids and SQLite storage types, and detects candidate value or rowid loss", async () => {
    for (const db of [source, candidate]) {
      expect(await db.prepare(`SELECT CAST(rowid AS TEXT) AS rowid,typeof(password_hash) AS blobType,
        hex(password_hash) AS blob,typeof(password_salt) AS nullType,typeof(display_name) AS textType
        FROM users WHERE id='b17-admin'`).first()).toEqual({
        rowid: "-17", blobType: "blob", blob: "0001027FFF", nullType: "null", textType: "text",
      });
      expect(await db.prepare(`SELECT typeof(attempts) AS type,CAST(attempts AS TEXT) AS value
        FROM rating_recompute_jobs WHERE id='b17-job'`).first()).toEqual({
        type: "integer", value: "9007199254740993",
      });
      expect(await db.prepare("SELECT typeof(latitude) AS type FROM places WHERE id='b17-place'")
        .first()).toEqual({ type: "real" });
      expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
    }
    const accepted = await verify();
    expect(accepted).toMatchObject({ ok: true, tableCount: 82, rowCount: baselineRowCount,
      mismatchCount: 0, mismatches: [] });
    expect(accepted.snapshotSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(accepted.candidateSnapshotSha256).toBe(accepted.snapshotSha256);
    expect(accepted.schemaSha256).toBe("a228043440488179e82e9abc2f2d9b26075ad9e810ab692343bd2e80aab822fe");
    expect(accepted.freezeTriggerCount).toBe(246);
    expect(accepted.cost).toEqual({ sqlStatements: 24, captureStatementsPerDatabase: 7, freezeDdlStatements: 246 });
    expect(JSON.stringify(accepted)).not.toContain(PRIVATE_TEXT);

    await mismatch(`UPDATE users SET display_name='synthetic corruption' WHERE id='b17-admin'`,
      `UPDATE users SET display_name='synthetic B17 원문'||char(10)||'검증 전용' WHERE id='b17-admin'`,
      "users", "display_name");
    await mismatch(`UPDATE users SET rowid=17 WHERE id='b17-admin'`,
      `UPDATE users SET rowid=-17 WHERE id='b17-admin'`, "users");
    await mismatch(`UPDATE rating_recompute_jobs SET attempts=9007199254740992 WHERE id='b17-job'`,
      `UPDATE rating_recompute_jobs SET attempts=9007199254740993 WHERE id='b17-job'`,
      "rating_recompute_jobs", "attempts");
    await mismatch(`UPDATE users SET password_hash=x'0001027ffe' WHERE id='b17-admin'`,
      `UPDATE users SET password_hash=x'0001027fff' WHERE id='b17-admin'`, "users", "password_hash");
    await mismatch(`UPDATE users SET password_salt='' WHERE id='b17-admin'`,
      `UPDATE users SET password_salt=NULL WHERE id='b17-admin'`, "users", "password_salt");
    await candidate.prepare("UPDATE users SET display_name=? WHERE id='b17-admin'")
      .bind("x".repeat(262145)).run();
    try { await rejectsSanitized(verify()); }
    finally {
      await candidate.prepare("UPDATE users SET display_name=? WHERE id='b17-admin'")
        .bind(PRIVATE_TEXT).run();
    }
    // The SQL still reads actual D1 data. Only this adapter's returned row array
    // loses one row, representing an incomplete transport result, not a mock DB.
    let droppedProjectionRow = false;
    const truncatedCandidate = {
      prepare(sql: string) {
        const statement = candidate.prepare(sql);
        return {
          async all() {
            const read = await statement.all<{ row_count?: number; values_json?: string | null }>();
            if (!droppedProjectionRow && sql.includes("AS values_json FROM")) {
              const index = read.results.findIndex(row => (row.row_count ?? 0) > 1 && row.values_json != null);
              if (index !== -1) {
                droppedProjectionRow = true;
                return { ...read, results: read.results.filter((_, position) => position !== index) };
              }
            }
            return read;
          },
        };
      },
    };
    await expect(verifyB17IsolatedD1({ source, candidate: truncatedCandidate }))
      .rejects.toThrow(/^B17_ISOLATED_TRUNCATED$/);
    expect(droppedProjectionRow).toBe(true);
    expect((await verify()).snapshotSha256).toBe(accepted.snapshotSha256);
    expect(await schemaSha256(candidate)).toBe(baselineSchemaSha256);
  }, 30_000);

  it("fails closed on missing or altered freeze, extra DDL, or incomplete migration ledger", async () => {
    for (const sql of [
      `INSERT INTO users(id,email,display_name,role,created_at,updated_at)
        VALUES('b17-blocked','b17-blocked@example.invalid','synthetic blocked','USER','${NOW}','${NOW}')`,
      "UPDATE users SET display_name='synthetic blocked' WHERE id='b17-admin'",
      "DELETE FROM users WHERE id='b17-admin'",
    ]) {
      await expect(source.prepare(sql).run()).rejects.toThrow("B17_SOURCE_FROZEN");
    }
    const statement = freeze.statements.find(entry => entry.table === "users" && entry.event === "UPDATE")!;
    expect(statement).toBeDefined();
    await source.prepare(`DROP TRIGGER "${statement.name}"`).run();
    try {
      await rejectsSanitized(verify());
      await source.prepare(`CREATE TRIGGER "${statement.name}" BEFORE UPDATE ON users
        BEGIN SELECT RAISE(ABORT,'synthetic wrong freeze'); END`).run();
      await rejectsSanitized(verify());
    } finally {
      await source.prepare(`DROP TRIGGER IF EXISTS "${statement.name}"`).run();
      await source.prepare(statement.sql).run();
    }
    await candidate.prepare("CREATE INDEX b17_unexpected_ddl ON users(display_name)").run();
    try { await rejectsSanitized(verify()); }
    finally { await candidate.prepare("DROP INDEX b17_unexpected_ddl").run(); }
    await source.prepare("CREATE INDEX b17_unexpected_source_ddl ON users(display_name)").run();
    try { await rejectsSanitized(verify()); }
    finally { await source.prepare("DROP INDEX b17_unexpected_source_ddl").run(); }

    await candidate.prepare("DELETE FROM d1_migrations WHERE id=51").run();
    try { await rejectsSanitized(verify()); }
    finally {
      await candidate.prepare("INSERT INTO d1_migrations(id,name,applied_at) VALUES(51,?,'2026-11-18 00:00:00')")
        .bind(MIGRATION_NAMES[50]).run();
    }
    await source.prepare("DELETE FROM d1_migrations WHERE id=51").run();
    try { await rejectsSanitized(verify()); }
    finally {
      await source.prepare("INSERT INTO d1_migrations(id,name,applied_at) VALUES(51,?,'2026-11-18 00:00:00')")
        .bind(MIGRATION_NAMES[50]).run();
    }
    await candidate.prepare("UPDATE sqlite_sequence SET seq=seq+1 WHERE name='d1_migrations'").run();
    try { await expect(verify()).rejects.toThrow(/^B17_ISOLATED_LEDGER_MISMATCH$/); }
    finally { await candidate.prepare("UPDATE sqlite_sequence SET seq=51 WHERE name='d1_migrations'").run(); }

    // A real D1 FK violation cannot be persisted through a successful commit.
    // Confirm enforcement and leave invalid-result simulation to unit coverage.
    await expect(candidate.prepare(`INSERT INTO sessions(id,user_id,expires_at,created_at)
      VALUES('b17-invalid-session','b17-missing-user',?,?)`).bind(LATER, NOW).run())
      .rejects.toThrow(/FOREIGN KEY constraint failed/);
    const accepted = await verify();
    expect(accepted.ok).toBe(true);
    expect(accepted.tableCount).toBe(82);
    expect(await schemaSha256(candidate)).toBe(baselineSchemaSha256);
  }, 30_000);
});
