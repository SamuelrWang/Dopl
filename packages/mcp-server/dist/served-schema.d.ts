import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
/**
 * Converter artifacts the SDK's zod → JSON Schema step adds to every listed schema, which no agent
 * acts on and every connection pays for (Context Economy W1, 2026-10-12):
 *   • `pattern` beside `format: "uuid"` — zod's `.uuid()` emits a ~166-char regex that only
 *     restates the format. The handler's zod schema still validates the id; only the listing loses it.
 *   • `maximum: Number.MAX_SAFE_INTEGER` / `minimum: Number.MIN_SAFE_INTEGER` — zod's `.int()` bound,
 *     not a product limit.
 * Validation is untouched: the SDK parses arguments against the registered zod schema, never this copy.
 * {@link slimListedSchemas} also drops the root `$schema` (see there).
 */
export declare function slimSchema(node: unknown): unknown;
/**
 * Serve every listed tool's `inputSchema` through {@link slimSchema} and {@link withoutDialect}. Call before the first
 * registration, like `unlisted-tools.ts › unlistTools`: `McpServer` installs its list handler through
 * `server.setRequestHandler` on the first `registerTool`, and this wraps exactly that handler.
 * Pinned in `served-schema.test.ts`.
 */
export declare function slimListedSchemas(server: McpServer): void;
