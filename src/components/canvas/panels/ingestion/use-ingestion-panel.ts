"use client";

/**
 * useIngestionPanel — owns the SSE ingestion lifecycle for one
 * IngestionPanel. Returns `startIngestion(url)` and `cancel()`.
 *
 * Unlike the chat-panel ingestion hook, this panel's terminal behavior
 * on a successful complete event is to DELETE ITSELF and spawn an
 * EntryPanel in the same slot so the user sees a clean handoff from
 * "ingesting" to "viewing the entry".
 *
 * Error and cancel paths leave the panel alive so the user can retry or
 * close it manually.
 */

import { useCallback, useEffect, useRef } from "react";
import { useCanvas } from "../../canvas-store";
import type { IngestionPanelData } from "../../types";
import type {
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

export function useIngestionPanel(panel: IngestionPanelData) {
  const { dispatch } = useCanvas();
  const eventSourceRef = useRef<EventSource | null>(null);
  // Local buffer of logs so we can dispatch the FULL array each time
  // (the reducer's UPDATE_INGESTION_STATE replaces logs by reference).
  const logsRef = useRef<ProgressEvent[]>(panel.logs);

  // Keep the logs ref in sync with whatever the state says, so a page
  // reload mid-ingestion picks up where it left off.
  useEffect(() => {
    logsRef.current = panel.logs;
  }, [panel.logs]);

  // Close the SSE on unmount so a navigation away doesn't leave an open
  // connection leaking.
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  const startIngestion = useCallback(
    async (url: string) => {
      const trimmed = url.trim();
      if (!trimmed) return;

      // Validate URL format upfront so we can set a clean error state
      // without ever touching the network.
      try {
        new URL(trimmed);
      } catch {
        dispatch({
          type: "UPDATE_INGESTION_STATE",
          panelId: panel.id,
          patch: {
            status: "error",
            errorMessage:
              "That doesn't look like a valid URL. Paste a full link starting with https://",
          },
        });
        return;
      }

      // Reset any prior error state and clear logs.
      logsRef.current = [];
      dispatch({
        type: "UPDATE_INGESTION_STATE",
        panelId: panel.id,
        patch: {
          url: trimmed,
          status: "streaming",
          logs: [],
          entryId: null,
          errorMessage: null,
        },
      });

      let entryId: string;
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
        entryId = data.entry_id;
      } catch (err) {
        dispatch({
          type: "UPDATE_INGESTION_STATE",
          panelId: panel.id,
          patch: {
            status: "error",
            errorMessage:
              err instanceof Error ? err.message : "Ingestion start failed",
          },
        });
        return;
      }

      dispatch({
        type: "UPDATE_INGESTION_STATE",
        panelId: panel.id,
        patch: { entryId },
      });

      // Open the SSE and route events into the panel's log.
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      const es = new EventSource(`/api/ingest/${entryId}/stream`);
      eventSourceRef.current = es;

      es.onmessage = (e) => {
        try {
          const evt: ProgressEvent = JSON.parse(e.data);
          logsRef.current = [...logsRef.current, evt];
          dispatch({
            type: "UPDATE_INGESTION_STATE",
            panelId: panel.id,
            patch: { logs: logsRef.current },
          });

          if (evt.type === "complete") {
            es.close();
            eventSourceRef.current = null;
            // Fetch the generated entry, then hand off by spawning an
            // EntryPanel in this panel's slot and closing ourselves.
            fetch(`/api/entries/${entryId}`)
              .then((r) => (r.ok ? r.json() : null))
              .then((entry: EntryFetchResponse | null) => {
                if (!entry) return;
                dispatch({
                  type: "SPAWN_ENTRY_PANEL",
                  sourcePanelId: panel.id,
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
                  // Take over this panel's exact position so the handoff
                  // is visually seamless.
                  position: { x: panel.x, y: panel.y },
                });
                // Delete ourselves. CLOSE_PANEL will also strip us from
                // the selection / any cluster we're in, and SPAWN_ENTRY
                // already auto-joined the new entry to our cluster
                // before the delete runs.
                dispatch({ type: "CLOSE_PANEL", id: panel.id });
              })
              .catch(() => {
                dispatch({
                  type: "UPDATE_INGESTION_STATE",
                  panelId: panel.id,
                  patch: {
                    status: "error",
                    errorMessage:
                      "Ingestion completed but the entry could not be fetched. Reload to try again.",
                  },
                });
              });
          } else if (evt.type === "error") {
            es.close();
            eventSourceRef.current = null;
            dispatch({
              type: "UPDATE_INGESTION_STATE",
              panelId: panel.id,
              patch: {
                status: "error",
                errorMessage: evt.message,
              },
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
    [dispatch, panel.id, panel.x, panel.y]
  );

  const cancel = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    dispatch({ type: "CLOSE_PANEL", id: panel.id });
  }, [dispatch, panel.id]);

  return { startIngestion, cancel };
}
