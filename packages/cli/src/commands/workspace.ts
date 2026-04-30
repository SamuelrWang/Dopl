import { Command } from "commander";
import { DoplClient } from "@dopl/client";

import {
  configFilePath,
  readConfig,
  writeConfig,
  type DoplConfig,
} from "../lib/config.js";
import { createClient, resolveCredentials } from "../lib/client-factory.js";
import { getGlobalOpts } from "../lib/global-options.js";
import { writeError, writeJson, writeLine } from "../lib/output.js";

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
export function registerWorkspaceCommands(program: Command): void {
  const workspace = program
    .command("workspace")
    .description("Choose which workspace the CLI and MCP target");

  workspace
    .command("list")
    .description("List your workspaces")
    .action(async (_cmdOpts: unknown, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      const client = await createClient(globals);
      const { workspaces } = await client.listWorkspaces();
      const active = await readActiveSelection();

      if (globals.json) {
        writeJson({ workspaces, active });
        return;
      }

      if (workspaces.length === 0) {
        writeLine("No workspaces yet. Create one in the web app.");
        return;
      }

      for (const w of workspaces) {
        const isActive =
          (active.workspaceId && active.workspaceId === w.id) ||
          (!active.workspaceId && active.fallback && w.slug === "default");
        const marker = isActive ? "*" : " ";
        writeLine(`${marker} ${w.slug.padEnd(28)} ${w.name}`);
      }
      writeLine("");
      writeLine(
        "Switch with `dopl workspace use <slug>`. The active workspace is marked *."
      );
    });

  workspace
    .command("current")
    .description("Show which workspace the CLI is currently targeting")
    .action(async (_cmdOpts: unknown, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      const active = await readActiveSelection();

      if (!active.workspaceId && !active.fallback) {
        writeLine("No active workspace configured.");
        writeLine("Run `dopl workspace use <slug>` to set one.");
        return;
      }

      // Round-trip through the API so the user sees the *server's* truth
      // (membership still active, slug still valid). Falls back to local
      // values on network error.
      try {
        const client = await createClient(globals);
        const resolved = await client.getActiveWorkspace();
        if (globals.json) {
          writeJson({
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
        writeLine(`Workspace: ${resolved.workspace.name}`);
        writeLine(`Slug:      ${resolved.workspace.slug}`);
        writeLine(`Role:      ${resolved.role}`);
        writeLine(`Source:    ${active.source}`);
      } catch (err) {
        writeError(
          `Could not reach Dopl to confirm active workspace: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
        if (active.workspaceSlug)
          writeLine(`Last known slug: ${active.workspaceSlug}`);
        process.exitCode = 3;
      }
    });

  workspace
    .command("use <slug>")
    .description("Set the active workspace by slug")
    .action(async (slug: string, _cmdOpts: unknown, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      const trimmed = slug.trim();
      if (!trimmed) {
        writeError("Slug is required.");
        process.exitCode = 1;
        return;
      }

      // Resolve slug → workspace via the API so we store a real UUID and
      // surface "no such workspace" / "not a member" errors immediately.
      const { apiKey, baseUrl } = await resolveCredentials(globals);
      const probe = new DoplClient(baseUrl, apiKey, {
        toolHeaderName: "X-Dopl-Cli",
      });
      let resolved;
      try {
        const res = await probe.getWorkspace(trimmed);
        resolved = res.workspace;
      } catch (err) {
        writeError(
          `Could not select workspace "${trimmed}": ${
            err instanceof Error ? err.message : String(err)
          }`
        );
        process.exitCode = 1;
        return;
      }

      const existing = await readConfig();
      const next: DoplConfig = {
        ...existing,
        workspaceId: resolved.id,
        workspaceSlug: resolved.slug,
      };
      await writeConfig(next);
      writeError(
        `Active workspace set to "${resolved.name}" (${resolved.slug}). Saved to ${configFilePath()}.`
      );
    });

  workspace
    .command("clear")
    .description("Unset the active workspace (fall back to your default)")
    .action(async () => {
      const existing = await readConfig();
      if (!existing.workspaceId && !existing.workspaceSlug) {
        writeError("No active workspace was set.");
        return;
      }
      const next: DoplConfig = { ...existing };
      delete next.workspaceId;
      delete next.workspaceSlug;
      await writeConfig(next);
      writeError(
        "Cleared active workspace. The server will use your default workspace."
      );
    });
}

interface ActiveSelection {
  workspaceId?: string;
  workspaceSlug?: string;
  source: "flag" | "env" | "config" | "default";
  fallback: boolean;
}

async function readActiveSelection(): Promise<ActiveSelection> {
  const cfg = await readConfig();
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
