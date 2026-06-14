/**
 * Chat message types — shared across the chat feature and the canvas store.
 *
 * These were previously owned by the (now-removed) ingestion feature. The
 * ingestion-only variants (`progress`, `artifacts`, `entry_cards`) and the
 * `ProgressEvent` / `EntryReference` types were dropped with that feature.
 */

/**
 * ChatAttachment — metadata for a file or image attached to a chat message.
 *
 * `base64` and `textContent` are ephemeral fields used only during the
 * current session to send content to the Anthropic API. They are NOT
 * persisted in conversation sync — only the metadata fields are stored.
 */
export interface ChatAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
  url: string;
  base64?: string;
  textContent?: string;
}

/**
 * ChatMessage — unified message type used by all chat flows (the canvas chat
 * panel and the private/builder chat panel that talk to /api/chat).
 */
export type ChatMessage =
  | { role: "ai"; type: "text"; content: string }
  | { role: "user"; type: "text"; content: string; attachments?: ChatAttachment[] }
  | { role: "ai"; type: "streaming"; content: string }
  | {
      role: "ai";
      type: "tool_activity";
      toolName: string;
      status: "calling" | "done";
      summary?: string;
    }
  | { role: "ai"; type: "trial_expired"; message: string }
  | {
      /**
       * Private-chat artifact: copy-pasteable prompt for the user's
       * executing agent (Claude Code, etc.). Rendered as an inline card with
       * copy + promote-to-canvas buttons.
       */
      role: "ai";
      type: "agent_prompt_artifact";
      artifactId: string;
      title: string;
      prompt: string;
      /** Set after the user promotes this artifact to a canvas panel. */
      promotedPanelId?: string;
    }
  | {
      /**
       * Private-chat artifact: synthesized markdown bundle assembled from
       * workspace KBs / skills / clusters. Rendered as an inline card with
       * copy + download + promote-to-canvas buttons.
       */
      role: "ai";
      type: "context_file_artifact";
      artifactId: string;
      title: string;
      markdown: string;
      promotedPanelId?: string;
    }
  | {
      /**
       * Private-chat artifact: a faithful inline render of one knowledge-
       * base entry (the `render_knowledge_entry` tool). Body is fetched
       * server-side under the caller's access, so it always reflects the
       * true entry. Rendered as a `<KbDocumentCard>` — a read view with
       * copy + open-in-Knowledge, no promote (the entry already lives in
       * the workspace).
       */
      role: "ai";
      type: "kb_card_artifact";
      artifactId: string;
      title: string;
      knowledgeBase: string;
      knowledgeBaseSlug: string;
      body: string;
      entryId: string;
      updatedAt: string | null;
    };
