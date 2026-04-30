#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const os_1 = require("os");
const path_1 = require("path");
const promises_1 = require("fs/promises");
const client_1 = require("@dopl/client");
const server_js_1 = require("./server.js");
const version_js_1 = require("./version.js");
function parseArgs() {
    const args = process.argv.slice(2);
    let apiKey = process.env.DOPL_API_KEY || "";
    let baseUrl = process.env.DOPL_BASE_URL || "https://www.usedopl.com";
    let workspaceId = process.env.DOPL_WORKSPACE_ID || "";
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--api-key" && args[i + 1]) {
            apiKey = args[++i];
        }
        else if (args[i] === "--base-url" && args[i + 1]) {
            baseUrl = args[++i];
        }
        else if (args[i] === "--workspace-id" && args[i + 1]) {
            workspaceId = args[++i];
        }
        else if (args[i] === "--help" || args[i] === "-h") {
            console.error(`
Dopl MCP Server

Usage: dopl-mcp --api-key <key> [--base-url <url>] [--workspace-id <uuid>]

Options:
  --api-key <key>     Dopl API key (or set DOPL_API_KEY)
  --base-url <url>    Dopl API base URL (default: https://www.usedopl.com,
                      or set DOPL_BASE_URL)
  --workspace-id <uuid>  Active canvas (workspace) for this session. If unset,
                      falls back to ~/.config/dopl/config.json's workspaceId
                      and finally to your account's default canvas.
  --help, -h          Show this help

Claude Code config example:
  {
    "mcpServers": {
      "dopl": {
        "command": "npx",
        "args": ["@dopl/mcp-server", "--api-key", "sk-dopl-xxxxx"],
        "env": {
          "DOPL_BASE_URL": "https://your-site.vercel.app",
          "DOPL_WORKSPACE_ID": "<paste from \`dopl canvas current\`>"
        }
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
    return {
        apiKey,
        baseUrl,
        workspaceId: workspaceId.trim() || undefined,
    };
}
/**
 * Read the CLI config file (`~/.config/dopl/config.json` on Unix,
 * `%APPDATA%/dopl/config.json` on Windows) and return the stored
 * workspaceId/slug if any. Used as a fallback when no env/flag is set so
 * `dopl canvas use <slug>` works for both the CLI and any MCP server
 * launched without explicit canvas args.
 */
async function readConfigWorkspace() {
    const override = process.env.DOPL_CONFIG_PATH;
    let path;
    if (override) {
        path = override;
    }
    else if (process.platform === "win32") {
        const appData = process.env.APPDATA ?? (0, path_1.join)((0, os_1.homedir)(), "AppData", "Roaming");
        path = (0, path_1.join)(appData, "dopl", "config.json");
    }
    else {
        const xdg = process.env.XDG_CONFIG_HOME ?? (0, path_1.join)((0, os_1.homedir)(), ".config");
        path = (0, path_1.join)(xdg, "dopl", "config.json");
    }
    try {
        const raw = await (0, promises_1.readFile)(path, "utf8");
        const parsed = JSON.parse(raw);
        return {
            workspaceId: typeof parsed.workspaceId === "string" ? parsed.workspaceId : undefined,
            workspaceSlug: typeof parsed.workspaceSlug === "string" ? parsed.workspaceSlug : undefined,
        };
    }
    catch {
        return {};
    }
}
async function main() {
    const { apiKey, baseUrl, workspaceId: argWorkspaceId } = parseArgs();
    // Resolve workspaceId: explicit arg/env > config file > nothing (server
    // falls back to default canvas).
    let workspaceId = argWorkspaceId;
    let workspaceSlug;
    if (!workspaceId) {
        const fromConfig = await readConfigWorkspace();
        workspaceId = fromConfig.workspaceId;
        workspaceSlug = fromConfig.workspaceSlug;
    }
    const client = new client_1.DoplClient(baseUrl, apiKey, {
        clientIdentifier: version_js_1.clientIdentifier,
        workspaceId,
    });
    // Block on the first status ping so we know whether this caller is the
    // admin before we register tools. The ping doubles as the initial
    // liveness signal to the web app, so we can drop the prior background
    // retry. If the backend is unreachable, we default to non-admin —
    // safe-default: admin loses skeleton_ingest until restart, non-admins
    // are unaffected.
    const { is_admin } = await pingWithRetry(client);
    // Canvas handshake — confirm the requested canvas exists and the
    // caller is an active member. Failure is fatal: we'd rather refuse to
    // start than write skill files into the wrong workspace.
    const handshake = await resolveWorkspace(client, workspaceId, workspaceSlug);
    if (handshake) {
        client.setWorkspaceId(handshake.workspace.id);
        console.error(`[dopl-mcp] Active canvas: ${handshake.workspace.name} (${handshake.workspace.slug}, role=${handshake.role})`);
    }
    else {
        console.error("[dopl-mcp] Could not resolve active canvas — tools that target a canvas will return errors. Run `dopl canvas use <slug>` to select one.");
    }
    const server = (0, server_js_1.createServer)(client, {
        isAdmin: is_admin,
        workspace: handshake?.workspace ?? null,
        role: handshake?.role ?? null,
    });
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
}
async function pingWithRetry(client) {
    const delays = [1000, 2000, 4000];
    for (let attempt = 0; attempt <= delays.length; attempt++) {
        try {
            return await client.pingMcpStatus();
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (attempt === delays.length) {
                console.error(`[dopl-mcp] Initial status ping failed after ${delays.length + 1} attempts: ${msg}`);
                return { is_admin: false };
            }
            await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
        }
    }
    return { is_admin: false };
}
async function resolveWorkspace(client, workspaceId, workspaceSlug) {
    try {
        const res = await client.getActiveWorkspace();
        return res;
    }
    catch (err) {
        const detail = err instanceof client_1.DoplApiError
            ? `${err.status}: ${err.message}`
            : err instanceof Error
                ? err.message
                : String(err);
        const target = workspaceId
            ? `workspaceId=${workspaceId}`
            : workspaceSlug
                ? `workspaceSlug=${workspaceSlug}`
                : "default canvas";
        console.error(`[dopl-mcp] Canvas handshake failed (${target}): ${detail}`);
        return null;
    }
}
main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
