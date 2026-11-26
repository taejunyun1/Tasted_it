import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword } from "../app/features/auth/password.server.ts";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const drizzle = join(projectRoot, "drizzle");
const localDatabaseId = "00000000-0000-4000-8000-000000000511";
const pilotDurationMs = 24 * 60 * 60 * 1000;
const omitted = new Set(["0053", "0054", "0055", "0056", "0059", "0060"]);
const baselineDigest = "30244af4d12da57ac28b02710347d85f26f7bb08cbb391c409fc292e2ac361c7";
const exactMigrations = {
  "0055_admin_privacy_operations.sql": "d34c91135a5e778c0e5ea1d8c462615edb75420d6c40720e8abc512b8e67ace1",
  "0063_place_poi_media.sql": "946e06e9974eb3f5e8652b0b8601595d2108333942e3e416c59036e8cd98fe4d",
  "0064_place_poi_media_identity_guard.sql": "6f19cb90902699d2e3f2d8797c2d153cbcebf4f9df7808835424a2b268164211",
};
const cleanupAnchors = [
  ...["revision", "status", "lease_id", "lease_expires_at", "last_error"]
    .map((column) => `ALTER TABLE reviewer_photo_cleanup_jobs ADD COLUMN ${column} `),
  "CREATE INDEX reviewer_photo_cleanup_status_idx ON reviewer_photo_cleanup_jobs(",
  "CREATE TABLE reviewer_photo_cleanup_guards (",
];

const digest = (value) => createHash("sha256").update(value).digest("hex");
const password = () => randomBytes(24).toString("base64url");
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
const writePrivate = (file, body) => writeFile(file, body, { flag: "wx", mode: 0o600 });
const writePrivateJson = (file, data) => writePrivate(file, JSON.stringify(data, null, 2) + "\n");

async function migrationFiles() {
  const names = (await readdir(drizzle)).filter((name) =>
    /^\d{4}_.+\.sql$/u.test(name) && name.slice(0, 4) <= "0062" && !omitted.has(name.slice(0, 4))
  ).sort();
  const baseline = await Promise.all(names.map(async (name) => [name, await readFile(join(drizzle, name))]));
  if (baseline.length !== 56 ||
    digest(baseline.map(([name, bytes]) => `${digest(bytes)}  ${name}\n`).join("")) !== baselineDigest) {
    throw new Error("Pilot baseline differs from the verified 56-file corpus");
  }
  const [privacy, ...poi] = await Promise.all(Object.entries(exactMigrations).map(async ([name, sha256]) => {
    const bytes = await readFile(join(drizzle, name));
    if (digest(bytes) !== sha256) throw new Error(`Unexpected migration bytes for ${name}`);
    return [name, bytes];
  }));
  const lines = privacy[1].toString("utf8").split("\n").map((line) => line.trim());
  const cleanup = cleanupAnchors.map((anchor) => {
    const matches = lines.filter((line) => line.startsWith(anchor) && line.endsWith(";"));
    if (matches.length !== 1) throw new Error("Pilot photo cleanup statement is missing or ambiguous");
    return matches[0];
  });
  return [...baseline, ...poi, ["0065_pilot_reviewer_photo_cleanup.sql", cleanup.join("\n") + "\n"]];
}

async function candidateDatabaseId(value) {
  const id = value.toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id) ||
    id.startsWith("00000000-0000-")) {
    throw new Error("Invalid candidate D1 UUID");
  }
  const config = await readFile(join(projectRoot, "wrangler.jsonc"), "utf8");
  const protectedIds = Array.from(config.matchAll(/"database_id"\s*:\s*"([0-9a-f-]{36})"/giu), ([, uuid]) => uuid.toLowerCase());
  if (protectedIds.length === 0) throw new Error("Cannot verify the protected D1 IDs");
  if (protectedIds.includes(id)) throw new Error("The candidate D1 must be separate from the primary Worker");
  return id;
}

function pilotConfig(databaseId, vars) {
  return {
    name: "retaste-student-pilot",
    main: join(projectRoot, "workers/student-pilot.ts"),
    compatibility_date: "2026-08-05",
    compatibility_flags: ["nodejs_compat", "global_fetch_strictly_public"],
    send_metrics: false,
    workers_dev: false,
    preview_urls: false,
    assets: { binding: "ASSETS", run_worker_first: true },
    vars: {
      CST_STUDENT_PILOT: "true",
      STUDENT_WORKSPACE_ENABLED: "true",
      STUDENT_REVIEWER_PHOTO_PILOT_SEATS: "C,D",
      REVIEW_PHOTO_UPLOAD_ENABLED: "false",
      POI_MEDIA_PUBLIC_ENABLED: "true",
      ...vars,
    },
    d1_databases: [{
      binding: "DB",
      database_name: "retaste-student-pilot",
      database_id: databaseId,
      migrations_dir: "migrations",
    }],
    r2_buckets: [{ binding: "REVIEW_PHOTOS", bucket_name: "retaste-student-pilot-photos" }],
  };
}

async function localSeed(accounts, now, expiresAt) {
  const at = quote(now.toISOString());
  const expiry = quote(expiresAt);
  const rows = await Promise.all(accounts.map(async ({ account, role, label }) => {
    const { hash, salt } = await hashPassword(account.password);
    return `(${[account.id, account.email, label, role, hash, salt].map(quote).join(", ")}, ${at}, ${at}, ${at})`;
  }));
  return `INSERT INTO users (id, email, display_name, role, password_hash, password_salt, email_verified_at, created_at, updated_at)
VALUES ${rows.join(",\n")};

UPDATE student_seats
SET is_active = (code IN ('C', 'D')), expires_at = ${expiry}, updated_at = ${at};

INSERT INTO places (id, slug, name, status, address, neighborhood, latitude, longitude, search_text, created_at, updated_at)
VALUES ('sample-place-1', 'sample-dongmyeong-ramen', 'Re:Taste 샘플 라멘 동명', 'PUBLISHED',
  '광주광역시 동구 동명동', '동명동', 35.1490, 126.9232, 'retaste 샘플 라멘 동명 동명동', ${at}, ${at});

INSERT INTO place_categories (place_id, category_id, is_primary) VALUES ('sample-place-1', 'cat-ramen', 1);
`;
}

async function prepare(outputDir, cloudDatabaseId) {
  const databaseId = cloudDatabaseId ? await candidateDatabaseId(cloudDatabaseId) : localDatabaseId;
  const migrations = await migrationFiles();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + pilotDurationMs).toISOString();
  const admin = { id: "pilot-admin", email: "pilot-admin@example.test", password: password() };
  const students = ["C", "D"].map((seat) => {
    const id = `pilot-student-${seat.toLowerCase()}`;
    return { seat, id, email: `${id}@example.test`, password: password() };
  });
  const access = { username: "pilot", password: password() };
  const secrets = {
    PILOT_BROWSER_PASSWORD: access.password,
    STUDENT_INVITE_COOKIE_SECRET: randomBytes(32).toString("base64url"),
  };
  const seed = await localSeed([
    { account: admin, role: "ADMIN", label: "합성 관리자" },
    ...students.map((account) => ({ account, role: "USER", label: `합성 학생 ${account.seat}` })),
  ], now, expiresAt);
  const config = pilotConfig(databaseId, cloudDatabaseId ? { PILOT_EXPIRES_AT: expiresAt } : secrets);
  await mkdir(outputDir, { mode: 0o700 });
  await mkdir(join(outputDir, "migrations"), { mode: 0o700 });
  for (const [name, bytes] of migrations) {
    await writePrivate(join(outputDir, "migrations", name), bytes);
  }
  await writePrivate(join(outputDir, "seed.sql"), seed);
  await writePrivateJson(join(outputDir, "credentials.json"), { access, admin, students });
  await writePrivateJson(join(outputDir, "wrangler.json"), config);
  if (cloudDatabaseId) {
    await writePrivateJson(join(outputDir, "worker-secrets.json"), secrets);
    await writePrivateJson(join(outputDir, "wrangler.open.json"), { ...config, workers_dev: true });
  }
}

const [outputDir, mode, cloudDatabaseId, ...extra] = process.argv.slice(2);
if (!outputDir || outputDir.startsWith("-") || extra.length ||
  (mode !== undefined && (mode !== "--cloud" || !cloudDatabaseId))) {
  console.error("Usage: node scripts/prepare-student-pilot.mjs <new-output-dir> [--cloud <candidate-d1-uuid>]");
  process.exitCode = 1;
} else {
  try {
    await prepare(resolve(outputDir), cloudDatabaseId);
    console.log(`Prepared a private ${cloudDatabaseId ? "cloud" : "local"} student pilot bundle with 59 migrations.`);
  } catch (error) {
    console.error(`Student pilot preparation failed (${error?.code ?? error.message})`);
    process.exitCode = 1;
  }
}
