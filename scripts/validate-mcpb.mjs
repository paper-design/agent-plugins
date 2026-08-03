#!/usr/bin/env node

/**
 * Validate Claude Desktop MCPB manifests with the official @anthropic-ai/mcpb CLI.
 * Injects README.md as long_description into a temp manifest (source file unchanged).
 */

import {
  readdirSync,
  existsSync,
  statSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from "fs";
import { resolve, dirname, relative, join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { buildMcpbManifest } from "./mcpb-manifest.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const extensionsRoot = resolve(root, "claude-extensions");

if (!existsSync(extensionsRoot) || !statSync(extensionsRoot).isDirectory()) {
  console.error(
    `ERROR: claude-extensions directory not found at ${relative(root, extensionsRoot)}`
  );
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
  const extensionDir = join(extensionsRoot, entry.name);
  const label = `claude-extensions/${entry.name}`;
  let tempDir;

  try {
    const { manifest, readmeLabel } = buildMcpbManifest(extensionDir, { root });
    tempDir = mkdtempSync(join(tmpdir(), "mcpb-validate-"));
    const tempManifest = join(tempDir, "manifest.json");
    writeFileSync(tempManifest, `${JSON.stringify(manifest, null, 2)}\n`);

    const result = spawnSync(
      "bunx",
      ["@anthropic-ai/mcpb", "validate", tempManifest],
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

    console.log(`${label}: MCPB manifest valid (long_description from ${readmeLabel}).`);
  } catch (err) {
    failed = true;
    console.error(`ERROR: ${label}: ${err.message}`);
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}

if (failed) {
  console.error("\nMCPB validation failed.");
  process.exit(1);
}

console.log("MCPB validation passed.");
