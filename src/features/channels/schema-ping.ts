import { z } from "zod";
import { closedEnum } from "@/shared/lib/closed-enum";
import {
  MAX_AWAIT_TIMEOUT_MS,
  MAX_PING_BODY,
  MAX_PING_LIMIT,
  DEFAULT_PING_LIMIT,
} from "./constants";
import type { PingKind } from "./types-ping";

/**
 * THE "NEEDS YOU" SIGNAL's schemas (2026-09-01) — `schema-direction.ts`'s
 * arrangement, re-exported from `schema.ts` so that stays the one barrel.
 *
 * 🔒 **NO SCHEMA HERE HAS A `senderUserId` FIELD, AND THE TWO SELF-SCOPED
 * RECIPIENT FORMS HAVE NO OPERATOR FIELD EITHER.** The service stamps `ctx.userId`
 * for the sender always, and for the recipient whenever the caller said
 * `toDesktop` or `agentId`. That absence IS the loop brake — an agent cannot ping
 * another member's agent because there is no request field with which to say so —
 * so it is asserted in `server/service-pings.test.ts` rather than left to review.
 */

/** The agent-id grammar, `dopl-desktop-app/main/agent-id.js › AGENT_ID_RE`'s.
 *  ⚠ Restated here AND as the column CHECK — three statements of one rule, the
 *  same arrangement `DirectionCreateSchema.agentId` already has. */
const AGENT_ID_RE = /^[a-z][a-z0-9]{7}$/;

/** ⚠ `closedEnum` so TS-side drift BREAKS THE BUILD. The column CHECK is the
 *  third statement of this set and no TypeScript can reach it. */
export const PingKindSchema = closedEnum<PingKind>()([
  "done",
  "question",
  "blocked",
]);

/**
 * SEND A PING.
 *
 * ⚠ `channel` IS NOT `.uuid()` — a slug or an id, resolved server-side, exactly
 * as `DirectionCreateSchema.channel` is.
 * ⚠ **EXACTLY ONE RECIPIENT FIELD, ENFORCED HERE RATHER THAN IN THE SERVICE.**
 * Zero would be a signal with nowhere to go; two would make the service pick, and
 * a silently-dropped address is the invisible-delivery failure the addressing
 * contract exists to prevent. The refinement names the count it saw, because a
 * caller that sent two cannot tell which one the server would have honoured.
 * ⚠ `to` IS A MEMBER REFERENCE, NOT A USER ID — an email or an id, resolved
 * server-side against the ACTIVE roster the way a post's `to` is.
 * ⚠ `body` IS BOUNDED AT 600, far under a message's 16000, and the bound is the
 * feature: a ping is a signal, and the thread it points at is where the report
 * lives. A cap that invited a report would produce pings nobody reads, which is
 * the failure this surface exists to fix.
 */
export const PingCreateSchema = z
  .object({
    channel: z.string().min(1).max(200),
    threadId: z.string().uuid().optional(),
    kind: PingKindSchema,
    body: z.string().trim().min(1).max(MAX_PING_BODY),
    to: z.string().trim().min(1).max(200).optional(),
    toDesktop: z.literal(true).optional(),
    agentId: z.string().regex(AGENT_ID_RE, "Invalid agent id").optional(),
  })
  .superRefine((value, ctx) => {
    const given = [value.to, value.toDesktop, value.agentId].filter(
      (field) => field !== undefined
    ).length;
    if (given === 1) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["to"],
      message:
        given === 0
          ? "A ping needs exactly one recipient: to (a member), toDesktop, or agentId."
          : `A ping takes exactly one recipient, but ${given} were given: send to, toDesktop, or agentId — never more than one.`,
    });
  });
export type PingCreateInput = z.infer<typeof PingCreateSchema>;

/**
 * `?since=<seq>&limit=<n<=100>` — THE INBOX CATCH-UP READ.
 *
 * ⚠ `since` IS A PING `seq`, NEVER A MESSAGE ONE. The two cursor spaces are
 * separate by construction (the migration header says why), so a caller that
 * crosses them reads a plausible, wrong page rather than an error. It is
 * `.nonnegative()` for `MessageReadQuerySchema.since`'s reason: `since=0` means
 * "everything from the beginning".
 */
export const PingListQuerySchema = z.object({
  since: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_PING_LIMIT)
    .optional()
    .default(DEFAULT_PING_LIMIT),
});
export type PingListQuery = z.infer<typeof PingListQuerySchema>;

/**
 * `?since=<seq>&timeoutMs<=50000` — THE HELD READ.
 *
 * ⚠ IT IS `AwaitQuerySchema` MINUS `excludeAuthor`, DELIBERATELY, and the absence
 * is the point: a message await excludes the caller's own posts so its own writes
 * cannot pop its hold, but a ping is never delivered to its own sender — the
 * recipient fence already excludes it — so the param would be a knob with no
 * effect. `timeoutMs` shares the message await's cap because it shares the
 * deadline chain underneath it (route `maxDuration` 60 > client 55s > this 50s).
 */
export const PingAwaitQuerySchema = z.object({
  since: z.coerce.number().int().nonnegative().optional(),
  timeoutMs: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_AWAIT_TIMEOUT_MS)
    .optional(),
});
export type PingAwaitQuery = z.infer<typeof PingAwaitQuerySchema>;
