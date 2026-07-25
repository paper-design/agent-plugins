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
import { Buffer } from "node:buffer";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

const DEFAULT_URL = "http://127.0.0.1:29979/mcp";
const CONNECT_TIMEOUT_MS = 3000;
const CLOSE_TIMEOUT_MS = 1000;
const CALL_TIMEOUT_MS = 120_000;
const MAX_TOOL_CATALOG_PAGES = 100;
const MAX_IMAGE_BASE64_CHARS = 6_500_000;
const TOOL_PREFIX = "paper_";
const DIAGNOSTIC_TOOL_NAME = "paper_status";

interface McpTool {
	name: string;
	title?: string;
	description?: string;
	inputSchema?: unknown;
}

interface ConnectResult {
	ok: boolean;
	toolCount: number;
	error?: string;
	superseded?: boolean;
}

interface SettledConnection {
	generation: number;
	configuration: string;
	result: ConnectResult;
}

type PiContent =
	| { type: "text"; text: string }
	| { type: "image"; data: string; mimeType: string };

function paperUrl(): string {
	return process.env.PAPER_MCP_URL ?? DEFAULT_URL;
}

function parsePaperUrl(configuration = paperUrl()): URL {
	const url = new URL(configuration);
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("PAPER_MCP_URL must use http:// or https://");
	}
	return url;
}

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : safeStringify(error);
}

function isConnectionFailure(error: unknown): boolean {
	return !(error instanceof McpError) || error.code === ErrorCode.ConnectionClosed;
}

function basePaperToolName(mcpName: string): string {
	const sanitized = (mcpName.trim() || "tool").replace(/[^a-zA-Z0-9_-]/g, "_");
	let name = sanitized.startsWith(TOOL_PREFIX) ? sanitized : `${TOOL_PREFIX}${sanitized}`;
	if (name === DIAGNOSTIC_TOOL_NAME) {
		// Keep status and paper_status distinct while reserving paper_status for
		// this extension's connection diagnostic.
		name = `${TOOL_PREFIX}mcp_${sanitized}`;
	}
	return name;
}

function detectImageMimeType(data: string): string | undefined {
	const header = Buffer.from(data.slice(0, 32), "base64");
	if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
		return "image/jpeg";
	}
	if (header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
		return "image/png";
	}
	if (header.length >= 6 && (header.subarray(0, 6).toString("ascii") === "GIF87a" || header.subarray(0, 6).toString("ascii") === "GIF89a")) {
		return "image/gif";
	}
	if (header.length >= 12 && header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP") {
		return "image/webp";
	}
	return undefined;
}

function imageBlock(data: unknown, mimeType: unknown): PiContent {
	if (typeof data !== "string" || data.length === 0) {
		return { type: "text", text: "[Paper returned an empty image]" };
	}

	let payload = data;
	let declaredMime = typeof mimeType === "string" ? mimeType.split(";", 1)[0].trim().toLowerCase() : "";
	const dataUrl = /^data:([^;,]+)(?:;[^,]*)?;base64,(.*)$/is.exec(payload);
	if (dataUrl) {
		declaredMime ||= dataUrl[1].trim().toLowerCase();
		payload = dataUrl[2];
	}
	payload = payload.replace(/\s/g, "");

	if (!payload || payload.length > MAX_IMAGE_BASE64_CHARS || !/^[a-zA-Z0-9+/]*={0,2}$/.test(payload)) {
		return { type: "text", text: "[Paper returned invalid or oversized image data]" };
	}

	// MCP accepts unpadded base64. Canonicalize it before forwarding while
	// rejecting the impossible one-character remainder.
	const unpadded = payload.replace(/=+$/, "");
	const remainder = unpadded.length % 4;
	if (remainder === 1) {
		return { type: "text", text: "[Paper returned invalid image data]" };
	}
	payload = `${unpadded}${"=".repeat((4 - remainder) % 4)}`;

	// Trust the bytes, not the declaration. This prevents malformed tool output
	// from poisoning every later provider request in the session.
	const detectedMime = detectImageMimeType(payload);
	if (!detectedMime) {
		return { type: "text", text: `[Paper returned unsupported image data (${declaredMime || "unknown type"})]` };
	}
	return { type: "image", data: payload, mimeType: detectedMime };
}

function mapContent(block: any): PiContent {
	switch (block?.type) {
		case "text":
			return { type: "text", text: typeof block.text === "string" ? block.text : safeStringify(block.text) };
		case "image":
			return imageBlock(block.data, block.mimeType);
		case "resource": {
			const resource = block.resource;
			if (typeof resource?.blob === "string") {
				return imageBlock(resource.blob, resource.mimeType);
			}
			return {
				type: "text",
				text: typeof resource?.text === "string" ? resource.text : safeStringify(resource ?? block),
			};
		}
		default:
			return { type: "text", text: typeof block === "string" ? block : safeStringify(block) };
	}
}

function mapToolResult(result: any): PiContent[] {
	const content = Array.isArray(result?.content) ? result.content.map(mapContent) : [];
	if (content.length > 0) return content;
	if (result?.structuredContent !== undefined) {
		return [{ type: "text", text: safeStringify(result.structuredContent) }];
	}
	return [{ type: "text", text: "[Paper returned no content]" }];
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	return Promise.race([
		promise,
		new Promise<T>((_, reject) => {
			timeout = setTimeout(() => reject(new Error(message)), ms);
		}),
	]).finally(() => clearTimeout(timeout));
}

async function closeQuietly(client: Client): Promise<void> {
	try {
		await withTimeout(client.close(), CLOSE_TIMEOUT_MS, "client close timed out");
	} catch {
		// Closing is best-effort during reconnect and shutdown.
	}
}

export default function (pi: ExtensionAPI) {
	let sessionActive = false;
	let connectionGeneration = 0;
	let client: Client | null = null;
	let clientConfiguration: string | null = null;
	let clientEndpoint: string | null = null;
	let connecting: Promise<ConnectResult> | null = null;
	let connectingConfiguration: string | null = null;
	let latestSettledConnection: SettledConnection | null = null;

	const pendingClients = new Set<Client>();
	const registeredToolNames = new Set<string>();
	const availableToolNames = new Set<string>();
	const toolTargets = new Map<string, string>();
	const toolDefinitionFingerprints = new Map<string, string>();
	const toolActivePreferences = new Map<string, boolean>();
	const mcpToPiNames = new Map<string, string>();
	const piNameOwners = new Map<string, string>();

	function allocatePiToolName(mcpName: string): string {
		const existing = mcpToPiNames.get(mcpName);
		if (existing) return existing;

		const base = basePaperToolName(mcpName);
		let candidate = base;
		let suffix = 2;
		while (candidate === DIAGNOSTIC_TOOL_NAME || piNameOwners.has(candidate)) {
			candidate = `${base}_${suffix++}`;
		}

		mcpToPiNames.set(mcpName, candidate);
		piNameOwners.set(candidate, mcpName);
		return candidate;
	}

	function captureActivePaperToolPreferences(): void {
		const active = new Set(pi.getActiveTools());
		for (const name of availableToolNames) {
			toolActivePreferences.set(name, active.has(name));
		}
	}

	function syncActivePaperTools(nextAvailable: ReadonlySet<string>): void {
		const active = new Set(pi.getActiveTools());
		for (const known of registeredToolNames) active.delete(known);
		for (const name of nextAvailable) {
			// New tools default to active. Existing tools retain the user's manual
			// active/inactive choice across reconnects and temporary outages.
			if (toolActivePreferences.get(name) !== false) active.add(name);
		}
		pi.setActiveTools([...active]);
	}

	function clearAvailableCatalog(): void {
		captureActivePaperToolPreferences();
		availableToolNames.clear();
		toolTargets.clear();
		syncActivePaperTools(availableToolNames);
	}

	function registerPaperTool(piName: string, tool: McpTool): void {
		const description = tool.description ?? `Paper Desktop tool "${tool.name}"`;
		const fingerprint = safeStringify({ title: tool.title, description, inputSchema: tool.inputSchema });
		if (toolDefinitionFingerprints.get(piName) === fingerprint) return;

		// Pi stores registered tools in a Map. Re-registering the same name
		// replaces its definition (rather than duplicating it), which lets a
		// Paper update refresh schemas, titles, and descriptions safely.
		pi.registerTool({
			name: piName,
			label: tool.title ? `Paper: ${tool.title}` : `Paper: ${tool.name}`,
			description: `${description}\n\nRequires Paper Desktop running with a file open.`,
			promptSnippet: description.split("\n")[0].slice(0, 120),
			// MCP input schemas are JSON Schema; TypeBox schemas use the same shape.
			parameters: (tool.inputSchema ?? { type: "object", properties: {} }) as never,
			async execute(_toolCallId, params, signal) {
				if (!sessionActive) {
					throw new Error("The Paper session is not active. Start a Pi session, then retry.");
				}

				// Never send a tool call to an endpoint that no longer matches the
				// process configuration. Refresh first because the new endpoint may
				// expose a different catalog or map this wrapper to another MCP name.
				if (!client || clientConfiguration !== paperUrl()) {
					const reconnectResult = await attemptConnect(false);
					if (!reconnectResult.ok) {
						throw new Error(
							`Paper Desktop is not reachable at ${paperUrl()} (${reconnectResult.error}). Call paper_status to retry.`,
						);
					}
				}

				const mcpName = toolTargets.get(piName);
				if (!mcpName || !availableToolNames.has(piName)) {
					throw new Error(
						`Paper tool "${piName}" is no longer available. Call paper_status or run /paper-reconnect to refresh the catalog.`,
					);
				}

				const activeClient = client;
				if (!activeClient) {
					throw new Error(
						"Paper Desktop is not reachable. Open Paper Desktop with a file, then call paper_status and retry.",
					);
				}

				let result: any;
				try {
					result = await activeClient.callTool(
						{ name: mcpName, arguments: params as Record<string, unknown> },
						undefined,
						{ signal, timeout: CALL_TIMEOUT_MS },
					);
				} catch (error) {
					const connectionLost = !signal?.aborted && isConnectionFailure(error);
					if (connectionLost) {
						if (client === activeClient) {
							client = null;
							clientConfiguration = null;
							clientEndpoint = null;
						}
						await closeQuietly(activeClient);
					}
					throw new Error(
						signal?.aborted
							? `Paper tool "${mcpName}" was cancelled.`
							: connectionLost
								? `Paper connection failed while calling "${mcpName}": ${errorMessage(error)}. Call paper_status to reconnect.`
								: `Paper tool "${mcpName}" failed: ${errorMessage(error)}`,
					);
				}

				const content = mapToolResult(result);
				if (result?.isError) {
					const message = content
						.filter((block): block is Extract<PiContent, { type: "text" }> => block.type === "text")
						.map((block) => block.text)
						.join("\n");
					throw new Error(message || `Paper tool "${mcpName}" failed`);
				}
				return { content, details: { mcpTool: mcpName } };
			},
		});

		registeredToolNames.add(piName);
		toolDefinitionFingerprints.set(piName, fingerprint);
	}

	function applyToolCatalog(tools: McpTool[]): void {
		captureActivePaperToolPreferences();
		const nextTargets = new Map<string, string>();
		const nextAvailable = new Set<string>();

		for (const tool of tools) {
			const piName = allocatePiToolName(tool.name);
			nextTargets.set(piName, tool.name);
			nextAvailable.add(piName);
			registerPaperTool(piName, tool);
		}

		toolTargets.clear();
		for (const [piName, mcpName] of nextTargets) toolTargets.set(piName, mcpName);
		availableToolNames.clear();
		for (const name of nextAvailable) availableToolNames.add(name);
		syncActivePaperTools(availableToolNames);
	}

	async function listAllTools(activeClient: Client): Promise<McpTool[]> {
		const tools: McpTool[] = [];
		const seenCursors = new Set<string>();
		let cursor: string | undefined;

		for (let pageNumber = 1; pageNumber <= MAX_TOOL_CATALOG_PAGES; pageNumber++) {
			const page = await withTimeout(
				activeClient.listTools(cursor ? { cursor } : undefined),
				CONNECT_TIMEOUT_MS,
				`listing tools timed out on page ${pageNumber}`,
			);
			tools.push(...(page.tools as McpTool[]));

			if (!page.nextCursor) return tools;
			if (seenCursors.has(page.nextCursor)) {
				throw new Error("Paper returned a repeated tool-catalog cursor");
			}
			seenCursors.add(page.nextCursor);
			cursor = page.nextCursor;
		}

		throw new Error(`Paper tool catalog exceeded ${MAX_TOOL_CATALOG_PAGES} pages`);
	}

	function supersededConnection(): ConnectResult {
		return { ok: false, toolCount: 0, error: "connection attempt was superseded", superseded: true };
	}

	function isCurrentConnection(generation: number, configuration: string): boolean {
		return sessionActive && connectionGeneration === generation && paperUrl() === configuration;
	}

	async function openConnection(
		generation: number,
		configuration: string,
		clientsToClose: Client[],
	): Promise<ConnectResult> {
		await Promise.all(clientsToClose.map(closeQuietly));
		if (!isCurrentConnection(generation, configuration)) return supersededConnection();

		let candidate: Client | null = null;
		try {
			// Parse the captured configuration inside this try so bad input cannot
			// wedge connection cleanup or silently fall back to another endpoint.
			const endpoint = parsePaperUrl(configuration);
			candidate = new Client({ name: "pi-paper-desktop", version: "0.1.0" });
			pendingClients.add(candidate);
			const transport = new StreamableHTTPClientTransport(endpoint);

			await withTimeout(candidate.connect(transport), CONNECT_TIMEOUT_MS, "connection timed out");
			if (!isCurrentConnection(generation, configuration)) {
				await closeQuietly(candidate);
				return supersededConnection();
			}

			const tools = await listAllTools(candidate);
			if (!isCurrentConnection(generation, configuration)) {
				await closeQuietly(candidate);
				return supersededConnection();
			}

			pendingClients.delete(candidate);
			client = candidate;
			clientConfiguration = configuration;
			clientEndpoint = endpoint.href;
			applyToolCatalog(tools);
			return { ok: true, toolCount: availableToolNames.size };
		} catch (error) {
			if (candidate) {
				pendingClients.delete(candidate);
				if (client === candidate) {
					client = null;
					clientConfiguration = null;
					clientEndpoint = null;
				}
				await closeQuietly(candidate);
			}
			if (!isCurrentConnection(generation, configuration)) return supersededConnection();
			clearAvailableCatalog();
			return { ok: false, toolCount: 0, error: errorMessage(error) };
		} finally {
			if (candidate) pendingClients.delete(candidate);
		}
	}

	async function settleConnectionResult(
		generation: number,
		configuration: string,
		ownAttempt: Promise<ConnectResult>,
		initialResult: ConnectResult,
	): Promise<ConnectResult> {
		const result = isCurrentConnection(generation, configuration)
			? initialResult
			: supersededConnection();

		if (!result.superseded) {
			if (!latestSettledConnection || generation >= latestSettledConnection.generation) {
				latestSettledConnection = { generation, configuration, result };
			}
			return result;
		}

		if (!sessionActive) {
			return { ok: false, toolCount: 0, error: "session is not active" };
		}

		const currentConfiguration = paperUrl();
		if (client && clientConfiguration === currentConfiguration) {
			return { ok: true, toolCount: availableToolNames.size };
		}

		// Follow the newest in-flight attempt rather than surfacing this stale
		// attempt's cancellation as a user-visible connection failure.
		if (connecting && connecting !== ownAttempt) {
			return connectingConfiguration === currentConfiguration
				? connecting
				: attemptConnect(true);
		}

		// The replacement may already have settled and cleared `connecting`.
		if (
			latestSettledConnection &&
			latestSettledConnection.generation > generation &&
			latestSettledConnection.configuration === currentConfiguration &&
			!latestSettledConnection.result.ok
		) {
			// A failure remains accurate until another attempt starts. A cached
			// success is never enough: its client may already have disconnected.
			return latestSettledConnection.result;
		}

		// No replacement survived long enough to be observed (for example, the
		// endpoint changed away and back). Start one so a superseded result never
		// leaks as a false user-visible failure while the session is still active.
		return attemptConnect(true);
	}

	function attemptConnect(force = false): Promise<ConnectResult> {
		if (!sessionActive) {
			return Promise.resolve({ ok: false, toolCount: 0, error: "session is not active" });
		}

		const configuration = paperUrl();
		let replaceExisting = force;
		if (!force) {
			if (client && clientConfiguration === configuration) {
				return Promise.resolve({ ok: true, toolCount: availableToolNames.size });
			}
			if (connecting && connectingConfiguration === configuration) return connecting;
			replaceExisting = Boolean(client || connecting);
		}

		const clientsToClose = new Set<Client>();
		if (replaceExisting) {
			if (client) clientsToClose.add(client);
			for (const pending of pendingClients) clientsToClose.add(pending);
			client = null;
			clientConfiguration = null;
			clientEndpoint = null;
		}

		const generation = ++connectionGeneration;
		const rawAttempt = openConnection(generation, configuration, [...clientsToClose]);
		let attempt: Promise<ConnectResult>;
		attempt = rawAttempt.then((result) => settleConnectionResult(generation, configuration, attempt, result));
		connecting = attempt;
		connectingConfiguration = configuration;
		void attempt.finally(() => {
			if (connecting === attempt) {
				connecting = null;
				connectingConfiguration = null;
			}
		});
		return attempt;
	}

	async function ensureLiveConnection(): Promise<ConnectResult> {
		if (!sessionActive) {
			return { ok: false, toolCount: 0, error: "session is not active" };
		}

		const configuration = paperUrl();
		const activeClient = client;
		if (!activeClient || clientConfiguration !== configuration) return attemptConnect(false);

		try {
			await withTimeout(activeClient.ping(), CONNECT_TIMEOUT_MS, "ping timed out");
			if (paperUrl() !== configuration) return attemptConnect(false);
			if (client === activeClient && clientConfiguration === configuration) {
				return { ok: true, toolCount: availableToolNames.size };
			}
			if (client && clientConfiguration === configuration) {
				return { ok: true, toolCount: availableToolNames.size };
			}
		} catch {
			if (client === activeClient) {
				client = null;
				clientConfiguration = null;
				clientEndpoint = null;
			}
			await closeQuietly(activeClient);
			if (client && clientConfiguration === paperUrl()) {
				return { ok: true, toolCount: availableToolNames.size };
			}
		}

		// Reuse a reconnect that matches the current configuration; attemptConnect
		// supersedes one aimed at an endpoint that changed while ping was in flight.
		return attemptConnect(false);
	}

	// Always available so the LLM can diagnose and restore the connection
	// even when Paper Desktop was started after pi.
	pi.registerTool({
		name: DIAGNOSTIC_TOOL_NAME,
		label: "Paper: status",
		description:
			"Check the connection to Paper Desktop, reconnecting if needed. Use this when paper_* tools are missing or failing.",
		promptSnippet: "Check or restore the Paper Desktop connection",
		parameters: Type.Object({}),
		async execute() {
			const result = await ensureLiveConnection();
			if (result.ok) {
				return {
					content: [
						{
							type: "text",
							text: `Connected to Paper Desktop at ${clientEndpoint ?? paperUrl()}. ${result.toolCount} tools available: ${[...availableToolNames].join(", ") || "none"}.`,
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
			const result = await attemptConnect(true);
			if (!ctx.hasUI) return;
			if (result.ok) {
				ctx.ui.notify(`Paper: connected — ${result.toolCount} tools`, "info");
			} else {
				ctx.ui.notify(`Paper: connection failed (${result.error}). Is Paper Desktop open?`, "warning");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		sessionActive = true;
		clearAvailableCatalog();
		const result = await attemptConnect(true);
		if (!ctx.hasUI) return;
		if (result.ok) {
			ctx.ui.notify(`Paper: connected — ${result.toolCount} tools`, "info");
		} else {
			ctx.ui.notify("Paper Desktop not reachable — open it, then run /paper-reconnect.", "warning");
		}
	});

	pi.on("session_shutdown", async () => {
		captureActivePaperToolPreferences();
		sessionActive = false;
		connectionGeneration++;
		connecting = null;

		const clientsToClose = new Set<Client>();
		if (client) clientsToClose.add(client);
		for (const pending of pendingClients) clientsToClose.add(pending);
		client = null;
		clientConfiguration = null;
		clientEndpoint = null;
		connectingConfiguration = null;
		latestSettledConnection = null;
		pendingClients.clear();
		availableToolNames.clear();
		toolTargets.clear();

		// Keep wrapper identities, fingerprints, preferences, and name allocations:
		// Pi has no unregisterTool API. Changed definitions are replaced in place.
		await Promise.all([...clientsToClose].map(closeQuietly));
	});
}
