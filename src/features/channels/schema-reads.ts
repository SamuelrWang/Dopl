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
 */
export const MessageReadQuerySchema = z.object({
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
