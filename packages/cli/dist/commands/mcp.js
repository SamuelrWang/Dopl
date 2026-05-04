"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerMcpCommands = registerMcpCommands;
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const promises_1 = require("node:fs/promises");
const client_factory_js_1 = require("../lib/client-factory.js");
const global_options_js_1 = require("../lib/global-options.js");
const output_js_1 = require("../lib/output.js");
/**
 * `dopl mcp` — set up an MCP client (Claude Code, Claude Desktop) to
 * talk to Dopl. The flagship subcommand is `dopl mcp config` which
 * either prints the config block or, with `--write`, drops it into
 * the right file on disk and installs the master Dopl skill.
 *
 * Resolved against the user's stored credentials (`dopl auth login`),
 * so the printed/written block already has the API key + base URL
 * substituted — no copy-paste fiddling.
 */
function registerMcpCommands(program) {
    const mcp = program
        .command("mcp")
        .description("Configure your MCP client (Claude Code, Claude Desktop) to talk to Dopl");
    mcp
        .command("config")
        .description("Print or install the MCP server config (with API key + base URL substituted)")
        .option("--write", "Install the config + master skill into ~/.claude/ instead of printing")
        .option("--workspace <slug>", "Generate a workspace-scoped config (default: personal — all workspaces)")
        .option("--target <client>", "Target client when --write is used: claude-code (default) or claude-desktop", "claude-code")
        .addHelpText("after", [
        "",
        "Examples:",
        "  $ dopl mcp config                       # print the config block",
        "  $ dopl mcp config --write               # install for Claude Code",
        "  $ dopl mcp config --write --target=claude-desktop",
        "  $ dopl mcp config --workspace my-team   # workspace-scoped form",
        "",
        "Notes:",
        "  • Personal keys (no --workspace) work across every workspace you join.",
        "    Your agent can switch between them via `set_workspace`. Best for laptops.",
        "  • Workspace-scoped keys are locked to one workspace. Best for service",
        "    accounts / CI runners that should not see other workspaces.",
        "",
    ].join("\n"))
        .action(async (cmdOpts, cmd) => {
        const globals = (0, global_options_js_1.getGlobalOpts)(cmd);
        const creds = await (0, client_factory_js_1.resolveCredentials)(globals);
        // Resolve workspace slug → uuid by listing memberships, so the
        // emitted config has the canonical UUID (slugs are user-mutable
        // and renaming a workspace would otherwise break the config).
        let workspace = null;
        if (cmdOpts.workspace) {
            const client = await (0, client_factory_js_1.createClient)(globals);
            const { workspaces } = await client.listWorkspaces();
            const match = workspaces.find((w) => w.slug === cmdOpts.workspace || w.id === cmdOpts.workspace);
            if (!match) {
                (0, output_js_1.writeError)(`Workspace not found: \`${cmdOpts.workspace}\`. Run \`dopl workspace list\` to see what you have access to.`);
                process.exitCode = 1;
                return;
            }
            workspace = { id: match.id, slug: match.slug, name: match.name };
        }
        const block = buildMcpConfigBlock({
            apiKey: creds.apiKey,
            baseUrl: creds.baseUrl,
            workspaceId: workspace?.id,
        });
        if (cmdOpts.write) {
            const target = parseTarget(cmdOpts.target);
            if (!target) {
                (0, output_js_1.writeError)(`Unknown --target value: \`${cmdOpts.target}\`. Use 'claude-code' or 'claude-desktop'.`);
                process.exitCode = 1;
                return;
            }
            const writtenTo = await installMcpConfig(target, block);
            const skillStatus = await installMasterSkill();
            (0, output_js_1.writeError)(`✓ Wrote MCP config to ${writtenTo}`);
            if (skillStatus.copied) {
                (0, output_js_1.writeError)(`✓ Installed master Dopl skill to ${skillStatus.path}`);
            }
            else {
                (0, output_js_1.writeError)(`! Master skill not bundled with this CLI build (${skillStatus.reason}). Run \`dopl mcp config --write\` again after rebuilding from source, or grab the skill manually from packages/mcp-server/skills/dopl/SKILL.md.`);
            }
            if (workspace) {
                (0, output_js_1.writeError)(`  Scope: workspace "${workspace.name}" (slug=${workspace.slug})`);
            }
            else {
                (0, output_js_1.writeError)(`  Scope: personal — your agent can target any workspace you join (use \`set_workspace\` from inside the agent to switch).`);
            }
            if (target === "claude-code") {
                (0, output_js_1.writeError)(`\nNext: restart Claude Code (or run \`claude mcp list\`) — it picks up new servers on launch.`);
            }
            else {
                (0, output_js_1.writeError)(`\nNext: restart Claude Desktop to pick up the new server.`);
            }
            return;
        }
        // Default: print mode.
        if (globals.json) {
            (0, output_js_1.writeJson)({
                claude_code_cli: block.claudeCodeCli,
                mcp_json: block.mcpJsonShape,
                scope: workspace
                    ? { kind: "workspace", workspaceId: workspace.id, slug: workspace.slug }
                    : { kind: "personal" },
            });
            return;
        }
        (0, output_js_1.writeLine)("# Add Dopl to Claude Code (CLI):");
        (0, output_js_1.writeLine)("");
        (0, output_js_1.writeLine)(`  ${block.claudeCodeCli}`);
        (0, output_js_1.writeLine)("");
        (0, output_js_1.writeLine)("# Or paste this into ~/.claude/mcp.json (Claude Code) or your");
        (0, output_js_1.writeLine)("# Claude Desktop config:");
        (0, output_js_1.writeLine)("");
        (0, output_js_1.writeLine)(JSON.stringify(block.mcpJsonShape, null, 2));
        (0, output_js_1.writeLine)("");
        if (workspace) {
            (0, output_js_1.writeLine)(`# Scope: workspace "${workspace.name}" (slug=${workspace.slug}).`);
            (0, output_js_1.writeLine)(`# This server only sees that workspace. Best for service accounts / CI.`);
        }
        else {
            (0, output_js_1.writeLine)(`# Scope: personal. This server can target any workspace you join —`);
            (0, output_js_1.writeLine)(`# your agent uses \`set_workspace\` (or the per-call \`workspace=\` arg) to switch.`);
        }
        (0, output_js_1.writeLine)("");
        (0, output_js_1.writeLine)(`# To install automatically: rerun with --write (drops mcp.json + the master Dopl skill into ~/.claude/).`);
    });
}
function parseTarget(raw) {
    if (raw === undefined || raw === "" || raw === "claude-code")
        return "claude-code";
    if (raw === "claude-desktop")
        return "claude-desktop";
    return null;
}
function buildMcpConfigBlock(input) {
    const env = { DOPL_BASE_URL: input.baseUrl };
    if (input.workspaceId)
        env.DOPL_WORKSPACE_ID = input.workspaceId;
    const cliEnvFlags = [`-e DOPL_BASE_URL=${input.baseUrl}`];
    if (input.workspaceId)
        cliEnvFlags.push(`-e DOPL_WORKSPACE_ID=${input.workspaceId}`);
    const claudeCodeCli = `claude mcp add dopl --scope user --transport stdio ` +
        `${cliEnvFlags.join(" ")} -- npx @dopl/mcp-server --api-key ${input.apiKey}`;
    return {
        claudeCodeCli,
        mcpJsonShape: {
            mcpServers: {
                dopl: {
                    command: "npx",
                    args: ["@dopl/mcp-server", "--api-key", input.apiKey],
                    env,
                },
            },
        },
    };
}
/**
 * Resolve the on-disk config path for a given MCP target. Errors out
 * loud rather than silently picking the wrong file — wrong file =
 * confusing "I ran --write and nothing changed".
 */
function configPathFor(target) {
    const home = (0, node_os_1.homedir)();
    if (target === "claude-code") {
        return (0, node_path_1.join)(home, ".claude", "mcp.json");
    }
    // claude-desktop
    if (process.platform === "darwin") {
        return (0, node_path_1.join)(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
    }
    if (process.platform === "win32") {
        const appData = process.env.APPDATA ?? (0, node_path_1.join)(home, "AppData", "Roaming");
        return (0, node_path_1.join)(appData, "Claude", "claude_desktop_config.json");
    }
    // Linux + other Unix — Claude Desktop isn't officially supported but
    // the same XDG-ish shape is what users hand-roll.
    const xdg = process.env.XDG_CONFIG_HOME ?? (0, node_path_1.join)(home, ".config");
    return (0, node_path_1.join)(xdg, "Claude", "claude_desktop_config.json");
}
/**
 * Merge the dopl entry into the target file. Preserves any other MCP
 * servers the user already configured. Creates the file (and parent
 * dirs) if missing. Returns the absolute path written to.
 */
async function installMcpConfig(target, block) {
    const path = configPathFor(target);
    let existing = {};
    try {
        const raw = await (0, promises_1.readFile)(path, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
            existing = parsed;
        }
    }
    catch (err) {
        // ENOENT / parse error → start fresh. Anything else is unexpected
        // but non-fatal — we'd rather overwrite a corrupt file than fail.
        if (err instanceof Error &&
            "code" in err &&
            err.code !== "ENOENT") {
            (0, output_js_1.writeError)(`Warning: could not parse existing ${path} (${err.message}); replacing.`);
        }
    }
    const next = {
        ...existing,
        mcpServers: {
            ...(existing.mcpServers ?? {}),
            dopl: block.mcpJsonShape.mcpServers.dopl,
        },
    };
    await (0, promises_1.mkdir)((0, node_path_1.dirname)(path), { recursive: true });
    await (0, promises_1.writeFile)(path, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
    return path;
}
/**
 * Drop the bundled master Dopl SKILL.md into ~/.claude/skills/dopl/.
 * The skill ships in the CLI's dist (copied from
 * packages/mcp-server/skills/dopl/SKILL.md at build time, see
 * scripts/copy-master-skill.mjs). If the bundled copy is missing
 * (someone running an unusual dev setup) we report and skip rather
 * than fail the whole `--write`.
 */
async function installMasterSkill() {
    const targetPath = (0, node_path_1.join)((0, node_os_1.homedir)(), ".claude", "skills", "dopl", "SKILL.md");
    const sourcePath = bundledMasterSkillPath();
    try {
        await (0, promises_1.stat)(sourcePath);
    }
    catch {
        return {
            copied: false,
            path: targetPath,
            reason: `bundled file not found at ${sourcePath}`,
        };
    }
    const body = await (0, promises_1.readFile)(sourcePath);
    await (0, promises_1.mkdir)((0, node_path_1.dirname)(targetPath), { recursive: true });
    await (0, promises_1.writeFile)(targetPath, body);
    return { copied: true, path: targetPath };
}
/**
 * Compute the path to the bundled master skill relative to this
 * compiled module. At runtime we live in `dist/commands/mcp.js`, so
 * `../skills/dopl/SKILL.md` is the sibling artifact dropped by
 * scripts/copy-master-skill.mjs.
 *
 * The CLI compiles to CommonJS (no `"type": "module"` in package.json),
 * so we use Node's `__dirname` rather than `import.meta.url` — the
 * latter doesn't exist in CJS and would fail to compile.
 */
function bundledMasterSkillPath() {
    return (0, node_path_1.join)(__dirname, "..", "skills", "dopl", "SKILL.md");
}
