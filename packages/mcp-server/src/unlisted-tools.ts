import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

/**
 * Keep `names` callable but out of `tools/list` — the tool set a connection did not ask for stays
 * reachable by name (DMP-013). Call before the first registration: `McpServer` installs its list
 * handler through `server.setRequestHandler` on the first `registerTool`, and this filters exactly
 * that handler, so the SDK still renders every schema it lists. `unlisted-tools.test.ts` pins the
 * install order against the SDK in use.
 */
export function unlistTools(server: McpServer, names: ReadonlySet<string>): void {
  if (names.size === 0) return;
  const protocol = server.server;
  const install = protocol.setRequestHandler.bind(protocol);
  type Handler = (request: unknown, extra: unknown) => Promise<{ tools: { name: string }[] }>;
  protocol.setRequestHandler = ((schema: unknown, handler: Handler) =>
    install(
      schema as never,
      (schema === ListToolsRequestSchema
        ? async (request: unknown, extra: unknown) => {
            const listed = await handler(request, extra);
            return { ...listed, tools: listed.tools.filter((t) => !names.has(t.name)) };
          }
        : handler) as never,
    )) as typeof protocol.setRequestHandler;
}
