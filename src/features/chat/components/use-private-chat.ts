"use client";

/**
 * usePrivateChat — state + side-effects for one private conversation.
 *
 * Drives the dedicated /[workspaceSlug]/chat page. Distinct from
 * `useChat` (which lives inside a canvas chat panel and dispatches into
 * the canvas store reducer). Here we own the message log directly via
 * useState — no canvas store, no panel id collisions.
 *
 * Responsibilities:
 *   - Hold the in-memory `ChatMessage[]` log.
 *   - Send a user turn through /api/chat with `mode: 'private'` and the
 *     active scope filters; parse the SSE stream into messages, including
 *     the new `artifact` event (Agent Prompt / Context File cards).
 *   - Persist the log + scope filters to /api/conversations on a debounce.
 *
 * Promotion of an artifact to the canvas is handled by the caller —
 * this hook just tracks `promotedPanelId` updates dispatched into the
 * message log.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ChatAttachment,
  ChatMessage,
} from "@/features/ingestion/components/chat-message";
import { messagesToApiHistory } from "./chat-message-types";
import type { ScopeFilters } from "./cluster-scope-picker";

interface UsePrivateChatOptions {
  workspaceId: string;
  panelId: string;
  initialMessages?: ChatMessage[];
  initialTitle?: string;
  initialScopeFilters?: ScopeFilters | null;
  /**
   * Called once after the first AI response finalises so the parent
   * can refresh the conversations rail (titles auto-named, etc.).
   */
  onFirstResponseSaved?: (panelId: string) => void;
}

interface PromoteOptions {
  artifactId: string;
  title: string;
  markdown: string;
  panelId: string;
}

export function usePrivateChat({
  workspaceId,
  panelId,
  initialMessages = [],
  initialTitle = "New chat",
  initialScopeFilters = null,
  onFirstResponseSaved,
}: UsePrivateChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [title, setTitle] = useState<string>(initialTitle);
  const [scopeFilters, setScopeFilters] = useState<ScopeFilters | null>(
    initialScopeFilters
  );
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Note: when the user switches conversations, the parent component
  // re-mounts ChatThread via `key={panelId}`, so useState initializers
  // pick up the new initialMessages/initialTitle/initialScopeFilters
  // automatically. No effect-based sync needed.

  /**
   * Persist current state to /api/conversations. Debounced via the
   * caller's effect below.
   */
  const persist = useCallback(
    async (
      msgs: ChatMessage[],
      currentTitle: string,
      currentScope: ScopeFilters | null
    ) => {
      if (msgs.length === 0) return;
      try {
        await fetch("/api/conversations", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Workspace-Id": workspaceId,
          },
          body: JSON.stringify({
            panel_id: panelId,
            title: currentTitle,
            messages: msgs,
            visibility: "private",
            scope_filters: currentScope,
          }),
        });
      } catch (err) {
        console.warn("private chat persist failed", err);
      }
    },
    [panelId, workspaceId]
  );

  // Debounced persist on changes.
  const persistRef = useRef(persist);
  persistRef.current = persist;
  useEffect(() => {
    if (messages.length === 0) return;
    const handle = setTimeout(() => {
      void persistRef.current(messages, title, scopeFilters);
    }, 800);
    return () => clearTimeout(handle);
  }, [messages, title, scopeFilters]);

  const send = useCallback(
    async (input: string, attachments?: ChatAttachment[]) => {
      const text = input.trim();
      if ((!text && (!attachments || attachments.length === 0)) || isStreaming) return;

      const userMessage: ChatMessage = {
        role: "user",
        type: "text",
        content: text || " ",
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
      };

      const updated = [...messages, userMessage];
      setMessages(updated);
      setIsStreaming(true);

      const history = messagesToApiHistory(updated);

      const controller = new AbortController();
      abortRef.current = controller;

      let streamingText = "";
      let streamingActive = false;
      const priorLength = updated.length;

      function ensureStreamingBubble() {
        streamingActive = true;
        // Snapshot the closure variable BEFORE scheduling the state
        // update — the updater function runs later (React batches state
        // dispatches), and `streamingText` may have been mutated by
        // subsequent SSE events by the time React invokes the updater.
        const snapshot = streamingText;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "ai" && last.type === "streaming") {
            const next = [...prev];
            next[next.length - 1] = {
              role: "ai",
              type: "streaming",
              content: snapshot,
            };
            return next;
          }
          return [
            ...prev,
            { role: "ai", type: "streaming", content: snapshot },
          ];
        });
      }
      function finaliseBubble() {
        if (!streamingActive) return;
        // Same snapshot dance as ensureStreamingBubble. Without this
        // the updater closure read `streamingText` AFTER the
        // `streamingText = ""` line below ran, so finalised messages
        // landed in state (and persisted to the DB) as empty strings.
        const snapshot = streamingText;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== "ai" || last.type !== "streaming") {
            return prev;
          }
          const next = [...prev];
          next[next.length - 1] = {
            role: "ai",
            type: "text",
            content: snapshot,
          };
          return next;
        });
        streamingActive = false;
        streamingText = "";
      }

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Workspace-Id": workspaceId,
          },
          body: JSON.stringify({
            mode: "private",
            messages: history,
            scopeFilters,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          if (response.status === 402 && err.error === "trial_expired") {
            setMessages((prev) => [
              ...prev,
              {
                role: "ai",
                type: "trial_expired",
                message:
                  err.message ||
                  "Your free trial has ended. Subscribe for $7.99/mo to continue.",
              },
            ]);
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
              artifact?: {
                kind: "agent_prompt" | "context_file";
                id: string;
                title: string;
                prompt?: string;
                markdown?: string;
              };
              message?: string;
            };
            try {
              event = JSON.parse(jsonStr);
            } catch {
              continue;
            }

            switch (event.type) {
              case "text_delta":
                streamingText += event.content || "";
                ensureStreamingBubble();
                break;
              case "tool_call":
                finaliseBubble();
                setMessages((prev) => [
                  ...prev,
                  {
                    role: "ai",
                    type: "tool_activity",
                    toolName: event.name || "tool",
                    status: "calling",
                  },
                ]);
                break;
              case "entry_reference":
                if (!event.entry) break;
                setMessages((prev) => [
                  ...prev,
                  {
                    role: "ai",
                    type: "entry_cards",
                    entries: [event.entry!],
                  },
                ]);
                break;
              case "tool_result":
                setMessages((prev) => [
                  ...prev,
                  {
                    role: "ai",
                    type: "tool_activity",
                    toolName: event.name || "tool",
                    status: "done",
                    summary: event.summary,
                  },
                ]);
                break;
              case "artifact":
                if (!event.artifact) break;
                if (event.artifact.kind === "agent_prompt") {
                  setMessages((prev) => [
                    ...prev,
                    {
                      role: "ai",
                      type: "agent_prompt_artifact",
                      artifactId: event.artifact!.id,
                      title: event.artifact!.title,
                      prompt: event.artifact!.prompt || "",
                    },
                  ]);
                } else if (event.artifact.kind === "context_file") {
                  setMessages((prev) => [
                    ...prev,
                    {
                      role: "ai",
                      type: "context_file_artifact",
                      artifactId: event.artifact!.id,
                      title: event.artifact!.title,
                      markdown: event.artifact!.markdown || "",
                    },
                  ]);
                }
                break;
              case "done":
                finaliseBubble();
                break;
              case "error":
                finaliseBubble();
                setMessages((prev) => [
                  ...prev,
                  {
                    role: "ai",
                    type: "text",
                    content: `Something went wrong: ${event.message || "Unknown error"}`,
                  },
                ]);
                break;
            }
          }
        }

        finaliseBubble();
        if (priorLength === 1) {
          // First send → notify parent so it can refresh the rail.
          onFirstResponseSaved?.(panelId);
        }
        void priorLength;
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          finaliseBubble();
          setMessages((prev) => [
            ...prev,
            {
              role: "ai",
              type: "text",
              content: `Failed to reach chat: ${err instanceof Error ? err.message : "Unknown error"}`,
            },
          ]);
        }
      } finally {
        abortRef.current = null;
        setIsStreaming(false);
      }
    },
    [isStreaming, messages, onFirstResponseSaved, panelId, scopeFilters, workspaceId]
  );

  /**
   * Promote an artifact message to a workspace-shared canvas panel via
   * POST /api/canvas/panels. Stamps the message with the resulting
   * panelId so the artifact card flips to its "On canvas" state.
   *
   * Position is fixed near the canvas origin; users can rearrange after.
   */
  const promoteArtifact = useCallback(
    async ({ artifactId, title: artifactTitle, markdown }: PromoteOptions) => {
      const newPanelId = `artifact-${artifactId}`;
      try {
        const res = await fetch("/api/canvas/panels", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Workspace-Id": workspaceId,
          },
          body: JSON.stringify({
            panel_id: newPanelId,
            panel_type: "artifact",
            x: 120,
            y: 120,
            width: 560,
            height: 720,
            title: artifactTitle,
            panel_data: {
              markdown,
              sourceConversationId: panelId,
              sourceMessageId: artifactId,
            },
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        // Mark the source message as promoted.
        setMessages((prev) =>
          prev.map((m) => {
            if (
              (m.role === "ai" && m.type === "agent_prompt_artifact") ||
              (m.role === "ai" && m.type === "context_file_artifact")
            ) {
              if (m.artifactId === artifactId) {
                return { ...m, promotedPanelId: newPanelId };
              }
            }
            return m;
          })
        );
        return newPanelId;
      } catch (err) {
        console.warn("promote artifact failed", err);
        return undefined;
      }
    },
    [panelId, workspaceId]
  );

  return {
    messages,
    isStreaming,
    title,
    setTitle,
    scopeFilters,
    setScopeFilters,
    send,
    promoteArtifact,
  };
}
