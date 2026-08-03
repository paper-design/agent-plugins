# Paper agent plugins

Use Paper with your favorite agent harness.
Are we missing one, you have feedback for us, or just want to chat? Join us on our [Discord](https://discord.gg/xqBrwhuh2J) or [Slack](https://paper-community.slack.com/join/shared_invite/zt-430qekrpz-EzbDXbpIHulMPVBB02CwVA) communities.

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

## Claude Desktop

Pack the config-only MCPB extension, then open or drag `mcpb/dist/paper.mcpb` into Claude Desktop → Extensions:

```sh
cd mcpb && bun run pack
```

Requires Paper Desktop installed and opened once (so `~/.paper/bin/paper` exists). See [`mcpb/README.md`](mcpb/README.md).
