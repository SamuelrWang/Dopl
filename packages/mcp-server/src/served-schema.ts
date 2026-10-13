import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

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
export function slimSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(slimSchema);
  if (node === null || typeof node !== "object") return node;
  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(src)) {
    if (key === "pattern" && src.format === "uuid") continue;
    if (key === "maximum" && value === Number.MAX_SAFE_INTEGER) continue;
    if (key === "minimum" && value === Number.MIN_SAFE_INTEGER) continue;
    out[key] = slimSchema(value);
  }
  return out;
}

/**
 * The root `"$schema": "http://json-schema.org/draft-07/schema#"` the converter stamps on every tool
 * (~52 chars × 40). Absent, MCP reads 2020-12; nothing listed differs between the two dialects (no
 * `$ref`, `definitions` or tuple `items`), which `served-schema.test.ts` asserts on the shipped surface.
 */
function withoutDialect(schema: unknown): unknown {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) return schema;
  const rest = { ...(schema as Record<string, unknown>) };
  delete rest.$schema;
  return rest;
}

/**
 * Serve every listed tool's `inputSchema` through {@link slimSchema} and {@link withoutDialect}. Call before the first
 * registration, like `unlisted-tools.ts › unlistTools`: `McpServer` installs its list handler through
 * `server.setRequestHandler` on the first `registerTool`, and this wraps exactly that handler.
 * Pinned in `served-schema.test.ts`.
 */
export function slimListedSchemas(server: McpServer): void {
  const protocol = server.server;
  const install = protocol.setRequestHandler.bind(protocol);
  type Listed = { tools: { inputSchema?: unknown }[] };
  type Handler = (request: unknown, extra: unknown) => Promise<Listed>;
  protocol.setRequestHandler = ((schema: unknown, handler: Handler) =>
    install(
      schema as never,
      (schema === ListToolsRequestSchema
        ? async (request: unknown, extra: unknown) => {
            const listed = await handler(request, extra);
            return {
              ...listed,
              tools: listed.tools.map((t) =>
                t.inputSchema === undefined ? t : { ...t, inputSchema: withoutDialect(slimSchema(t.inputSchema)) },
              ),
            };
          }
        : handler) as never,
    )) as typeof protocol.setRequestHandler;
}
