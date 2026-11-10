# Paper for ChatGPT and Codex

Paper connects your designs, agents, code, and data on a single canvas built on web standards. This plugin connects ChatGPT (and Codex) to Paper's hosted MCP server at `https://mcp.paper.design`, so your agent can read and write your design files after you sign in with your Paper account.

No desktop install is required: everything runs through the remote server.

**Features**

- **Read designs**: Inspect artboard structure, screenshots, computed styles, JSX output, and text content.
- **Write to the canvas**: Create artboards, add or replace HTML nodes, update styles, set text, and duplicate elements from a prompt.
- **Export**: Export artboards as images or PDFs.
- **Design systems**: Read and write design tokens.

**Install**

- ChatGPT / Codex: search for "Paper" in the Plugin Directory and install it, then sign in with your Paper account when prompted. Before it is listed: Plugins, the plus button, Add custom MCP server, URL `https://mcp.paper.design`, OAuth authentication.
- Cursor / Grok Bot: install **Paper** from the Cursor Marketplace or Connect Apps. In the Cursor IDE with Paper Desktop installed, prefer the **Paper Desktop** plugin instead; it is faster and acts on the file you have open.

**Package layout**

This folder uses the Codex plugin layout, the same one every plugin in OpenAI's curated catalog ships:

- `.codex-plugin/plugin.json`: identity and listing metadata (`interface`), with review test cases under `extensions.com.openai`.
- `.mcp.json`: the remote MCP server. OAuth is discovered from the server itself (401 + `resource_metadata`); nothing secret lives here.
- `assets/`: listing icon.

We deliberately don't use the portable Agent Plugins layout (root `plugin.json` + `mcp.json`): Codex applies an 8 KB per-tool / 64 KB total budget to servers declared that way and silently hides tools past it, which drops Paper's write tools. The Codex layout has no such budget. See openai/codex#44308.

Run `bun run pack:chatgpt` from the repository root to produce the ZIP uploaded to the OpenAI plugin submission portal. The ZIP contains only the manifest, `.mcp.json`, and the referenced icons; this README is for the repo, not the listing.
