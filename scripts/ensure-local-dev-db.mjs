import { spawnSync } from "node:child_process";

const skipBootstrap = process.env.RETASTE_SKIP_LOCAL_DB_BOOTSTRAP === "true";

if (skipBootstrap) {
  console.log("[retaste] skipping local DB bootstrap because RETASTE_SKIP_LOCAL_DB_BOOTSTRAP=true");
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
