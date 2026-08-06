import { z } from "zod";
import { safeLabel } from "@/shared/lib/safe-label";

/**
 * READ-SESSION-STATE's two schemas (rollback §3.5) — the `?channelId=` of the
 * READ and the body of the WRITE.
 *
 * SPLIT OUT OF `schema.ts` (§2), which stood at 487/500: the write schema below
 * does not fit there, and "trim a comment to buy the line you need" is the exact
 * habit §2 names as how eight files converged on the cap. The seam is the one §2
 * lists third — a sub-feature with its own surface — and `schema.ts` re-exports
 * both names, so every existing import path is unchanged.
 */

/** `?channelId=<uuid>` for read-session-state.
 *
 * F-145 — IT WAS UNVALIDATED. The route read the param and handed it straight to
 * `.eq("channel_id", …)`, so `?channelId=oops` reached Postgres as a uuid cast
 * and came back as a raw driver error that `mapChannelError` does not own — a
 * 500 for what is plainly a malformed request. Same shape and same fix as the
 * consent inbox's `ConsentListQuerySchema`, which is the only other
 * `?channelId=` on this surface.
 */
export const SessionStateQuerySchema = z.object({
  channelId: z.string().uuid().optional(),
});
export type SessionStateQuery = z.infer<typeof SessionStateQuerySchema>;

/**
 * THE DESKTOP'S SESSION KEY — `<channelId>:<taskId>`, and `<channelId>:` for a
 * responder with no first-class thread (`main/session-store.js#sessionKey`).
 *
 * It is CARRIED, not re-derived. The server could compose it from `channelId`
 * and `threadId`, and that would be a second derivation of a key format owned by
 * another process in another language — F-142's "one derivation, every consumer
 * is handed the result", which this whole surface exists to honour. The desktop
 * owns what a session key IS; this only bounds what it may LOOK like.
 *
 * The charset is deliberately tighter than "any text": the reconcile deletes by
 * key, so a key carrying a quote or a comma would be a filter-injection question
 * every time someone touches the repository. Hex, dashes, one colon — a uuid
 * pair and nothing else — makes that question unaskable.
 */
const SESSION_KEY_RE = /^[0-9a-fA-F-]{1,64}:[0-9a-fA-F-]{0,64}$/;

/**
 * The friendly handle, matching `channel_sessions.name`'s CHECK character for
 * character (`^[a-z][a-z0-9-]{1,30}$`). The generator only ever emits `flint` or
 * `flint-2` (`main/agent-names.js`), so this refuses nothing legitimate — it is
 * here so a bad value is a 400 that NAMES the field rather than a constraint
 * violation surfacing as an opaque 500.
 */
const SESSION_NAME_RE = /^[a-z][a-z0-9-]{1,30}$/;

/**
 * ONE SESSION, as the desktop reports it. The field names are the
 * `ChannelSessionState` ones (the read's shape), not the column names, so the
 * two halves of this endpoint speak the same vocabulary.
 *
 * `channelName` / `threadTitle` are COUNTERPARTY-INFLUENCED text on their way
 * into a `dopl_channel` result, and their bounds are the migration's CHECKs:
 * `safeLabel`'s class (trimmed, no control / zero-width / bidi / line-separator
 * characters) at 120 and 200 — the lengths `channels.name` and
 * `channel_tasks.title` themselves carry, so a legitimate name or title can
 * never be refused on the way into this projection. `null` is legitimate (a
 * session whose channel name never resolved, a responder with no thread), which
 * is why each is `.nullable()` rather than merely optional.
 */
const SessionStateEntrySchema = z.object({
  sessionKey: z.string().regex(SESSION_KEY_RE, "Invalid session key"),
  channelId: z.string().uuid(),
  threadId: z.string().uuid().nullable().optional(),
  name: z.string().regex(SESSION_NAME_RE, "Invalid session handle"),
  // The closed set the `state` CHECK carries, and deliberately no `thinking`
  // (rollback §3.3: the pill has no such state to report).
  state: z.enum(["working", "idle", "ended"]),
  channelName: safeLabel("Channel name", 120).nullable().optional(),
  threadTitle: safeLabel("Thread title", 200).nullable().optional(),
});
export type SessionStateEntryInput = z.infer<typeof SessionStateEntrySchema>;

/**
 * THE CAP IS THE DESKTOP'S OWN CEILING, WITH ROOM. A machine can hold
 * `MAX_SESSION_WINDOWS` (6) live sessions plus `MAX_ENDED` (12) retained ones,
 * so 32 is comfortably above any real report and low enough that a caller
 * cannot use this endpoint to write a table.
 */
const SESSION_REPORT_MAX = 32;

/**
 * POST body — THE WHOLE LIVE SET for one workspace, not a delta.
 *
 * WHY THE WHOLE SET. The row lifetime is "as long as the pill", and a delta
 * protocol needs an explicit removal message that a crashed or quit desktop
 * never sends — rows would then accumulate exactly as plan §5 forbids. A full
 * set makes removal implicit: anything the caller no longer lists is gone. The
 * migration's own upsert note says the same ("the desktop upserts the whole live
 * set on every state change").
 *
 * DUPLICATE KEYS ARE REFUSED rather than deduped. Two entries for one key would
 * hit `ON CONFLICT` twice in one statement — Postgres raises 21000 and the
 * caller reads an opaque 500 — and there is no honest way to pick which of two
 * contradictory states for the same session is the true one.
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
