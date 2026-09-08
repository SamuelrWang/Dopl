import { z } from "zod";
import {
  DEFAULT_MESSAGE_LIMIT,
  MAX_AWAIT_TIMEOUT_MS,
  MAX_MESSAGE_LIMIT,
} from "./constants";

/**
 * THE TWO READ-QUERY SCHEMAS — the transcript's paged read and the await
 * long-poll's hold. Split out of `schema.ts` on 2026-09-01 at the 500-line cap,
 * on the precedent `schema-sessions.ts` / `schema-collab.ts` / `schema-launch.ts`
 * / `schema-direction.ts` already set: `schema.ts` re-exports both, so every
 * existing `@/features/channels/schema` import is unchanged and there is still
 * no second path to a symbol.
 *
 * ⚠ THE PAIR BELONGS TOGETHER. Both are GET query strings over the same table
 * and both key on `seq`; the difference is that one describes a page and the
 * other describes a wait. A cursor rule changed in one and not the other is the
 * bug this file exists to make visible.
 */

/**
 * `?since=<seq>&before=<seq>&limit=<n<=200>&thread=<taskId>` for a message read.
 *
 * `thread` is a FILTER, not a lookup: keeps rows whose `metadata.taskId`
 * equals it. ⚠ Deliberately ANY non-empty string, NOT `.uuid()` — the
 * transcript still carries legacy `task-<channelId>-<seq>` ids from before
 * threads were a table, and `.uuid()` would 400 exactly those.
 *
 * Never checked against `channel_tasks`: an unmatched id returns `[]`, not an
 * error. Length bounded like `clientMsgId`.
 *
 * ⚠ `since` AND `before` ARE THE TWO ENDS OF ONE WINDOW, NOT AN EITHER/OR, and
 * neither is an offset. `since` walks FORWARD (the await/desktop incremental
 * read), `before` walks BACKWARD (the transcript's scroll-up page). Sending both
 * is legal and means a bounded window; `repository-messages.ts › listMessages`
 * states which end the `limit` then bites.
 *
 * ⚠ `before` is `.positive()` where `since` is `.nonnegative()`, and the
 * difference is real: `since=0` means "everything from the beginning", while
 * `before=0` would mean "everything older than the first row", i.e. an
 * unconditionally empty page — a caller that reaches it has computed a cursor
 * wrong and should hear about it.
 *
 * ⚠ **`lineBudget` IS OPT-IN, AND THAT IS WHAT KEEPS THE MCP / DESKTOP READ OUT
 * OF THIS (2026-09-08).** The UI transcript pages by ESTIMATED RENDERED LINES
 * (`constants.ts › CHANNEL_TRANSCRIPT_LINE_BUDGET`) because a row is not a unit
 * a reader experiences; every other caller of this route pages by rows and asks
 * for no budget, so it gets exactly the page it got yesterday. `limit` still
 * bounds the read in BOTH cases — the budget only ever returns FEWER rows than
 * `limit`, never more.
 */
export const MessageReadQuerySchema = z
  .object({
    since: z.coerce.number().int().nonnegative().optional(),
    before: z.coerce.number().int().positive().optional(),
    limit: z.coerce
      .number()
      .int()
      .positive()
      .max(MAX_MESSAGE_LIMIT)
      .optional()
      .default(DEFAULT_MESSAGE_LIMIT),
    thread: z.string().trim().min(1).max(200).optional(),
    // ⚠ NO `.max()`, AND IT NEEDS NONE: `limit` above is the read's bound and
    // the budget can only shrink a page below it, so an absurd budget asks for
    // `limit` rows and gets them. A second ceiling here would be a number with
    // nothing to enforce.
    lineBudget: z.coerce.number().int().positive().optional(),
  })
  // ⚠ **`lineBudget` WITH `since` IS REFUSED, NOT IGNORED** — the same rule
  // `AccountStatusQuerySchema` applies to `view`+`since`, for the same reason.
  // The budget keeps the NEWEST rows of the block it read; a forward read
  // (`since` without `before`) is oldest-first from its cursor, so trimming it
  // would silently drop the rows nearest the cursor and hand back a page with a
  // hole at its front. Nothing asks for that combination today, and a 400 is how
  // it stays that way.
  .refine((q) => q.lineBudget === undefined || q.since === undefined, {
    message: "lineBudget is not supported with since (forward reads page by row)",
    path: ["lineBudget"],
  });
export type MessageReadQuery = z.infer<typeof MessageReadQuerySchema>;

/**
 * `?since=<seq>&timeoutMs<=50000&excludeAuthor=<userId>` for the await
 * long-poll. `excludeAuthor` is OPT-IN: desktop listener omits it (needs its
 * own account's messages for thread targeting, requester-window routing,
 * version-skew observation); MCP await passes the caller's own id so its own
 * posts cannot pop its hold.
 */
export const AwaitQuerySchema = z.object({
  since: z.coerce.number().int().nonnegative().optional(),
  timeoutMs: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_AWAIT_TIMEOUT_MS)
    .optional(),
  excludeAuthor: z.string().uuid().optional(),
});
export type AwaitQuery = z.infer<typeof AwaitQuerySchema>;

/**
 * `?since=<seq>&view=full|sessions` for the ACCOUNT-WIDE status read
 * (`GET /api/channels/account/status`).
 *
 * ⚠ `since` IS OPTIONAL HERE AND REQUIRED ON THE AWAIT, and the difference is
 * the difference between a page and a wait: a status answer with no cursor is a
 * complete, useful answer that simply reports `unread: null` — "not asked" —
 * whereas a hold with no cursor is a firehose. See
 * `server/service-account.ts › AccountChannelStatus.unread`.
 *
 * ⚠ `view` IS A PARAMETER AND THE EXPENSIVE VIEW IS THE DEFAULT (INVARIANTS §9):
 * nothing may get a thinner answer than it asked for, and an unrecognised value
 * is a 400 rather than a silent fall-through to `full`.
 */
export const AccountStatusQuerySchema = z
  .object({
    since: z.coerce.number().int().nonnegative().optional(),
    view: z.enum(["full", "sessions"]).optional().default("full"),
  })
  // ⚠ **`view="sessions"` WITH A `since` IS REFUSED, NOT IGNORED (2026-09-02).**
  // That view skips the cursor arithmetic entirely — `unread` is `null` on every
  // row by construction — so the answer ECHOED a cursor back beside a column that
  // could never be a count, which reads as "0 new everywhere" to anything that
  // does not know the view's shape. Silently dropping the argument is the other
  // wrong answer: a caller that asked a question and got no error believes it was
  // answered. ⚠ It is a REFUSAL rather than an upgrade to `full` for §9's reason
  // in reverse: nothing may get a WIDER answer than it asked for either, and a
  // status read that quietly ran the expensive view is a cost nobody chose.
  .refine((q) => !(q.view === "sessions" && q.since !== undefined), {
    path: ["since"],
    message:
      'since= is not answerable with view="sessions": that view reports no unread counts, so a cursor there would be echoed back beside a column that is always null. Drop since=, or ask for view="full".',
  });
export type AccountStatusQuery = z.infer<typeof AccountStatusQuerySchema>;

/**
 * `?since=<seq>&limit=<n<=200>` for the ACCOUNT-WIDE message read
 * (`GET /api/channels/account/messages`).
 *
 * ⚠ `since` IS REQUIRED. `channel_messages.seq` is a TABLE-WIDE identity, so one
 * cursor really does cover every channel of every workspace at once — and that
 * is exactly why a cursorless call here would return the newest N messages of
 * the caller's entire working life across every tenancy they belong to. The
 * companion read (`MessageReadQuerySchema`) may omit it because it is bounded to
 * ONE channel; this one may not.
 */
export const AccountMessagesQuerySchema = z.object({
  since: z.coerce.number().int().nonnegative(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_MESSAGE_LIMIT)
    .optional()
    .default(DEFAULT_MESSAGE_LIMIT),
});
export type AccountMessagesQuery = z.infer<typeof AccountMessagesQuerySchema>;
