#!/usr/bin/env bun
/**
 * Packs the portable `plugins/paper` package into the ZIP uploaded to the OpenAI plugin
 * submission portal (ChatGPT + Codex directory).
 *
 * Only what the portal reads is staged: plugin.json, mcp.json, the icons plugin.json
 * references, and skills/ if the plugin has one (portable packages discover it by path).
 * The README is for people browsing the repo; the listing text comes from plugin.json.
 * Timestamps and modes are normalized so rebuilds are bit-identical, matching the .mcpb
 * pack script.
 */
import { chmod, cp, mkdir, readdir, rm, stat, utimes } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { $ } from "bun";

/** DOS-era zip epoch — fixed so rebuilds are bit-identical across runs. */
const ZIP_EPOCH = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));
const FILE_MODE = 0o644;
const DIR_MODE = 0o755;

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = join(repoRoot, "plugins/paper");
const distDir = join(repoRoot, "dist");
const stageDir = join(distDir, "stage-chatgpt");
const outFile = join(distDir, "paper-chatgpt-plugin.zip");

type Interface = Record<string, unknown>;
type Manifest = {
  name: string;
  version?: string;
  extensions?: { "com.openai"?: { interface?: Interface } };
};

const manifest = (await Bun.file(join(pluginDir, "plugin.json")).json()) as Manifest;
const iface = manifest.extensions?.["com.openai"]?.interface ?? {};

// Every icon the listing references must ship in the ZIP
const iconFields = ["logo", "logoDark", "composerIcon", "composerIconDark"];
const assetPaths = iconFields
  .map((field) => iface[field])
  .filter((value): value is string => typeof value === "string");

const files = ["plugin.json", "mcp.json", ...assetPaths];
if (existsSync(join(pluginDir, "skills"))) {
  files.push("skills");
}

async function normalizeStaging(dir: string) {
  await chmod(dir, DIR_MODE);
  await utimes(dir, ZIP_EPOCH, ZIP_EPOCH);
  for (const name of await readdir(dir)) {
    const path = join(dir, name);
    if ((await stat(path)).isDirectory()) {
      await normalizeStaging(path);
    } else {
      await chmod(path, FILE_MODE);
      await utimes(path, ZIP_EPOCH, ZIP_EPOCH);
    }
  }
}

await rm(stageDir, { recursive: true, force: true });
await rm(outFile, { force: true });
await mkdir(stageDir, { recursive: true });

for (const rel of files) {
  if (rel.includes("..") || rel.startsWith("/")) {
    console.error(`Refusing to pack unsafe path: ${rel}`);
    process.exit(1);
  }
  const src = join(pluginDir, rel);
  const dest = join(stageDir, rel);
  await mkdir(dirname(dest), { recursive: true });
  await cp(src, dest, { recursive: true });
}

await normalizeStaging(stageDir);

// TZ=UTC so DOS timestamps in the zip are timezone-independent (CI is UTC).
const result = await $`zip -r -X ${outFile} ${files}`
  .cwd(stageDir)
  .env({ ...process.env, TZ: "UTC" })
  .nothrow();

if (result.exitCode !== 0) {
  console.error(result.stderr.toString() || result.stdout.toString());
  process.exit(result.exitCode ?? 1);
}

await rm(stageDir, { recursive: true, force: true });

const listing = await $`unzip -l ${outFile}`.text();
console.log(listing.trimEnd());
console.log(`\nWrote ${outFile} (${manifest.name}@${manifest.version ?? "unversioned"})`);
