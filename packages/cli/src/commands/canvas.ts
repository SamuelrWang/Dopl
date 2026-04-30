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
 * `dopl canvas` — manage which workspace the CLI (and any MCP server
 * launched without an explicit `DOPL_CANVAS_ID`) is scoped to.
 *
 * Subcommands:
 *   list      — list every canvas the current user is an active member of
 *   current   — show the active canvas (from config, env, or default)
 *   use <slug>— set the active canvas (writes config)
 *   clear     — unset; the server will fall back to the user's default
 */
export function registerCanvasCommands(program: Command): void {
  const canvas = program
    .command("canvas")
    .description("Choose which canvas (workspace) the CLI and MCP target");

  canvas
    .command("list")
    .description("List your canvases")
    .action(async (_cmdOpts: unknown, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      const client = await createClient(globals);
      const { canvases } = await client.listCanvases();
      const active = await readActiveSelection();

      if (globals.json) {
        writeJson({ canvases, active });
        return;
      }

      if (canvases.length === 0) {
        writeLine("No canvases yet. Create one in the web app at /canvases.");
        return;
      }

      for (const c of canvases) {
        const isActive =
          (active.canvasId && active.canvasId === c.id) ||
          (!active.canvasId && active.fallback && c.slug === "default");
        const marker = isActive ? "*" : " ";
        writeLine(`${marker} ${c.slug.padEnd(28)} ${c.name}`);
      }
      writeLine("");
      writeLine(
        "Switch with `dopl canvas use <slug>`. The active canvas is marked *."
      );
    });

  canvas
    .command("current")
    .description("Show which canvas the CLI is currently targeting")
    .action(async (_cmdOpts: unknown, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      const active = await readActiveSelection();

      if (!active.canvasId && !active.fallback) {
        writeLine("No active canvas configured.");
        writeLine("Run `dopl canvas use <slug>` to set one.");
        return;
      }

      // Round-trip through the API so the user sees the *server's* truth
      // (membership still active, slug still valid). Falls back to local
      // values on network error.
      try {
        const client = await createClient(globals);
        const resolved = await client.getActiveCanvas();
        if (globals.json) {
          writeJson({
            active: { canvasId: resolved.canvas.id, canvasSlug: resolved.canvas.slug },
            canvas: resolved.canvas,
            role: resolved.role,
            source: active.source,
          });
          return;
        }
        writeLine(`Canvas: ${resolved.canvas.name}`);
        writeLine(`Slug:   ${resolved.canvas.slug}`);
        writeLine(`Role:   ${resolved.role}`);
        writeLine(`Source: ${active.source}`);
      } catch (err) {
        writeError(
          `Could not reach Dopl to confirm active canvas: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
        if (active.canvasSlug) writeLine(`Last known slug: ${active.canvasSlug}`);
        process.exitCode = 3;
      }
    });

  canvas
    .command("use <slug>")
    .description("Set the active canvas by slug")
    .action(async (slug: string, _cmdOpts: unknown, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      const trimmed = slug.trim();
      if (!trimmed) {
        writeError("Slug is required.");
        process.exitCode = 1;
        return;
      }

      // Resolve slug → canvas via the API so we store a real UUID and
      // surface "no such canvas" / "not a member" errors immediately.
      const { apiKey, baseUrl } = await resolveCredentials(globals);
      const probe = new DoplClient(baseUrl, apiKey, {
        toolHeaderName: "X-Dopl-Cli",
      });
      let canvas;
      try {
        const res = await probe.getCanvas(trimmed);
        canvas = res.canvas;
      } catch (err) {
        writeError(
          `Could not select canvas "${trimmed}": ${
            err instanceof Error ? err.message : String(err)
          }`
        );
        process.exitCode = 1;
        return;
      }

      const existing = await readConfig();
      const next: DoplConfig = {
        ...existing,
        canvasId: canvas.id,
        canvasSlug: canvas.slug,
      };
      await writeConfig(next);
      writeError(
        `Active canvas set to "${canvas.name}" (${canvas.slug}). Saved to ${configFilePath()}.`
      );
    });

  canvas
    .command("clear")
    .description("Unset the active canvas (fall back to your default)")
    .action(async () => {
      const existing = await readConfig();
      if (!existing.canvasId && !existing.canvasSlug) {
        writeError("No active canvas was set.");
        return;
      }
      const next: DoplConfig = { ...existing };
      delete next.canvasId;
      delete next.canvasSlug;
      await writeConfig(next);
      writeError(
        "Cleared active canvas. The server will use your default canvas."
      );
    });
}

interface ActiveSelection {
  canvasId?: string;
  canvasSlug?: string;
  source: "flag" | "env" | "config" | "default";
  fallback: boolean;
}

async function readActiveSelection(): Promise<ActiveSelection> {
  const cfg = await readConfig();
  const fromEnv = process.env.DOPL_CANVAS_ID?.trim();
  if (fromEnv) {
    return {
      canvasId: fromEnv,
      source: "env",
      fallback: false,
    };
  }
  if (cfg.canvasId) {
    return {
      canvasId: cfg.canvasId,
      canvasSlug: cfg.canvasSlug,
      source: "config",
      fallback: false,
    };
  }
  return { source: "default", fallback: true };
}
