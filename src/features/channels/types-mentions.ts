/**
 * THE MENTIONS INBOX's row type.
 *
 * ⚠ SPLIT OUT OF `types.ts` at the 500-line cap (2026-09-15) and re-exported from
 * there, so no import path changed and there is no second path to the symbol —
 * the same move `types-launch.ts` and `types-sessions.ts` made before it, for the
 * same reason and with the same rule.
 */

import type { AgentColorKey, MessageAuthorKind } from "./types";

/**
 * ONE ROW OF THE TAGS (MENTIONS) INBOX — a message whose server-stamped
 * `metadata.mentionedUserIds` names the viewer, plus whether they marked it read.
 *
 * ⚠ A PROJECTION, NOT A MESSAGE. It carries a clipped `snippet`, never the body: the
 * transcript row is the record and the inbox a pointer at it — which is why
 * `messageId` + `threadId` are the load-bearing fields. ⚠ `read` is per-viewer, from
 * `channel_mention_reads`; the UNREAD COUNT is client-side arithmetic over this list
 * and never a second server derivation (wiring plan Phase 6, design decision 3).
 */
export type ChannelMention = {
  /** The message row this mention lives in — the scroll target. */
  messageId: string;
  /** Per-channel monotonic identity; the list's order. */
  seq: number;
  channelId: string;
  /** `metadata.taskId`, or null for a channel-level post — the navigate target. */
  threadId: string | null;
  authorUserId: string | null;
  /** Display claim only, same rule as the transcript's chip (INVARIANTS §5). */
  authorKind: MessageAuthorKind;
  authorName: string | null;
  authorAvatarUrl: string | null;
  /**
   * WHICH of the author's agents wrote it, and WHAT ITS OPERATOR CALLS IT
   * (2026-09-15, for the row's agent pill).
   *
   * ⚠ BOTH `null` IS "CANNOT SAY", NEVER "NOT AN AGENT" — `authorKind` answers
   * that, and the two are independent: an agent post with no stamp and no
   * session key is `authorKind: "agent"` with no id. Readers fall back through
   * name -> `#id` -> the bare noun (INVARIANTS §11), and never render a blank.
   * ⚠ DISPLAY CLAIMS, exactly like the transcript's: the id is derived by the
   * one parser and the name is resolved per page, so neither moves a row or
   * proves anything about who wrote it.
   */
  authorAgentId: string | null;
  authorAgentName: string | null;
  /**
   * THAT AGENT'S IDENTITY COLOUR — the hue the Agents tab and the transcript have
   * already taught this reader (`lib/agent-colors.ts`).
   *
   * ⚠ `null` IS LEGITIMATE AND IS NOT AN ERROR: a seventeenth live agent in one
   * room runs UNCOLOURED because refusing to start an agent over a decoration
   * would be the tail wagging the dog. Renderers degrade to the neutral mark.
   */
  authorAgentColor: AgentColorKey | null;
  /** Preview text, CLIPPED server-side. The transcript row is the record. */
  snippet: string;
  createdAt: string;
  /** True when this viewer has marked it read. */
  read: boolean;
};

