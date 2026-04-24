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
  ChatPanelData,
  EntryPanelData,
  ConnectionPanelData,
  ClusterBrainPanelData,
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
    entry_id: null as string | null,
    title: null as string | null,
    summary: null as string | null,
    source_url: null as string | null,
    panel_data: {} as Record<string, unknown>,
  };

  switch (panel.type) {
    case "entry":
      base.entry_id = panel.entryId;
      base.title = panel.title;
      base.summary = panel.summary;
      base.source_url = panel.sourceUrl;
      base.panel_data = {
        sourcePlatform: panel.sourcePlatform,
        sourceAuthor: panel.sourceAuthor,
        thumbnailUrl: panel.thumbnailUrl,
        useCase: panel.useCase,
        complexity: panel.complexity,
        contentType: panel.contentType,
        tags: panel.tags,
        readme: panel.readme,
        agentsMd: panel.agentsMd,
        manifest: panel.manifest,
        createdAt: panel.createdAt,
      };
      break;
    case "chat":
      base.title = panel.title;
      base.panel_data = {
        conversationId: panel.conversationId,
        pinned: panel.pinned,
        expiresAt: panel.expiresAt,
      };
      break;
    case "connection":
      base.panel_data = { apiKey: panel.apiKey };
      break;
    case "cluster-brain":
      base.panel_data = {
        clusterId: panel.clusterId,
        clusterName: panel.clusterName,
        instructions: panel.instructions,
        memories: panel.memories,
        status: panel.status,
        errorMessage: panel.errorMessage,
      };
      break;
    case "browse":
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
    case "entry":
      return {
        ...base,
        type: "entry",
        entryId: (row.entry_id as string) || "",
        title: (row.title as string) || "Untitled",
        summary: (row.summary as string) || null,
        sourceUrl: (row.source_url as string) || "",
        sourcePlatform: (data.sourcePlatform as string) || null,
        sourceAuthor: (data.sourceAuthor as string) || null,
        thumbnailUrl: (data.thumbnailUrl as string) || null,
        useCase: (data.useCase as string) || null,
        complexity: (data.complexity as string) || null,
        contentType: (data.contentType as string) || null,
        tags: (data.tags as Array<{ type: string; value: string }>) || [],
        readme: (data.readme as string) || "",
        agentsMd: (data.agentsMd as string) || "",
        manifest: (data.manifest as Record<string, unknown>) || {},
        createdAt: (data.createdAt as string) || new Date().toISOString(),
      } as EntryPanelData;
    case "chat":
      return {
        ...base,
        type: "chat",
        title: (row.title as string) || "New Chat",
        messages: [],
        isProcessing: false,
        activeEntryId: null,
        conversationId: (data.conversationId as string) || undefined,
        pinned: (data.pinned as boolean) || false,
        expiresAt: (data.expiresAt as string) || undefined,
      } as ChatPanelData;
    case "connection":
      return {
        ...base,
        type: "connection",
        apiKey: (data.apiKey as string) || null,
      } as ConnectionPanelData;
    case "browse":
      return { ...base, type: "browse" };
    case "cluster-brain":
      return {
        ...base,
        type: "cluster-brain",
        clusterId: (data.clusterId as string) || "",
        clusterName: (data.clusterName as string) || "",
        instructions: (data.instructions as string) || "",
        memories: (data.memories as string[]) || [],
        status: (data.status as "generating" | "ready" | "error") || "ready",
        errorMessage: (data.errorMessage as string) || null,
      } as ClusterBrainPanelData;
    default:
      return null;
  }
}
