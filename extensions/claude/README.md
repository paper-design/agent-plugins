# Paper Claude Desktop Extension (MCPB)

Config-only Claude Desktop extension that registers Paper’s MCP server via the CLI already installed by Paper Desktop.

No MCP server code, Node runtime, or CLI binary is bundled. The extension points at the stable CLI path written on Paper Desktop launch:

- Unix: `${HOME}/.paper/bin/paper mcp`
- Windows: `${HOME}/.paper/bin/paper.exe mcp`

This mirrors the Cursor / Claude Code MCP config in [`plugins/paper-desktop/mcp.json`](../plugins/paper-desktop/mcp.json).

## Prerequisites

1. Install [Paper Desktop](https://paper.design/downloads).
2. Open Paper Desktop once so it installs the CLI to `~/.paper/bin/paper` (or `paper.exe` on Windows).

## Install

1. Pack the extension (from this directory):

   ```sh
   bun run pack
   ```

   This writes `dist/paper.mcpb`.

2. In Claude Desktop, open or drag `dist/paper.mcpb` into **Settings → Extensions**.
3. Restart Claude Desktop if Paper tools do not appear after install.

## Failure mode

If the Paper CLI is missing, Claude fails to spawn the MCP server (missing binary). Fix that by launching Paper Desktop once — do not edit the extension or `claude_desktop_config.json`.

## Pack notes

The archive is a zip with `manifest.json` at the root. We pack with a plain zip because the CLI lives outside the bundle (`entry_point` is an absolute `${HOME}/…` path), which `mcpb validate` may reject as a missing in-bundle binary.
