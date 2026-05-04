import { Command } from "commander";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";

import { createClient, resolveCredentials } from "../lib/client-factory.js";
import { getGlobalOpts } from "../lib/global-options.js";
import { writeError, writeJson, writeLine } from "../lib/output.js";

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
export function registerMcpCommands(program: Command): void {
  const mcp = program
    .command("mcp")
    .description(
      "Configure your MCP client (Claude Code, Claude Desktop) to talk to Dopl"
    );

  mcp
    .command("config")
    .description(
      "Print or install the MCP server config (with API key + base URL substituted)"
    )
    .option(
      "--write",
      "Install the config + master skill into ~/.claude/ instead of printing"
    )
    .option(
      "--workspace <slug>",
      "Generate a workspace-scoped config (default: personal — all workspaces)"
    )
    .option(
      "--target <client>",
      "Target client when --write is used: claude-code (default) or claude-desktop",
      "claude-code"
    )
    .addHelpText(
      "after",
      [
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
      ].join("\n")
    )
    .action(async (cmdOpts: ConfigOpts, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      const creds = await resolveCredentials(globals);

      // Resolve workspace slug → uuid by listing memberships, so the
      // emitted config has the canonical UUID (slugs are user-mutable
      // and renaming a workspace would otherwise break the config).
      let workspace: { id: string; slug: string; name: string } | null = null;
      if (cmdOpts.workspace) {
        const client = await createClient(globals);
        const { workspaces } = await client.listWorkspaces();
        const match = workspaces.find(
          (w) => w.slug === cmdOpts.workspace || w.id === cmdOpts.workspace
        );
        if (!match) {
          writeError(
            `Workspace not found: \`${cmdOpts.workspace}\`. Run \`dopl workspace list\` to see what you have access to.`
          );
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
          writeError(
            `Unknown --target value: \`${cmdOpts.target}\`. Use 'claude-code' or 'claude-desktop'.`
          );
          process.exitCode = 1;
          return;
        }
        const writtenTo = await installMcpConfig(target, block);
        const skillStatus = await installMasterSkill();
        writeError(`✓ Wrote MCP config to ${writtenTo}`);
        if (skillStatus.copied) {
          writeError(`✓ Installed master Dopl skill to ${skillStatus.path}`);
        } else {
          writeError(
            `! Master skill not bundled with this CLI build (${skillStatus.reason}). Run \`dopl mcp config --write\` again after rebuilding from source, or grab the skill manually from packages/mcp-server/skills/dopl/SKILL.md.`
          );
        }
        if (workspace) {
          writeError(`  Scope: workspace "${workspace.name}" (slug=${workspace.slug})`);
        } else {
          writeError(
            `  Scope: personal — your agent can target any workspace you join (use \`set_workspace\` from inside the agent to switch).`
          );
        }
        if (target === "claude-code") {
          writeError(
            `\nNext: restart Claude Code (or run \`claude mcp list\`) — it picks up new servers on launch.`
          );
        } else {
          writeError(`\nNext: restart Claude Desktop to pick up the new server.`);
        }
        return;
      }

      // Default: print mode.
      if (globals.json) {
        writeJson({
          claude_code_cli: block.claudeCodeCli,
          mcp_json: block.mcpJsonShape,
          scope: workspace
            ? { kind: "workspace", workspaceId: workspace.id, slug: workspace.slug }
            : { kind: "personal" },
        });
        return;
      }

      writeLine("# Add Dopl to Claude Code (CLI):");
      writeLine("");
      writeLine(`  ${block.claudeCodeCli}`);
      writeLine("");
      writeLine("# Or paste this into ~/.claude/mcp.json (Claude Code) or your");
      writeLine("# Claude Desktop config:");
      writeLine("");
      writeLine(JSON.stringify(block.mcpJsonShape, null, 2));
      writeLine("");
      if (workspace) {
        writeLine(
          `# Scope: workspace "${workspace.name}" (slug=${workspace.slug}).`
        );
        writeLine(
          `# This server only sees that workspace. Best for service accounts / CI.`
        );
      } else {
        writeLine(
          `# Scope: personal. This server can target any workspace you join —`
        );
        writeLine(
          `# your agent uses \`set_workspace\` (or the per-call \`workspace=\` arg) to switch.`
        );
      }
      writeLine("");
      writeLine(
        `# To install automatically: rerun with --write (drops mcp.json + the master Dopl skill into ~/.claude/).`
      );
    });
}

interface ConfigOpts {
  write?: boolean;
  workspace?: string;
  target?: string;
}

type Target = "claude-code" | "claude-desktop";

function parseTarget(raw: string | undefined): Target | null {
  if (raw === undefined || raw === "" || raw === "claude-code") return "claude-code";
  if (raw === "claude-desktop") return "claude-desktop";
  return null;
}

interface McpConfigBlock {
  /** The single CLI command to add Dopl to Claude Code. */
  claudeCodeCli: string;
  /**
   * The `mcpServers.dopl` shape that goes into `~/.claude/mcp.json` or
   * Claude Desktop's `claude_desktop_config.json`. Always wrapped under
   * `mcpServers.dopl` so callers can paste it as a top-level snippet
   * or merge into an existing file.
   */
  mcpJsonShape: { mcpServers: { dopl: McpServerEntry } };
}

interface McpServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

function buildMcpConfigBlock(input: {
  apiKey: string;
  baseUrl: string;
  workspaceId?: string;
}): McpConfigBlock {
  const env: Record<string, string> = { DOPL_BASE_URL: input.baseUrl };
  if (input.workspaceId) env.DOPL_WORKSPACE_ID = input.workspaceId;

  const cliEnvFlags = [`-e DOPL_BASE_URL=${input.baseUrl}`];
  if (input.workspaceId) cliEnvFlags.push(`-e DOPL_WORKSPACE_ID=${input.workspaceId}`);
  const claudeCodeCli =
    `claude mcp add dopl --scope user --transport stdio ` +
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
function configPathFor(target: Target): string {
  const home = homedir();
  if (target === "claude-code") {
    return join(home, ".claude", "mcp.json");
  }
  // claude-desktop
  if (process.platform === "darwin") {
    return join(
      home,
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json"
    );
  }
  if (process.platform === "win32") {
    const appData =
      process.env.APPDATA ?? join(home, "AppData", "Roaming");
    return join(appData, "Claude", "claude_desktop_config.json");
  }
  // Linux + other Unix — Claude Desktop isn't officially supported but
  // the same XDG-ish shape is what users hand-roll.
  const xdg = process.env.XDG_CONFIG_HOME ?? join(home, ".config");
  return join(xdg, "Claude", "claude_desktop_config.json");
}

/**
 * Merge the dopl entry into the target file. Preserves any other MCP
 * servers the user already configured. Creates the file (and parent
 * dirs) if missing. Returns the absolute path written to.
 */
async function installMcpConfig(
  target: Target,
  block: McpConfigBlock
): Promise<string> {
  const path = configPathFor(target);
  let existing: { mcpServers?: Record<string, McpServerEntry> } = {};
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      existing = parsed as { mcpServers?: Record<string, McpServerEntry> };
    }
  } catch (err) {
    // ENOENT / parse error → start fresh. Anything else is unexpected
    // but non-fatal — we'd rather overwrite a corrupt file than fail.
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code !== "ENOENT"
    ) {
      writeError(
        `Warning: could not parse existing ${path} (${err.message}); replacing.`
      );
    }
  }
  const next = {
    ...existing,
    mcpServers: {
      ...(existing.mcpServers ?? {}),
      dopl: block.mcpJsonShape.mcpServers.dopl,
    },
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  return path;
}

interface SkillInstallResult {
  copied: boolean;
  path: string;
  reason?: string;
}

/**
 * Drop the bundled master Dopl SKILL.md into ~/.claude/skills/dopl/.
 * The skill ships in the CLI's dist (copied from
 * packages/mcp-server/skills/dopl/SKILL.md at build time, see
 * scripts/copy-master-skill.mjs). If the bundled copy is missing
 * (someone running an unusual dev setup) we report and skip rather
 * than fail the whole `--write`.
 */
async function installMasterSkill(): Promise<SkillInstallResult> {
  const targetPath = join(homedir(), ".claude", "skills", "dopl", "SKILL.md");
  const sourcePath = bundledMasterSkillPath();
  try {
    await stat(sourcePath);
  } catch {
    return {
      copied: false,
      path: targetPath,
      reason: `bundled file not found at ${sourcePath}`,
    };
  }
  const body = await readFile(sourcePath);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, body);
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
function bundledMasterSkillPath(): string {
  return join(__dirname, "..", "skills", "dopl", "SKILL.md");
}
