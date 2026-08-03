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

## Copilot CLI

**Add the custom marketplace**

```sh
copilot plugin marketplace add paper-design/agent-plugins
```

**Install the plugin**

```sh
copilot plugin install paper-desktop@paper
```

Confirm with `copilot mcp list`. Plugins installed this way also appear in VS Code under **Agent Plugins - Installed**.

## VS Code

1. Enable agent plugins: set `chat.plugins.enabled` to `true`.
2. Add the marketplace in settings:

```json
"chat.plugins.marketplaces": [
  "paper-design/agent-plugins"
]
```

3. Install **paper-desktop** from the Agent Plugins view (or install via Copilot CLI as above).

### Manual MCP (optional)

If you prefer not to use plugins, add this to your Copilot / VS Code MCP config:

```json
{
  "servers": {
    "paper": {
      "type": "stdio",
      "command": "${userHome}/.paper/bin/paper",
      "args": ["mcp"]
    }
  }
}
```

- [About Copilot plugins](https://docs.github.com/en/copilot/concepts/agents/about-plugins)
- [Agent plugins in VS Code](https://code.visualstudio.com/docs/agent-customization/agent-plugins)
