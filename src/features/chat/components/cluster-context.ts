/**
 * Canvas context builder for the chat panel.
 *
 * Scope rules (see `serializePanel` for the gate):
 *   - cluster scope → sibling chat panels' messages ARE included so a
 *     cluster behaves like a shared workspace. Entry panels included too.
 *   - canvas scope (panel not in a cluster) → sibling chat panels are
 *     EXCLUDED. Each standalone chat is its own session. Entry panels are
 *     still included — they're knowledge artifacts the AI can reference.
 *
 * When a chat panel lives inside a cluster, every message sent to
 * /api/chat includes snapshots of sibling panels in the same cluster
 * so Claude has them as loaded context:
 *   - Entry panels: title, summary, readme, agentsMd
 *   - Chat panels: title + last N messages (role + content) — cluster only
 *   - Connection / browse panels: excluded (not knowledge content)
 */

import type { CanvasState, Panel } from "@/features/canvas/types";

// ── Constants ────────────────────────────────────────────────────────

import { CONTEXT_CHAR_BUDGET_PER_FIELD } from "@/config";

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
;

export interface CanvasContextPayload {
  scope: "cluster" | "canvas";
  clusterName?: string;
  /** Slug of the enclosing cluster, when scope is "cluster" AND the
   * cluster has been synced to the DB. Required server-side for the
   * brain-editing tools to enforce scope (cluster-scoped chat can only
   * edit its own cluster's brain). */
  clusterSlug?: string;
  panels: ContextPanelDTO[];
}

// ── Serializers ──────────────────────────────────────────────────────

function serializePanel(
  panel: Panel,
  selfId: string,
  scope: "cluster" | "canvas"
): ContextPanelDTO | null {
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
      // Isolation rule: standalone (canvas-scope) chats don't see each
      // other's messages — each is its own session. Cluster-scope chats
      // still share so a cluster acts as a shared workspace.
      if (scope === "canvas") return null;

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

    // Connection, browse panels are not knowledge content.
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
  const scope: "cluster" | "canvas" = cluster ? "cluster" : "canvas";

  const candidatePanels = cluster
    ? state.panels.filter((p) => new Set(cluster.panelIds).has(p.id))
    : state.panels;

  const panels: ContextPanelDTO[] = [];
  let totalChars = 0;

  for (const p of candidatePanels) {
    const dto = serializePanel(p, panelId, scope);
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
      clusterSlug: cluster.slug,
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
