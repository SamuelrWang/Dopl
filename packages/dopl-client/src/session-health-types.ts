/**
 * SESSION HEALTH — "is this agent GETTING ANYWHERE", as the seven facts that
 * ride an OWN-scoped session row beside the cost ones (2026-09-01, server
 * migration `20260909120000`).
 *
 * ⚠ **ITS OWN MODULE FOR `launch-types.ts`'s AND `escalation-types.ts`'s REASON:
 * `channel-types.ts` IS AT THE 500-LINE CAP.** `ChannelSessionStateOwn`
 * intersects this in over there, so no import path changes and there is still
 * one path to every symbol.
 *
 * ⚠ **THE HAND MIRROR THIS FILE OPENED WITH IS GONE (2026-09-02, v2 slice A13).**
 * It said this was "A HAND MIRROR of `src/features/channels/types-sessions.ts ›
 * ChannelSessionHealth`, WITH NO DRIFT GATE OVER IT", then a gate was written,
 * then the gate counted FOUR declarations of one 7-field type. The type is now
 * declared once, in `@dopl/contracts › sessions.ts`, and re-exported here under
 * the same name — so no consumer import changed and the two trees can no longer
 * disagree.
 *
 * ⚠ **WHY IT NEEDED A GATE AT ALL, AND WHY TWO SITES STILL DO.** Every field is
 * `optional` AND `nullable` by design — an older desktop must not 400 its whole
 * push — so drift here fails no build and no test: the field just never arrives.
 * The zod half (`schema-sessions.ts`) and the migration's columns are still
 * outside any compiler, and `scripts/check-session-health-drift.ts` still
 * compares exactly those two against the package.
 *
 * ⚠ **OPERATOR-ONLY, all seven.** They ride only on own-scoped reads
 * (`listChannelSessions` → `GET /api/channels/sessions`, and the `sessions` block
 * on an await result). A PEER's session never carries them: the server's
 * channel-scoped mapper cannot emit what it never names.
 */
import type { ChannelSessionHealth } from "@dopl/contracts";

export type { ChannelSessionHealth };
