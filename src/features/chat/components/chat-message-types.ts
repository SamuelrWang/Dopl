/**
 * Chat message helpers for the real-chat panel.
 *
 * The shared `ChatMessage` union in `@/features/ingestion/components/chat-message`
 * now includes the full set of variants for both the URL-ingestion flow
 * and the real-chat flow (text / user-text / progress / artifacts /
 * streaming / tool_activity / entry_cards). This file re-exports those
 * and adds constants + helpers specific to the real-chat panel.
 */

import type {
  ChatMessage,
  ChatAttachment,
  EntryReference,
} from "@/features/ingestion/components/chat-message";

export type { ChatMessage, ChatAttachment, EntryReference };

/** Maximum number of messages kept in a single chat panel's state. */
export const MAX_MESSAGES_PER_PANEL = 200;

/**
 * Trim a messages array to the last N entries. Used when appending so
 * localStorage doesn't balloon from long conversations. Older messages
 * are dropped silently — the user can still see recent context.
 */
export function capMessages(
  messages: ChatMessage[],
  max = MAX_MESSAGES_PER_PANEL
): ChatMessage[] {
  if (messages.length <= max) return messages;
  return messages.slice(messages.length - max);
}

/** A single content block in the Anthropic multimodal format. */
export type ContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    }
  | {
      type: "document";
      source: { type: "base64"; media_type: string; data: string };
    };

/** API message payload — content may be a string or multimodal blocks. */
export type ApiMessage = {
  role: "user" | "assistant";
  content: string | ContentBlock[];
};

/**
 * Build the MessageParam[] payload for /api/chat from a chat panel's
 * message log. Only user-text and finalised AI text messages become
 * entries in the history — streaming/tool_activity/entry_cards/progress/
 * artifacts are UI-only and should not leak into Claude's context.
 *
 * When a user message has attachments with base64/textContent, the
 * content is returned as an array of multimodal content blocks
 * (Anthropic vision format). Otherwise, plain string content is used.
 */
export function messagesToApiHistory(messages: ChatMessage[]): ApiMessage[] {
  const out: ApiMessage[] = [];
  for (const m of messages) {
    if (m.role === "user" && m.type === "text") {
      const attachments = m.attachments;
      if (attachments && attachments.length > 0) {
        const blocks = buildContentBlocks(m.content, attachments);
        out.push({ role: "user", content: blocks });
      } else {
        out.push({ role: "user", content: m.content });
      }
    } else if (m.role === "ai" && m.type === "text") {
      out.push({ role: "assistant", content: m.content });
    }
  }
  return out;
}

/**
 * Build multimodal content blocks from text + attachments.
 * Only includes attachments that have ephemeral data (base64/textContent).
 */
function buildContentBlocks(
  text: string,
  attachments: ChatAttachment[]
): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  for (const a of attachments) {
    if (a.mimeType.startsWith("image/") && a.base64) {
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: a.mimeType, data: a.base64 },
      });
    } else if (a.mimeType === "application/pdf" && a.base64) {
      blocks.push({
        type: "document",
        source: {
          type: "base64",
          media_type: a.mimeType,
          data: a.base64,
        },
      });
    } else if (a.textContent) {
      blocks.push({
        type: "text",
        text: `File: ${a.fileName}\n\n${a.textContent}`,
      });
    }
  }

  // Always include the user's text (Anthropic requires at least one text block)
  blocks.push({ type: "text", text: text || " " });

  return blocks;
}
