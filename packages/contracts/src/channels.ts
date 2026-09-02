/**
 * CHANNEL CLOSED SETS — the message vocabulary and the four small channel
 * enums, stated ONCE for all three trees.
 *
 * ⚠ **THIS FILE IS THE REFERENCE, AND "REFERENCE" NOW MEANS THE COMPILER
 * ENFORCES IT.** Until 2026-09-02 each of these unions was written twice —
 * `src/features/channels/types.ts` and `packages/dopl-client/src/channel-types.ts`,
 * plus the SDK's committed `dist/` as a third — and only
 * `scripts/check-message-kind-drift.ts` held two of them together. Both files now
 * RE-EXPORT from here, so the names consumers import are unchanged and a
 * disagreement between the trees is no longer expressible.
 *
 * ⚠ **WHAT IS STILL OUTSIDE THE COMPILER'S REACH, and therefore still gated:**
 * the `channel_messages.kind` / `.author_kind` column `CHECK`s in
 * `supabase/migrations/20260725120000_channels.sql`. SQL can import nothing.
 * `check-message-kind-drift.ts` now compares exactly that one pair — this file
 * against the two CHECKs — which is the whole of what a script can still add.
 *
 * ⚠ **TYPE-ONLY, LIKE EVERY MODULE IN THIS PACKAGE** (see `index.ts`). Nothing
 * here may become a `const`: a runtime export would make `@dopl/contracts` a
 * build input for four bundlers instead of a declaration every one of them
 * erases.
 */

/** Private = members only. Public = any workspace member can read/join. */
export type ChannelVisibility = "private" | "public";

/** Channel-scoped role: the creator is `owner`, everyone added is `member`. */
export type ChannelRole = "owner" | "member";

/** How a thread is worked: interactive (multi-turn) or autonomous. */
export type ThreadMode = "interactive" | "autonomous";

/**
 * ⚠ LEGACY AND UNREAD SINCE 2026-08-18 (wiring plan Phase 4). THREADS DO NOT
 * CLOSE — no close, no propose-then-confirm, no reopen; the operator pauses or
 * ends an AGENT. `channel_tasks.status` and its CHECK constraint survive
 * carrying rows closed before the removal (dropping the column is a migration
 * behind a desktop-floor raise, INVARIANTS §13), and this type is the projection
 * of that column. **Nothing writes it and nothing may branch on it.** A new
 * `=== "open"` filter is a bug: it hides legacy rows from a list that is
 * supposed to hold everything.
 */
export type ThreadStatus = "open" | "closed";

/** Legacy, on {@link ThreadStatus}'s terms — the outcome of a close that can no
 *  longer happen. Null on every thread opened since. */
export type ThreadOutcome = "completed" | "failed";

/** Who wrote a message: a human, an agent (MCP/CLI), or the system. */
export type MessageAuthorKind = "user" | "agent" | "system";

/**
 * The author kinds a CALLER may claim. `system` is server-reserved — an
 * anonymized system-styled post is a forgery primitive — and this type is what
 * `schema.ts › PostableAuthorKindSchema` is closed over, so the carve-out is
 * DERIVED rather than re-typed. Widening {@link MessageAuthorKind} without a
 * decision about this one is a compile error, not a silent widening.
 */
export type PostableAuthorKind = Exclude<MessageAuthorKind, "system">;

/**
 * Message kind. `message` = chat; the `task_*` values are structured activity
 * events (payload in `metadata`, human-readable render in `body`); `system` =
 * joins / topic changes, server-emitted only.
 */
export type ChannelMessageKind =
  | "message"
  | "task_started"
  | "task_progress"
  | "task_finished"
  | "task_failed"
  | "system";

/**
 * The message kinds a CALLER may post — the full set MINUS the server-owned one,
 * DERIVED, never re-typed, which is what makes `schema.ts ›
 * PostableMessageKindSchema`'s `closedEnum` a proof rather than a second list to
 * keep in step.
 *
 * ⚠ POSTABLE IS NOT AGENT-WRITABLE. An agent token may write exactly `message`
 * and `task_progress`; the three lifecycle kinds are refused from it at two
 * layers on the CREDENTIAL (INVARIANTS §5,
 * `server/service-writes-lifecycle.ts`). That is an authorization, not a shape,
 * and it is deliberately not expressed here.
 */
export type PostableMessageKind = Exclude<ChannelMessageKind, "system">;

/**
 * Whether a post may REACH AN AGENT.
 *  - `request` — DEFAULT: an explicit `toUserId` addresses, and that is the only
 *    thing that does. ⚠ The DM auto-address that used to fill it in was retired
 *    2026-08-18 (wiring plan Phase 3).
 *  - `chat` — human talk; DECLARES that the post is work for nobody, and never
 *    inherits an open DM thread.
 *
 * Absence means `request` and stamps NO metadata key, so existing callers' wire
 * is unchanged. `chat` + explicit address → 400 `CHANNEL_CHAT_ADDRESSED`.
 */
export type MessageIntent = "chat" | "request";
