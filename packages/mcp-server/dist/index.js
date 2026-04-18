#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const api_client_js_1 = require("./api-client.js");
const server_js_1 = require("./server.js");
function parseArgs() {
    const args = process.argv.slice(2);
    let apiKey = process.env.DOPL_API_KEY || "";
    let baseUrl = process.env.DOPL_BASE_URL || "https://www.usedopl.com";
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--api-key" && args[i + 1]) {
            apiKey = args[++i];
        }
        else if (args[i] === "--base-url" && args[i + 1]) {
            baseUrl = args[++i];
        }
        else if (args[i] === "--help" || args[i] === "-h") {
            console.error(`
Dopl MCP Server

Usage: dopl-mcp --api-key <key> [--base-url <url>]

Options:
  --api-key <key>    Dopl API key (or set DOPL_API_KEY env var)
  --base-url <url>   Dopl API base URL (default: https://www.usedopl.com, or set DOPL_BASE_URL)
  --help, -h         Show this help

Claude Code config example:
  {
    "mcpServers": {
      "dopl": {
        "command": "npx",
        "args": ["@dopl/mcp-server", "--api-key", "sk-dopl-xxxxx"],
        "env": { "DOPL_BASE_URL": "https://your-site.vercel.app" }
      }
    }
  }
`);
            process.exit(0);
        }
    }
    if (!apiKey) {
        console.error("Error: API key is required. Use --api-key <key> or set DOPL_API_KEY env var.");
        console.error("Run with --help for usage information.");
        process.exit(1);
    }
    return { apiKey, baseUrl };
}
async function main() {
    const { apiKey, baseUrl } = parseArgs();
    const client = new api_client_js_1.DoplClient(baseUrl, apiKey);
    const server = (0, server_js_1.createServer)(client);
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    // Signal to the web app that an MCP connection is live. Retries with
    // exponential backoff (1s / 2s / 4s) so a transient network blip
    // doesn't leave the user staring at "Waiting for connection…" forever.
    // Runs in the background — never blocks MCP tool handling.
    void pingWithRetry(client);
}
async function pingWithRetry(client) {
    const delays = [1000, 2000, 4000];
    for (let attempt = 0; attempt <= delays.length; attempt++) {
        try {
            await client.pingMcpStatus();
            return;
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (attempt === delays.length) {
                // Final failure — surface it so users and logs can see it.
                // Subsequent tool calls will still refresh the connection timestamp
                // server-side, so this is not catastrophic.
                console.error(`[dopl-mcp] Initial status ping failed after ${delays.length + 1} attempts: ${msg}`);
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
        }
    }
}
main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
