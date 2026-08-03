#!/usr/bin/env bun
/**
 * Pack a config-only MCPB (zip with manifest.json at archive root).
 *
 * Uses a plain zip instead of `mcpb pack` because the binary entry_point is an
 * external `${HOME}/.paper/bin/paper` path installed by Paper Desktop — not a
 * file inside the bundle.
 */
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";

const root = import.meta.dir;
const distDir = join(root, "../dist");
const outFile = join(distDir, "../paper.mcpb");
const manifest = join(root, "../manifest.json");

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

// -j: store manifest.json at archive root (no directory prefix)
const result = await $`zip -j -X ${outFile} ${manifest}`.nothrow();
if (result.exitCode !== 0) {
  console.error(result.stderr.toString() || result.stdout.toString());
  process.exit(result.exitCode ?? 1);
}

const listing = await $`unzip -l ${outFile}`.text();
console.log(listing.trimEnd());
console.log(`\nWrote ${outFile}`);
