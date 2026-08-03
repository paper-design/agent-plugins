/**
 * Build the effective MCPB manifest for an extension directory:
 * source manifest.json + README.md as long_description.
 */

import { existsSync, readFileSync, realpathSync } from "fs";
import { join, relative } from "path";

export function buildMcpbManifest(extensionDir, { root } = {}) {
  const manifestPath = join(extensionDir, "manifest.json");
  const readmePath = join(extensionDir, "README.md");

  if (!existsSync(manifestPath)) {
    throw new Error(`missing manifest.json`);
  }
  if (!existsSync(readmePath)) {
    throw new Error(`missing README.md`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const readme = readFileSync(readmePath, "utf-8").replace(/\r\n/g, "\n").trimEnd();

  const built = {
    ...manifest,
    long_description: readme,
  };

  // Prefer a stable field order for the packed artifact.
  const ordered = {
    ...(built.$schema !== undefined ? { $schema: built.$schema } : {}),
    manifest_version: built.manifest_version,
    name: built.name,
    ...(built.display_name !== undefined ? { display_name: built.display_name } : {}),
    version: built.version,
    description: built.description,
    long_description: built.long_description,
    ...(built.documentation !== undefined ? { documentation: built.documentation } : {}),
    author: built.author,
    server: built.server,
    ...(built.compatibility !== undefined ? { compatibility: built.compatibility } : {}),
    ...(built.tools_generated !== undefined
      ? { tools_generated: built.tools_generated }
      : {}),
  };

  for (const [key, value] of Object.entries(built)) {
    if (!(key in ordered)) ordered[key] = value;
  }

  let readmeLabel = readmePath;
  if (root) {
    try {
      readmeLabel = relative(root, realpathSync(readmePath));
    } catch {
      readmeLabel = relative(root, readmePath);
    }
  }

  return { manifest: ordered, readmeLabel };
}
