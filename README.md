# Paper agent plugins

Use Paper with your favorite agent harness.
Missing one? [Request it in an issue](https://github.com/paper-design/agent-plugins/issues/new).

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

## Codex

**Add the custom marketplace**

```sh
codex plugin marketplace add paper-design/agent-plugins
```

**Install the plugin**

```sh
codex plugin install paper-desktop@paper
```

You can also browse and install plugins interactively by running `/plugins` inside Codex CLI after adding the marketplace.

- [Read more about installing Codex plugins](https://developers.openai.com/codex/plugins)

## Pi

```sh
pi install git:github.com/paper-design/agent-plugins
```

Pi has no built-in MCP support, so the Pi package ships a small extension
(`plugins/paper-desktop/pi`) that connects to Paper Desktop's local server and
exposes its capabilities as native Pi tools (`paper_*`), plus a `paper_status`
tool and a `/paper-reconnect` command for when Paper Desktop starts after Pi.
Requires Paper Desktop running with a file open. Set `PAPER_MCP_URL` to
override the default `http://127.0.0.1:29979/mcp` endpoint.
