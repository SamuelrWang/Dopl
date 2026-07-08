/**
 * `dopl_canvas` — inspect the panels on the user's canvas.
 */

import { z } from "zod";
import type { CanvasPanel, DoplClient } from "@dopl/client";
import { type RegisterTool, type ToolResponse } from "./respond";

const DESCRIPTION = `Inspect the user's canvas — the workspace of panels (knowledge bases, skills, workflows, artifacts). Set \`op\` to:
- "list" — list every panel currently on the user's canvas. Use this when the user asks 'what's on my canvas?' or before operations that need to reason about the current workspace.`;

export function registerCanvasTools(
  register: RegisterTool,
  client: DoplClient,
): void {
  register(
    "dopl_canvas",
    DESCRIPTION,
    {
      op: z.enum(["list"]).describe("Operation to perform."),
    },
    async (): Promise<ToolResponse> => opList(client),
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
    lines.push(`- **${label}** \`${p.panel_id}\`${detail ? ` — ${detail}` : ""}`);
  }

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

function panelLabel(type: CanvasPanel["panel_type"]): string {
  switch (type) {
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
  if (panel.panel_type === "connection") {
    return "status of your connected MCP agent";
  }
  return null;
}
