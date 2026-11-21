import { createHash } from "node:crypto";
import { z } from "zod";

const FORMAT = "retaste-place-intake-v1";
const MAX_BYTES = 1_500_000;
const MAX_ROWS = 1000;
const CHUNK_ROWS = 40;
const JEOLLA = new Set(["GWANGJU", "JEONNAM", "JEONBUK"]);
const GWANGJU_DISTRICTS = new Set(["동구", "서구", "남구", "북구", "광산구"]);
const clean = max => z.string().normalize().trim().min(1).max(max)
  .refine(value => !/[\p{Cc}\p{Cf}]/u.test(value));

const rowSchema = z.strictObject({
  position: z.number().int().min(1).max(MAX_ROWS),
  name: clean(160),
  address: clean(300).nullable(),
  neighborhood: clean(120).nullable(),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  categoryLabel: clean(120).nullable(),
  categorySlug: z.string().max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).nullable(),
  kind: z.enum(["DINING", "CAFE", "BAR", "OTHER", "ADDRESS", "UNKNOWN"]),
  source: z.enum(["SHARED_MAP", "USER_SUPPLIED"]),
  selection: z.enum(["CANDIDATE", "REVIEW", "HIDDEN"]),
  reason: clean(250).nullable(),
  note: clean(500).nullable(),
  photo: z.enum(["NOT_SUPPLIED", "UNVERIFIED"]),
});

const intakeSchema = z.strictObject({
  format: z.literal(FORMAT),
  label: clean(100),
  rows: z.array(rowSchema).min(1).max(MAX_ROWS),
});

export function placeIntakeRegion(address) {
  const [prefix, district] = (address ?? "").trim().split(/\s+/u);
  if (!prefix) return "UNKNOWN";
  if (["전남광주", "전남광주통합특별시"].includes(prefix)) {
    if (GWANGJU_DISTRICTS.has(district)) return "GWANGJU";
    return /^[가-힣]+(?:시|군)$/u.test(district ?? "") ? "JEONNAM" : "UNKNOWN";
  }
  if (prefix === "광주광역시" || prefix === "광주" && GWANGJU_DISTRICTS.has(district)) return "GWANGJU";
  if (["전라남도", "전남"].includes(prefix)) return "JEONNAM";
  if (["전북특별자치도", "전라북도", "전북"].includes(prefix)) return "JEONBUK";
  return /^(?:서울|경기|부산|대구|인천|대전|울산|세종|충(?:청)?[남북]|경(?:상)?[남북]|강원|제주)/u.test(prefix)
    ? "OUTSIDE" : "UNKNOWN";
}

function safeSelection(row, regionCode) {
  if (regionCode === "OUTSIDE") return ["HIDDEN", "OUTSIDE_JEOLLA"];
  if (row.selection === "HIDDEN") return ["HIDDEN", row.reason];
  if (row.kind === "BAR" || regionCode === "UNKNOWN") return ["REVIEW", row.reason ?? "REVIEW_REQUIRED"];
  if (row.kind !== "DINING" && row.kind !== "CAFE") return ["HIDDEN", "NON_DINING"];
  if (row.selection === "REVIEW") return ["REVIEW", row.reason];
  if (!row.address || !row.neighborhood || !row.categorySlug
      || row.latitude === null || row.latitude < 33 || row.latitude > 37
      || row.longitude === null || row.longitude < 124 || row.longitude > 129) return ["REVIEW", "LOCATION_OR_CATEGORY_UNCONFIRMED"];
  return ["CANDIDATE", row.reason];
}

function placeIntakeIdentity({ name, address }) {
  return JSON.stringify([name, address].map(value => (value ?? "").normalize("NFKC").toLowerCase().replace(/\s+/gu, "")));
}

export function parsePlaceIntake(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_BYTES) throw Error("PLACE_INTAKE_LIMIT");
  let input;
  try {
    input = intakeSchema.parse(JSON.parse(text));
  } catch {
    throw Error("PLACE_INTAKE_INVALID");
  }
  const preliminaryRows = input.rows.map((row, index) => {
    if (row.position !== index + 1 || (row.latitude === null) !== (row.longitude === null)
        || row.source === "SHARED_MAP" && (row.note !== null || row.photo !== "NOT_SUPPLIED")) {
      throw Error("PLACE_INTAKE_ROW_INVALID");
    }
    const regionCode = placeIntakeRegion(row.address);
    const [selection, reason] = safeSelection(row, regionCode);
    return { ...row, regionCode, selection, reason };
  });
  const candidateKeys = new Map();
  for (const row of preliminaryRows) {
    if (row.selection !== "CANDIDATE") continue;
    const key = placeIntakeIdentity(row);
    candidateKeys.set(key, (candidateKeys.get(key) ?? 0) + 1);
  }
  const rows = preliminaryRows.map(row => row.selection === "CANDIDATE" && candidateKeys.get(placeIntakeIdentity(row)) > 1
    ? { ...row, selection: "REVIEW", reason: "INTAKE_DUPLICATE_REVIEW" } : row);
  const payload = { ...input, rows };
  const id = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const counts = { candidate: 0, review: 0, hidden: 0 };
  for (const row of rows) counts[row.selection.toLowerCase()]++;
  return { ...payload, id, counts };
}

const ROW_FIELDS = [
  ["position", "position"], ["name", "name"], ["address", "address"], ["neighborhood", "neighborhood"],
  ["latitude", "latitude"], ["longitude", "longitude"], ["category_label", "categoryLabel"],
  ["category_slug", "categorySlug"], ["kind", "kind"], ["source", "source"], ["region_code", "regionCode"],
  ["selection", "selection"], ["reason", "reason"], ["note", "note"], ["photo", "photo"],
];
const jsonValue = field => `json_extract(value,'$.${field}')`;
const WRITE_ROWS = `INSERT INTO place_intake_entries
  (batch_id,${ROW_FIELDS.map(([column]) => column).join(",")})
  SELECT ?,${ROW_FIELDS.map(([, field]) => jsonValue(field)).join(",")} FROM json_each(?)`;
const VERIFY_ROWS = `SELECT count(*) AS matches FROM json_each(?) j
  JOIN place_intake_entries e ON e.batch_id=?
  AND ${ROW_FIELDS.map(([column, field]) => `e.${column} IS ${jsonValue(field)}`).join(" AND ")}`;

function encodedChunks(rows) {
  const chunks = [];
  for (let offset = 0; offset < rows.length; offset += CHUNK_ROWS) {
    const part = rows.slice(offset, offset + CHUNK_ROWS);
    chunks.push({ json: JSON.stringify(part), length: part.length });
  }
  return chunks;
}

async function existing(db, batch, chunks) {
  const stored = await db.prepare(`SELECT label,expected_count,state,
    (SELECT count(*) FROM place_intake_entries WHERE batch_id=?) AS actual_count
    FROM place_intake_batches WHERE id=?`).bind(batch.id, batch.id).first();
  if (!stored) return false;
  if (stored.state !== "READY" || stored.expected_count !== batch.rows.length || stored.actual_count !== batch.rows.length) {
    throw Error("PLACE_INTAKE_INCOMPLETE");
  }
  const checks = await db.batch(chunks.map(({ json }) => db.prepare(VERIFY_ROWS).bind(json, batch.id)));
  if (stored.label !== batch.label || checks.length !== chunks.length || checks.some((check, index) =>
    !check.success || check.results[0]?.matches !== chunks[index].length)) throw Error("PLACE_INTAKE_CONTENT_MISMATCH");
  return true;
}

// Binding-only operator tool. It writes the private intake tables exclusively.
export async function stagePrivatePlaceIntake(db, text) {
  const batch = parsePlaceIntake(text);
  const chunks = encodedChunks(batch.rows);
  const result = { batchId: batch.id, total: batch.rows.length, ...batch.counts };
  if (await existing(db, batch, chunks)) return { ...result, state: "EXISTING" };

  const categorySlugs = [...new Set(batch.rows.filter(row => row.selection === "CANDIDATE")
    .map(row => row.categorySlug))];
  const categories = await db.prepare(`SELECT c.slug FROM categories c WHERE c.is_active=1
    AND NOT EXISTS (SELECT 1 FROM categories child WHERE child.parent_id=c.id AND child.is_active=1)
    AND c.slug IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(categorySlugs)).all();
  if (!categories.success || categories.results.length !== categorySlugs.length) throw Error("PLACE_INTAKE_CATEGORY_UNKNOWN");

  const statements = [
    db.prepare("INSERT INTO place_intake_batches(id,label,expected_count,state,created_at) VALUES(?,?,?,'STAGING',?)")
      .bind(batch.id, batch.label, batch.rows.length, new Date().toISOString()),
  ];
  for (const { json } of chunks) statements.push(db.prepare(WRITE_ROWS).bind(batch.id, json));
  statements.push(db.prepare("UPDATE place_intake_batches SET state='READY' WHERE id=?").bind(batch.id));
  try {
    const results = await db.batch(statements);
    if (results.length !== statements.length || results.some(row => !row.success)) throw Error("PLACE_INTAKE_WRITE_FAILED");
  } catch {
    if (!(await existing(db, batch, chunks))) throw Error("PLACE_INTAKE_WRITE_UNCONFIRMED");
    return { ...result, state: "EXISTING" };
  }
  if (!(await existing(db, batch, chunks))) throw Error("PLACE_INTAKE_WRITE_UNCONFIRMED");
  return { ...result, state: "STAGED_PRIVATE" };
}

export function planPrivatePlaceDrafts(text) {
  const batch = parsePlaceIntake(text);
  return batch.rows.filter(row => row.selection === "CANDIDATE" && JEOLLA.has(row.regionCode))
    .map(row => ({
      name: row.name,
      slug: `place-intake-${createHash("sha256").update(placeIntakeIdentity(row)).digest("hex").slice(0, 24)}`,
      address: row.address,
      neighborhood: row.neighborhood,
      latitude: row.latitude,
      longitude: row.longitude,
      primary_category: row.categorySlug,
      status: "DRAFT",
    }));
}
