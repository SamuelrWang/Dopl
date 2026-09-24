import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
/**
 * Keep `names` callable but out of `tools/list` — the tool set a connection did not ask for stays
 * reachable by name (DMP-013). Call before the first registration: `McpServer` installs its list
 * handler through `server.setRequestHandler` on the first `registerTool`, and this filters exactly
 * that handler, so the SDK still renders every schema it lists. `unlisted-tools.test.ts` pins the
 * install order against the SDK in use.
 */
export declare function unlistTools(server: McpServer, names: ReadonlySet<string>): void;
