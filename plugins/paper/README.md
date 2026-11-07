# Paper for ChatGPT and Codex

Paper connects your designs, agents, code, and data on a single canvas built on web standards. This plugin connects ChatGPT (and Codex) to Paper's hosted MCP server at `https://mcp.paper.design`, so your agent can read and write your design files after you sign in with your Paper account.

No desktop install is required: everything runs through the remote server.

**Features**

- **Read designs**: Inspect artboard structure, screenshots, computed styles, JSX output, and text content.
- **Write to the canvas**: Create artboards, add or replace HTML nodes, update styles, set text, and duplicate elements from a prompt.
- **Export**: Export artboards as images or PDFs.
- **Design systems**: Read and write design tokens.

**Install**

- From the Plugin Directory: search for "Paper" in ChatGPT Plugins and install it, then sign in with your Paper account when prompted.
- Manually, before it is listed: in ChatGPT go to Plugins, select the plus button, then Add custom MCP server. Use `https://mcp.paper.design` as the server URL with OAuth authentication.

**Package layout**

This folder is a portable [Agent Plugins](https://agent-plugins.org) package:

- `plugin.json`: identity and listing metadata (OpenAI-specific fields under `extensions.com.openai`).
- `mcp.json`: the remote MCP server, strictly per the Agent Plugins schema. OAuth is not declared here: Codex's parser rejects servers with extra keys, and clients discover the authorization server from the MCP endpoint itself (401 + `resource_metadata`). Pick OAuth in the portal's Connect panel when submitting.
- `assets/`: listing icon.

Run `bun run pack:chatgpt` from the repository root to produce the ZIP uploaded to the OpenAI plugin submission portal.
