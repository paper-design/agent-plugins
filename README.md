# Paper agent plugins

Use Paper with your favorite agent harness.
Are we missing one, you have feedback for us, or just want to chat? Join us on our [Discord](https://discord.gg/xqBrwhuh2J) or [Slack](https://paper-community.slack.com/join/shared_invite/zt-430qekrpz-EzbDXbpIHulMPVBB02CwVA) communities.

## ChatGPT and Codex

The `paper` plugin connects to Paper's hosted MCP server (`https://mcp.paper.design`), so no desktop install is needed.

- Search for "Paper" in ChatGPT Plugins once it is listed in the directory.
- Before then, add it as a custom MCP server: Plugins > plus button > Add custom MCP server, URL `https://mcp.paper.design`, OAuth authentication.
- Maintainers: `bun run pack:chatgpt` writes `dist/paper-chatgpt-plugin.zip` for the OpenAI plugin submission portal.

## Cursor

Two plugins, pick by where the agent runs:

- **Paper Desktop** (`paper-desktop`): for the Cursor IDE with Paper Desktop installed. Talks to the running app over a local MCP server; fastest and most reliable, and it works on the file you have open.
- **Paper (remote)** (`paper`): for Grok Bot, cloud agents, and Cursor without Paper Desktop. Connects to `https://mcp.paper.design` and signs in with your Paper account.

```sh
/add-plugin paper-desktop
```

- [View on Cursor Marketplace](https://cursor.com/marketplace/paper)
- [Read more about installing Cursor plugins](https://cursor.com/docs/plugins#installing-plugins)

## Grok Bot

Grok Bot runs in the cloud, so only the remote plugin applies. Install **Paper (remote)** from Connect Apps, or tell your bot: "Add this MCP server: https://mcp.paper.design".

## Claude Code

**Add the custom marketplace**

```sh
/plugin marketplace add paper-design/agent-plugins
```

**Install the plugin**

```sh
/plugin install paper-desktop@paper
```

## Claude Desktop (Chat)

[Download](https://claude-mcpb.paper.design) then drag into Claude or double click to install.
