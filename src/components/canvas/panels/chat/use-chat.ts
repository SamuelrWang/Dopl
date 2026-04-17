"use client";

/**
 * useChat — streams a user message through /api/chat and updates the
 * panel's message log as events arrive.
 *
 * Event handling mirrors the BuilderChat implementation so there's one
 * canonical SSE contract in the codebase:
 *   - text_delta: append to the current streaming bubble via
 *                 UPDATE_STREAMING_MESSAGE (in-place edit, no bloat)
 *   - tool_call: finalise any open streaming bubble, then append a
 *                tool_activity message
 *   - entry_reference: append an entry_cards message for inline render
 *   - tool_result: append a "done" tool_activity summary
 *   - done: finalise the trailing streaming bubble
 *   - error: append a plain-text error bubble
 */

import { useCallback, useRef, useState } from "react";
import { useCanvas, computeNewPanelPosition } from "../../canvas-store";
import type { ChatMessage, ChatAttachment } from "@/components/ingest/chat-message";
import type { ChatPanelData } from "../../types";
import { ENTRY_PANEL_SIZE } from "../../types";
import { buildCanvasContext } from "./cluster-context";
import { messagesToApiHistory } from "./chat-message-types";
import { connectToIngestionStream } from "../../use-panel-ingestion";

interface UseChatOptions {
  panel: ChatPanelData;
}

export function useChat({ panel }: UseChatOptions) {
  const { state, dispatch } = useCanvas();
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // Latest state snapshot — the SSE loop needs to read the current
  // panel/clusters map without re-creating `send` on every render.
  const stateRef = useRef(state);
  stateRef.current = state;

  const send = useCallback(
    async (input: string, attachments?: ChatAttachment[]) => {
      const text = input.trim();
      if ((!text && (!attachments || attachments.length === 0)) || isStreaming)
        return;

      // 1. Append the user message synchronously so the UI reflects it
      //    immediately (before network).
      const userMessage: ChatMessage = {
        role: "user",
        type: "text",
        content: text || " ",
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
      };
      dispatch({
        type: "APPEND_MESSAGE",
        panelId: panel.id,
        message: userMessage,
      });

      setIsStreaming(true);

      // 2. Build history + cluster context from a stable state snapshot.
      const latestPanel = stateRef.current.panels.find(
        (p) => p.id === panel.id && p.type === "chat"
      );
      const latestMessages: ChatMessage[] =
        latestPanel && latestPanel.type === "chat"
          ? latestPanel.messages
          : [];
      const history = messagesToApiHistory([...latestMessages, userMessage]);
      const canvasContext = buildCanvasContext(panel.id, stateRef.current);

      const controller = new AbortController();
      abortRef.current = controller;

      // 3. Kick off the request and parse the SSE stream.
      let streamingText = "";
      let streamingActive = false;

      function ensureStreamingBubble() {
        streamingActive = true;
        dispatch({
          type: "UPDATE_STREAMING_MESSAGE",
          panelId: panel.id,
          content: streamingText,
        });
      }
      function finaliseBubble() {
        if (!streamingActive) return;
        dispatch({
          type: "FINALISE_STREAMING_MESSAGE",
          panelId: panel.id,
          content: streamingText,
        });
        streamingActive = false;
        streamingText = "";
      }

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history,
            canvasContext,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          if (response.status === 402 && err.error === "trial_expired") {
            // Trial ended or never started — the root-mounted PaywallGate
            // will pick this up on its next poll and show the modal. We
            // still surface a short notice inline so the user sees why
            // their request didn't go through.
            dispatch({
              type: "APPEND_MESSAGE",
              panelId: panel.id,
              message: {
                role: "ai",
                type: "trial_expired",
                message:
                  err.message ||
                  "Your free trial has ended. Subscribe for $7.99/mo to continue.",
              },
            });
            return;
          }
          throw new Error(err.error || `HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response stream");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;
            let event: {
              type: string;
              content?: string;
              name?: string;
              summary?: string;
              entry?: {
                entry_id: string;
                title?: string;
                summary?: string;
                source_url?: string;
                complexity?: string;
              };
              message?: string;
              // ingest_started fields
              entry_id?: string;
              stream_url?: string;
              status?: string;
              title?: string;
            };
            try {
              event = JSON.parse(jsonStr);
            } catch {
              continue;
            }

            switch (event.type) {
              case "text_delta": {
                streamingText += event.content || "";
                ensureStreamingBubble();
                break;
              }
              case "tool_call": {
                finaliseBubble();
                dispatch({
                  type: "APPEND_MESSAGE",
                  panelId: panel.id,
                  message: {
                    role: "ai",
                    type: "tool_activity",
                    toolName: event.name || "tool",
                    status: "calling",
                  },
                });
                break;
              }
              case "entry_reference": {
                if (!event.entry) break;
                dispatch({
                  type: "APPEND_MESSAGE",
                  panelId: panel.id,
                  message: {
                    role: "ai",
                    type: "entry_cards",
                    entries: [event.entry],
                  },
                });
                break;
              }
              case "tool_result": {
                dispatch({
                  type: "APPEND_MESSAGE",
                  panelId: panel.id,
                  message: {
                    role: "ai",
                    type: "tool_activity",
                    toolName: event.name || "tool",
                    status: "done",
                    summary: event.summary,
                  },
                });
                // A fresh streaming bubble will be created lazily on the
                // next text_delta — no need to prep it empty.
                break;
              }
              case "ingest_started": {
                const entryId = event.entry_id;
                const streamUrl = event.stream_url;
                const ingestStatus = event.status;
                const ingestTitle = event.title;

                if (!entryId) break;

                if (ingestStatus === "queued") {
                  // Site chat created a skeleton entry with status
                  // 'pending_ingestion'. The user's connected MCP agent
                  // will pick it up on its next tool call via the
                  // _dopl_status footer. Spawn an amber placeholder
                  // panel; it auto-transitions to the ingesting state
                  // when the entries realtime subscription observes
                  // the DB row flip to 'processing'.
                  dispatch({
                    type: "SPAWN_ENTRY_PANEL",
                    sourcePanelId: panel.id,
                    entryId,
                    title: ingestTitle || "Queued — waiting for agent",
                    summary: null,
                    sourceUrl: "",
                    sourcePlatform: null,
                    sourceAuthor: null,
                    thumbnailUrl: null,
                    useCase: null,
                    complexity: null,
                    tags: [],
                    readme: "",
                    agentsMd: "",
                    manifest: {},
                    isPendingIngestion: true,
                  });
                } else if (ingestStatus === "already_exists") {
                  // Fetch full entry and spawn a completed panel. If the
                  // fetch fails the user sees chat success but no panel —
                  // surface that so they can retry / realize something's
                  // wrong.
                  fetch(`/api/entries/${entryId}`)
                    .then(async (r) => {
                      if (!r.ok) {
                        throw new Error(
                          `Couldn't load existing entry (HTTP ${r.status})`
                        );
                      }
                      return r.json();
                    })
                    .then((entry) => {
                      if (!entry) return;
                      const tags = (entry.tags ?? []).map((t: { tag_type: string; tag_value: string }) => ({
                        type: t.tag_type,
                        value: t.tag_value,
                      }));
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
                        contentType: entry.content_type ?? null,
                        tags,
                        readme: entry.readme || "",
                        agentsMd: entry.agents_md || "",
                        manifest: entry.manifest || {},
                      });
                    })
                    .catch((err) => {
                      console.error("[useChat] already_exists fetch failed:", err);
                      dispatch({
                        type: "APPEND_MESSAGE",
                        panelId: panel.id,
                        message: {
                          role: "ai",
                          type: "text",
                          content:
                            "I found an existing entry for that URL but couldn't load it. You can try searching for it directly or refreshing.",
                        },
                      });
                    });
                } else if (streamUrl) {
                  // Spawn a skeleton entry panel and connect to stream
                  dispatch({
                    type: "SPAWN_ENTRY_PANEL",
                    sourcePanelId: panel.id,
                    entryId,
                    title: ingestTitle || "Ingesting...",
                    summary: null,
                    sourceUrl: "",
                    sourcePlatform: null,
                    sourceAuthor: null,
                    thumbnailUrl: null,
                    useCase: null,
                    complexity: null,
                    tags: [],
                    readme: "",
                    agentsMd: "",
                    manifest: {},
                    readmeLoading: true,
                    agentsMdLoading: true,
                    tagsLoading: true,
                    isIngesting: true,
                  });

                  connectToIngestionStream(
                    entryId,
                    streamUrl,
                    panel.id,
                    dispatch,
                    (reason) => {
                      // Ingestion failed — add a message to the chat explaining why.
                      // If the reason names a DB constraint (code=... / constraint=...),
                      // it's not a paywall — surface the specific error and skip the
                      // Chrome-extension boilerplate so the underlying bug stays visible.
                      const isDbError = /code=|constraint/i.test(reason);
                      const content = isDbError
                        ? `Ingestion failed with a database error: ${reason}`
                        : `Ingestion failed: ${reason}\n\nThis usually happens with paywalled sites, bot-protected pages, or content that requires login. You can try using the Dopl Chrome Extension to ingest the page directly from your browser, which bypasses these restrictions since it reads the page as you see it.`;
                      dispatch({
                        type: "APPEND_MESSAGE",
                        panelId: panel.id,
                        message: {
                          role: "ai",
                          type: "text",
                          content,
                        },
                      });
                    }
                  );
                }
                break;
              }
              case "done": {
                finaliseBubble();
                break;
              }
              case "error": {
                finaliseBubble();
                dispatch({
                  type: "APPEND_MESSAGE",
                  panelId: panel.id,
                  message: {
                    role: "ai",
                    type: "text",
                    content: `Something went wrong: ${event.message || "Unknown error"}`,
                  },
                });
                break;
              }
            }
          }
        }

        // Stream ended without an explicit done event (defensive).
        finaliseBubble();
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          finaliseBubble();
          dispatch({
            type: "APPEND_MESSAGE",
            panelId: panel.id,
            message: {
              role: "ai",
              type: "text",
              content: `Failed to reach chat: ${err instanceof Error ? err.message : "Unknown error"}`,
            },
          });
        }
      } finally {
        abortRef.current = null;
        setIsStreaming(false);
      }
    },
    [dispatch, isStreaming, panel.id]
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  return { send, cancel, isStreaming };
}
