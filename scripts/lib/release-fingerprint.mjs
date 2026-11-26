import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function buildFingerprint(buildRoot) {
  if (!lstatSync(buildRoot).isDirectory()) {
    throw new Error("Expected a regular build directory");
  }
  const files = [];
  for (const name of readdirSync(buildRoot, { recursive: true }).sort()) {
    const target = join(buildRoot, name);
    const stat = lstatSync(target);
    if (stat.isDirectory()) continue;
    if (!stat.isFile()) throw new Error(`Unexpected build entry: ${name}`);
    files.push([name, digest(readFileSync(target))]);
  }
  return digest(JSON.stringify(files));
}
