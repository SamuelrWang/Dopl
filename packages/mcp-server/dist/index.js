#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const api_client_js_1 = require("./api-client.js");
const server_js_1 = require("./server.js");
function parseArgs() {
    const args = process.argv.slice(2);
    let apiKey = process.env.SIE_API_KEY || "";
    let baseUrl = process.env.SIE_BASE_URL || "http://localhost:3000";
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--api-key" && args[i + 1]) {
            apiKey = args[++i];
        }
        else if (args[i] === "--base-url" && args[i + 1]) {
            baseUrl = args[++i];
        }
        else if (args[i] === "--help" || args[i] === "-h") {
            console.error(`
Setup Intelligence Engine MCP Server

Usage: sie-mcp --api-key <key> [--base-url <url>]

Options:
  --api-key <key>    SIE API key (or set SIE_API_KEY env var)
  --base-url <url>   SIE API base URL (default: http://localhost:3000, or set SIE_BASE_URL)
  --help, -h         Show this help

Claude Code config example:
  {
    "mcpServers": {
      "setup-intelligence": {
        "command": "npx",
        "args": ["@sie/mcp-server", "--api-key", "sk-sie-xxxxx"],
        "env": { "SIE_BASE_URL": "https://your-site.vercel.app" }
      }
    }
  }
`);
            process.exit(0);
        }
    }
    if (!apiKey) {
        console.error("Error: API key is required. Use --api-key <key> or set SIE_API_KEY env var.");
        console.error("Run with --help for usage information.");
        process.exit(1);
    }
    return { apiKey, baseUrl };
}
async function main() {
    const { apiKey, baseUrl } = parseArgs();
    const client = new api_client_js_1.SIEClient(baseUrl, apiKey);
    const server = (0, server_js_1.createServer)(client);
    // Register cluster prompts (Phase 3) — best-effort, don't block startup
    (0, server_js_1.registerClusterPrompts)(server, client).catch(() => { });
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    // Start polling for cluster changes (Phase 4)
    (0, server_js_1.startPromptSync)(server, client, 30_000);
}
main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
