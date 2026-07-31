import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { productionCLICandidates } from "./locate-paper-cli.mjs";

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
        "C:\\Users\\ada"
      )
    ).toEqual([join("C:\\Users\\ada\\AppData\\Roaming", "Paper", "cli.cmd")]);
  });

  it("falls back to home AppData/Roaming when APPDATA is unset", () => {
    expect(productionCLICandidates("win32", {}, "C:\\Users\\ada")).toEqual([
      join("C:\\Users\\ada", "AppData", "Roaming", "Paper", "cli.cmd"),
    ]);
  });

  it("resolves Linux XDG config / Paper / cli", () => {
    expect(
      productionCLICandidates("linux", { XDG_CONFIG_HOME: "/home/ada/.config" }, "/home/ada")
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
      ...productionCLICandidates("win32", { APPDATA: "C:\\Roaming" }, "C:\\Users\\ada"),
    ];
    for (const path of paths) {
      expect(path.includes("staging")).toBe(false);
    }
  });
});
