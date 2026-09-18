import { z } from "zod";
import {
  DEFAULT_MESSAGE_LIMIT,
  MAX_AWAIT_TIMEOUT_MS,
  MAX_MESSAGE_LIMIT,
} from "./constants";

/**
 * THE TWO READ-QUERY SCHEMAS — the transcript's paged read and the await long-poll's
 * hold. Split out of `schema.ts` on 2026-09-01 at the 500-line cap, on the precedent
 * `schema-sessions.ts` / `schema-collab.ts` / `schema-launch.ts` /
 * `schema-direction.ts` set; `schema.ts` re-exports both, so there is still no second
 * path to a symbol.
 *
 * ⚠ THE PAIR BELONGS TOGETHER: both are GET query strings over the same table and
 * both key on `seq`. A cursor rule changed in one and not the other is the bug this
 * file exists to make visible.
 */

/**
 * `?since=<seq>&before=<seq>&limit=<n<=200>&thread=<taskId>` for a message read.
 *
 * `thread` is a FILTER, not a lookup: it keeps rows whose `metadata.taskId` equals it,
 * and an unmatched id returns `[]`, not an error. ⚠ Deliberately ANY non-empty string,
 * NOT `.uuid()` — the transcript still carries legacy `task-<channelId>-<seq>` ids
 * from before threads were a table.
 *
 * ⚠ `since` AND `before` ARE THE TWO ENDS OF ONE WINDOW, NOT AN EITHER/OR, and neither
 * is an offset: `since` walks FORWARD (the await/desktop incremental read), `before`
 * walks BACKWARD (the scroll-up page), and sending both is legal.
 * `repository-messages.ts › listMessages` states which end the `limit` then bites.
 * ⚠ `before` is `.positive()` where `since` is `.nonnegative()`: `since=0` is
 * "everything from the beginning", while `before=0` would be an unconditionally empty
 * page — a miscomputed cursor, and the caller should hear about it.
 *
 * ⚠ **`lineBudget` IS OPT-IN, AND THAT IS WHAT KEEPS THE MCP / DESKTOP READ OUT OF
 * THIS (2026-09-08).** The UI transcript pages by ESTIMATED RENDERED LINES
 * (`constants.ts › CHANNEL_TRANSCRIPT_LINE_BUDGET`); every other caller pages by rows
 * and asks for no budget. `limit` still bounds the read in BOTH cases — the budget
 * only ever returns FEWER rows, never more.
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
    // ⚠ NO `.max()`, AND IT NEEDS NONE: `limit` above is the read's bound and the
    // budget can only shrink a page below it.
    lineBudget: z.coerce.number().int().positive().optional(),
  })
  // ⚠ **`lineBudget` WITH `since` IS REFUSED, NOT IGNORED** — the same rule
  // `AccountStatusQuerySchema` applies to `view`+`since`. The budget keeps the NEWEST
  // rows of the block it read, so trimming an oldest-first forward read would hand
  // back a page with a hole at its front.
  .refine((q) => q.lineBudget === undefined || q.since === undefined, {
    message: "lineBudget is not supported with since (forward reads page by row)",
    path: ["lineBudget"],
  });
export type MessageReadQuery = z.infer<typeof MessageReadQuerySchema>;

/**
 * `?since=<seq>&timeoutMs<=50000&excludeAuthor=<userId>` for the await long-poll.
 * `excludeAuthor` is OPT-IN: the desktop listener omits it (it needs its own account's
 * messages for thread targeting, requester-window routing and version-skew
 * observation); MCP await passes the caller's own id so its posts cannot pop its hold.
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
 * ⚠ `since` IS OPTIONAL HERE AND REQUIRED ON THE AWAIT — the difference between a page
 * and a wait: a status answer with no cursor reports `unread: null` ("not asked"),
 * whereas a hold with no cursor is a firehose (`server/service-account.ts ›
 * AccountChannelStatus.unread`). ⚠ `view` IS A PARAMETER AND THE EXPENSIVE VIEW IS THE
 * DEFAULT (INVARIANTS §9): nothing may get a thinner answer than it asked for, and an
 * unrecognised value is a 400 rather than a silent fall-through to `full`.
 */
export const AccountStatusQuerySchema = z
  .object({
    since: z.coerce.number().int().nonnegative().optional(),
    view: z.enum(["full", "sessions"]).optional().default("full"),
  })
  // ⚠ **`view="sessions"` WITH A `since` IS REFUSED, NOT IGNORED (2026-09-02).** That
  // view skips the cursor arithmetic entirely, so echoing a cursor back reads as "0 new
  // everywhere" — and silently dropping the argument is the other wrong answer. ⚠ A
  // REFUSAL rather than an upgrade to `full` for §9's reason in reverse: nothing may
  // get a WIDER answer than it asked for either.
  .refine((q) => !(q.view === "sessions" && q.since !== undefined), {
    path: ["since"],
    message:
      'since= is not answerable with view="sessions": that view reports no unread counts, so a cursor there would be echoed back beside a column that is always null. Drop since=, or ask for view="full".',
  });
export type AccountStatusQuery = z.infer<typeof AccountStatusQuerySchema>;

/**
 * `?since=<seq>&limit=<n<=200>` for the ACCOUNT-WIDE message read
 * (`GET /api/channels/account/messages`). ⚠ `since` IS REQUIRED:
 * `channel_messages.seq` is a TABLE-WIDE identity, so a cursorless call would return
 * the newest N messages of the caller's entire working life across every tenancy they
 * belong to. The companion read (`MessageReadQuerySchema`) may omit it because it is
 * bounded to ONE channel.
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

/**
 * 🔒 **THE SCOPE OF A CHANNEL LIST — R-26's parameter, and the whole of the
 * collapse** (Samuel, 2026-09-17: *one endpoint*).
 *
 * `container` = today's list, fenced by membership of the named container.
 * `account` = every container the caller is a member of, fenced by the USER.
 *
 * ⚠ **AN UNRECOGNISED VALUE IS A 400, NEVER A SILENT FALL-THROUGH** (§9) — a
 * mistyped scope that quietly answered the narrower list is the failure mode a
 * default would hide.
 *
 * ⚠ **ABSENT DEFAULTS TO `container`, WHICH IS WHAT EVERY EXISTING CALLER MEANS.**
 * The SDK, the desktop and the MCP loopback all send no scope and all want the
 * workspace list; making the parameter required would break them for no gain. The
 * CLIENT sends it explicitly at both scopes anyway, so the two cache entries are
 * distinct tuples.
 */
export const ChannelListQuerySchema = z.object({
  scope: z.enum(["container", "account"]).optional().default("container"),
});
export type ChannelListQuery = z.infer<typeof ChannelListQuerySchema>;
