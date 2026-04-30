"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerWorkspaceCommands = registerWorkspaceCommands;
const client_1 = require("@dopl/client");
const config_js_1 = require("../lib/config.js");
const client_factory_js_1 = require("../lib/client-factory.js");
const global_options_js_1 = require("../lib/global-options.js");
const output_js_1 = require("../lib/output.js");
/**
 * `dopl workspace` — manage which workspace the CLI (and any MCP server
 * launched without an explicit `DOPL_WORKSPACE_ID`) is scoped to.
 *
 * Subcommands:
 *   list      — list every workspace the current user is an active member of
 *   current   — show the active workspace (from config, env, or default)
 *   use <slug>— set the active workspace (writes config)
 *   clear     — unset; the server will fall back to the user's default
 */
function registerWorkspaceCommands(program) {
    const workspace = program
        .command("workspace")
        .description("Choose which workspace the CLI and MCP target");
    workspace
        .command("list")
        .description("List your workspaces")
        .action(async (_cmdOpts, cmd) => {
        const globals = (0, global_options_js_1.getGlobalOpts)(cmd);
        const client = await (0, client_factory_js_1.createClient)(globals);
        const { workspaces } = await client.listWorkspaces();
        const active = await readActiveSelection();
        if (globals.json) {
            (0, output_js_1.writeJson)({ workspaces, active });
            return;
        }
        if (workspaces.length === 0) {
            (0, output_js_1.writeLine)("No workspaces yet. Create one in the web app.");
            return;
        }
        for (const w of workspaces) {
            const isActive = (active.workspaceId && active.workspaceId === w.id) ||
                (!active.workspaceId && active.fallback && w.slug === "default");
            const marker = isActive ? "*" : " ";
            (0, output_js_1.writeLine)(`${marker} ${w.slug.padEnd(28)} ${w.name}`);
        }
        (0, output_js_1.writeLine)("");
        (0, output_js_1.writeLine)("Switch with `dopl workspace use <slug>`. The active workspace is marked *.");
    });
    workspace
        .command("current")
        .description("Show which workspace the CLI is currently targeting")
        .action(async (_cmdOpts, cmd) => {
        const globals = (0, global_options_js_1.getGlobalOpts)(cmd);
        const active = await readActiveSelection();
        if (!active.workspaceId && !active.fallback) {
            (0, output_js_1.writeLine)("No active workspace configured.");
            (0, output_js_1.writeLine)("Run `dopl workspace use <slug>` to set one.");
            return;
        }
        // Round-trip through the API so the user sees the *server's* truth
        // (membership still active, slug still valid). Falls back to local
        // values on network error.
        try {
            const client = await (0, client_factory_js_1.createClient)(globals);
            const resolved = await client.getActiveWorkspace();
            if (globals.json) {
                (0, output_js_1.writeJson)({
                    active: {
                        workspaceId: resolved.workspace.id,
                        workspaceSlug: resolved.workspace.slug,
                    },
                    workspace: resolved.workspace,
                    role: resolved.role,
                    source: active.source,
                });
                return;
            }
            (0, output_js_1.writeLine)(`Workspace: ${resolved.workspace.name}`);
            (0, output_js_1.writeLine)(`Slug:      ${resolved.workspace.slug}`);
            (0, output_js_1.writeLine)(`Role:      ${resolved.role}`);
            (0, output_js_1.writeLine)(`Source:    ${active.source}`);
        }
        catch (err) {
            (0, output_js_1.writeError)(`Could not reach Dopl to confirm active workspace: ${err instanceof Error ? err.message : String(err)}`);
            if (active.workspaceSlug)
                (0, output_js_1.writeLine)(`Last known slug: ${active.workspaceSlug}`);
            process.exitCode = 3;
        }
    });
    workspace
        .command("use <slug>")
        .description("Set the active workspace by slug")
        .action(async (slug, _cmdOpts, cmd) => {
        const globals = (0, global_options_js_1.getGlobalOpts)(cmd);
        const trimmed = slug.trim();
        if (!trimmed) {
            (0, output_js_1.writeError)("Slug is required.");
            process.exitCode = 1;
            return;
        }
        // Resolve slug → workspace via the API so we store a real UUID and
        // surface "no such workspace" / "not a member" errors immediately.
        const { apiKey, baseUrl } = await (0, client_factory_js_1.resolveCredentials)(globals);
        const probe = new client_1.DoplClient(baseUrl, apiKey, {
            toolHeaderName: "X-Dopl-Cli",
        });
        let resolved;
        try {
            const res = await probe.getWorkspace(trimmed);
            resolved = res.workspace;
        }
        catch (err) {
            (0, output_js_1.writeError)(`Could not select workspace "${trimmed}": ${err instanceof Error ? err.message : String(err)}`);
            process.exitCode = 1;
            return;
        }
        const existing = await (0, config_js_1.readConfig)();
        const next = {
            ...existing,
            workspaceId: resolved.id,
            workspaceSlug: resolved.slug,
        };
        await (0, config_js_1.writeConfig)(next);
        (0, output_js_1.writeError)(`Active workspace set to "${resolved.name}" (${resolved.slug}). Saved to ${(0, config_js_1.configFilePath)()}.`);
    });
    workspace
        .command("clear")
        .description("Unset the active workspace (fall back to your default)")
        .action(async () => {
        const existing = await (0, config_js_1.readConfig)();
        if (!existing.workspaceId && !existing.workspaceSlug) {
            (0, output_js_1.writeError)("No active workspace was set.");
            return;
        }
        const next = { ...existing };
        delete next.workspaceId;
        delete next.workspaceSlug;
        await (0, config_js_1.writeConfig)(next);
        (0, output_js_1.writeError)("Cleared active workspace. The server will use your default workspace.");
    });
}
async function readActiveSelection() {
    const cfg = await (0, config_js_1.readConfig)();
    const fromEnv = process.env.DOPL_WORKSPACE_ID?.trim();
    if (fromEnv) {
        return {
            workspaceId: fromEnv,
            source: "env",
            fallback: false,
        };
    }
    if (cfg.workspaceId) {
        return {
            workspaceId: cfg.workspaceId,
            workspaceSlug: cfg.workspaceSlug,
            source: "config",
            fallback: false,
        };
    }
    return { source: "default", fallback: true };
}
