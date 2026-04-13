/**
 * Canvas context builder for the chat panel.
 *
 * When a chat panel lives inside a cluster, every message sent to
 * /api/chat includes snapshots of ALL sibling panels in the same
 * cluster so Claude has them as loaded context:
 *   - Entry panels: title, summary, readme, agentsMd
 *   - Chat panels: title + last N messages (role + content)
 *   - Ingestion panels: url + status
 *   - Connection / browse panels: excluded (not knowledge content)
 *
 * Returns null when the chat panel is not inside a cluster. When it IS
 * in a cluster but has no serializable siblings, returns a payload with
 * an empty panels array so the API knows the chat is cluster-scoped.
 */

import type { CanvasState, Panel } from "../../types";

// ── Constants ────────────────────────────────────────────────────────

/** Max chars per readme / agentsMd field in an entry panel context. */
const CONTEXT_CHAR_BUDGET_PER_FIELD = 2000;

/** Max total chars across all serialized panels in one context payload. */
const TOTAL_CONTEXT_CHAR_BUDGET = 30_000;

/** Max text messages to include from a sibling chat panel. */
const MAX_CHAT_MESSAGES = 10;

/** Max total chars for a sibling chat's message transcript. */
const CHAT_TRANSCRIPT_CHAR_BUDGET = 2000;

// ── Types (shared with the API route via the wire format) ────────────

export type ContextPanelDTO =
  | {
      kind: "entry";
      entryId: string;
      title: string;
      summary: string | null;
      readme: string;
      agentsMd: string;
    }
  | {
      kind: "chat";
      panelId: string;
      title: string;
      messages: Array<{ role: string; content: string }>;
    }
  | {
      kind: "ingestion";
      panelId: string;
      url: string;
      status: string;
    };

export interface CanvasContextPayload {
  scope: "cluster" | "canvas";
  clusterName?: string;
  panels: ContextPanelDTO[];
}

// ── Serializers ──────────────────────────────────────────────────────

function serializePanel(panel: Panel, selfId: string): ContextPanelDTO | null {
  if (panel.id === selfId) return null;

  switch (panel.type) {
    case "entry":
      return {
        kind: "entry",
        entryId: panel.entryId,
        title: panel.title,
        summary: panel.summary,
        readme: (panel.readme || "").slice(0, CONTEXT_CHAR_BUDGET_PER_FIELD),
        agentsMd: (panel.agentsMd || "").slice(0, CONTEXT_CHAR_BUDGET_PER_FIELD),
      };

    case "chat": {
      // Extract last N text messages (user + finalized AI text only).
      const textMessages: Array<{ role: string; content: string }> = [];
      for (const m of panel.messages) {
        if (
          (m.role === "user" && m.type === "text") ||
          (m.role === "ai" && m.type === "text")
        ) {
          textMessages.push({
            role: m.role === "ai" ? "assistant" : "user",
            content: m.content,
          });
        }
      }
      // Take the last N and truncate the total transcript.
      const recent = textMessages.slice(-MAX_CHAT_MESSAGES);
      let charCount = 0;
      const truncated: Array<{ role: string; content: string }> = [];
      for (const msg of recent) {
        if (charCount + msg.content.length > CHAT_TRANSCRIPT_CHAR_BUDGET) {
          // Include a truncated version of this message if we have room.
          const remaining = CHAT_TRANSCRIPT_CHAR_BUDGET - charCount;
          if (remaining > 50) {
            truncated.push({ role: msg.role, content: msg.content.slice(0, remaining) + "..." });
          }
          break;
        }
        truncated.push(msg);
        charCount += msg.content.length;
      }
      return {
        kind: "chat",
        panelId: panel.id,
        title: panel.title,
        messages: truncated,
      };
    }

    case "ingestion":
      return {
        kind: "ingestion",
        panelId: panel.id,
        url: panel.url,
        status: panel.status,
      };

    // Connection and browse panels are not knowledge content.
    case "connection":
    case "browse":
      return null;

    default:
      return null;
  }
}

function estimateDTOChars(dto: ContextPanelDTO): number {
  switch (dto.kind) {
    case "entry":
      return (
        (dto.title?.length || 0) +
        (dto.summary?.length || 0) +
        dto.readme.length +
        dto.agentsMd.length +
        50 // overhead for labels
      );
    case "chat":
      return (
        (dto.title?.length || 0) +
        dto.messages.reduce((n, m) => n + m.content.length + 15, 0) +
        30
      );
    case "ingestion":
      return dto.url.length + dto.status.length + 30;
  }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Build the context payload for a chat panel.
 *
 * - If the panel lives inside a cluster → scope "cluster", include only
 *   sibling panels in that cluster (existing behavior).
 * - If the panel is NOT in a cluster → scope "canvas", include ALL
 *   panels on the canvas so the AI has full awareness of the workspace.
 */
export function buildCanvasContext(
  panelId: string,
  state: CanvasState
): CanvasContextPayload {
  const cluster = state.clusters.find((c) => c.panelIds.includes(panelId));

  const candidatePanels = cluster
    ? state.panels.filter((p) => new Set(cluster.panelIds).has(p.id))
    : state.panels;

  const panels: ContextPanelDTO[] = [];
  let totalChars = 0;

  for (const p of candidatePanels) {
    const dto = serializePanel(p, panelId);
    if (!dto) continue;

    const chars = estimateDTOChars(dto);
    if (totalChars + chars > TOTAL_CONTEXT_CHAR_BUDGET) break;

    panels.push(dto);
    totalChars += chars;
  }

  if (cluster) {
    return {
      scope: "cluster",
      clusterName: cluster.name,
      panels,
    };
  }

  return {
    scope: "canvas",
    panels,
  };
}

/** Used by the chat panel header to display a small "in cluster: X" badge. */
export function findEnclosingClusterName(
  panelId: string,
  state: CanvasState
): string | null {
  const cluster = state.clusters.find((c) => c.panelIds.includes(panelId));
  return cluster?.name ?? null;
}
