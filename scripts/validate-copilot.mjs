#!/usr/bin/env node

/**
 * Copilot plugin validator.
 * - marketplace.json: GitHub Copilot marketplace layout
 * - plugin.json: Open Plugin Spec fields (+ Copilot `mcpServers` path)
 * - mcp.json: Open Plugin Spec MCP schema
 */

import { readFileSync, existsSync, statSync } from "fs";
import { resolve, dirname, relative } from "path";
import { fileURLToPath } from "url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadJSON(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function loadJSONSafe(path, label, fail) {
  if (!existsSync(path)) {
    fail(`${label}: file not found at ${relative(root, path)}`);
    return null;
  }
  try {
    return loadJSON(path);
  } catch (err) {
    fail(`${label}: invalid JSON — ${err.message}`);
    return null;
  }
}

const pluginSchema = loadJSON(
  resolve(root, "schemas/agent-plugins/plugin.schema.json")
);
const mcpSchema = loadJSON(resolve(root, "schemas/agent-plugins/mcp.schema.json"));

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const validatePlugin = ajv.compile(pluginSchema);
const validateMcp = ajv.compile(mcpSchema);

let errors = 0;

function fail(message) {
  console.error(`ERROR: ${message}`);
  errors++;
}

function reportSchemaErrors(label, validate) {
  fail(`${label}: schema validation failed:`);
  for (const err of validate.errors ?? []) {
    const detail =
      err.keyword === "additionalProperties"
        ? `${err.message}: "${err.params.additionalProperty}"`
        : err.message;
    console.error(`  ${err.instancePath || "/"}: ${detail}`);
  }
}

function isValidRelativePath(path) {
  if (typeof path !== "string" || path.length === 0) return false;
  const stripped = path.startsWith("./") ? path.slice(2) : null;
  if (stripped === null || stripped.length === 0) return false;
  const segments = stripped.replace(/\/+$/, "").split("/");
  return segments.every((s) => s.length > 0 && s !== ".." && s !== ".");
}

// 1. Marketplace (GitHub Copilot layout; structural checks)
const marketplacePath = resolve(root, ".github/plugin/marketplace.json");
const marketplace = loadJSONSafe(marketplacePath, "Marketplace", fail);

if (!marketplace) {
  process.exit(1);
}

if (typeof marketplace.name !== "string" || marketplace.name.length === 0) {
  fail("Marketplace: missing or empty `name`");
}

if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length === 0) {
  fail("Marketplace: `plugins` must be a non-empty array");
}

for (const [index, entry] of (marketplace.plugins ?? []).entries()) {
  const label = `Marketplace plugins[${index}]`;

  if (typeof entry?.name !== "string" || entry.name.length === 0) {
    fail(`${label}: missing or empty \`name\``);
    continue;
  }

  const pluginLabel = `Marketplace plugin "${entry.name}"`;

  if (!isValidRelativePath(entry.source)) {
    fail(
      `${pluginLabel}: \`source\` must be a relative path starting with "./" — got "${entry.source}"`
    );
    continue;
  }

  const pluginDir = resolve(root, entry.source.slice(2));
  if (!existsSync(pluginDir) || !statSync(pluginDir).isDirectory()) {
    fail(`${pluginLabel}: source directory does not exist — ${entry.source}`);
    continue;
  }

  // 2. plugin.json — OPS core fields; Copilot allows mcpServers on top
  const pluginJsonPath = resolve(pluginDir, "plugin.json");
  const pluginJson = loadJSONSafe(
    pluginJsonPath,
    `${pluginLabel} plugin.json`,
    fail
  );
  if (!pluginJson) continue;

  const { mcpServers, ...opsPluginJson } = pluginJson;
  if (!validatePlugin(opsPluginJson)) {
    reportSchemaErrors(
      `${pluginLabel} (${relative(root, pluginJsonPath)})`,
      validatePlugin
    );
  }

  if (pluginJson.name && pluginJson.name !== entry.name) {
    fail(
      `${pluginLabel}: marketplace name does not match plugin.json name "${pluginJson.name}"`
    );
  }

  // 3. MCP via Copilot mcpServers path (or inline object)
  if (mcpServers === undefined) {
    fail(
      `${pluginLabel}: missing \`mcpServers\` (path to mcp.json or inline servers)`
    );
    continue;
  }

  let mcpJson = null;
  let mcpLabel = `${pluginLabel} mcpServers`;

  if (typeof mcpServers === "string") {
    if (!isValidRelativePath(mcpServers)) {
      fail(
        `${pluginLabel}: \`mcpServers\` path must start with "./" — got "${mcpServers}"`
      );
      continue;
    }
    const mcpPath = resolve(pluginDir, mcpServers.slice(2));
    mcpLabel = `${pluginLabel} (${relative(root, mcpPath)})`;
    mcpJson = loadJSONSafe(mcpPath, mcpLabel, fail);
  } else if (mcpServers && typeof mcpServers === "object") {
    mcpJson = { mcpServers };
    // Inline Copilot shape lacks OPS $schema; wrap only the servers object
    // Validate by synthesizing a minimal OPS document when possible.
    if (!("$schema" in mcpServers) && !("mcpServers" in mcpServers)) {
      mcpJson = {
        $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
        mcpServers,
      };
    } else {
      mcpJson = mcpServers;
    }
  } else {
    fail(`${pluginLabel}: \`mcpServers\` must be a path string or object`);
    continue;
  }

  if (!mcpJson) continue;

  if (!validateMcp(mcpJson)) {
    reportSchemaErrors(mcpLabel, validateMcp);
  }
}

if (errors > 0) {
  console.error(`\nCopilot validation failed with ${errors} error(s).`);
  process.exit(1);
}

console.log("Copilot validation passed.");
process.exit(0);
