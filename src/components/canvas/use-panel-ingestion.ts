"use client";

/**
 * usePanelIngestion(panel) — manages the SSE ingestion lifecycle for one
 * ChatPanel. Returns a `startIngestion(url)` callback.
 *
 * Progressive spawning: the entry panel is spawned as soon as the manifest
 * step completes (title/summary/metadata available). README, agents.md, and
 * tags populate live as their respective pipeline steps finish.
 *
 * SSE reconnection: if the connection drops (Vercel 300s timeout), the
 * client reconnects with exponential backoff. The server replays buffered
 * events, and the idempotent reducer guards prevent duplicate panels.
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

// ── Shared progressive SSE handler ────────────────────────────────────

interface ProgressState {
  panelSpawned: boolean;
  readme: string;
  agentsMd: string;
  manifest: Record<string, unknown>;
}

/**
 * Handle a single SSE progress event. Returns { close: true } if the
 * event is terminal and the EventSource should be closed.
 */
function handleProgressEvent(
  data: ProgressEvent,
  entryId: string,
  panelId: string,
  dispatch: Dispatch<CanvasAction>,
  pstate: ProgressState
): { close: boolean } {
  // Always dispatch progress update for the chat log
  dispatch({
    type: "UPDATE_PROGRESS",
    panelId,
    entryId,
    event: data,
  });

  // Progressive artifact handling on step_complete events
  if (data.type === "step_complete" && data.details) {
    const step = data.step;
    const details = data.details as Record<string, unknown>;

    if (step === "manifest_generation" && !pstate.panelSpawned) {
      pstate.panelSpawned = true;
      pstate.manifest = (details.manifest as Record<string, unknown>) || {};
      const contentType = (details.contentType as string) || "setup";

      dispatch({
        type: "SPAWN_ENTRY_PANEL",
        sourcePanelId: panelId,
        entryId,
        title: (details.title as string) || "Untitled Setup",
        summary: (details.summary as string) || null,
        sourceUrl: (details.sourceUrl as string) || "",
        sourcePlatform: (details.sourcePlatform as string) || null,
        sourceAuthor: null,
        thumbnailUrl: (details.thumbnailUrl as string) || null,
        useCase: (details.useCase as string) || null,
        complexity: (details.complexity as string) || null,
        tags: [],
        readme: "",
        agentsMd: "",
        manifest: pstate.manifest,
        readmeLoading: true,
        agentsMdLoading: contentType !== "knowledge",
        tagsLoading: true,
      });
    }

    if (step === "readme_generation" && details.readme) {
      pstate.readme = details.readme as string;
      dispatch({
        type: "UPDATE_ENTRY_ARTIFACT",
        entryId,
        readme: pstate.readme,
      });
    }

    if (step === "agents_md_generation" && details.agentsMd !== undefined) {
      pstate.agentsMd = details.agentsMd as string;
      dispatch({
        type: "UPDATE_ENTRY_ARTIFACT",
        entryId,
        agentsMd: pstate.agentsMd,
      });
    }

    if (step === "tag_generation" && details.tags) {
      const rawTags = details.tags as Array<{ tag_type: string; tag_value: string }>;
      dispatch({
        type: "UPDATE_ENTRY_ARTIFACT",
        entryId,
        tags: rawTags.map((t) => ({ type: t.tag_type, value: t.tag_value })),
      });
    }
  }

  if (data.type === "complete") {
    // If panel wasn't spawned progressively (edge case), fall back to fetch
    if (!pstate.panelSpawned) {
      fetch(`/api/entries/${entryId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((entry: EntryFetchResponse | null) => {
          if (!entry) return;
          const payload = buildEntryActionPayload(entry, panelId, entryId);
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
            ...payload,
          });
        })
        .catch(() => {});
    } else {
      // Inline artifacts card in the chat
      dispatch({
        type: "ADD_ARTIFACTS",
        panelId,
        entryId,
        title: (pstate.manifest as Record<string, string>).title || "Untitled",
        readme: pstate.readme,
        agentsMd: pstate.agentsMd,
        manifest: pstate.manifest,
      });
    }

    dispatch({
      type: "SET_PROCESSING",
      panelId,
      isProcessing: false,
      activeEntryId: null,
    });
    return { close: true };
  }

  if (data.type === "error") {
    dispatch({
      type: "APPEND_MESSAGE",
      panelId,
      message: {
        role: "ai",
        type: "text",
        content: `Something went wrong: ${data.message}`,
      },
    });
    dispatch({
      type: "SET_PROCESSING",
      panelId,
      isProcessing: false,
      activeEntryId: null,
    });
    return { close: true };
  }

  return { close: false };
}

// ── Polling fallback ──────────────────────────────────────────────────

function pollForCompletion(
  entryId: string,
  panelId: string,
  dispatch: Dispatch<CanvasAction>,
  pstate: ProgressState
) {
  const poll = async () => {
    try {
      const res = await fetch(`/api/ingest/${entryId}/status`);
      if (!res.ok) return;
      const data = await res.json();

      if (data.status === "complete") {
        if (!pstate.panelSpawned) {
          const entry: EntryFetchResponse | null = await fetch(
            `/api/entries/${entryId}`
          ).then((r) => (r.ok ? r.json() : null));
          if (entry) {
            const payload = buildEntryActionPayload(entry, panelId, entryId);
            dispatch({ type: "SPAWN_ENTRY_PANEL", sourcePanelId: panelId, ...payload });
          }
        }
        dispatch({
          type: "SET_PROCESSING",
          panelId,
          isProcessing: false,
          activeEntryId: null,
        });
        return;
      }

      if (data.status === "error") {
        dispatch({
          type: "SET_PROCESSING",
          panelId,
          isProcessing: false,
          activeEntryId: null,
        });
        return;
      }

      // Still processing — poll again in 5s
      setTimeout(poll, 5000);
    } catch {
      setTimeout(poll, 5000);
    }
  };
  poll();
}

// ── Hook version ──────────────────────────────────────────────────────

export function usePanelIngestion(panel: ChatPanelData) {
  const { dispatch } = useCanvas();
  const eventSourceRef = useRef<EventSource | null>(null);
  const pstateRef = useRef<ProgressState>({
    panelSpawned: false,
    readme: "",
    agentsMd: "",
    manifest: {},
  });

  const subscribeToStream = useCallback(
    (entryId: string) => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      let reconnectAttempts = 0;
      const MAX_RECONNECT = 5;

      function connect() {
        const es = new EventSource(`/api/ingest/${entryId}/stream`);
        eventSourceRef.current = es;

        es.onmessage = (e) => {
          try {
            const data: ProgressEvent = JSON.parse(e.data);
            const { close } = handleProgressEvent(
              data,
              entryId,
              panel.id,
              dispatch,
              pstateRef.current
            );
            if (close) {
              es.close();
              eventSourceRef.current = null;
            }
          } catch {
            // Skip malformed SSE messages
          }
        };

        es.onerror = () => {
          if (es.readyState === EventSource.CLOSED) {
            es.close();
            eventSourceRef.current = null;

            // Don't reconnect if we already have a terminal state
            if (pstateRef.current.panelSpawned && !panel.isProcessing) return;

            if (reconnectAttempts < MAX_RECONNECT) {
              reconnectAttempts++;
              const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 10000);
              setTimeout(connect, delay);
            } else {
              pollForCompletion(entryId, panel.id, dispatch, pstateRef.current);
            }
          }
        };
      }

      connect();
    },
    [dispatch, panel.id, panel.isProcessing]
  );

  const startIngestion = useCallback(
    async (url: string) => {
      const trimmed = url.trim();
      if (!trimmed) return;

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

      dispatch({
        type: "APPEND_MESSAGE",
        panelId: panel.id,
        message: { role: "user", type: "text", content: trimmed },
      });

      try {
        const response = await fetch("/api/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: trimmed, content: {} }),
        });

        const data: IngestStartResponse = await response.json();
        if (!response.ok) {
          throw new Error(data.message || data.error || "Ingestion failed");
        }

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
            const payload = buildEntryActionPayload(entry, panel.id, data.entry_id);
            dispatch({ type: "ADD_ARTIFACTS", panelId: payload.panelId, entryId: payload.entryId, title: payload.title, readme: payload.readme, agentsMd: payload.agentsMd, manifest: payload.manifest });
            dispatch({ type: "SPAWN_ENTRY_PANEL", sourcePanelId: payload.panelId, ...payload });
          }
          return;
        }

        // Reset progressive state for this ingestion
        pstateRef.current = { panelSpawned: false, readme: "", agentsMd: "", manifest: {} };

        const progressMessage: ChatMessage = {
          role: "ai",
          type: "progress",
          entryId: data.entry_id,
          events: [],
          status: "streaming",
        };
        dispatch({ type: "APPEND_MESSAGE", panelId: panel.id, message: progressMessage });
        dispatch({ type: "SET_PROCESSING", panelId: panel.id, isProcessing: true, activeEntryId: data.entry_id });

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
        dispatch({ type: "SET_PROCESSING", panelId: panel.id, isProcessing: false, activeEntryId: null });
      }
    },
    [dispatch, panel.id, subscribeToStream]
  );

  useEffect(() => {
    if (panel.activeEntryId && panel.isProcessing) {
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
          pstateRef.current = { panelSpawned: false, readme: "", agentsMd: "", manifest: {} };
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { startIngestion };
}

// ── Standalone (no hook) — used by FixedInputBar ───────────────────

export async function startPanelIngestion(
  dispatch: Dispatch<CanvasAction>,
  panelId: string,
  url: string
): Promise<void> {
  const trimmed = url.trim();
  if (!trimmed) return;

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
        dispatch({ type: "ADD_ARTIFACTS", panelId: payload.panelId, entryId: payload.entryId, title: payload.title, readme: payload.readme, agentsMd: payload.agentsMd, manifest: payload.manifest });
        dispatch({ type: "SPAWN_ENTRY_PANEL", sourcePanelId: payload.panelId, ...payload });
      }
      return;
    }

    const pstate: ProgressState = { panelSpawned: false, readme: "", agentsMd: "", manifest: {} };

    const progressMessage: ChatMessage = {
      role: "ai",
      type: "progress",
      entryId: data.entry_id,
      events: [],
      status: "streaming",
    };
    dispatch({ type: "APPEND_MESSAGE", panelId, message: progressMessage });
    dispatch({ type: "SET_PROCESSING", panelId, isProcessing: true, activeEntryId: data.entry_id });

    let reconnectAttempts = 0;
    const MAX_RECONNECT = 5;

    function connect() {
      const es = new EventSource(`/api/ingest/${data.entry_id}/stream`);

      es.onmessage = (e) => {
        try {
          const evt: ProgressEvent = JSON.parse(e.data);
          const { close } = handleProgressEvent(evt, data.entry_id, panelId, dispatch, pstate);
          if (close) {
            es.close();
          }
        } catch {
          // skip malformed
        }
      };

      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) {
          es.close();

          if (reconnectAttempts < MAX_RECONNECT) {
            reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 10000);
            setTimeout(connect, delay);
          } else {
            pollForCompletion(data.entry_id, panelId, dispatch, pstate);
          }
        }
      };
    }

    connect();
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
    dispatch({ type: "SET_PROCESSING", panelId, isProcessing: false, activeEntryId: null });
  }
}
