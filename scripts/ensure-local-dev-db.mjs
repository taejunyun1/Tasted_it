import { spawnSync } from "node:child_process";

// Playwright and synthetic-beta seed isolated persist-to DBs, then call `pnpm dev`.
// Skip those runs so they do not migrate or seed the default local D1.
const skipReason =
  process.env.RETASTE_SKIP_LOCAL_DB_BOOTSTRAP === "true"
    ? "RETASTE_SKIP_LOCAL_DB_BOOTSTRAP=true"
    : process.env.RETASTE_E2E === "true"
      ? "RETASTE_E2E=true"
      : process.env.SYNTHETIC_BETA === "1"
        ? "SYNTHETIC_BETA=1"
        : null;

if (skipReason) {
  console.log(`[retaste] skipping local DB bootstrap because ${skipReason}`);
  process.exit(0);
}

const commands = [
  ["pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local"]],
  ["pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--file", "scripts/seed-week1.sql"]],
];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    env: { ...process.env, CI: process.env.CI ?? "1" },
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
