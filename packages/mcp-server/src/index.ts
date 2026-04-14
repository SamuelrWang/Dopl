#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SIEClient } from "./api-client.js";
import { createServer } from "./server.js";

function parseArgs(): { apiKey: string; baseUrl: string } {
  const args = process.argv.slice(2);
  let apiKey = process.env.SIE_API_KEY || "";
  let baseUrl = process.env.SIE_BASE_URL || "http://localhost:3000";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--api-key" && args[i + 1]) {
      apiKey = args[++i];
    } else if (args[i] === "--base-url" && args[i + 1]) {
      baseUrl = args[++i];
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.error(`
Setup Intelligence Engine MCP Server

Usage: dopl-mcp --api-key <key> [--base-url <url>]

Options:
  --api-key <key>    SIE API key (or set SIE_API_KEY env var)
  --base-url <url>   SIE API base URL (default: http://localhost:3000, or set SIE_BASE_URL)
  --help, -h         Show this help

Claude Code config example:
  {
    "mcpServers": {
      "setup-intelligence": {
        "command": "npx",
        "args": ["@dopl/mcp-server", "--api-key", "sk-sie-xxxxx"],
        "env": { "SIE_BASE_URL": "https://your-site.vercel.app" }
      }
    }
  }
`);
      process.exit(0);
    }
  }

  if (!apiKey) {
    console.error(
      "Error: API key is required. Use --api-key <key> or set SIE_API_KEY env var."
    );
    console.error("Run with --help for usage information.");
    process.exit(1);
  }

  return { apiKey, baseUrl };
}

async function main() {
  const { apiKey, baseUrl } = parseArgs();
  const client = new SIEClient(baseUrl, apiKey);
  const server = createServer(client);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Signal to the web app that an MCP connection is live (best-effort).
  client.pingMcpStatus().catch(() => {});
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
