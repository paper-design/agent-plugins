#!/usr/bin/env bun
/**
 * Pack a config-only MCPB (zip with manifest.json at archive root).
 *
 * Injects README.md as long_description at pack time — the source
 * manifest.json is left unchanged.
 *
 * Uses a plain zip instead of `mcpb pack` because the binary entry_point is an
 * external `${HOME}/.paper/bin/paper` path installed by Paper Desktop — not a
 * file inside the bundle.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { $ } from "bun";
import { buildMcpbManifest } from "../../../scripts/mcpb-manifest.mjs";

const extensionDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(extensionDir, "../..");
const distDir = join(extensionDir, "dist");
const outFile = join(distDir, "paper.mcpb");
const builtManifestPath = join(distDir, "manifest.json");

const { manifest, readmeLabel } = buildMcpbManifest(extensionDir, {
  root: repoRoot,
});

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await writeFile(builtManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

// -j: store manifest.json at archive root (no directory prefix)
const result = await $`zip -j -X ${outFile} ${builtManifestPath}`.nothrow();
if (result.exitCode !== 0) {
  console.error(result.stderr.toString() || result.stdout.toString());
  process.exit(result.exitCode ?? 1);
}

const listing = await $`unzip -l ${outFile}`.text();
console.log(listing.trimEnd());
console.log(`\nInjected long_description from ${readmeLabel}`);
console.log(`Wrote ${outFile}`);
