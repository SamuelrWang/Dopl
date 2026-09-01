import { z } from "zod";
import { safeLabel } from "@/shared/lib/safe-label";
import { closedEnum } from "@/shared/lib/closed-enum";
import type { SessionPillState } from "./types";

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
 * THE DESKTOP'S SESSION KEY — `<channelId>:<taskId>:<agentId>`, with an empty
 * middle segment for a responder with no first-class thread
 * (`main/session-store.js#sessionKey`).
 *
 * ⚠ THE THIRD SEGMENT JOINED ON 2026-08-21 (Samuel's multiplayer ruling) and it
 * is the reason this regex changed at all. One operator may now run SEVERAL
 * agents on one thread, so `<channel>:<thread>` stopped identifying a session
 * and the desktop appended the AGENT INSTANCE id
 * (`dopl-desktop-app/main/agent-id.js`, `^[a-z][a-z0-9]{7}$` — no colon, so the
 * key stays unambiguous). Without this widening every push from a current
 * desktop 400s on `Invalid session key`, `retryable(400)` is false, and
 * `read_sessions` answers `[]` for that machine forever.
 *
 * ⚠ CARRIED, never re-derived: composing it from `channelId` + `threadId` here
 * is a SECOND derivation of a key format owned by another process in another
 * language. The desktop owns what a session key IS; this only bounds what it may
 * LOOK like — which is also why the third segment is `{0,64}` rather than an
 * exact 8: bounding it tighter would make this file an authority on the id
 * format, and it is not.
 *
 * ⚠ Charset deliberately tighter than "any text" — the reconcile DELETES BY KEY,
 * so a key carrying a quote or comma is a filter-injection question every time
 * someone touches the repository. Hex, dashes, two colons.
 *
 * ⚠ THE TWO-SEGMENT FORM IS STILL ACCEPTED, deliberately: an older desktop is a
 * supported peer during a rollout (INVARIANTS §13), and refusing its keys would
 * blank its whole workspace's session rows rather than degrade.
 */
// ⚠ ONE LINE, DELIBERATELY. `dopl-desktop-app/test/session-state-push.test.mjs` lifts this
// literal out of this file by regex and drives the desktop's real keys through it, so the two
// trees cannot drift about what a key may look like. A wrapped declaration is invisible to it,
// and the case fails LOUDLY rather than silently passing — keep it on one line.
const SESSION_KEY_RE = /^[0-9a-fA-F-]{1,64}:[0-9a-fA-F-]{0,64}(?::[0-9a-zA-Z-]{0,64})?$/;

/**
 * Friendly handle. ⚠ Matches `channel_sessions.name`'s CHECK character for
 * character (`^[a-z][a-z0-9-]{1,30}$`) so a bad value is a 400 that NAMES the
 * field rather than a constraint violation surfacing as an opaque 500.
 *
 * ⚠ WHAT FILLS IT CHANGED ON 2026-08-21 AND THE BOUND DID NOT HAVE TO. It was a
 * handle from a curated pool ("flint", "onyx"); it is now the agent instance id,
 * whose charset (`^[a-z][a-z0-9]{7}$`) was chosen as a strict SUBSET of this one
 * precisely so no migration and no schema change were needed to ship the
 * multiplayer wave.
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
  /** ⚠ Annotated so TS-side drift breaks the build — see
   *  `schema.ts › VisibilitySchema`. ⚠ AND THE COST OF DRIFT IS UNUSUAL HERE: zod
   *  validates the ARRAY, so one row carrying a fourth value 400s the WHOLE push,
   *  `retryable(400)` is false, and every later push for that workspace fails
   *  identically (INVARIANTS §11). The SQL `CHECK` is a third statement of this
   *  same set and no TypeScript reaches it. */
  state: closedEnum<SessionPillState>()(["working", "idle", "ended"]),
  channelName: safeLabel("Channel name", 120).nullable().optional(),
  threadTitle: safeLabel("Thread title", 200).nullable().optional(),

  // ── TELEMETRY (2026-08-22, migration 20260822150000) ──────────────────────
  //
  // ⚠ EVERY ONE IS `.nullable().optional()`, AND BOTH HALVES ARE LOAD-BEARING.
  // `optional` is the ROLLOUT contract: a desktop older than this wave sends no
  // such key, and a REQUIRED field here would 400 its whole report — `retryable
  // (400)` is false, so that machine's `read_sessions` answers `[]` forever
  // (INVARIANTS §11, §13). `nullable` is the SEMANTIC one: a desktop that HAS
  // this build and genuinely does not know a number sends `null`, which is a
  // different statement from omitting the key and must survive as `null` all
  // the way to the render.
  //
  // ⚠ **NULL IS UNKNOWN. NEVER COERCE ONE TO 0** — see `types.ts ›
  // ChannelSessionTelemetry`. There is no `.default()` anywhere below and there
  // must not be.
  //
  // ⚠ `SESSION_REPORT_MAX` IS UNTOUCHED (still 32) — these are columns on a row
  // that already existed, not more rows. Widening the array bound because rows
  // got wider is the mistake its docblock exists to refuse.
  /**
   * WHICH OF SIX SITUATIONS the session is in — the CLOSED key vocabulary
   * `dopl-desktop-app/main/session-detail.js › detailFor` derives
   * (`thinking` / `tool` / `posting` / `permission` / `awaiting_peer` /
   * `awaiting_inbound`). ⚠ **THE ONE REFINEMENT THAT CROSSES TO A PEER**, and it
   * crosses only because the vocabulary is closed and coarse.
   *
   * ⚠ **NOT A `z.enum`, DELIBERATELY, AND THE REASON IS THE SAME ONE
   * `SESSION_REPORT_MAX` CARRIES.** zod validates the ARRAY: a desktop shipping a
   * SEVENTH key would 400 its ENTIRE push, `retryable(400)` is false, and every
   * later push for that workspace fails identically — leaving `read_sessions`
   * answering `[]` for that machine forever (INVARIANTS §11, §13). An older or
   * NEWER desktop must both degrade, not fail. So the write bound is SHAPE
   * (`safeLabel`, 40 chars — it is spliced into MCP narration and must not be
   * able to open a line), and the closed-VALUE test lives on the READ side in
   * `collab-dto.ts › narrowSessionDetail`, where an unknown key becomes `null`
   * instead of poisoning a push.
   * ⚠ 40 rather than 200: this field is a KEY. A bound that comfortably fits a
   * sentence is a bound that invites one, and a sentence here is operator-only
   * material on a peer-visible column.
   */
  detail: safeLabel("Session detail", 40).nullable().optional(),
  /** The tool running right now. Same charset class, much shorter. */
  toolLabel: safeLabel("Tool label", 80).nullable().optional(),
  /** Model id/label. ⚠ Operator-only on the way OUT, still neutralized on the
   *  way IN — the operator's own result is narration too. */
  model: safeLabel("Model", 120).nullable().optional(),
  // ⚠ `.int().nonnegative()` and NO `.default(0)`. A negative or fractional
  // count is a reporting bug, and refusing it here is a 400 that names the
  // field rather than a nonsense number rendered as fact.
  contextUsed: z.number().int().nonnegative().nullable().optional(),
  contextWindow: z.number().int().nonnegative().nullable().optional(),
  tokensSpent: z.number().int().nonnegative().nullable().optional(),
  /** ⚠ `.datetime()` — these land in TIMESTAMPTZ columns, and an unparseable
   *  string reaches Postgres as a cast error, i.e. an opaque 500 for a
   *  malformed request (the same rule `SessionStateQuerySchema` states). */
  startedAt: z.string().datetime({ offset: true }).nullable().optional(),
  lastActivityAt: z.string().datetime({ offset: true }).nullable().optional(),

  // ── THE AGENT TEMPLATE (2026-08-23, migration 20260823130000) ─────────────
  /**
   * THE TEMPLATE THIS SESSION WAS LAUNCHED FROM, BY NAME, AS OF SPAWN.
   *
   * ⚠ **ACCEPTED HERE BEFORE ANY DESKTOP SENDS IT, AND THAT ORDER IS THE WHOLE
   * POINT.** Phase 1 of the templates wave teaches `main/session-state-push.js`
   * to put `templateName` on the reported row. The two trees ship separately, so
   * for some window a NEWER desktop pushes to an OLDER server — and zod
   * validates the ARRAY, so ONE unknown key on ONE row 400s that machine's WHOLE
   * push, `retryable(400)` is false, and every later push for that workspace
   * fails identically, leaving `read_sessions` answering `[]` for it forever
   * (INVARIANTS §11, §13). ⚠ **A 400 HERE POISONS THE WORKSPACE; IT DOES NOT
   * DROP A FIELD.** So the field lands on the server FIRST and stays inert.
   * (zod objects strip unknown keys rather than refusing them, which would make
   * this merely belt — but the belt is what the additive-fields discipline is,
   * and relying on a parser's default mode for a wire contract is how the
   * default gets changed under you.)
   *
   * ⚠ `.nullable().optional()` for the SAME two reasons the telemetry block
   * states: `optional` is the rollout contract (an older desktop sends no key),
   * `nullable` is the semantic one (a session launched from no template says so
   * explicitly).
   *
   * ⚠ **THE NAME, NEVER THE ID.** The server does not resolve a template here —
   * main captured the resolved template at spawn and reports what it RAN AS, so
   * the value survives a rename or a delete. See
   * `20260823130000_channel_sessions_template_name.sql` for why this is a
   * denormalized snapshot rather than an FK.
   *
   * ⚠ Bound is `safeLabel` at **120** — character for character the column's
   * CHECK, which is itself character for character
   * `agent_templates_name_charset_check`. The mirror is load-bearing: a name
   * that is LEGAL on a template must never be refusable into this projection, or
   * a legitimate launch 400s the operator's entire session push. And it is
   * bounded at all because it is operator-authored free text spliced into MCP
   * narration — operator-only is not the same as trusted, and a newline in your
   * own result forges a line in your own result.
   */
  templateName: safeLabel("Template name", 120).nullable().optional(),

  // ── THE OPERATOR-GIVEN AGENT NAME (2026-08-31, migration 20260905120000) ──
  /**
   * WHAT THE OPERATOR CALLS THIS AGENT ("Bug Reviewer"), snapshotted from the
   * desktop's local name store (`main/agent-names.js`) on every push — the
   * additive column that file's own header promised. ⚠ PEER-VISIBLE BY DESIGN
   * (Samuel's ruling: the other member should see what your agent is called),
   * so unlike `templateName` it maps through `mapPeerSessionStateRow`.
   *
   * ⚠ `.nullable().optional()` on the telemetry block's two grounds: `optional`
   * is the rollout contract (an older desktop sends no key and its whole push
   * must not 400 — INVARIANTS §11, §13); `nullable` is semantic (never named).
   * ⚠ Bound is `safeLabel` at **60** — character for character the column's
   * CHECK, which is itself `main/agent-names.js › MAX_NAME`. Operator-authored
   * free text on a PEER's screen; the newline/zero-width strip is load-bearing.
   */
  displayName: safeLabel("Agent name", 60).nullable().optional(),
});
export type SessionStateEntryInput = z.infer<typeof SessionStateEntrySchema>;

/**
 * The desktop's own ceiling with a lot of room: **the wire set is LIVE ONLY**, so
 * a machine can offer at most
 * `dopl-desktop-app/main/session-windowless.js › MAX_CONCURRENT_SESSIONS` rows
 * (**15 since 2026-09-01**; it was 6 when this was measured on 2026-08-22) and
 * this bound is a little over TWICE that. ⚠ Low enough that a caller cannot use
 * this endpoint to write a table.
 *
 * ⚠ **THE HEADROOM NARROWED AND THE NUMBER DELIBERATELY DID NOT MOVE
 * (2026-09-01).** This docblock read "over five times that" against a cap of 6;
 * the cap's raise to 15 spends most of that margin, and 32 is kept because the
 * bound's JOB is unchanged — it is the "a caller cannot write a table here"
 * fence, not a mirror of the desktop ceiling, and doubling it to preserve a
 * ratio would weaken the only thing it enforces. ⚠ **What DOES have to hold is
 * `SESSION_REPORT_MAX > MAX_CONCURRENT_SESSIONS`**, because the wire set is
 * live-only and zod validates the ARRAY: a cap raised past this bound would
 * 400 the WHOLE push for a busy machine, unretryably (see below). A future
 * raise of the desktop ceiling past ~30 must raise this number in the same
 * change.
 *
 * ⚠ THE OLD DERIVATION ADDED A RETAINED-ENDED TERM, AND THAT TERM IS GONE
 * (2026-08-22, F-255). It read "6 live plus `session-summary.js › MAX_ENDED`
 * (12) retained", and `MAX_ENDED` is DELETED: ended-agent retention moved to a
 * DURABLE seven-day history (`main/agent-history.js`), which no in-memory 12
 * bounds. **The push does not send ended rows at all** —
 * `main/session-state-push.js › liveForWire` drops them before
 * `SessionStateReportSchema` ever sees them — and that filter exists to protect
 * exactly THIS number: a machine holding hundreds of durable ended cards would
 * overflow the array bound, and because zod validates the ARRAY, one oversized
 * payload 400s the WHOLE push, `retryable(400)` is false, and every later push
 * for that workspace fails identically — leaving `read_sessions` answering `[]`
 * for LIVE sessions too, with stale rows never cleared.
 *
 * ⚠ SO THE HEADROOM IS NOT SLACK TO SPEND. Re-deriving this bound from "how many
 * ended agents might a machine hold" is the mistake to refuse; the only term is
 * the live cap, and the answer to a bigger set is to keep it off the wire.
 *
 * ⚠ IT USED TO CITE `MAX_SESSION_WINDOWS`, WHICH IS ALSO DELETED. That was the
 * WINDOW budget, and the v1 session window is gone — the ceiling that survives
 * counts RUNNING sessions, not open windows. The NUMBER did not change on that
 * move (both 6), so this bound was unaffected; the reference had to, because a
 * bound justified against a constant nobody can find is a bound nobody can
 * re-derive.
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
