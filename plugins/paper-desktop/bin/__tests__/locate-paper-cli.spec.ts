import { describe, expect, it, mock } from "bun:test";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import {
  attachSignalForwarding,
  productionCLICandidates,
  spawnCommand,
} from "../locate-paper-cli.mjs";

describe("productionCLICandidates", () => {
  it("resolves macOS Application Support / Paper / cli", () => {
    expect(productionCLICandidates("darwin", {}, "/Users/ada")).toEqual([
      join("/Users/ada", "Library", "Application Support", "Paper", "cli"),
    ]);
  });

  it("resolves Windows %APPDATA% / Paper / cli.cmd", () => {
    expect(
      productionCLICandidates(
        "win32",
        { APPDATA: "C:\\Users\\ada\\AppData\\Roaming" },
        "C:\\Users\\ada",
      ),
    ).toEqual([join("C:\\Users\\ada\\AppData\\Roaming", "Paper", "cli.cmd")]);
  });

  it("falls back to home AppData/Roaming when APPDATA is unset", () => {
    expect(productionCLICandidates("win32", {}, "C:\\Users\\ada")).toEqual([
      join("C:\\Users\\ada", "AppData", "Roaming", "Paper", "cli.cmd"),
    ]);
  });

  it("resolves Linux XDG config / Paper / cli", () => {
    expect(
      productionCLICandidates(
        "linux",
        { XDG_CONFIG_HOME: "/home/ada/.config" },
        "/home/ada",
      ),
    ).toEqual([join("/home/ada/.config", "Paper", "cli")]);
  });

  it("falls back to ~/.config when XDG_CONFIG_HOME is unset", () => {
    expect(productionCLICandidates("linux", {}, "/home/ada")).toEqual([
      join("/home/ada", ".config", "Paper", "cli"),
    ]);
  });

  it("does not include staging or other non-prod subdirectories", () => {
    const paths = [
      ...productionCLICandidates("darwin", {}, "/Users/ada"),
      ...productionCLICandidates("linux", {}, "/home/ada"),
      ...productionCLICandidates(
        "win32",
        { APPDATA: "C:\\Roaming" },
        "C:\\Users\\ada",
      ),
    ];
    for (const path of paths) {
      expect(path.includes("staging")).toBe(false);
    }
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
