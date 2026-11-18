import { createHash } from "node:crypto";

// Pinned from actual 0049 D1 catalogue in a2dd828. No #470 runtime imports.
const SCHEMA = "a228043440488179e82e9abc2f2d9b26075ad9e810ab692343bd2e80aab822fe";
const MIGRATIONS = Object.freeze([
  "0000_week1.sql",
  "0001_public_data_candidates.sql",
  "0002_category_taxonomy.sql",
  "0003_member_accounts.sql",
  "0004_reviewer_management.sql",
  "0005_rating_foundation.sql",
  "0006_place_operations.sql",
  "0007_ai_operations.sql",
  "0008_ai_usage_quota.sql",
  "0009_category_semantic_taxonomy.sql",
  "0010_chain_store_exclusions.sql",
  "0011_backfill_chain_store_exclusions.sql",
  "0012_repair_category_slugs.sql",
  "0013_expand_candidate_exclusions.sql",
  "0014_parking_foundation.sql",
  "0015_google_oauth.sql",
  "0016_naver_oidc_auth.sql",
  "0017_profile_taste_badges.sql",
  "0018_app_first_taste_onboarding.sql",
  "0019_taste_learning_state.sql",
  "0020_product_event_lifecycle_uniqueness.sql",
  "0021_guest_onboarding_selection_revision.sql",
  "0022_guest_onboarding_selection_epoch.sql",
  "0023_onboarding_data_lifecycle.sql",
  "0024_reviewer_visit_reviews.sql",
  "0025_place_liveness_states.sql",
  "0026_reviewer_visit_photos.sql",
  "0027_reviewer_photo_cleanup_jobs.sql",
  "0028_rate_limit_windows.sql",
  "0029_auto_not_restaurant_exclusion.sql",
  "0030_naver_local_category_verification.sql",
  "0031_place_category_v5_profiles.sql",
  "0031_remove_workers_ai.sql",
  "0032_place_course_context.sql",
  "0033_naver_place_liveness.sql",
  "0034_place_review_pipeline.sql",
  "0035_naver_run_region_code.sql",
  "0036_local_dining_evidence.sql",
  "0037_student_invitations.sql",
  "0038_student_tasks.sql",
  "0039_student_invite_aliases.sql",
  "0040_reviewer_moderation.sql",
  "0041_guest_saved_places.sql",
  "0042_admin_operation_contract.sql",
  "0043_admin_session_assurance.sql",
  "0044_temp_public_catalog.sql",
  "0045_admin_activity_read_indexes.sql",
  "0046_temp_photo_supplements.sql",
  "0047_member_access.sql",
  "0048_admin_people_contract.sql",
  "0049_admin_place_contract.sql"
]);
export const B17_ISOLATED_LIMITS = Object.freeze({ maxTableRows: 10000, maxBatchRows: 10000, maxTotalRows: 50000,
  maxCellBytes: 262144, maxBatchBytes: 4194304, maxTotalBytes: 67108864,
  maxResponseBytes: 16777216, maxSqlBytes: 92160, maxTablesPerQuery: 12 });
const fail = (code) => { throw new Error(`B17_ISOLATED_${code}`); };
const hash = (v) => createHash("sha256").update(v).digest("hex");
const bytes = (v) => Buffer.byteLength(v, "utf8");
const canonical = (v) => JSON.stringify(v, (_, x) => x && !Array.isArray(x) && typeof x === "object"
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x);
const exact = (v, keys) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join(",") === [...keys].sort().join(",");
const quote = (name) => { if (typeof name !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(name)) fail("IDENTIFIER"); return `"${name}"`; };
const integer = (v) => {
  if (typeof v !== "string" || v.length > 20 || !/^(0|-?[1-9][0-9]*)$/.test(v)) fail("INTEGER");
  if (BigInt(v) < -9223372036854775808n || BigInt(v) > 9223372036854775807n) fail("INTEGER");
};
const count = (v) => { if (!Number.isSafeInteger(v) || v < 0) fail("COUNT"); return v; };

export function getB17BaselineCatalogQuery() {
  return `SELECT 'object' AS kind,s.name AS name,s.tbl_name AS table_name,s.type AS type,s.sql AS definition,NULL AS cid,NULL AS not_null,NULL AS pk,NULL AS hidden,NULL AS default_value FROM sqlite_master s WHERE substr(s.name,1,7)<>'sqlite_' AND s.name NOT IN('_cf_KV','_cf_METADATA','d1_migrations') UNION ALL SELECT 'column',p.name,s.name,p.type,NULL,p.cid,p.[notnull],p.pk,p.hidden,p.dflt_value FROM sqlite_master s JOIN pragma_table_xinfo(s.name) p WHERE s.type='table' AND substr(s.name,1,7)<>'sqlite_' AND s.name NOT IN('_cf_KV','_cf_METADATA','d1_migrations') ORDER BY kind,table_name,name LIMIT 2001`;
}

function catalogDigest(rows) {
  if (!Array.isArray(rows) || rows.length > 2000 || bytes(JSON.stringify(rows)) > 2097152) fail("CATALOG_LIMIT");
  const normalized = rows.map((r) => {
    if (!exact(r, ["kind", "name", "table_name", "type", "definition", "cid", "not_null", "pk", "hidden", "default_value"])) fail("CATALOG");
    quote(r.name); quote(r.table_name);
    return canonical(r);
  }).sort();
  return hash(`[${normalized.join(",")}]`);
}

function baseline(rows) {
  if (catalogDigest(rows) !== SCHEMA) fail("SCHEMA");
  const columns = {};
  for (const r of rows.filter((r) => r.kind === "column").sort((a, b) => a.cid - b.cid)) {
    if (r.hidden !== 0 || ["rowid", "oid", "_rowid_"].includes(r.name)) fail("ROWID_SCHEMA");
    (columns[r.table_name] ??= []).push(r.name);
  }
  if (Object.keys(columns).length !== 82 || Object.values(columns).reduce((n, c) => n + c.length, 0) !== 853) fail("PROJECTION");
  return columns;
}

export function buildB17FreezeStatements(catalog) {
  const columns = baseline(catalog), statements = [];
  for (const table of Object.keys(columns).sort()) for (const event of ["INSERT", "UPDATE", "DELETE"]) {
    const name = `b17_freeze_${table}_${event.toLowerCase()}`;
    const sql = `CREATE TRIGGER ${quote(name)} BEFORE ${event} ON ${quote(table)} BEGIN SELECT RAISE(ABORT,'B17_SOURCE_FROZEN'); END`;
    statements.push({ name, table, event, sql });
  }
  return { statements, statementCount: statements.length, sha256: hash(canonical(statements)) };
}

function frozenSource(rows) {
  const tables = rows.filter((r) => r.kind === "object" && r.type === "table").map((r) => r.name);
  const names = new Set(tables.flatMap((t) => ["insert", "update", "delete"].map((event) => `b17_freeze_${t}_${event}`)));
  // Remove only the exact generated names, then pin every remaining DDL object.
  const original = rows.filter((r) => !(r.kind === "object" && names.has(r.name)));
  const freeze = buildB17FreezeStatements(original);
  for (const statement of freeze.statements) {
    const expected = { kind: "object", name: statement.name, table_name: statement.table, type: "trigger", definition: statement.sql,
      cid: null, not_null: null, pk: null, hidden: null, default_value: null };
    const matches = rows.filter((r) => r.name === statement.name && r.kind === "object");
    if (matches.length !== 1 || canonical(matches[0]) !== canonical(expected)) fail("FREEZE");
  }
  return { columns: baseline(original), freeze };
}

function ledgerSql() {
  return `SELECT CAST(rowid AS TEXT) AS rowid,typeof(id) AS id_type,CAST(id AS TEXT) AS id,name,applied_at,
    (SELECT sql FROM sqlite_master WHERE type='table' AND name='d1_migrations') AS definition,
    (SELECT json_group_array(json_array(name,type,"notnull",dflt_value,pk)) FROM pragma_table_info('d1_migrations')) AS columns_json,
    (SELECT CAST(seq AS TEXT) FROM sqlite_sequence WHERE name='d1_migrations') AS sequence_value
    FROM d1_migrations ORDER BY id LIMIT ${MIGRATIONS.length + 1}`;
}
function ledger(rows) {
  if (!Array.isArray(rows) || rows.length !== MIGRATIONS.length || bytes(JSON.stringify(rows)) > 65536) fail("LEDGER");
  const expectedColumns = [["id", "INTEGER", 0, null, 1], ["name", "TEXT", 0, null, 0], ["applied_at", "TIMESTAMP", 1, "CURRENT_TIMESTAMP", 0]];
  const normalize = (s) => typeof s === "string" ? s.replace(/\s+/g, "").replaceAll('"', "").toLowerCase() : "";
  const ddl = "createtabled1_migrations(idintegerprimarykeyautoincrement,nametextunique,applied_attimestampdefaultcurrent_timestampnotnull)";
  const seen = new Set(), seenNames = new Set(), expectedNames = new Set(MIGRATIONS);
  const normalized = rows.map((r) => {
    if (!exact(r, ["rowid", "id_type", "id", "name", "applied_at", "definition", "columns_json", "sequence_value"]) || r.id_type !== "integer"
      || !expectedNames.has(r.name) || seenNames.has(r.name) || typeof r.applied_at !== "string" || r.applied_at.length > 64 || r.applied_at.length < 10
      || normalize(r.definition) !== ddl || r.columns_json !== JSON.stringify(expectedColumns)) fail("LEDGER");
    integer(r.rowid); integer(r.id);
    integer(r.sequence_value);
    if (r.rowid !== r.id || seen.has(r.id) || r.sequence_value !== rows[0].sequence_value || BigInt(r.sequence_value) < BigInt(r.id)) fail("LEDGER"); seen.add(r.id); seenNames.add(r.name);
    return { rowid: r.rowid, id: r.id, name: r.name, appliedAt: r.applied_at };
  });
  return { rows: normalized, sequence: rows[0].sequence_value };
}

function batchSql(tables, columns) {
  const l = B17_ISOLATED_LIMITS, ctes = [], objects = [];
  tables.forEach((table, i) => {
    const cs = columns[table].map(quote), t = quote(table);
    const size = `max(0,${cs.map((c) => `coalesce(length(CAST(${c} AS BLOB)),0)`).join(",")})`;
    const values = cs.map((c) => `json_array(typeof(${c}),CASE WHEN coalesce(length(CAST(${c} AS BLOB)),0)>${l.maxCellBytes} THEN NULL WHEN typeof(${c})='blob' THEN hex(${c}) WHEN typeof(${c})='integer' THEN CAST(${c} AS TEXT) WHEN typeof(${c})='real' THEN printf('%!.17g',${c}) ELSE ${c} END)`);
    ctes.push(`r${i} AS MATERIALIZED (SELECT CAST(rowid AS TEXT) AS rid,json_array(${values.join(",")}) AS payload,${size} AS cell_bytes FROM ${t} ORDER BY rowid LIMIT ${l.maxTableRows + 1})`);
    ctes.push(`s${i} AS MATERIALIZED (SELECT (SELECT count(*) FROM ${t}) AS n,coalesce(sum(length(CAST(payload AS BLOB))),0) AS b,coalesce(max(cell_bytes),0) AS c FROM r${i})`);
    objects.push(`json((SELECT json_object('table_name','${table}','row_count',s.n,'payload_bytes',s.b,'max_cell_bytes',s.c,'rows',json(CASE WHEN s.n<=${l.maxTableRows} AND s.c<=${l.maxCellBytes} AND budget.n<=${l.maxBatchRows} AND budget.b<=${l.maxBatchBytes} THEN (SELECT json_group_array(json_object('row_id',rid,'values_json',payload)) FROM r${i}) ELSE '[]' END)) FROM s${i} s CROSS JOIN budget))`);
  });
  ctes.push(`budget AS MATERIALIZED (SELECT ${tables.map((_, i) => `(SELECT n FROM s${i})`).join("+")} AS n,${tables.map((_, i) => `(SELECT b FROM s${i})`).join("+")} AS b)`);
  return `WITH ${ctes.join(",")} SELECT json_extract(t.value,'$.table_name') AS table_name,json_extract(t.value,'$.row_count') AS row_count,json_extract(t.value,'$.payload_bytes') AS payload_bytes,json_extract(t.value,'$.max_cell_bytes') AS max_cell_bytes,json_extract(r.value,'$.row_id') AS row_id,json_extract(r.value,'$.values_json') AS values_json FROM json_each(json_array(${objects.join(",")})) t LEFT JOIN json_each(json_extract(t.value,'$.rows')) r ON 1`;
}
function batches(columns) {
  const result = []; let tables = [];
  for (const table of Object.keys(columns).sort()) {
    if (tables.length && (tables.length >= B17_ISOLATED_LIMITS.maxTablesPerQuery || bytes(batchSql([...tables, table], columns)) > B17_ISOLATED_LIMITS.maxSqlBytes)) {
      result.push({ tables, sql: batchSql(tables, columns) }); tables = [];
    }
    tables.push(table);
    if (bytes(batchSql(tables, columns)) > B17_ISOLATED_LIMITS.maxSqlBytes) fail("SQL_LIMIT");
  }
  if (tables.length) result.push({ tables, sql: batchSql(tables, columns) });
  return result;
}
function typed(values, n) {
  if (!Array.isArray(values) || values.length !== n) fail("COLUMNS");
  for (const v of values) {
    if (!Array.isArray(v) || v.length !== 2) fail("VALUE");
    const [type, value] = v;
    if (type === "integer") integer(value);
    else if (type === "null") { if (value !== null) fail("VALUE"); }
    else if (type === "text") { if (typeof value !== "string" || bytes(value) > B17_ISOLATED_LIMITS.maxCellBytes) fail("VALUE"); }
    else if (type === "blob") { if (typeof value !== "string" || !/^(?:[0-9A-F]{2})*$/.test(value) || value.length / 2 > B17_ISOLATED_LIMITS.maxCellBytes) fail("VALUE"); }
    else if (type === "real") { if (typeof value !== "string" || !/^-?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(value) || !Number.isFinite(Number(value))) fail("VALUE"); }
    else fail("VALUE");
  }
  return values;
}
function collect(rows, tables, columns) {
  const l = B17_ISOLATED_LIMITS;
  if (!Array.isArray(rows) || rows.length > l.maxBatchRows + tables.length || bytes(JSON.stringify(rows)) > l.maxResponseBytes) fail("RESPONSE_LIMIT");
  const grouped = Object.fromEntries(tables.map((t) => [t, []]));
  for (const r of rows) {
    if (!exact(r, ["table_name", "row_count", "payload_bytes", "max_cell_bytes", "row_id", "values_json"]) || !Object.hasOwn(grouped, r.table_name)) fail("RESULT");
    grouped[r.table_name].push(r);
  }
  let rowCount = 0, byteCount = 0;
  for (const table of tables) {
    const first = grouped[table][0]; if (!first) fail("OMISSION");
    const n = count(first.row_count), b = count(first.payload_bytes), c = count(first.max_cell_bytes);
    if (n > l.maxTableRows || c > l.maxCellBytes) fail("LIMIT"); rowCount += n; byteCount += b;
  }
  if (rowCount > l.maxBatchRows || byteCount > l.maxBatchBytes) fail("LIMIT");
  const result = {};
  for (const table of tables) {
    const source = grouped[table], first = source[0], values = [], seen = new Set(); let actualBytes = 0;
    for (const r of source) {
      if (r.row_count !== first.row_count || r.payload_bytes !== first.payload_bytes || r.max_cell_bytes !== first.max_cell_bytes) fail("COUNT");
      if (first.row_count === 0) { if (source.length !== 1 || r.row_id !== null || r.values_json !== null || first.payload_bytes !== 0 || first.max_cell_bytes !== 0) fail("EMPTY"); continue; }
      integer(r.row_id); if (seen.has(r.row_id) || typeof r.values_json !== "string") fail("ROW"); seen.add(r.row_id);
      actualBytes += bytes(r.values_json);
      let parsed; try { parsed = JSON.parse(r.values_json); } catch { fail("JSON"); }
      values.push({ rowid: r.row_id, values: typed(parsed, columns[table].length) });
    }
    if (values.length !== first.row_count || actualBytes !== first.payload_bytes) fail("TRUNCATED");
    values.sort((a, b) => BigInt(a.rowid) < BigInt(b.rowid) ? -1 : 1);
    result[table] = values;
  }
  return { tables: result, rowCount, byteCount };
}

/** Read-only binding verification. Binding identities and manifest signatures
 * must be authenticated by the coordinator; this function does not infer them
 * from caller booleans. Raw rows remain batch-local and are never returned. */
export async function verifyB17IsolatedD1({ source, candidate } = {}) {
  if (!source?.prepare || !candidate?.prepare || source === candidate) fail("BINDINGS");
  let sqlStatements = 0;
  const query = async (db, sql) => {
    sqlStatements++;
    let r; try { r = await db.prepare(sql).all(); } catch { fail("READ_FAILED"); }
    if (r?.success !== true || !Array.isArray(r.results)) fail("READ_FAILED"); return r.results;
  };
  const sourceCatalog = await query(source, getB17BaselineCatalogQuery());
  const candidateCatalog = await query(candidate, getB17BaselineCatalogQuery());
  const { columns, freeze } = frozenSource(sourceCatalog); baseline(candidateCatalog);
  const sourceLedger = ledger(await query(source, ledgerSql())), candidateLedger = ledger(await query(candidate, ledgerSql()));
  if (canonical(sourceLedger) !== canonical(candidateLedger)) fail("LEDGER_MISMATCH");
  const ledgerSha256 = hash(canonical(sourceLedger)), tables = [], mismatches = [];
  let mismatchCount = 0, rowCount = 0, totalSourceRows = 0, totalCandidateRows = 0, totalSourceBytes = 0, totalCandidateBytes = 0;
  const record = (table, rowid, column) => { mismatchCount++; if (mismatches.length < 100) mismatches.push({ table, rowid, column }); };
  const plan = batches(columns);
  for (const batch of plan) {
    const a = collect(await query(source, batch.sql), batch.tables, columns);
    const b = collect(await query(candidate, batch.sql), batch.tables, columns);
    totalSourceRows += a.rowCount; totalCandidateRows += b.rowCount; totalSourceBytes += a.byteCount; totalCandidateBytes += b.byteCount;
    if (Math.max(totalSourceRows, totalCandidateRows) > B17_ISOLATED_LIMITS.maxTotalRows || Math.max(totalSourceBytes, totalCandidateBytes) > B17_ISOLATED_LIMITS.maxTotalBytes) fail("LIMIT");
    for (const table of batch.tables) {
      const before = a.tables[table], after = b.tables[table], target = new Map(after.map((r) => [r.rowid, r])); rowCount += before.length;
      for (const row of before) {
        const other = target.get(row.rowid); target.delete(row.rowid);
        if (!other) record(table, row.rowid, "rowid");
        else row.values.forEach((v, i) => { if (canonical(v) !== canonical(other.values[i])) record(table, row.rowid, columns[table][i]); });
      }
      for (const rowid of target.keys()) record(table, rowid, "rowid");
      tables.push({ table, sourceRows: before.length, candidateRows: after.length, sourceSha256: hash(canonical(before)), candidateSha256: hash(canonical(after)) });
    }
  }
  for (const db of [source, candidate]) if ((await query(db, "SELECT 1 AS invalid FROM pragma_foreign_key_check LIMIT 1")).length) fail("FOREIGN_KEYS");
  const finalSource = await query(source, getB17BaselineCatalogQuery()), finalCandidate = await query(candidate, getB17BaselineCatalogQuery());
  frozenSource(finalSource); baseline(finalCandidate);
  if (catalogDigest(finalSource) !== catalogDigest(sourceCatalog) || catalogDigest(finalCandidate) !== catalogDigest(candidateCatalog)) fail("SCHEMA_CHANGED");
  if (canonical(ledger(await query(source, ledgerSql()))) !== canonical(sourceLedger) || canonical(ledger(await query(candidate, ledgerSql()))) !== canonical(candidateLedger)) fail("LEDGER_CHANGED");
  const digest = (side) => hash(canonical({ schemaSha256: SCHEMA, ledgerSha256, tables: tables.map((t) => ({ table: t.table, rows: t[`${side}Rows`], sha256: t[`${side}Sha256`] })) }));
  const sourceSnapshotSha256 = digest("source"), candidateSnapshotSha256 = digest("candidate");
  return { ok: mismatchCount === 0, tableCount: tables.length, rowCount, mismatchCount, mismatches, mismatchLocationsTruncated: mismatchCount > mismatches.length, snapshotSha256: sourceSnapshotSha256,
    candidateSnapshotSha256, schemaSha256: SCHEMA, ledgerSha256, migrationNamesSha256: hash(canonical(MIGRATIONS)), freezeSha256: freeze.sha256, freezeTriggerCount: freeze.statementCount,
    sourceTypedPayloadBytes: totalSourceBytes, candidateTypedPayloadBytes: totalCandidateBytes,
    tables, limits: B17_ISOLATED_LIMITS, cost: { sqlStatements, captureStatementsPerDatabase: plan.length, freezeDdlStatements: freeze.statementCount },
    bindingIdentityVerification: "EXTERNAL_COORDINATOR_REQUIRED", signatureVerification: "EXTERNAL_COORDINATOR_REQUIRED" };
}
