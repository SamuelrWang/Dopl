#!/usr/bin/env node
/**
 * `dopl-sdk-mcp`: the project-scoped MCP server over stdio. Reads `DOPL_API_KEY` (a secret key)
 * and optional `DOPL_BASE_URL`. Never prints the key; stdout belongs to the MCP protocol, so
 * diagnostics go to stderr.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { Dopl } from "../client.js";
import { createProjectMcpServer } from "./server.js";

async function main(): Promise<void> {
  const apiKey = process.env.DOPL_API_KEY;
  if (!apiKey) {
    process.stderr.write("dopl-sdk-mcp: set DOPL_API_KEY to a secret key (sk_test_ or sk_live_).\n");
    process.exit(1);
  }
  if (apiKey.startsWith("pk_")) {
    process.stderr.write("dopl-sdk-mcp: a publishable (pk_) key cannot deliver or run actions. Use a secret key.\n");
    process.exit(1);
  }
  const dopl = new Dopl({ apiKey, baseUrl: process.env.DOPL_BASE_URL || undefined });
  await createProjectMcpServer(dopl).connect(new StdioServerTransport());
}

main().catch((err: unknown) => {
  process.stderr.write(`dopl-sdk-mcp: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
