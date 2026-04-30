/**
 * load-server-state.ts — Server-side loaders for the canvas' initial
 * state. Used by the server-rendered canvas page to fetch everything
 * the client reducer needs before the HTML is sent, eliminating the
 * client-side hydration race entirely.
 *
 * Both loaders `never throw`. Failures degrade to empty-but-valid state
 * so a transient Supabase hiccup can't block the page render.
 *
 * The API routes (/api/canvas/state, /api/conversations) also call these
 * loaders so the HTTP path and the server-render path share one source
 * of truth — same queries, same response shape, same side effects.
 */

import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { dbRowToPanel } from "./panel-dto";
import {
  dedupSingletonPanels,
  ensureDefaultPanels,
} from "./defaults";
import type {
  CanvasState,
  Cluster,
  ChatPanelData,
  Panel,
} from "@/features/canvas/types";
import { INITIAL_CANVAS_STATE } from "@/features/canvas/types";
import type { ChatMessage, ChatAttachment } from "@/features/ingestion/components/chat-message";

// ── Shared types mirrored from the client-side conversation sync ─────

interface PersistedAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
}

interface ServerMessage {
  role: "user" | "assistant";
  content: string;
  attachments?: PersistedAttachment[];
}

export interface ServerConversation {
  id: string;
  panel_id: string;
  title: string;
  messages: ServerMessage[];
  pinned: boolean;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

// ── Canvas state loader ──────────────────────────────────────────────

/**
 * Load a user's full canvas state from Supabase, apply singleton-dedup
 * and default-panel invariants, and stitch conversation messages into
 * chat panels. Return a `CanvasState` ready to seed `useReducer`.
 *
 * Guarantees:
 *   - Always returns a valid CanvasState (empty + defaults on any error).
 *   - Runs `dedupSingletonPanels` + `ensureDefaultPanels` before return
 *     so connection + browse panels are always present (single instance).
 *   - Chat panel `messages` arrays are populated from the conversations
 *     table so the reducer doesn't need a separate HYDRATE_CHAT_MESSAGES
 *     dispatch on mount.
 */
export async function loadCanvasInitialState(
  scope: { userId: string; workspaceId: string },
  conversations?: ServerConversation[]
): Promise<CanvasState> {
  const empty: CanvasState = {
    ...INITIAL_CANVAS_STATE,
    selectedPanelIds: [],
    deletedPanelsStack: [],
  };

  try {
    const supabase = supabaseAdmin();

    const [stateRes, panelsRes, publishedRes] = await Promise.all([
      supabase
        .from("canvas_state")
        .select("*")
        .eq("workspace_id", scope.workspaceId)
        .maybeSingle(),
      supabase.from("canvas_panels").select("*").eq("workspace_id", scope.workspaceId),
      // Published clusters stay user-scoped — publishing is a user-level
      // action and the gallery is global. We still filter by user so the
      // local cluster's `publishedSlug` resolves to *this* user's
      // published copy. Indexed lookup, ≪50 rows per user typically.
      supabase
        .from("published_clusters")
        .select("cluster_id, slug")
        .eq("user_id", scope.userId)
        .eq("status", "published"),
    ]);

    // 404 / first-time user → return empty state with defaults injected.
    if (stateRes.error || !stateRes.data) {
      return dedupSingletonPanels(ensureDefaultPanels(empty));
    }

    const cs = stateRes.data as {
      camera_x: number;
      camera_y: number;
      camera_zoom: number;
      next_panel_id: number;
      next_cluster_id: number;
      clusters: Cluster[] | null;
    };
    const dbPanels = panelsRes.data || [];

    // Deserialize panels, drop any row that doesn't map (shouldn't happen,
    // but guard against future schema drift).
    const panels: Panel[] = [];
    for (const row of dbPanels) {
      const panel = dbRowToPanel(row as Record<string, unknown>);
      if (panel) panels.push(panel);
    }

    // Stitch conversation messages into chat panels. Conversation data
    // lives in a separate table and is loaded in parallel; see
    // loadUserConversations below.
    if (conversations && conversations.length > 0) {
      const convByPanelId = new Map<string, ServerConversation>();
      for (const c of conversations) convByPanelId.set(c.panel_id, c);

      for (let i = 0; i < panels.length; i++) {
        const p = panels[i];
        if (p.type !== "chat") continue;
        const conv = convByPanelId.get(p.id);
        if (!conv) continue;

        const messages: ChatMessage[] = conv.messages.map((m) => {
          if (m.role === "user") {
            const msg: ChatMessage = {
              role: "user",
              type: "text" as const,
              content: m.content,
            };
            if (m.attachments && m.attachments.length > 0) {
              msg.attachments = m.attachments.map((a) => ({
                ...a,
                url: "", // filled in post-signing; see resolveAttachmentUrls
              })) as ChatAttachment[];
            }
            return msg;
          }
          return {
            role: "ai" as const,
            type: "text" as const,
            content: m.content,
          };
        });

        const nextTitle =
          conv.title && !/^(Chat\s*#\d+|New Chat)$/i.test(conv.title)
            ? conv.title
            : p.title;

        panels[i] = {
          ...p,
          title: nextTitle,
          pinned: conv.pinned,
          expiresAt: conv.expires_at,
          messages,
          conversationId: conv.id,
        } as ChatPanelData;
      }
    }

    const rawClusters: Cluster[] = Array.isArray(cs.clusters) ? cs.clusters : [];

    // Build a map of cluster_id → published slug so we can stitch it
    // onto each Cluster in one pass. Clusters without a published row
    // get publishedSlug=null (the "not published" signal).
    const publishedSlugByClusterDbId = new Map<string, string>();
    for (const row of publishedRes.data || []) {
      if (row.cluster_id && row.slug) {
        publishedSlugByClusterDbId.set(row.cluster_id, row.slug);
      }
    }
    const clusters: Cluster[] = rawClusters.map((c) => ({
      ...c,
      publishedSlug: c.dbId
        ? publishedSlugByClusterDbId.get(c.dbId) ?? null
        : null,
    }));

    const state: CanvasState = {
      ...empty,
      camera: {
        x: cs.camera_x ?? 0,
        y: cs.camera_y ?? 0,
        zoom: cs.camera_zoom ?? 1,
      },
      panels,
      clusters,
      nextPanelId: cs.next_panel_id ?? 1,
      nextClusterId: cs.next_cluster_id ?? 1,
    };

    return dedupSingletonPanels(ensureDefaultPanels(state));
  } catch {
    return dedupSingletonPanels(ensureDefaultPanels(empty));
  }
}

// ── Conversations loader ─────────────────────────────────────────────

/**
 * Load a user's conversations from Supabase. Runs the same expired-
 * unpinned cleanup side effect that the /api/conversations GET handler
 * does, then batch-signs attachment URLs in-line so the client doesn't
 * need a follow-up round trip.
 *
 * Returns an empty array on any failure.
 */
export async function loadCanvasConversations(scope: {
  userId: string;
  workspaceId: string;
}): Promise<ServerConversation[]> {
  try {
    const supabase = supabaseAdmin();

    // Clean up expired unpinned conversations + their attachments.
    // Same logic as /api/conversations GET.
    const { data: expiring } = await supabase
      .from("conversations")
      .select("id, panel_id")
      .eq("workspace_id", scope.workspaceId)
      .eq("pinned", false)
      .lt("expires_at", new Date().toISOString());

    if (expiring && expiring.length > 0) {
      const panelIds = expiring.map(
        (c: { panel_id: string }) => c.panel_id
      );
      const { data: attachments } = await supabase
        .from("chat_attachments")
        .select("storage_path")
        .eq("workspace_id", scope.workspaceId)
        .in("panel_id", panelIds);

      if (attachments && attachments.length > 0) {
        const paths = attachments.map(
          (a: { storage_path: string }) => a.storage_path
        );
        await supabase.storage.from("chat-attachments").remove(paths);
        await supabase
          .from("chat_attachments")
          .delete()
          .eq("workspace_id", scope.workspaceId)
          .in("panel_id", panelIds);
      }

      await supabase
        .from("conversations")
        .delete()
        .eq("workspace_id", scope.workspaceId)
        .eq("pinned", false)
        .lt("expires_at", new Date().toISOString());
    }

    const { data, error } = await supabase
      .from("conversations")
      .select(
        "id, panel_id, title, messages, pinned, expires_at, created_at, updated_at"
      )
      .eq("workspace_id", scope.workspaceId)
      .order("updated_at", { ascending: false });

    if (error || !data) return [];

    const conversations = data as ServerConversation[];

    // Batch-sign any attachment URLs so the client has them ready to use.
    await resolveAttachmentUrls(scope.userId, conversations);

    return conversations;
  } catch {
    return [];
  }
}

/**
 * Walk every conversation's attachments, batch-sign storage paths via
 * Supabase, and mutate the conversations in place to attach signed URLs.
 *
 * Mutation is fine because we just fetched these off a fresh response —
 * no one else holds a reference.
 */
async function resolveAttachmentUrls(
  userId: string,
  conversations: ServerConversation[]
): Promise<void> {
  const pathsToSign: string[] = [];
  for (const conv of conversations) {
    for (const m of conv.messages) {
      if (!m.attachments) continue;
      for (const a of m.attachments) {
        if (a.storagePath && a.storagePath.startsWith(`${userId}/`)) {
          pathsToSign.push(a.storagePath);
        }
      }
    }
  }

  if (pathsToSign.length === 0) return;

  try {
    const supabase = supabaseAdmin();
    const { data, error } = await supabase.storage
      .from("chat-attachments")
      .createSignedUrls(pathsToSign, 3600);

    if (error || !data) return;

    const urlByPath = new Map<string, string>();
    for (const item of data) {
      if (item.signedUrl && item.path) urlByPath.set(item.path, item.signedUrl);
    }

    // Attach signed URLs in place. The `url` field is added alongside
    // the persisted attachment metadata — the client code expects it.
    for (const conv of conversations) {
      for (const m of conv.messages) {
        if (!m.attachments) continue;
        for (const a of m.attachments as (PersistedAttachment & {
          url?: string;
        })[]) {
          const signed = urlByPath.get(a.storagePath);
          if (signed) a.url = signed;
        }
      }
    }
  } catch {
    // Silent failure — client will show placeholders for attachments.
  }
}
