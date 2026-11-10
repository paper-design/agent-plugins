#!/usr/bin/env node

/**
 * Validates plugins prepared for OpenAI's plugin directory against the limits the submission
 * portal enforces on listing metadata, review cases, icons and the MCP server declaration
 * (https://developers.openai.com/plugins/deploy/submission).
 *
 * Plugins are discovered from .agents/plugins/marketplace.json; only those with a review block
 * are checked. Both package layouts are read: the Codex layout (.codex-plugin/plugin.json +
 * .mcp.json), and the portable Agent Plugins layout (plugin.json + mcp.json), which is also
 * validated against the published 1.0.0 schemas.
 */

import { readFileSync, existsSync, openSync, readSync, closeSync } from "fs";
import { resolve, dirname, relative, extname } from "path";
import { fileURLToPath } from "url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

let errors = 0;
let warnings = 0;

function fail(message) {
  console.error(`ERROR: ${message}`);
  errors++;
}

function warn(message) {
  console.warn(`WARN: ${message}`);
  warnings++;
}

function loadJSON(path, context) {
  let raw;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    fail(`${context}: file not found at ${relative(root, path)}`);
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(`${context}: invalid JSON — ${err.message}`);
    return null;
  }
}

// Verbatim snapshots of https://agent-plugins.org/schemas/1.0.0/{plugin,mcp}.schema.json, the version
// our manifests' $schema names (and the only one Codex accepts). Re-download them if that URL ever moves.
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validatePluginSchema = ajv.compile(
  loadJSON(resolve(root, "schemas/agent-plugins/plugin.schema.json"), "plugin schema")
);
const validateMcpSchema = ajv.compile(
  loadJSON(resolve(root, "schemas/agent-plugins/mcp.schema.json"), "mcp schema")
);

function reportSchemaErrors(label, validate) {
  for (const err of validate.errors ?? []) {
    const detail =
      err.keyword === "additionalProperties"
        ? `${err.message}: "${err.params.additionalProperty}"`
        : err.message;
    console.error(`  ${err.instancePath || "/"}: ${detail}`);
  }
}

// --- Submission limits (OpenAI plugin submission field reference) ---

const LIMITS = {
  displayName: 30,
  shortDescription: 30,
  longDescription: 4000,
  developerName: 80,
  url: 1024,
  defaultPromptCount: 3,
  defaultPromptLength: 128,
  capabilitiesCount: 20,
  capabilityLength: 120,
};
const REQUIRED_LISTING_URLS = ["websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"];
// Every category in use across OpenAI's curated catalog (github.com/openai/plugins); the dashboard
// rejects anything else with "Select a valid category". Design tools (Figma, Canva, Adobe) use Creativity.
const DASHBOARD_CATEGORIES = new Set([
  "Developer Tools",
  "Productivity",
  "Creativity",
  "Communication",
  "Education & Research",
  "Data & Analytics",
  "Finance",
  "Security",
  "Scientific Research",
  "Business & Operations",
]);
const REQUIRED_POSITIVE_CASES = 5;
const REQUIRED_NEGATIVE_CASES = 3;
const MIN_ICON_PX = 48;
const MAX_ICON_PX = 4096;
const MAX_ICON_BYTES = 5 * 1024 * 1024;
const ICON_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg"]);

function isRelativePluginPath(value) {
  if (typeof value !== "string" || !value.startsWith("./")) return false;
  const segments = value.slice(2).split("/");
  return segments.every((s) => s.length > 0 && s !== "." && s !== "..");
}

function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

function checkMaxLength(label, field, value, max) {
  if (typeof value !== "string") {
    fail(`${label}: ${field} must be a string`);
    return;
  }
  if (value.length > max) {
    fail(`${label}: ${field} is ${value.length} characters, submission limit is ${max}`);
  }
}

/** Reads a PNG's IHDR so icon dimensions can be checked without an image library. */
function readPngSize(path) {
  const header = Buffer.alloc(24);
  const fd = openSync(path, "r");
  try {
    readSync(fd, header, 0, 24, 0);
  } finally {
    closeSync(fd);
  }
  const isPng = header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isPng) return null;
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

function readSvgSize(path) {
  const svg = readFileSync(path, "utf-8");
  const viewBox = svg.match(/viewBox\s*=\s*"[^"]*?\s*([\d.]+)\s+([\d.]+)\s*"/i);
  if (viewBox) {
    return { width: Number(viewBox[1]), height: Number(viewBox[2]) };
  }
  const width = svg.match(/<svg[^>]*\swidth\s*=\s*"([\d.]+)(px)?"/i);
  const height = svg.match(/<svg[^>]*\sheight\s*=\s*"([\d.]+)(px)?"/i);
  if (width && height) {
    return { width: Number(width[1]), height: Number(height[1]) };
  }
  return null;
}

function validateIcon(pluginDir, label, field, value) {
  if (!isRelativePluginPath(value)) {
    fail(`${label}: interface.${field} must be a "./"-relative path inside the plugin — got "${value}"`);
    return;
  }
  const path = resolve(pluginDir, value.slice(2));
  if (!existsSync(path)) {
    fail(`${label}: interface.${field} references missing file "${value}"`);
    return;
  }
  const ext = extname(path).toLowerCase();
  if (!ICON_EXTENSIONS.has(ext)) {
    fail(`${label}: interface.${field} must be PNG, JPEG, WebP, or SVG — got "${ext}"`);
    return;
  }
  const bytes = readFileSync(path).byteLength;
  if (bytes > MAX_ICON_BYTES) {
    fail(`${label}: interface.${field} is ${bytes} bytes, limit is ${MAX_ICON_BYTES}`);
  }

  let size = null;
  if (ext === ".png") size = readPngSize(path);
  if (ext === ".svg") size = readSvgSize(path);
  if (size === null) {
    warn(`${label}: interface.${field} dimensions not checked (unsupported for "${ext}" here)`);
    return;
  }
  if (size.width !== size.height) {
    fail(`${label}: interface.${field} must be square — got ${size.width}x${size.height}`);
  }
  if (size.width < MIN_ICON_PX) {
    fail(`${label}: interface.${field} must be at least ${MIN_ICON_PX}px — got ${size.width}px`);
  }
  if (ext !== ".svg" && size.width > MAX_ICON_PX) {
    fail(`${label}: interface.${field} must be at most ${MAX_ICON_PX}px — got ${size.width}px`);
  }
}

function validateInterface(pluginDir, label, iface) {
  checkMaxLength(label, "interface.displayName", iface.displayName, LIMITS.displayName);
  checkMaxLength(label, "interface.shortDescription", iface.shortDescription, LIMITS.shortDescription);
  checkMaxLength(label, "interface.longDescription", iface.longDescription, LIMITS.longDescription);
  checkMaxLength(label, "interface.developerName", iface.developerName, LIMITS.developerName);

  if (typeof iface.category !== "string" || iface.category.length === 0) {
    fail(`${label}: interface.category is required`);
  } else if (!DASHBOARD_CATEGORIES.has(iface.category)) {
    fail(
      `${label}: interface.category "${iface.category}" is not a dashboard category; use one of: ${[...DASHBOARD_CATEGORIES].join(", ")}`
    );
  }

  if (iface.capabilities !== undefined) {
    if (!Array.isArray(iface.capabilities)) {
      fail(`${label}: interface.capabilities must be an array`);
    } else {
      if (iface.capabilities.length > LIMITS.capabilitiesCount) {
        fail(`${label}: interface.capabilities has ${iface.capabilities.length} entries, limit is ${LIMITS.capabilitiesCount}`);
      }
      for (const [i, capability] of iface.capabilities.entries()) {
        checkMaxLength(label, `interface.capabilities[${i}]`, capability, LIMITS.capabilityLength);
      }
    }
  }

  // All four listing URLs are required for MCP review, and must be HTTPS
  for (const field of REQUIRED_LISTING_URLS) {
    const value = iface[field];
    if (value === undefined) {
      fail(`${label}: interface.${field} is required for MCP review`);
      continue;
    }
    checkMaxLength(label, `interface.${field}`, value, LIMITS.url);
    if (!isHttpsUrl(value)) {
      fail(`${label}: interface.${field} must be an HTTPS URL without credentials — got "${value}"`);
    } else if (/todo/i.test(value)) {
      warn(`${label}: interface.${field} is a placeholder ("${value}"); fill it in before submitting`);
    }
  }

  if (iface.defaultPrompt !== undefined) {
    const prompts = Array.isArray(iface.defaultPrompt) ? iface.defaultPrompt : [iface.defaultPrompt];
    if (prompts.length > LIMITS.defaultPromptCount) {
      fail(`${label}: interface.defaultPrompt has ${prompts.length} entries, limit is ${LIMITS.defaultPromptCount}`);
    }
    if (new Set(prompts).size !== prompts.length) {
      fail(`${label}: interface.defaultPrompt entries must be unique`);
    }
    for (const [i, prompt] of prompts.entries()) {
      checkMaxLength(label, `interface.defaultPrompt[${i}]`, prompt, LIMITS.defaultPromptLength);
      if (typeof prompt === "string" && prompt.includes("@")) {
        fail(`${label}: interface.defaultPrompt[${i}] must not contain an @mention`);
      }
    }
  }

  for (const field of ["brandColor", "brandColorDark"]) {
    if (iface[field] !== undefined && !/^#[0-9a-fA-F]{6}$/.test(iface[field])) {
      fail(`${label}: interface.${field} must be #RRGGBB — got "${iface[field]}"`);
    }
  }

  // The dashboard requires a primary icon before submission; Codex validation requires both
  for (const field of ["logo", "composerIcon"]) {
    if (iface[field] === undefined) {
      fail(`${label}: interface.${field} is required`);
      continue;
    }
    validateIcon(pluginDir, label, field, iface[field]);
  }
  for (const field of ["logoDark", "composerIconDark"]) {
    if (iface[field] !== undefined) {
      validateIcon(pluginDir, label, field, iface[field]);
    }
  }
}

function validateReview(label, review) {
  const cases = review.test_cases;
  if (cases === undefined || cases === null) {
    warn(`${label}: review.test_cases not declared; initial MCP review needs them in the portal`);
  } else {
    const positive = Array.isArray(cases.positive) ? cases.positive : [];
    const negative = Array.isArray(cases.negative) ? cases.negative : [];
    if (positive.length !== REQUIRED_POSITIVE_CASES) {
      warn(`${label}: review.test_cases.positive has ${positive.length} cases; initial MCP review requires exactly ${REQUIRED_POSITIVE_CASES}`);
    }
    if (negative.length !== REQUIRED_NEGATIVE_CASES) {
      warn(`${label}: review.test_cases.negative has ${negative.length} cases; initial MCP review requires exactly ${REQUIRED_NEGATIVE_CASES}`);
    }
    for (const [i, testCase] of positive.entries()) {
      for (const field of ["description", "prompt", "tools_triggered", "expected_behavior"]) {
        if (typeof testCase[field] !== "string" || testCase[field].length === 0) {
          fail(`${label}: review.test_cases.positive[${i}].${field} is required`);
        }
      }
    }
    for (const [i, testCase] of negative.entries()) {
      for (const field of ["description", "prompt"]) {
        if (typeof testCase[field] !== "string" || testCase[field].length === 0) {
          fail(`${label}: review.test_cases.negative[${i}].${field} is required`);
        }
      }
    }
  }

  if (review.demo_recording_url === undefined) {
    warn(`${label}: review.demo_recording_url not declared; required for MCP review`);
  } else if (!isHttpsUrl(review.demo_recording_url)) {
    fail(`${label}: review.demo_recording_url must be an HTTPS URL`);
  } else if (/todo/i.test(review.demo_recording_url)) {
    warn(`${label}: review.demo_recording_url is a placeholder; fill it in before submitting`);
  }

  // Credentials and reviewer notes are entered in the portal, never shipped in the package
  for (const field of ["test_credentials", "reviewer_instructions"]) {
    if (review[field] !== undefined) {
      fail(`${label}: review.${field} is rejected by the package upload; enter it in the portal instead`);
    }
  }
}

/**
 * Reads a plugin package in either layout and returns the parts the submission checks need.
 *
 * Codex layout (`.codex-plugin/plugin.json`, listing fields at root `interface`, servers in `.mcp.json`) is
 * what every plugin in OpenAI's own catalog ships, and Codex applies no tool budget to it. The portable
 * Agent Plugins layout (root `plugin.json` + `mcp.json`) is still accepted, but Codex budgets its tools.
 */
function loadPackage(pluginDir, label) {
  const codexManifestPath = resolve(pluginDir, ".codex-plugin/plugin.json");
  const portableManifestPath = resolve(pluginDir, "plugin.json");

  if (existsSync(codexManifestPath)) {
    const manifest = loadJSON(codexManifestPath, `${label} .codex-plugin/plugin.json`);
    if (!manifest) return null;
    const mcpRelative = typeof manifest.mcpServers === "string" ? manifest.mcpServers : "./.mcp.json";
    return {
      layout: "codex",
      manifest,
      iface: manifest.interface,
      openai: manifest.extensions?.["com.openai"] ?? {},
      mcpPath: resolve(pluginDir, mcpRelative.replace(/^\.\//, "")),
    };
  }

  if (existsSync(portableManifestPath)) {
    const manifest = loadJSON(portableManifestPath, `${label} plugin.json`);
    if (!manifest) return null;
    if (!validatePluginSchema(manifest)) {
      fail(`${label}: plugin.json failed schema validation:`);
      reportSchemaErrors(label, validatePluginSchema);
    }
    const openai = manifest.extensions?.["com.openai"] ?? {};
    return { layout: "portable", manifest, iface: openai.interface, openai, mcpPath: resolve(pluginDir, "mcp.json") };
  }

  return null;
}

const REMOTE_TRANSPORTS = new Set(["http", "streamable_http", "streamable-http"]);

function validateMcpConfig(pkg, label) {
  if (!existsSync(pkg.mcpPath)) return;
  const mcp = loadJSON(pkg.mcpPath, `${label} ${relative(root, pkg.mcpPath)}`);
  if (!mcp) return;

  // The portable schema forbids unknown server keys, and Codex's portable parser drops any server carrying
  // them, so portable packages are validated strictly. The Codex layout has no published schema.
  if (pkg.layout === "portable" && !validateMcpSchema(mcp)) {
    fail(`${label}: mcp.json failed schema validation:`);
    reportSchemaErrors(label, validateMcpSchema);
  }

  const servers = mcp.mcpServers ?? {};
  const serverNames = Object.keys(servers);
  if (serverNames.length !== 1) {
    warn(`${label}: ${serverNames.length} MCP servers declared; the portal connects one per plugin and plugin-level review cases require exactly one`);
  }

  for (const [name, server] of Object.entries(servers)) {
    const serverLabel = `${label} server "${name}"`;

    if (!REMOTE_TRANSPORTS.has(server.type)) {
      fail(`${serverLabel}: public submission requires a remote HTTP server — got type "${server.type}"`);
    }
    if (typeof server.url !== "string" || !isHttpsUrl(server.url)) {
      fail(`${serverLabel}: url must be a public HTTPS endpoint — got "${server.url}"`);
    }
    // Also what a fixed credential would look like, and credentials never belong in the package
    if (server.headers !== undefined && Object.keys(server.headers).length > 0) {
      fail(`${serverLabel}: public submission rejects nonempty headers`);
    }
  }
}

function validateSubmissionPackage(pluginDir, marketplaceName) {
  const label = `Plugin "${marketplaceName}"`;
  const pkg = loadPackage(pluginDir, label);
  if (!pkg) return false;

  // Only plugins prepared for the directory carry review cases; the rest aren't held to submission rules
  if (pkg.openai.review === undefined) return false;

  const { manifest, iface, openai } = pkg;
  if (manifest.name !== marketplaceName) {
    fail(`${label}: marketplace name does not match manifest name "${manifest.name}"`);
  }
  if (typeof manifest.version !== "string") {
    fail(`${label}: version is required for submission and updates`);
  }
  if (pkg.layout === "codex") {
    for (const field of ["description", "author"]) {
      if (manifest[field] === undefined) fail(`${label}: ${field} is required in the Codex manifest`);
    }
  }

  // App references and lifecycle hooks make a ZIP ineligible for public submission
  for (const field of ["apps", "hooks"]) {
    if (manifest[field] !== undefined || openai[field] !== undefined) {
      fail(`${label}: ${field} is not accepted for public directory submission`);
    }
  }

  if (iface === undefined) {
    fail(`${label}: interface listing metadata is required for submission`);
  } else {
    validateInterface(pluginDir, label, iface);
  }
  validateReview(label, openai.review);
  validateMcpConfig(pkg, label);
  return true;
}

// --- Main ---

const marketplace = loadJSON(resolve(root, ".agents/plugins/marketplace.json"), "Marketplace");
let validated = 0;
for (const entry of marketplace?.plugins ?? []) {
  const sourcePath = typeof entry.source === "string" ? entry.source : entry.source?.path;
  if (typeof sourcePath !== "string" || !sourcePath.startsWith("./")) continue;
  if (validateSubmissionPackage(resolve(root, sourcePath.slice(2)), entry.name)) validated++;
}

if (validated === 0) {
  warn("No directory submission packages (plugins with a review block) found in .agents/plugins/marketplace.json");
}

if (errors > 0) {
  console.error(`\nAgent Plugins validation failed with ${errors} error(s).`);
  process.exit(1);
} else if (warnings > 0) {
  console.log(`Agent Plugins validation passed with ${warnings} warning(s).`);
} else {
  console.log("Agent Plugins validation passed.");
}
