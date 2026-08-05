#!/usr/bin/env node

/**
 * Ensure the committed paper.mcpb matches a fresh deterministic pack.
 * Relies on pack.ts producing bit-identical zips (fixed mtimes + TZ=UTC).
 */

import { existsSync } from "fs";
import { resolve, dirname, relative } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const artifact = resolve(
  root,
  "claude-extensions/paper-desktop/dist/paper.mcpb"
);
const label = relative(root, artifact);

if (!existsSync(artifact)) {
  console.error(`ERROR: missing committed MCPB artifact: ${label}`);
  console.error("Run: bun run pack:mcpb && git add -f " + label);
  process.exit(1);
}

const diff = spawnSync(
  "git",
  ["diff", "--exit-code", "--", label],
  { cwd: root, encoding: "utf8" }
);

if (diff.status === 0) {
  console.log(`${label}: matches deterministic pack.`);
  process.exit(0);
}

if (diff.status !== 1) {
  console.error(`ERROR: git diff failed for ${label}`);
  if (diff.stderr) console.error(diff.stderr.trimEnd());
  process.exit(diff.status ?? 1);
}

console.error(`ERROR: ${label} is out of date (or not packed deterministically).`);
console.error("Run: bun run pack:mcpb && git add -f " + label);
if (diff.stdout) console.error(diff.stdout.trimEnd());
process.exit(1);
