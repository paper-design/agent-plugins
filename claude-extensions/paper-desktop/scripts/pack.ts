#!/usr/bin/env bun
/**
 * Pack a config-only MCPB (zip with manifest.json at archive root).
 *
 * Injects README.md as long_description at pack time — the source
 * manifest.json is left unchanged.
 *
 * Bundles icon/screenshot paths referenced by the built manifest (resolving
 * symlinks into the archive).
 *
 * Uses a plain zip instead of `mcpb pack` because the binary entry_point is an
 * external `${HOME}/.paper/bin/paper` path installed by Paper Desktop — not a
 * file inside the bundle.
 */
import {
  cp,
  mkdir,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { $ } from "bun";
import { buildMcpbManifest } from "../../../scripts/mcpb-manifest.mjs";

/** DOS-era zip epoch — fixed so rebuilds are bit-identical across runs. */
const ZIP_EPOCH = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));

async function normalizeMtimes(dir: string) {
  await utimes(dir, ZIP_EPOCH, ZIP_EPOCH);
  for (const name of await readdir(dir)) {
    const path = join(dir, name);
    if ((await stat(path)).isDirectory()) {
      await normalizeMtimes(path);
    } else {
      await utimes(path, ZIP_EPOCH, ZIP_EPOCH);
    }
  }
}

const extensionDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(extensionDir, "../..");
const distDir = join(extensionDir, "dist");
const stageDir = join(distDir, "stage");
const outFile = join(distDir, "paper.mcpb");
const builtManifestPath = join(stageDir, "manifest.json");

const { manifest, readmeLabel } = buildMcpbManifest(extensionDir, {
  root: repoRoot,
});

const assetPaths = [
  ...(typeof manifest.icon === "string" ? [manifest.icon] : []),
  ...(Array.isArray(manifest.screenshots) ? manifest.screenshots : []),
];

await rm(distDir, { recursive: true, force: true });
await mkdir(stageDir, { recursive: true });
await writeFile(builtManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

for (const rel of assetPaths) {
  if (typeof rel !== "string" || rel.includes("..") || rel.startsWith("/")) {
    console.error(`Refusing to pack unsafe asset path: ${rel}`);
    process.exit(1);
  }
  const src = join(extensionDir, rel);
  const dest = join(stageDir, rel);
  await mkdir(dirname(dest), { recursive: true });
  await cp(src, dest);
}

await normalizeMtimes(stageDir);

// TZ=UTC so DOS timestamps in the zip are timezone-independent (CI is UTC).
const result = await $`zip -r -X ${outFile} manifest.json ${assetPaths}`
  .cwd(stageDir)
  .env({ ...process.env, TZ: "UTC" })
  .nothrow();

if (result.exitCode !== 0) {
  console.error(result.stderr.toString() || result.stdout.toString());
  process.exit(result.exitCode ?? 1);
}

// Keep a copy of the built manifest next to the .mcpb for inspection
await cp(builtManifestPath, join(distDir, "manifest.json"));
await rm(stageDir, { recursive: true, force: true });

const listing = await $`unzip -l ${outFile}`.text();
console.log(listing.trimEnd());
console.log(`\nInjected long_description from ${readmeLabel}`);
console.log(`Wrote ${outFile}`);
