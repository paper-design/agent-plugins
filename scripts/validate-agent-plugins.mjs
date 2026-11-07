#!/usr/bin/env node

/**
 * Validates portable Agent Plugins packages (root plugin.json + mcp.json) against the
 * published 1.0.0 schemas, then applies the limits OpenAI's plugin submission portal
 * enforces on the extensions["com.openai"] listing data
 * (https://developers.openai.com/plugins/deploy/submission).
 *
 * Plugins are discovered from .agents/plugins/marketplace.json; entries without a root
 * plugin.json (Codex compatibility layout) are left to validate-codex.mjs.
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

function validateMcpConfig(pluginDir, label) {
  const mcpPath = resolve(pluginDir, "mcp.json");
  if (!existsSync(mcpPath)) return;
  const mcp = loadJSON(mcpPath, `${label} mcp.json`);
  if (!mcp) return;

  // The 1.0.0 MCP schema forbids unknown server keys, but OpenAI documents its auth settings
  // under each server's extensions["com.openai"]. Validate the portable shape with that
  // namespace set aside, then check the OpenAI settings separately.
  const servers = mcp.mcpServers ?? {};
  const portableOnly = {
    ...mcp,
    mcpServers: Object.fromEntries(
      Object.entries(servers).map(([name, server]) => {
        const { extensions, ...rest } = server;
        return [name, rest];
      })
    ),
  };
  if (!validateMcpSchema(portableOnly)) {
    fail(`${label}: mcp.json failed schema validation:`);
    reportSchemaErrors(label, validateMcpSchema);
  }

  const serverNames = Object.keys(servers);
  if (serverNames.length !== 1) {
    warn(`${label}: mcp.json declares ${serverNames.length} servers; the portal connects one per plugin and plugin-level review cases require exactly one`);
  }

  for (const [name, server] of Object.entries(servers)) {
    const serverLabel = `${label} server "${name}"`;

    if (server.type !== "streamable-http") {
      fail(`${serverLabel}: public submission requires a remote "streamable-http" server — got "${server.type}"`);
    }
    if (typeof server.url === "string" && !isHttpsUrl(server.url)) {
      fail(`${serverLabel}: url must be a public HTTPS endpoint — got "${server.url}"`);
    }
    if (server.headers !== undefined && Object.keys(server.headers).length > 0) {
      fail(`${serverLabel}: public submission rejects nonempty headers`);
    }

    const auth = server.extensions?.["com.openai"]?.auth;
    if (auth === undefined) {
      warn(`${serverLabel}: no extensions["com.openai"].auth declared; the portal will treat the server as unauthenticated`);
      continue;
    }
    if (!["none", "oauth", "mixed", "api_key"].includes(auth.type)) {
      fail(`${serverLabel}: auth.type must be none, oauth, mixed, or api_key — got "${auth.type}"`);
    }
    if (auth.type === "api_key") {
      fail(`${serverLabel}: the submission portal has no connection flow for api_key auth`);
    }
    if (auth.clientSecret !== undefined || auth.client?.clientSecret !== undefined) {
      fail(`${serverLabel}: clientSecret must not be in the package; enter it in the portal`);
    }
    const client = auth.client;
    if (client !== undefined) {
      if (!["provided", "dcr", "cimd"].includes(client.mode)) {
        fail(`${serverLabel}: auth.client.mode must be provided, dcr, or cimd — got "${client.mode}"`);
      }
      if (client.mode === "provided" && typeof client.clientId !== "string") {
        fail(`${serverLabel}: auth.client.clientId is required for a provided client`);
      }
      if (client.mode !== "provided" && client.clientId !== undefined) {
        fail(`${serverLabel}: auth.client.clientId is only allowed for a provided client`);
      }
    }
  }
}

function validatePortablePlugin(pluginDir, marketplaceName) {
  const label = `Plugin "${marketplaceName}"`;
  const manifest = loadJSON(resolve(pluginDir, "plugin.json"), `${label} plugin.json`);
  if (!manifest) return;

  if (!validatePluginSchema(manifest)) {
    fail(`${label}: plugin.json failed schema validation:`);
    reportSchemaErrors(label, validatePluginSchema);
  }

  if (manifest.name !== marketplaceName) {
    fail(`${label}: marketplace name does not match plugin.json name "${manifest.name}"`);
  }
  if (typeof manifest.version !== "string") {
    warn(`${label}: version is optional in the schema but submissions and updates need an explicit semantic version`);
  }

  const openai = manifest.extensions?.["com.openai"];
  if (openai === undefined) {
    warn(`${label}: no extensions["com.openai"]; listing metadata will be derived from root fields`);
  } else {
    // App references and lifecycle hooks make a ZIP ineligible for public submission
    for (const field of ["apps", "hooks"]) {
      if (openai[field] !== undefined) {
        fail(`${label}: extensions["com.openai"].${field} is not accepted for public directory submission`);
      }
    }
    if (openai.interface === undefined) {
      fail(`${label}: extensions["com.openai"].interface is required for submission`);
    } else {
      validateInterface(pluginDir, label, openai.interface);
    }
    if (openai.review !== undefined) {
      validateReview(label, openai.review);
    } else {
      warn(`${label}: no review block; test cases and demo recording must be entered in the portal`);
    }
  }

  validateMcpConfig(pluginDir, label);
}

// --- Main ---

const marketplace = loadJSON(resolve(root, ".agents/plugins/marketplace.json"), "Marketplace");
let validated = 0;
for (const entry of marketplace?.plugins ?? []) {
  const sourcePath = typeof entry.source === "string" ? entry.source : entry.source?.path;
  if (typeof sourcePath !== "string" || !sourcePath.startsWith("./")) continue;
  const pluginDir = resolve(root, sourcePath.slice(2));
  if (!existsSync(resolve(pluginDir, "plugin.json"))) continue;
  validatePortablePlugin(pluginDir, entry.name);
  validated++;
}

if (validated === 0) {
  warn("No portable Agent Plugins packages found in .agents/plugins/marketplace.json");
}

if (errors > 0) {
  console.error(`\nAgent Plugins validation failed with ${errors} error(s).`);
  process.exit(1);
} else if (warnings > 0) {
  console.log(`Agent Plugins validation passed with ${warnings} warning(s).`);
} else {
  console.log("Agent Plugins validation passed.");
}
