/**
 * Chat message helpers for the real-chat panel.
 *
 * The shared `ChatMessage` union in `@/components/ingest/chat-message`
 * now includes the full set of variants for both the URL-ingestion flow
 * and the real-chat flow (text / user-text / progress / artifacts /
 * streaming / tool_activity / entry_cards). This file re-exports those
 * and adds constants + helpers specific to the real-chat panel.
 */

import type {
  ChatMessage,
  EntryReference,
} from "@/components/ingest/chat-message";

export type { ChatMessage, EntryReference };

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

/**
 * Build the MessageParam[] payload for /api/chat from a chat panel's
 * message log. Only user-text and finalised AI text messages become
 * entries in the history — streaming/tool_activity/entry_cards/progress/
 * artifacts are UI-only and should not leak into Claude's context.
 */
export function messagesToApiHistory(
  messages: ChatMessage[]
): Array<{ role: "user" | "assistant"; content: string }> {
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of messages) {
    if (m.role === "user" && m.type === "text") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "ai" && m.type === "text") {
      out.push({ role: "assistant", content: m.content });
    }
  }
  return out;
}
