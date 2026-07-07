/**
 * panel-dto.ts — Shared serialization helpers between a Panel (the
 * client-side reducer shape) and the `canvas_panels` DB row shape.
 *
 * Extracted from use-canvas-db-sync.ts so the server-side canvas state
 * loader (src/features/canvas/server/load-server-state.ts) and the client-side sync
 * hook can share one source of truth. This file is safe to import from
 * both server and client code — it has no React dependencies and does
 * no DB I/O.
 */

import type {
  Panel,
  ArtifactPanelData,
  WorkflowPanelData,
  NodePanelData,
  NodeRef,
  ConnectionPanelData,
  KnowledgeBasePanelData,
  KnowledgePanelData,
  SkillPanelData,
  SkillsPanelData,
} from "@/features/canvas/types";

/** Serialize a panel into the shape the `canvas_panels` DB row expects. */
export function panelToDbRow(panel: Panel) {
  const base = {
    panel_id: panel.id,
    panel_type: panel.type,
    x: panel.x,
    y: panel.y,
    width: panel.width,
    height: panel.height,
    title: null as string | null,
    summary: null as string | null,
    source_url: null as string | null,
    panel_data: {} as Record<string, unknown>,
  };

  switch (panel.type) {
    case "connection":
      break;
    case "knowledge":
      break;
    case "skills":
      break;
    case "knowledge-base":
      base.title = panel.name;
      base.panel_data = {
        knowledgeBaseId: panel.knowledgeBaseId,
        slug: panel.slug,
        description: panel.description,
        agentWriteEnabled: panel.agentWriteEnabled,
      };
      break;
    case "skill":
      base.title = panel.name;
      base.panel_data = {
        skillId: panel.skillId,
        slug: panel.slug,
        description: panel.description,
        status: panel.status,
      };
      break;
    case "artifact":
      base.title = panel.title;
      base.panel_data = {
        markdown: panel.markdown,
      };
      break;
    case "workflow":
      base.panel_data = {
        workflowId: panel.workflowId,
        name: panel.name,
        description: panel.description ?? "",
      };
      break;
    case "node":
      base.title = panel.title;
      base.panel_data = {
        description: panel.description,
        reads: panel.reads,
        actions: panel.actions,
        userInput: panel.userInput,
        agentOutput: panel.agentOutput,
        nextInstructions: panel.nextInstructions,
        // Preserve the agent authoring handle so the client's write-through
        // doesn't wipe it (set_graph matches nodes by ref).
        ...(panel.ref ? { ref: panel.ref } : null),
      };
      break;
  }

  return base;
}

/** Deserialize a `canvas_panels` DB row back into a client-side Panel. */
export function dbRowToPanel(row: Record<string, unknown>): Panel | null {
  const base = {
    id: row.panel_id as string,
    x: (row.x as number) ?? 0,
    y: (row.y as number) ?? 0,
    width: (row.width as number) ?? 480,
    height: (row.height as number) ?? 600,
  };
  const data = (row.panel_data as Record<string, unknown>) || {};
  const type = row.panel_type as string;

  switch (type) {
    case "connection":
      return { ...base, type: "connection" } as ConnectionPanelData;
    case "knowledge":
      return { ...base, type: "knowledge" } as KnowledgePanelData;
    case "skills":
      return { ...base, type: "skills" } as SkillsPanelData;
    case "knowledge-base":
      return {
        ...base,
        type: "knowledge-base",
        knowledgeBaseId: (data.knowledgeBaseId as string) || "",
        slug: (data.slug as string) || "",
        name: (row.title as string) || "Untitled",
        description: (data.description as string) || null,
        agentWriteEnabled: (data.agentWriteEnabled as boolean) || false,
      } as KnowledgeBasePanelData;
    case "skill":
      return {
        ...base,
        type: "skill",
        skillId: (data.skillId as string) || "",
        slug: (data.slug as string) || "",
        name: (row.title as string) || "Untitled",
        description: (data.description as string) || "",
        status: (data.status as "active" | "draft") || "draft",
      } as SkillPanelData;
    case "artifact":
      return {
        ...base,
        type: "artifact",
        title: (row.title as string) || "Untitled artifact",
        markdown: (data.markdown as string) || "",
      } as ArtifactPanelData;
    case "workflow":
      return {
        ...base,
        type: "workflow",
        workflowId: (data.workflowId as string) || "",
        name: (data.name as string) || "",
        description: (data.description as string) || null,
      } as WorkflowPanelData;
    case "node":
      return {
        ...base,
        type: "node",
        title: (row.title as string) || "",
        description: (data.description as string) || "",
        reads: Array.isArray(data.reads) ? (data.reads as NodeRef[]) : [],
        actions: Array.isArray(data.actions)
          ? (data.actions as NodeRef[])
          : [],
        userInput: (data.userInput as string) || "",
        agentOutput: (data.agentOutput as string) || "",
        nextInstructions: (data.nextInstructions as string) || "",
        ...(typeof data.ref === "string" ? { ref: data.ref } : null),
      } as NodePanelData;
    default:
      return null;
  }
}
