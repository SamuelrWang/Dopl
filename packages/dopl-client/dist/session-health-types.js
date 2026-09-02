"use strict";
/**
 * SESSION HEALTH — "is this agent GETTING ANYWHERE", as the seven facts that
 * ride an OWN-scoped session row beside the cost ones (2026-09-01, server
 * migration `20260909120000`).
 *
 * ⚠ **ITS OWN MODULE FOR `launch-types.ts`'s AND `escalation-types.ts`'s REASON:
 * `channel-types.ts` IS AT THE 500-LINE CAP** and cannot take another field.
 * `ChannelSessionStateOwn` intersects this in over there, so no import path
 * changes and there is still one path to every symbol.
 *
 * ⚠ **A HAND MIRROR of `src/features/channels/types-sessions.ts ›
 * ChannelSessionHealth`, WITH NO DRIFT GATE OVER IT** — the rule `home-types.ts`
 * states for its own pair, and the same one `knowledge-types.ts` and
 * `agent-template-types.ts` live under. There is no script comparing these two
 * declarations, so **both halves move in ONE change**: a field added here and not
 * there compiles on both sides and simply never arrives, which is the failure
 * mode a mirror without a gate has.
 *
 * ⚠ **NOTHING HERE MAY RESTATE A RULE.** The server file is where the shape and
 * every argument about it are STATED — what each value is derived from, why
 * `tokensDelta`'s baseline is the last POST rather than the last push, why
 * `stale` is not the other `stale`. What is written here is what a CONSUMER of
 * the SDK cannot get anywhere else: the field's meaning in one line, and the two
 * things a render must never do with it.
 *
 * ⚠ **OPERATOR-ONLY, all seven.** They ride only on own-scoped reads
 * (`listChannelSessions` → `GET /api/channels/sessions`, and the `sessions` block
 * on an await result). A PEER's session never carries them: the server's
 * channel-scoped mapper cannot emit what it never names.
 */
Object.defineProperty(exports, "__esModule", { value: true });
