"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.unlistTools = unlistTools;
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
/**
 * Keep `names` callable but out of `tools/list` — the tool set a connection did not ask for stays
 * reachable by name (DMP-013). Call before the first registration: `McpServer` installs its list
 * handler through `server.setRequestHandler` on the first `registerTool`, and this filters exactly
 * that handler, so the SDK still renders every schema it lists. `unlisted-tools.test.ts` pins the
 * install order against the SDK in use.
 */
function unlistTools(server, names) {
    if (names.size === 0)
        return;
    const protocol = server.server;
    const install = protocol.setRequestHandler.bind(protocol);
    protocol.setRequestHandler = ((schema, handler) => install(schema, (schema === types_js_1.ListToolsRequestSchema
        ? async (request, extra) => {
            const listed = await handler(request, extra);
            return { ...listed, tools: listed.tools.filter((t) => !names.has(t.name)) };
        }
        : handler)));
}
