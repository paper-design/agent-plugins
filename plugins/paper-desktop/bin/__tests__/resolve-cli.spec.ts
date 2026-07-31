import { describe, expect, it, mock } from "bun:test";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import {
  attachSignalForwarding,
  cliCandidates,
  paperAppDataRoot,
  spawnCommand,
} from "../resolve-cli.mjs";

describe("paperAppDataRoot", () => {
  it("resolves macOS Application Support / Paper", () => {
    expect(paperAppDataRoot("darwin", {}, "/Users/ada")).toBe(
      join("/Users/ada", "Library", "Application Support", "Paper"),
    );
  });

  it("resolves Windows %APPDATA% / Paper", () => {
    expect(
      paperAppDataRoot(
        "win32",
        { APPDATA: "C:\\Users\\ada\\AppData\\Roaming" },
        "C:\\Users\\ada",
      ),
    ).toBe(join("C:\\Users\\ada\\AppData\\Roaming", "Paper"));
  });

  it("falls back to home AppData/Roaming when APPDATA is unset", () => {
    expect(paperAppDataRoot("win32", {}, "C:\\Users\\ada")).toBe(
      join("C:\\Users\\ada", "AppData", "Roaming", "Paper"),
    );
  });

  it("resolves Linux XDG config / Paper", () => {
    expect(
      paperAppDataRoot("linux", { XDG_CONFIG_HOME: "/home/ada/.config" }, "/home/ada"),
    ).toBe(join("/home/ada/.config", "Paper"));
  });

  it("falls back to ~/.config when XDG_CONFIG_HOME is unset", () => {
    expect(paperAppDataRoot("linux", {}, "/home/ada")).toBe(
      join("/home/ada", ".config", "Paper"),
    );
  });
});

describe("cliCandidates", () => {
  it("prefers production, then staging, then localhost on macOS", () => {
    const root = join("/Users/ada", "Library", "Application Support", "Paper");
    expect(cliCandidates("darwin", {}, "/Users/ada")).toEqual([
      join(root, "cli"),
      join(root, "staging", "cli"),
      join(root, "localhost", "cli"),
    ]);
  });

  it("prefers production, then staging, then localhost on Windows", () => {
    const root = join("C:\\Users\\ada\\AppData\\Roaming", "Paper");
    expect(
      cliCandidates(
        "win32",
        { APPDATA: "C:\\Users\\ada\\AppData\\Roaming" },
        "C:\\Users\\ada",
      ),
    ).toEqual([
      join(root, "cli.cmd"),
      join(root, "staging", "cli.cmd"),
      join(root, "localhost", "cli.cmd"),
    ]);
  });

  it("prefers production, then staging, then localhost on Linux", () => {
    const root = join("/home/ada/.config", "Paper");
    expect(
      cliCandidates("linux", { XDG_CONFIG_HOME: "/home/ada/.config" }, "/home/ada"),
    ).toEqual([
      join(root, "cli"),
      join(root, "staging", "cli"),
      join(root, "localhost", "cli"),
    ]);
  });
});

describe("spawnCommand", () => {
  it("quotes Windows paths so spaces survive shell: true", () => {
    const cli = join(
      "C:\\Users\\Ada Lovelace\\AppData\\Roaming",
      "Paper",
      "cli.cmd",
    );
    expect(spawnCommand(cli, "win32")).toBe(`"${cli}"`);
  });

  it("escapes embedded double quotes for cmd.exe", () => {
    expect(spawnCommand('C:\\odd"path\\cli.cmd', "win32")).toBe(
      '"C:\\odd""path\\cli.cmd"',
    );
  });

  it("leaves Unix paths unchanged", () => {
    const cli = join(
      "/Users/ada",
      "Library",
      "Application Support",
      "Paper",
      "cli",
    );
    expect(spawnCommand(cli, "darwin")).toBe(cli);
    expect(spawnCommand(cli, "linux")).toBe(cli);
  });
});

describe("attachSignalForwarding", () => {
  it("forwards SIGTERM from the host process to the child", () => {
    const child = Object.assign(new EventEmitter(), {
      killed: false,
      exitCode: null,
      signalCode: null,
      kill: mock(() => true),
    });
    const proc = new EventEmitter();

    attachSignalForwarding(child, ["SIGTERM"], proc);
    proc.emit("SIGTERM");

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("forwards SIGINT and SIGHUP to the child", () => {
    const child = Object.assign(new EventEmitter(), {
      killed: false,
      exitCode: null,
      signalCode: null,
      kill: mock(() => true),
    });
    const proc = new EventEmitter();

    attachSignalForwarding(child, ["SIGINT", "SIGHUP"], proc);
    proc.emit("SIGINT");
    proc.emit("SIGHUP");

    expect(child.kill).toHaveBeenCalledWith("SIGINT");
    expect(child.kill).toHaveBeenCalledWith("SIGHUP");
  });

  it("does not kill an already-exited child", () => {
    const child = Object.assign(new EventEmitter(), {
      killed: false,
      exitCode: 0,
      signalCode: null,
      kill: mock(() => true),
    });
    const proc = new EventEmitter();

    attachSignalForwarding(child, ["SIGTERM"], proc);
    proc.emit("SIGTERM");

    expect(child.kill).not.toHaveBeenCalled();
  });

  it("detaches listeners when the child exits", () => {
    const child = Object.assign(new EventEmitter(), {
      killed: false,
      exitCode: null,
      signalCode: null,
      kill: mock(() => true),
    });
    const proc = new EventEmitter();

    attachSignalForwarding(child, ["SIGTERM"], proc);
    child.emit("exit", 0, null);
    proc.emit("SIGTERM");

    expect(child.kill).not.toHaveBeenCalled();
  });
});
