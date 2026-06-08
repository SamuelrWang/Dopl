#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const os_1 = require("os");
const path_1 = require("path");
const promises_1 = require("fs/promises");
const client_1 = require("@dopl/client");
const factory_js_1 = require("./factory.js");
const version_js_1 = require("./version.js");
const orphan_skill_cleanup_js_1 = require("./orphan-skill-cleanup.js");
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
    if (!workspaceId) {
        const fromConfig = await readConfigWorkspace();
        workspaceId = fromConfig.workspaceId;
    }
    const client = new client_1.DoplClient(baseUrl, apiKey, {
        clientIdentifier: version_js_1.clientIdentifier,
        workspaceId,
    });
    // Status ping (admin flag + liveness) + canvas handshake + tool
    // registration — all shared with the remote HTTP route via factory.ts.
    // A few ping retries here because the stdio server boots once and should
    // tolerate a cold backend; the HTTP route uses 0 (per-request, cached).
    const { server, userId, activeWorkspace } = await (0, factory_js_1.bootServer)(client, {
        pingRetries: 3,
        onDiag: (message) => console.error(message),
    });
    if (activeWorkspace) {
        console.error(`[dopl-mcp] Active canvas: ${activeWorkspace.name} (${activeWorkspace.slug}, role=${activeWorkspace.role})`);
    }
    else {
        console.error("[dopl-mcp] Could not resolve active canvas — tools that target a canvas will return errors. Run `dopl canvas use <slug>` to select one.");
    }
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    // Fire-and-forget cleanup of stale `~/.claude/skills/dopl-*/` dirs
    // from previous server versions or workspaces the user has left.
    // Must NOT block boot or serve — failures log and move on. Pass
    // user_id from the ping so the cleanup can scope deletions to dirs
    // it owns (Audit B7 — multi-user OS account safety).
    void (0, orphan_skill_cleanup_js_1.cleanupOrphanSkills)(client, { userId }).catch((err) => {
        console.error(`[dopl-mcp] Orphan skill cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    });
}
main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
