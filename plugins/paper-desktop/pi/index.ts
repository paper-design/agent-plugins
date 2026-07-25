/**
 * Paper Desktop extension for pi.
 *
 * Connects to the Paper Desktop app's local MCP endpoint and exposes its
 * capabilities as native pi tools. pi itself stays MCP-free — the protocol
 * is an implementation detail of this extension, the same way any HTTP
 * client would be.
 *
 * Requires Paper Desktop running with a file open.
 * Override the endpoint with the PAPER_MCP_URL environment variable.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const DEFAULT_URL = "http://127.0.0.1:29979/mcp";
const CONNECT_TIMEOUT_MS = 3000;
const CALL_TIMEOUT_MS = 120_000;
const TOOL_PREFIX = "paper_";

interface McpTool {
	name: string;
	description?: string;
	inputSchema?: unknown;
}

interface ConnectResult {
	ok: boolean;
	toolCount: number;
	error?: string;
}

function paperUrl(): string {
	return process.env.PAPER_MCP_URL ?? DEFAULT_URL;
}

function toPaperToolName(name: string): string {
	return name.startsWith(TOOL_PREFIX) ? name : `${TOOL_PREFIX}${name}`;
}

const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function imageBlock(data: unknown, mimeType: unknown): any {
	if (typeof data !== "string" || data.length === 0) {
		return { type: "text", text: "[Paper returned an empty image]" };
	}
	// Never forward an unexpected mime type to the provider — a non-image
	// value here previously poisoned the whole session with 400s.
	const mime = typeof mimeType === "string" && IMAGE_MIME_TYPES.has(mimeType) ? mimeType : "image/png";
	// pi-ai ImageContent is flat: { type: "image", data, mimeType }
	return { type: "image", data, mimeType: mime };
}

function mapContent(block: any): any {
	switch (block?.type) {
		case "text":
			return { type: "text", text: block.text ?? "" };
		case "image":
			return imageBlock(block.data, block.mimeType);
		case "resource": {
			const resource = block.resource;
			if (typeof resource?.mimeType === "string" && resource.mimeType.startsWith("image/") && resource.blob) {
				return imageBlock(resource.blob, resource.mimeType);
			}
			return { type: "text", text: resource?.text ?? JSON.stringify(resource ?? block) };
		}
		default:
			return { type: "text", text: typeof block === "string" ? block : JSON.stringify(block) };
	}
}

export default function (pi: ExtensionAPI) {
	let client: Client | null = null;
	let connecting: Promise<ConnectResult> | null = null;
	const registeredTools = new Set<string>();

	function registerPaperTool(c: Client, tool: McpTool): void {
		const name = toPaperToolName(tool.name);
		if (registeredTools.has(name)) return;
		registeredTools.add(name);

		const description = tool.description ?? `Paper Desktop tool "${tool.name}"`;

		pi.registerTool({
			name,
			label: `Paper: ${tool.name}`,
			description: `${description}\n\nRequires Paper Desktop running with a file open.`,
			promptSnippet: description.split("\n")[0].slice(0, 120),
			// MCP input schemas are JSON Schema; pass through unchanged.
			parameters: (tool.inputSchema ?? { type: "object", properties: {} }) as never,
			async execute(_toolCallId, params, signal) {
				if (!client) {
					throw new Error(
						"Paper Desktop is not reachable. Open Paper Desktop with a file, then retry (or run /paper-reconnect).",
					);
				}
				const result = await c.callTool(
					{ name: tool.name, arguments: params as Record<string, unknown> },
					undefined,
					{ signal, timeout: CALL_TIMEOUT_MS },
				);
				const content = Array.isArray((result as any).content)
					? (result as any).content.map(mapContent)
					: [{ type: "text", text: JSON.stringify(result) }];
				if ((result as any).isError) {
					const message = content
						.filter((block: any) => block.type === "text")
						.map((block: any) => block.text)
						.join("\n");
					throw new Error(message || `Paper tool "${tool.name}" failed`);
				}
				return { content, details: {} };
			},
		});
	}

	function attemptConnect(): Promise<ConnectResult> {
		if (client) return Promise.resolve({ ok: true, toolCount: registeredTools.size });
		if (connecting) return connecting;

		connecting = (async (): Promise<ConnectResult> => {
			const c = new Client({ name: "pi-paper-desktop", version: "0.1.0" });
			const transport = new StreamableHTTPClientTransport(new URL(paperUrl()));
			try {
				let timeout: ReturnType<typeof setTimeout> | undefined;
				await Promise.race([
					c.connect(transport),
					new Promise((_, reject) => {
						timeout = setTimeout(() => reject(new Error("connection timed out")), CONNECT_TIMEOUT_MS);
					}),
				]).finally(() => clearTimeout(timeout));

				// Note: if the server ever paginates tools, this needs a cursor loop.
				const { tools } = (await c.listTools()) as { tools: McpTool[] };
				client = c;
				for (const tool of tools) registerPaperTool(c, tool);
				return { ok: true, toolCount: tools.length };
			} catch (err) {
				client = null;
				void transport.close().catch(() => {});
				return { ok: false, toolCount: 0, error: err instanceof Error ? err.message : String(err) };
			} finally {
				connecting = null;
			}
		})();

		return connecting;
	}

	// Always available so the LLM can diagnose and restore the connection
	// even when Paper Desktop was started after pi.
	pi.registerTool({
		name: "paper_status",
		label: "Paper: status",
		description:
			"Check the connection to Paper Desktop, reconnecting if needed. Use this when paper_* tools are missing or failing.",
		promptSnippet: "Check or restore the Paper Desktop connection",
		parameters: Type.Object({}),
		async execute() {
			const result = await attemptConnect();
			if (result.ok) {
				const names = [...registeredTools].filter((n) => n !== "paper_status").join(", ");
				return {
					content: [
						{
							type: "text",
							text: `Connected to Paper Desktop at ${paperUrl()}. ${result.toolCount} tools available: ${names || "none"}.`,
						},
					],
					details: {},
				};
			}
			return {
				content: [
					{
						type: "text",
						text: `Paper Desktop is not reachable at ${paperUrl()} (${result.error}). Open Paper Desktop with a file, then call paper_status again.`,
					},
				],
				details: {},
			};
		},
	});

	pi.registerCommand("paper-reconnect", {
		description: "Reconnect to Paper Desktop and refresh paper_* tools",
		handler: async (_args, ctx) => {
			const result = await attemptConnect();
			if (!ctx.hasUI) return;
			if (result.ok) {
				ctx.ui.notify(`Paper: connected — ${result.toolCount} tools`, "info");
			} else {
				ctx.ui.notify(`Paper: connection failed (${result.error}). Is Paper Desktop open?`, "warning");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const result = await attemptConnect();
		if (!ctx.hasUI) return;
		if (result.ok) {
			ctx.ui.notify(`Paper: connected — ${result.toolCount} tools`, "info");
		} else {
			ctx.ui.notify("Paper Desktop not reachable — open it, then run /paper-reconnect.", "warning");
		}
	});

	pi.on("session_shutdown", async () => {
		const c = client;
		client = null;
		registeredTools.clear();
		if (c) await c.close().catch(() => {});
	});
}
