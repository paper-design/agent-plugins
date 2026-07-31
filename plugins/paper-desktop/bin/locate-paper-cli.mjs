#!/usr/bin/env node
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

/** @returns {string[]} Candidate absolute paths for the production CLI binary. */
export function productionCLICandidates(
  platform = process.platform,
  env = process.env,
  home = homedir(),
) {
  if (platform === "darwin") {
    return [join(home, "Library", "Application Support", "Paper", "cli")];
  }

  if (platform === "win32") {
    const appData = env.APPDATA || join(home, "AppData", "Roaming");
    return [join(appData, "Paper", "cli.cmd")];
  }

  // Electron appData on Linux is XDG config home.
  const configHome = env.XDG_CONFIG_HOME || join(home, ".config");
  return [join(configHome, "Paper", "cli")];
}

/** @returns {string | undefined} */
export function resolveProductionCLI(platform, env, home) {
  return productionCLICandidates(platform, env, home).find((path) =>
    existsSync(path),
  );
}

export function main(argv = process.argv.slice(2)) {
  const cli = resolveProductionCLI();
  if (!cli) {
    console.error(
      "Paper CLI not found. Install Paper Desktop from https://paper.design/downloads and open it once so it can install the CLI.",
    );
    process.exit(1);
  }

  const args = argv.length > 0 ? argv : ["mcp"];

  const child = spawn(cli, args, {
    stdio: "inherit",
    // Windows .cmd shims need a shell; Unix payload is a real executable.
    shell: process.platform === "win32",
    windowsHide: true,
  });

  child.on("error", (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main();
}
