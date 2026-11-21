import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { B17_MIGRATIONS } from "../../scripts/b17-rollout-evidence.mjs";

export async function withB17SourceFixture(run: (root: string) => Promise<void>) {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const baseline = execFileSync("git", ["ls-tree", "--name-only", `${head}:drizzle`], { encoding: "utf8" })
    .split("\n")
    .filter((name) => /^\d{4}.*\.sql$/.test(name) && name < "0050");
  const root = await mkdtemp(join(tmpdir(), "b17-source-"));
  try {
    const directory = join(root, "drizzle");
    await mkdir(directory);
    for (const name of [...baseline, ...B17_MIGRATIONS]) {
      const contents = execFileSync("git", ["show", `${head}:drizzle/${name}`]);
      await writeFile(join(directory, name), contents);
    }

    // Rollout evidence binds the files to HEAD. Commit only the historical
    // layout in this temporary repository so future app migrations remain independent.
    const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
    git("init", "--initial-branch=main");
    git("add", "drizzle");
    git("-c", "user.name=B17 fixture", "-c", "user.email=b17@example.test", "commit", "-m", "B17 source fixture");
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
