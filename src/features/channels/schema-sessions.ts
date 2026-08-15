import { z } from "zod";
import { safeLabel } from "@/shared/lib/safe-label";

/**
 * READ-SESSION-STATE's two schemas — the `?channelId=` of the READ and the body
 * of the WRITE. `schema.ts` re-exports both names, so every existing import path
 * is unchanged.
 */

/** `?channelId=<uuid>` for read-session-state.
 *
 * ⚠ Must stay validated: handed straight to `.eq("channel_id", …)`, an
 * unvalidated `?channelId=oops` reaches Postgres as a uuid cast and returns a
 * raw driver error `mapChannelError` does not own — a 500 for a malformed
 * request. Same shape as the consent inbox's `ConsentListQuerySchema`.
 */
export const SessionStateQuerySchema = z.object({
  channelId: z.string().uuid().optional(),
});
export type SessionStateQuery = z.infer<typeof SessionStateQuerySchema>;

/**
 * THE DESKTOP'S SESSION KEY — `<channelId>:<taskId>`, and `<channelId>:` for a
 * responder with no first-class thread (`main/session-store.js#sessionKey`).
 *
 * ⚠ CARRIED, never re-derived: composing it from `channelId` + `threadId` here
 * is a SECOND derivation of a key format owned by another process in another
 * language. The desktop owns what a session key IS; this only bounds what it may
 * LOOK like.
 *
 * ⚠ Charset deliberately tighter than "any text" — the reconcile DELETES BY KEY,
 * so a key carrying a quote or comma is a filter-injection question every time
 * someone touches the repository. Hex, dashes, one colon.
 */
const SESSION_KEY_RE = /^[0-9a-fA-F-]{1,64}:[0-9a-fA-F-]{0,64}$/;

/**
 * Friendly handle. ⚠ Matches `channel_sessions.name`'s CHECK character for
 * character (`^[a-z][a-z0-9-]{1,30}$`) so a bad value is a 400 that NAMES the
 * field rather than a constraint violation surfacing as an opaque 500.
 */
const SESSION_NAME_RE = /^[a-z][a-z0-9-]{1,30}$/;

/**
 * ONE SESSION, as the desktop reports it. Field names are the
 * `ChannelSessionState` ones, not the column names, so both halves of this
 * endpoint speak one vocabulary.
 *
 * ⚠ `channelName` / `threadTitle` are COUNTERPARTY-INFLUENCED text on their way
 * into a `dopl_channel` result. Bounds are the migration's CHECKs: `safeLabel`'s
 * class at 120 and 200 — the lengths `channels.name` and `channel_tasks.title`
 * carry, so a legitimate name can never be refused into this projection.
 * `.nullable()` rather than optional because `null` is legitimate.
 */
const SessionStateEntrySchema = z.object({
  sessionKey: z.string().regex(SESSION_KEY_RE, "Invalid session key"),
  channelId: z.string().uuid(),
  threadId: z.string().uuid().nullable().optional(),
  name: z.string().regex(SESSION_NAME_RE, "Invalid session handle"),
  // ⚠ The closed set the `state` CHECK carries — deliberately no `thinking`.
  state: z.enum(["working", "idle", "ended"]),
  channelName: safeLabel("Channel name", 120).nullable().optional(),
  threadTitle: safeLabel("Thread title", 200).nullable().optional(),
});
export type SessionStateEntryInput = z.infer<typeof SessionStateEntrySchema>;

/**
 * The desktop's own ceiling with room: a machine holds `MAX_SESSION_WINDOWS` (6)
 * live plus `MAX_ENDED` (12) retained. ⚠ Low enough that a caller cannot use this
 * endpoint to write a table.
 */
const SESSION_REPORT_MAX = 32;

/**
 * POST body — ⚠ THE WHOLE LIVE SET for one workspace, never a delta. The row
 * lifetime is "as long as the pill", and a delta protocol needs an explicit
 * removal message a crashed or quit desktop never sends, so rows accumulate. A
 * full set makes removal implicit: anything not listed is gone.
 *
 * ⚠ DUPLICATE KEYS ARE REFUSED, not deduped — two entries for one key hit
 * `ON CONFLICT` twice in one statement (Postgres 21000 → opaque 500), and there
 * is no honest way to pick which contradictory state is true.
 */
export const SessionStateReportSchema = z.object({
  sessions: z
    .array(SessionStateEntrySchema)
    .max(SESSION_REPORT_MAX)
    .refine(
      (list) => new Set(list.map((s) => s.sessionKey)).size === list.length,
      { message: "Duplicate session keys in one report" }
    ),
});
export type SessionStateReportInput = z.infer<typeof SessionStateReportSchema>;
