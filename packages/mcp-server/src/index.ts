#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DoplClient } from "@dopl/client";
import { createServer } from "./server.js";
import { clientIdentifier } from "./version.js";

function parseArgs(): { apiKey: string; baseUrl: string } {
  const args = process.argv.slice(2);
  let apiKey = process.env.DOPL_API_KEY || "";
  let baseUrl = process.env.DOPL_BASE_URL || "https://www.usedopl.com";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--api-key" && args[i + 1]) {
      apiKey = args[++i];
    } else if (args[i] === "--base-url" && args[i + 1]) {
      baseUrl = args[++i];
    } else if (args[i] === "--help" || args[i] === "-h") {
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
    console.error(
      "Error: API key is required. Use --api-key <key> or set DOPL_API_KEY env var."
    );
    console.error("Run with --help for usage information.");
    process.exit(1);
  }

  return { apiKey, baseUrl };
}

async function main() {
  const { apiKey, baseUrl } = parseArgs();
  const client = new DoplClient(baseUrl, apiKey, { clientIdentifier });

  // Block on the first status ping so we know whether this caller is the
  // admin before we register tools. The ping doubles as the initial
  // liveness signal to the web app, so we can drop the prior background
  // retry. If the backend is unreachable, we default to non-admin —
  // safe-default: admin loses skeleton_ingest until restart, non-admins
  // are unaffected.
  const { is_admin } = await pingWithRetry(client);

  const server = createServer(client, { isAdmin: is_admin });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function pingWithRetry(
  client: DoplClient,
): Promise<{ is_admin: boolean }> {
  const delays = [1000, 2000, 4000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await client.pingMcpStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt === delays.length) {
        // Final failure — surface it so users and logs can see it.
        // Subsequent tool calls will still refresh the connection timestamp
        // server-side, so this is not catastrophic.
        console.error(
          `[dopl-mcp] Initial status ping failed after ${delays.length + 1} attempts: ${msg}`
        );
        return { is_admin: false };
      }
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
  return { is_admin: false };
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
