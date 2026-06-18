/**
 * `dopl_canvas` — inspect and rename panels on the user's canvas.
 */

import { z } from "zod";
import type { CanvasPanel, DoplClient } from "@dopl/client";
import { err, ok, missingParams, type RegisterTool, type ToolResponse } from "./respond";

const DESCRIPTION = `Manage the user's canvas — the workspace of panels (chat, knowledge bases, skills, artifacts). Set \`op\` to one of:
- "list" — list every panel currently on the user's canvas. Use this when the user asks 'what's on my canvas?' or before operations that need to reason about the current workspace.
- "rename_chat" — rename a chat panel on the user's canvas. Use when the user asks to rename a chat, or when the auto-derived title no longer captures the conversation's topic.`;

export function registerCanvasTools(
  register: RegisterTool,
  client: DoplClient,
): void {
  register(
    "dopl_canvas",
    DESCRIPTION,
    {
      op: z
        .enum(["list", "rename_chat"])
        .describe("Operation to perform."),
      panel_id: z
        .string()
        .optional()
        .describe("op=rename_chat: chat panel ID (e.g. 'panel-3')."),
      title: z
        .string()
        .optional()
        .describe("op=rename_chat: new chat title."),
    },
    async (args): Promise<ToolResponse> => {
      switch (args.op) {
        case "list":
          return opList(client);
        case "rename_chat": {
          const miss = missingParams("rename_chat", args, ["panel_id", "title"]);
          if (miss) return miss;
          return opRenameChat(client, args.panel_id as string, args.title as string);
        }
      }
    },
  );
}

async function opList(client: DoplClient): Promise<ToolResponse> {
  const panels = await client.listCanvasPanels();

  if (panels.length === 0) {
    return {
      content: [{ type: "text" as const, text: "Your canvas is empty." }],
    };
  }

  const lines: string[] = [];
  lines.push(`## Your Canvas — ${panels.length} panel${panels.length === 1 ? "" : "s"}\n`);
  for (const p of panels) {
    const label = panelLabel(p.panel_type);
    const detail = panelDetail(p);
    lines.push(`- **${label}**${detail ? ` — ${detail}` : ""}`);
  }

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

async function opRenameChat(
  client: DoplClient,
  panel_id: string,
  title: string,
): Promise<ToolResponse> {
  // The backend PATCH /api/canvas/panels/{id} is generic — it will set the
  // `title` of ANY panel and reports success even when no panel matched.
  // rename_chat is documented as chat-only, so guard here: confirm the panel
  // exists AND is a chat before writing, otherwise we'd silently corrupt a
  // node/workflow/KB panel's title or return a false success for a typo'd id.
  const panels = await client.listCanvasPanels();
  const panel = panels.find((p) => p.panel_id === panel_id);
  if (!panel) {
    return err(
      `No panel with id \`${panel_id}\` on the canvas — nothing renamed. Call dopl_canvas(op="list") to see what's there.`,
    );
  }
  if (panel.panel_type !== "chat") {
    return err(
      `Panel \`${panel_id}\` is a ${panel.panel_type} panel, not a chat. rename_chat only renames chat panels.`,
    );
  }
  await client.renameChat(panel_id, title);
  return ok(`Renamed chat \`${panel_id}\` to "${title}".`);
}

function panelLabel(type: CanvasPanel["panel_type"]): string {
  switch (type) {
    case "chat": return "Chat panel";
    case "connection": return "MCP connection panel";
    case "knowledge": return "Knowledge bases panel";
    case "skills": return "Skills panel";
    case "knowledge-base": return "Knowledge base panel";
    case "skill": return "Skill panel";
    case "artifact": return "Artifact panel";
    default: return "Panel";
  }
}

function panelDetail(panel: CanvasPanel): string | null {
  if (panel.title) return panel.title;
  switch (panel.panel_type) {
    case "connection": return "status of your connected MCP agent";
    case "chat": return "an in-canvas chat thread";
    default: return null;
  }
}
