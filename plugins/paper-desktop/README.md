Paper connects your designs, agents, code, and data on a single canvas built on web standards. Because Paper is based on web technology and LLMs are fluent in HTML/CSS, your agent can read and write to your design files with high fidelity — turning your canvas into a live collaboration surface between you and your agent.

**Prerequisites**

Make sure to install [Paper Desktop](https://paper.design/downloads) and open it at least once.

**Features**

- **Read designs**: Inspect artboard structure, screenshots, computed styles, JSX output, and text content directly from Paper.
- **Write to the canvas**: Create artboards, add or replace HTML nodes, update styles, set text, and duplicate elements — all from a prompt.
- **Cross-tool workflows**: Combine with other MCP servers (Figma, Notion, etc.) to sync tokens, pull real content, or translate designs across tools.
- **Design-to-code**: Turn Paper designs into production code by reading the canvas structure and generating components in your framework of choice.
- **Code-to-design**: Use your codebase (tokens, styles, components) as context to generate new designs on the canvas.

**Examples**

**Prompt:** "Use the CSS styles from my repo and design a settings page in Paper".

**Expected behavior:**

- Your agent will read your project's stylesheets, tokens, or theme files to understand your existing design language.
- Creates a new artboard in Paper and builds a settings page that matches your codebase's visual style.
- Uses your actual colors, typography, spacing, and component patterns — not generic defaults.

**Prompt:** "Implement my design from Paper in my codebase, using my code conventions".

**Expected behavior:**

- Your agent will read the selected frame in Paper — structure, styles, text content, and images.
- Generates production-ready components in your project's framework and coding style.
- Matches the design's layout, spacing, typography, and colors using your existing conventions (e.g. Tailwind classes, CSS modules, styled-components).

**Prompt:** "Grab my tokens from Figma and create a design system on the canvas in Paper".

**Expected behavior:**

- Your agent will read color variables, text styles, and spacing tokens from your open Figma file via the Figma MCP server.
- Creates a design system sticker sheet on the Paper canvas with swatches, type scales, and spacing references.
- Note: requires the [Figma MCP server](https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server) to also be connected.
