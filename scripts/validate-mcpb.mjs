#!/usr/bin/env node

/**
 * Validate Claude Desktop MCPB manifests with the official @anthropic-ai/mcpb CLI.
 */

import { readdirSync, existsSync, statSync } from "fs";
import { resolve, dirname, relative, join } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const extensionsRoot = resolve(root, "claude-extensions");

if (!existsSync(extensionsRoot) || !statSync(extensionsRoot).isDirectory()) {
  console.error(`ERROR: claude-extensions directory not found at ${relative(root, extensionsRoot)}`);
  process.exit(1);
}

const extensions = readdirSync(extensionsRoot, { withFileTypes: true }).filter(
  (entry) => entry.isDirectory()
);

if (extensions.length === 0) {
  console.error("ERROR: no Claude Desktop extensions found under claude-extensions/");
  process.exit(1);
}

let failed = false;

for (const entry of extensions) {
  const manifestPath = join(extensionsRoot, entry.name, "manifest.json");
  const label = `claude-extensions/${entry.name}`;

  if (!existsSync(manifestPath)) {
    console.error(`ERROR: ${label}: missing manifest.json`);
    failed = true;
    continue;
  }

  const result = spawnSync(
    "bunx",
    ["@anthropic-ai/mcpb", "validate", manifestPath],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  if (result.status !== 0) {
    failed = true;
    console.error(`ERROR: ${label}: mcpb validate failed`);
    if (result.stdout) console.error(result.stdout.trimEnd());
    if (result.stderr) console.error(result.stderr.trimEnd());
    continue;
  }

  console.log(`${label}: MCPB manifest valid.`);
}

if (failed) {
  console.error("\nMCPB validation failed.");
  process.exit(1);
}

console.log("MCPB validation passed.");
