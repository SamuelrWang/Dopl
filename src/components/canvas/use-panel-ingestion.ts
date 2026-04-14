"use client";

/**
 * usePanelIngestion(panel) — manages the SSE ingestion lifecycle for one
 * ChatPanel. Returns a `startIngestion(url)` callback.
 *
 * On mount, if the panel has an `activeEntryId` and its last progress event
 * isn't terminal, the SSE is reopened. The server-side ingestionProgress
 * subscriber buffers events, so the panel catches up automatically after
 * a page reload.
 *
 * On unmount, any open EventSource is closed.
 *
 * Also exports a plain `startPanelIngestion()` function for use by the
 * FixedInputBar (which spawns a new panel and immediately starts ingestion
 * before the new panel's hook has mounted).
 */

import { useCallback, useEffect, useRef } from "react";
import type { Dispatch } from "react";
import { useCanvas } from "./canvas-store";
import type { CanvasAction, ChatPanelData } from "./types";
import type {
  ChatMessage,
  ProgressEvent,
} from "@/components/ingest/chat-message";

interface IngestStartResponse {
  entry_id: string;
  status: string;
  stream_url?: string;
  error?: string;
  message?: string;
}

interface EntryFetchResponse {
  id: string;
  title?: string | null;
  summary?: string | null;
  source_url?: string;
  source_platform?: string | null;
  source_author?: string | null;
  thumbnail_url?: string | null;
  use_case?: string | null;
  complexity?: string | null;
  readme?: string | null;
  agents_md?: string | null;
  manifest?: Record<string, unknown> | null;
  tags?: Array<{ tag_type: string; tag_value: string }>;
}

/**
 * Convert a raw /api/entries/{id} response into the payload shape that
 * both ADD_ARTIFACTS and SPAWN_ENTRY_PANEL actions expect. Centralizes
 * the null-handling and tag mapping so the SSE handlers in both the
 * hook and the standalone function stay in sync.
 */
function buildEntryActionPayload(
  entry: EntryFetchResponse,
  panelId: string,
  entryId: string
) {
  return {
    panelId,
    entryId,
    title: entry.title || "Untitled Setup",
    summary: entry.summary ?? null,
    sourceUrl: entry.source_url ?? "",
    sourcePlatform: entry.source_platform ?? null,
    sourceAuthor: entry.source_author ?? null,
    thumbnailUrl: entry.thumbnail_url ?? null,
    useCase: entry.use_case ?? null,
    complexity: entry.complexity ?? null,
    tags: (entry.tags ?? []).map((t) => ({
      type: t.tag_type,
      value: t.tag_value,
    })),
    readme: entry.readme || "",
    agentsMd: entry.agents_md || "",
    manifest: entry.manifest || {},
  };
}

export function usePanelIngestion(panel: ChatPanelData) {
  const { dispatch } = useCanvas();
  const eventSourceRef = useRef<EventSource | null>(null);

  // Subscribe to an existing entry's stream — used both for new sends and
  // for re-attaching after a page reload.
  const subscribeToStream = useCallback(
    (entryId: string) => {
      // Close any existing connection first
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      const es = new EventSource(`/api/ingest/${entryId}/stream`);
      eventSourceRef.current = es;

      es.onmessage = (e) => {
        try {
          const data: ProgressEvent = JSON.parse(e.data);
          dispatch({
            type: "UPDATE_PROGRESS",
            panelId: panel.id,
            entryId,
            event: data,
          });

          if (data.type === "complete") {
            es.close();
            eventSourceRef.current = null;
            // Fetch the generated artifacts and append them as a message.
            // Also auto-spawn an EntryPanel next to this chat panel.
            fetch(`/api/entries/${entryId}`)
              .then((r) => (r.ok ? r.json() : null))
              .then((entry: EntryFetchResponse | null) => {
                if (!entry) return;
                const payload = buildEntryActionPayload(
                  entry,
                  panel.id,
                  entryId
                );
                // 1. Inline artifacts card in the chat (conversation log)
                dispatch({
                  type: "ADD_ARTIFACTS",
                  panelId: payload.panelId,
                  entryId: payload.entryId,
                  title: payload.title,
                  readme: payload.readme,
                  agentsMd: payload.agentsMd,
                  manifest: payload.manifest,
                });
                // 2. Floating EntryPanel next to the chat panel
                dispatch({
                  type: "SPAWN_ENTRY_PANEL",
                  sourcePanelId: payload.panelId,
                  entryId: payload.entryId,
                  title: payload.title,
                  summary: payload.summary,
                  sourceUrl: payload.sourceUrl,
                  sourcePlatform: payload.sourcePlatform,
                  sourceAuthor: payload.sourceAuthor,
                  thumbnailUrl: payload.thumbnailUrl,
                  useCase: payload.useCase,
                  complexity: payload.complexity,
                  tags: payload.tags,
                  readme: payload.readme,
                  agentsMd: payload.agentsMd,
                  manifest: payload.manifest,
                });
              })
              .catch(() => {
                // Ignore — user can still view via the entry page
              })
              .finally(() => {
                dispatch({
                  type: "SET_PROCESSING",
                  panelId: panel.id,
                  isProcessing: false,
                  activeEntryId: null,
                });
              });
          }

          if (data.type === "error") {
            es.close();
            eventSourceRef.current = null;
            const errorMsg: ChatMessage = {
              role: "ai",
              type: "text",
              content: `Something went wrong: ${data.message}`,
            };
            dispatch({
              type: "APPEND_MESSAGE",
              panelId: panel.id,
              message: errorMsg,
            });
            dispatch({
              type: "SET_PROCESSING",
              panelId: panel.id,
              isProcessing: false,
              activeEntryId: null,
            });
          }
        } catch {
          // Skip malformed SSE messages (keepalive comments etc.)
        }
      };

      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) {
          eventSourceRef.current = null;
        }
      };
    },
    [dispatch, panel.id]
  );

  /** Send a URL to ingest. Adds a user message, POSTs to /api/ingest, opens SSE. */
  const startIngestion = useCallback(
    async (url: string) => {
      const trimmed = url.trim();
      if (!trimmed) return;

      // Validate URL format
      try {
        new URL(trimmed);
      } catch {
        dispatch({
          type: "APPEND_MESSAGE",
          panelId: panel.id,
          message: {
            role: "ai",
            type: "text",
            content:
              "That doesn't look like a valid URL. Please paste a full link starting with https://",
          },
        });
        return;
      }

      // 1. User message
      dispatch({
        type: "APPEND_MESSAGE",
        panelId: panel.id,
        message: { role: "user", type: "text", content: trimmed },
      });

      try {
        const response = await fetch("/api/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: trimmed,
            content: {},
          }),
        });

        const data: IngestStartResponse = await response.json();
        if (!response.ok) {
          throw new Error(data.message || data.error || "Ingestion failed");
        }

        // If already ingested, skip SSE — fetch and spawn immediately
        if (data.status === "already_exists") {
          dispatch({
            type: "APPEND_MESSAGE",
            panelId: panel.id,
            message: {
              role: "ai",
              type: "text",
              content: "Already ingested — loading it now.",
            },
          });
          const entry: EntryFetchResponse | null = await fetch(
            `/api/entries/${data.entry_id}`
          ).then((r) => (r.ok ? r.json() : null));
          if (entry) {
            const payload = buildEntryActionPayload(
              entry,
              panel.id,
              data.entry_id
            );
            dispatch({
              type: "ADD_ARTIFACTS",
              panelId: payload.panelId,
              entryId: payload.entryId,
              title: payload.title,
              readme: payload.readme,
              agentsMd: payload.agentsMd,
              manifest: payload.manifest,
            });
            dispatch({
              type: "SPAWN_ENTRY_PANEL",
              sourcePanelId: payload.panelId,
              entryId: payload.entryId,
              title: payload.title,
              summary: payload.summary,
              sourceUrl: payload.sourceUrl,
              sourcePlatform: payload.sourcePlatform,
              sourceAuthor: payload.sourceAuthor,
              thumbnailUrl: payload.thumbnailUrl,
              useCase: payload.useCase,
              complexity: payload.complexity,
              tags: payload.tags,
              readme: payload.readme,
              agentsMd: payload.agentsMd,
              manifest: payload.manifest,
            });
          }
          return;
        }

        // 2. Add empty progress message tied to the new entry id
        const progressMessage: ChatMessage = {
          role: "ai",
          type: "progress",
          entryId: data.entry_id,
          events: [],
          status: "streaming",
        };
        dispatch({
          type: "APPEND_MESSAGE",
          panelId: panel.id,
          message: progressMessage,
        });

        // 3. Mark panel as processing
        dispatch({
          type: "SET_PROCESSING",
          panelId: panel.id,
          isProcessing: true,
          activeEntryId: data.entry_id,
        });

        // 4. Open SSE for live updates
        subscribeToStream(data.entry_id);
      } catch (err) {
        dispatch({
          type: "APPEND_MESSAGE",
          panelId: panel.id,
          message: {
            role: "ai",
            type: "text",
            content: `Failed to start ingestion: ${err instanceof Error ? err.message : "Unknown error"}`,
          },
        });
        dispatch({
          type: "SET_PROCESSING",
          panelId: panel.id,
          isProcessing: false,
          activeEntryId: null,
        });
      }
    },
    [dispatch, panel.id, subscribeToStream]
  );

  // On mount: if the panel was processing when we last persisted state,
  // re-attach to its SSE stream so progress continues to flow in.
  // The server-side event buffer will replay any missed events.
  useEffect(() => {
    if (panel.activeEntryId && panel.isProcessing) {
      // Check the last progress message — if it's already terminal, don't reopen
      const lastProgress = [...panel.messages]
        .reverse()
        .find(
          (m) =>
            m.role === "ai" &&
            m.type === "progress" &&
            m.entryId === panel.activeEntryId
        );
      if (lastProgress && lastProgress.type === "progress") {
        if (lastProgress.status === "streaming") {
          subscribeToStream(panel.activeEntryId);
        }
      }
    }
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
    // We intentionally only run this once per panel mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { startIngestion };
}

// ── Standalone (no hook) — used by FixedInputBar ───────────────────

/**
 * Plain-function version of startIngestion. Same behavior, but takes
 * `dispatch` and `panelId` explicitly. Used by the FixedInputBar which
 * creates a new panel and kicks off ingestion before that panel's
 * `usePanelIngestion` hook has had a chance to mount.
 *
 * Note: this version manages its own ad-hoc EventSource that survives
 * until the panel is reloaded (when the per-panel hook will reopen via
 * SSE replay if needed).
 */
export async function startPanelIngestion(
  dispatch: Dispatch<CanvasAction>,
  panelId: string,
  url: string
): Promise<void> {
  const trimmed = url.trim();
  if (!trimmed) return;

  // Validate URL
  try {
    new URL(trimmed);
  } catch {
    dispatch({
      type: "APPEND_MESSAGE",
      panelId,
      message: {
        role: "ai",
        type: "text",
        content:
          "That doesn't look like a valid URL. Please paste a full link starting with https://",
      },
    });
    return;
  }

  // 1. User message
  dispatch({
    type: "APPEND_MESSAGE",
    panelId,
    message: { role: "user", type: "text", content: trimmed },
  });

  try {
    const response = await fetch("/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: trimmed, content: {} }),
    });

    const data = (await response.json()) as {
      entry_id: string;
      status?: string;
      error?: string;
      message?: string;
    };
    if (!response.ok) {
      throw new Error(data.message || data.error || "Ingestion failed");
    }

    // If already ingested, skip SSE — fetch and spawn immediately
    if (data.status === "already_exists") {
      dispatch({
        type: "APPEND_MESSAGE",
        panelId,
        message: {
          role: "ai",
          type: "text",
          content: "Already ingested — loading it now.",
        },
      });
      const entry: EntryFetchResponse | null = await fetch(
        `/api/entries/${data.entry_id}`
      ).then((r) => (r.ok ? r.json() : null));
      if (entry) {
        const payload = buildEntryActionPayload(entry, panelId, data.entry_id);
        dispatch({
          type: "ADD_ARTIFACTS",
          panelId: payload.panelId,
          entryId: payload.entryId,
          title: payload.title,
          readme: payload.readme,
          agentsMd: payload.agentsMd,
          manifest: payload.manifest,
        });
        dispatch({
          type: "SPAWN_ENTRY_PANEL",
          sourcePanelId: payload.panelId,
          entryId: payload.entryId,
          title: payload.title,
          summary: payload.summary,
          sourceUrl: payload.sourceUrl,
          sourcePlatform: payload.sourcePlatform,
          sourceAuthor: payload.sourceAuthor,
          thumbnailUrl: payload.thumbnailUrl,
          useCase: payload.useCase,
          complexity: payload.complexity,
          tags: payload.tags,
          readme: payload.readme,
          agentsMd: payload.agentsMd,
          manifest: payload.manifest,
        });
      }
      return;
    }

    // 2. Empty progress message
    const progressMessage: ChatMessage = {
      role: "ai",
      type: "progress",
      entryId: data.entry_id,
      events: [],
      status: "streaming",
    };
    dispatch({ type: "APPEND_MESSAGE", panelId, message: progressMessage });

    // 3. Mark processing
    dispatch({
      type: "SET_PROCESSING",
      panelId,
      isProcessing: true,
      activeEntryId: data.entry_id,
    });

    // 4. Open SSE — this connection lives until terminal event or page unload.
    //    On reload, the per-panel hook will reattach via SSE replay.
    const es = new EventSource(`/api/ingest/${data.entry_id}/stream`);
    es.onmessage = (e) => {
      try {
        const evt: ProgressEvent = JSON.parse(e.data);
        dispatch({
          type: "UPDATE_PROGRESS",
          panelId,
          entryId: data.entry_id,
          event: evt,
        });

        if (evt.type === "complete") {
          es.close();
          fetch(`/api/entries/${data.entry_id}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((entry: EntryFetchResponse | null) => {
              if (!entry) return;
              const payload = buildEntryActionPayload(
                entry,
                panelId,
                data.entry_id
              );
              // 1. Inline artifacts card in the chat
              dispatch({
                type: "ADD_ARTIFACTS",
                panelId: payload.panelId,
                entryId: payload.entryId,
                title: payload.title,
                readme: payload.readme,
                agentsMd: payload.agentsMd,
                manifest: payload.manifest,
              });
              // 2. Floating EntryPanel next to the chat panel
              dispatch({
                type: "SPAWN_ENTRY_PANEL",
                sourcePanelId: payload.panelId,
                entryId: payload.entryId,
                title: payload.title,
                summary: payload.summary,
                sourceUrl: payload.sourceUrl,
                sourcePlatform: payload.sourcePlatform,
                sourceAuthor: payload.sourceAuthor,
                thumbnailUrl: payload.thumbnailUrl,
                useCase: payload.useCase,
                complexity: payload.complexity,
                tags: payload.tags,
                readme: payload.readme,
                agentsMd: payload.agentsMd,
                manifest: payload.manifest,
              });
            })
            .catch(() => {})
            .finally(() => {
              dispatch({
                type: "SET_PROCESSING",
                panelId,
                isProcessing: false,
                activeEntryId: null,
              });
            });
        }

        if (evt.type === "error") {
          es.close();
          dispatch({
            type: "APPEND_MESSAGE",
            panelId,
            message: {
              role: "ai",
              type: "text",
              content: `Something went wrong: ${evt.message}`,
            },
          });
          dispatch({
            type: "SET_PROCESSING",
            panelId,
            isProcessing: false,
            activeEntryId: null,
          });
        }
      } catch {
        // skip malformed
      }
    };
  } catch (err) {
    dispatch({
      type: "APPEND_MESSAGE",
      panelId,
      message: {
        role: "ai",
        type: "text",
        content: `Failed to start ingestion: ${err instanceof Error ? err.message : "Unknown error"}`,
      },
    });
    dispatch({
      type: "SET_PROCESSING",
      panelId,
      isProcessing: false,
      activeEntryId: null,
    });
  }
}
