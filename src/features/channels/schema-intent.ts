import { closedEnum } from "@/shared/lib/closed-enum";
import type { MessageIntent } from "./types";

// A leaf (no channel-schema imports), so `schema.ts` and `schema-tasks.ts` can both use it
// without a require cycle through the barrel. Split out of `schema.ts` 2026-10-11.

/**
 * CHAT vs REQUEST — whether a post may reach anybody's agent.
 *  - `request` (DEFAULT) — an EXPLICIT `toUserId` addresses, and the receiving
 *    listener triggers on it.
 *  - `chat` — human talk: it STATES that this post is not work for anybody, and keeps
 *    the post out of an open DM thread (`resolvePostMetadata` resolves no peer).
 *
 * ⚠ `chat` no longer has an AUTO-ADDRESS to suppress — the DM fallback was retired
 * 2026-08-18 (wiring plan Phase 3). What survives is the DECLARATION and the
 * inheritance gate. ⚠ `chat` + explicit human `to` is a contradiction → 400
 * `CHANNEL_CHAT_ADDRESSED` (`server/errors.ts`), never silently resolved: addressing a
 * person starts their agent on a subject they saw no title for.
 */
export const MessageIntentSchema = closedEnum<MessageIntent>()(["chat", "request"]);
