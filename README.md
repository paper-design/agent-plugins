# Paper agent plugins

Use Paper with your favorite agent harness.
Are we missing one, you have feedback for us, or just want to chat? Join us on our [Discord](https://discord.gg/xqBrwhuh2J) or [Slack](https://paper-community.slack.com/join/shared_invite/zt-430qekrpz-EzbDXbpIHulMPVBB02CwVA) communities.

## ChatGPT and Codex

The `paper` plugin connects to Paper's hosted MCP server (`https://mcp.paper.design`), so no desktop install is needed.

- Search for "Paper" in ChatGPT Plugins once it is listed in the directory.
- Before then, add it as a custom MCP server: Plugins > plus button > Add custom MCP server, URL `https://mcp.paper.design`, OAuth authentication.
- Maintainers: `bun run pack:chatgpt` writes `dist/paper-chatgpt-plugin.zip` for the OpenAI plugin submission portal.

## Cursor

```sh
/add-plugin paper-desktop
```

- [View on Cursor Marketplace](https://cursor.com/marketplace/paper)
- [Read more about installing Cursor plugins](https://cursor.com/docs/plugins#installing-plugins)

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
