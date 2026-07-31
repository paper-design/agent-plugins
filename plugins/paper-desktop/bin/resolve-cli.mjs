#!/usr/bin/env node
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * App-data root for Paper Desktop (Electron `app.getPath('appData')` + app name).
 * Production installs the CLI here; staging/localhost use subdirectories.
 * @param {NodeJS.Platform} [platform]
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [home]
 * @returns {string}
 */
export function paperAppDataRoot(
  platform = process.platform,
  env = process.env,
  home = homedir(),
) {
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "Paper");
  }

  if (platform === "win32") {
    const appData = env.APPDATA || join(home, "AppData", "Roaming");
    return join(appData, "Paper");
  }

  // Electron appData on Linux is XDG config home.
  const configHome = env.XDG_CONFIG_HOME || join(home, ".config");
  return join(configHome, "Paper");
}

/**
 * Candidate CLI paths in preference order: production, then staging, then localhost.
 * Mirrors desktop `getAppDataPath()` — prod stays at the Paper root; other envs use a
 * subdirectory so they don't share state with production.
 * @param {NodeJS.Platform} [platform]
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [home]
 * @returns {string[]}
 */
export function cliCandidates(
  platform = process.platform,
  env = process.env,
  home = homedir(),
) {
  const root = paperAppDataRoot(platform, env, home);
  const cliFile = platform === "win32" ? "cli.cmd" : "cli";
  return [
    join(root, cliFile),
    join(root, "staging", cliFile),
    join(root, "localhost", cliFile),
  ];
}

/**
 * Node's Windows `shell: true` path joins the command into a cmd.exe string
 * without quoting, so paths with spaces must be quoted by the caller.
 * @param {string} command
 * @param {NodeJS.Platform} [platform]
 * @returns {string}
 */
export function spawnCommand(command, platform = process.platform) {
  if (platform !== "win32") {
    return command;
  }
  return `"${command.replaceAll('"', '""')}"`;
}

/**
 * @typedef {object} SignalForwardableChild
 * @property {boolean} killed
 * @property {number | null} exitCode
 * @property {NodeJS.Signals | null} signalCode
 * @property {(signal?: NodeJS.Signals) => boolean} kill
 * @property {(event: "exit" | "error", listener: () => void) => unknown} once
 */

/**
 * @typedef {object} SignalSource
 * @property {(event: NodeJS.Signals, listener: () => void) => unknown} on
 * @property {(event: NodeJS.Signals, listener: () => void) => unknown} off
 */

/**
 * Forward host termination signals to the spawned CLI so the child does not
 * outlive the wrapper when the MCP host stops the configured `node` process.
 * @param {SignalForwardableChild} child
 * @param {NodeJS.Signals[]} [signals]
 * @param {SignalSource} [proc]
 */
export function attachSignalForwarding(
  child,
  signals = ["SIGINT", "SIGTERM", "SIGHUP"],
  proc = process,
) {
  /** @type {{ signal: NodeJS.Signals, forward: () => void }[]} */
  const attached = [];

  for (const signal of signals) {
    const forward = () => {
      if (child.killed || child.exitCode !== null || child.signalCode) {
        return;
      }
      try {
        child.kill(signal);
      } catch {
        // Child may already be gone between the checks and kill.
      }
    };

    try {
      proc.on(signal, forward);
      attached.push({ signal, forward });
    } catch {
      // Unsupported on this platform (e.g. SIGHUP on Windows).
    }
  }

  const detach = () => {
    for (const { signal, forward } of attached) {
      proc.off(signal, forward);
    }
  };
  child.once("exit", detach);
  child.once("error", detach);
}

/**
 * @param {string[]} [argv]
 * @returns {void}
 */
export function main(argv = process.argv.slice(2)) {
  const cli = cliCandidates().find((path) => existsSync(path));

  if (!cli) {
    console.error(
      "Paper CLI not found. Install Paper Desktop from https://paper.design/downloads and open it once so it can install the CLI.",
    );
    process.exit(1);
  }

  const args = argv.length > 0 ? argv : ["mcp"];
  const isWindows = process.platform === "win32";

  const child = spawn(spawnCommand(cli), args, {
    stdio: "inherit",
    // Windows .cmd shims need a shell; Unix payload is a real executable.
    shell: isWindows,
    windowsHide: true,
  });

  attachSignalForwarding(child);

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
