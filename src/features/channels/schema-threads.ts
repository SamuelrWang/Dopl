import { z } from "zod";
import { closedEnum } from "@/shared/lib/closed-enum";
import { CHANNEL_FANOUT_MAX_ADDRESSEES } from "./constants";
import type { ThreadMode } from "./types";
// ⚠ The retired parameters live in their own module, which carries the delete-me clock.
import {
  REMOVED_PARTICIPANTS,
  REMOVED_THREAD_CLOSE,
  removedOp,
  removedParam,
} from "./schema-removed-params";
import { MessageIntentSchema } from "./schema-intent";

// Split out of `schema.ts` at the 500-line cap (2026-10-11), verbatim; `schema.ts` re-exports
// every name below, so importers of the barrel are unchanged.

/** Task execution mode. `set_task_mode` governs the creator's own machine. */
/** ⚠ Annotated so TS-side drift breaks the build — see `VisibilitySchema`.
 *  ⚠ The DOMAIN name is `ThreadMode`; `task` is the storage spelling (INVARIANTS
 *  §5), which is why the schema and the type do not share a name. */
const TaskModeSchema = closedEnum<ThreadMode>()(["interactive", "autonomous"]);

/**
 * Create a task. `title` = queryable header; `body` = initial request (posted as
 * the task's first message, addressed to `toUserId`); `mode` defaults
 * interactive. `toUserId` must be an active member (service validates).
 * `clientMsgId` idempotency key: a re-send returns the existing task rather than
 * double-creating it AND double-spawning the responder's window.
 *
 * ⚠ `toUserId` is OPTIONAL since 1.37.1: a thread with no target has its opener
 * as its only party and its opening post wakes nobody (address-only wake). The
 * column was always nullable (`ON DELETE SET NULL`), so every reader already
 * handles it. `intent:"chat"` opens it as a RECORD, the MCP `kind="record"`.
 */
export const TaskCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  mode: TaskModeSchema.optional(),
  body: z.string().min(1).max(16000),
  toUserId: z.string().uuid().optional(),
  intent: MessageIntentSchema.optional(),
  // Zod strips unknown keys, so without this a malformed FAN-OUT (`toUserIds: []`)
  // would fall through the union and open a targetless thread instead of a 400.
  toUserIds: removedParam("toUserIds is the fan-out shape; it needs at least one addressee"),
  clientMsgId: z.string().min(1).max(200).optional(),
  /**
   * SPAWN-WITH-HANDOFF: an external agent (the operator's own Claude Desktop / Code
   * over MCP) asks that the driving session open ON THE OPERATOR'S MACHINE.
   * Absent/false → the external create opens nothing locally and keeps the reply.
   * Rides the opening message as reserved `metadata.handoff` (server-written —
   * `service-writes-metadata.resolvePostMetadata`).
   *
   * ⚠ Security gate: the launch predicate ALSO requires `authorUserId === me` AND
   * `taskCreatedBy === me`, so a peer's handoff can never open a window elsewhere.
   *
   * ⚠ **NO CURRENT BUILD READS THIS STAMP (F-274, measured 2026-08-22).**
   * `dopl-desktop-app/main/targeting.js › requesterTaskOpen` has no caller; its
   * listener path went with the session window (F-228). Everything else still happens
   * (accepted, stripped from caller metadata, re-stamped, stored). ⚠ KEPT ON PURPOSE:
   * refusing it would 400 every older external agent for no gain. What was removed is
   * the PROMISE, in `channel-description.ts` and `channel-ops-threads.ts ›
   * opCreateThread`; the live capability is the MCP op `launch_agent`.
   */
  handoff: z.boolean().optional(),
  /** REMOVED (rollback §1) — see {@link removedParam}. */
  participants: removedParam(REMOVED_PARTICIPANTS),
});
export type TaskCreateInput = z.infer<typeof TaskCreateSchema>;

/**
 * Create ONE request against N addressees — the "New agent thread" panel's send.
 * Storage still holds one requester + one target per thread (INVARIANTS §5), so the
 * service loops `createTask`; this is the shape of the ASK, not of a row.
 *
 * ⚠ `toUserIds` is `.min(1)`: **a fan-out with no addressees is a 400**, not an empty
 * success — a surface that accepted it would report a request never raised. The UI
 * disables Send at zero too; only one of the two is the contract.
 *
 * ⚠ `clientMsgId` is REQUIRED here where `TaskCreateSchema` leaves it optional: it is
 * the BASE the per-addressee keys derive from (`server/service-tasks-broadcast.ts ›
 * addresseeClientMsgId`) AND the seed of the group id the N threads share, so a
 * fan-out without one cannot converge on retry. Bounded under `clientMsgId`'s own 200
 * so the derived `${base}:${uuid}` keys stay inside it.
 */
export const TaskFanOutSchema = z.object({
  title: z.string().trim().min(1).max(200),
  mode: TaskModeSchema.optional(),
  body: z.string().min(1).max(16000),
  toUserIds: z
    .array(z.string().uuid())
    .min(1, { error: "Address at least one agent" })
    .max(CHANNEL_FANOUT_MAX_ADDRESSEES),
  clientMsgId: z.string().min(1).max(120),
});
export type TaskFanOutInput = z.infer<typeof TaskFanOutSchema>;

/**
 * What POST `/channels/[channelId]/tasks` accepts: the fan-out shape or the
 * single-target one. ⚠ Plain union, FAN-OUT FIRST, and the order is load-bearing —
 * there is no discriminator to add without breaking every installed caller, and zod
 * STRIPS unknown keys, so a `{toUserIds}` body checked against
 * {@link TaskCreateSchema} first would parse as a targetless thread. The single arm
 * refuses a `toUserIds` key outright, so first-match is exact.
 */
export const TaskCreatePayloadSchema = z.union([
  TaskFanOutSchema,
  TaskCreateSchema,
]);
type TaskCreatePayloadInput = z.infer<typeof TaskCreatePayloadSchema>;

/** True for the fan-out arm of {@link TaskCreatePayloadSchema}. */
export function isTaskFanOutInput(
  input: TaskCreatePayloadInput
): input is TaskFanOutInput {
  return Array.isArray((input as TaskFanOutInput).toUserIds);
}

/**
 * Update a task. ONE op survives: `set_mode` — creator only.
 *
 * ⚠ THREADS NO LONGER CLOSE (wiring plan Phase 4, 2026-08-18): the services behind
 * `close`, `propose_close` and `reopen` are DELETED, and the operator pauses or ends
 * an AGENT, not a thread. ⚠ **THE THREE SURVIVE AS TOMBSTONES ({@link removedOp}),
 * WHICH IS NOT THE SAME AS KEEPING THEM** — each parses, then always fails, naming
 * the replacement. (Zod reports `invalid_union` / "Invalid input", not an invalid
 * enum value, so an installed desktop's close request came back as a generic 400.)
 *
 * ⚠ STILL A DISCRIMINATED UNION, ON PURPOSE: the wire shape is `{op, …}` and a bare
 * object would make `op` optional-by-omission. ⚠ **ONE LIVE ARM** — a second real op
 * goes in beside `set_mode`.
 */
const TaskUpdateUnion = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set_mode"), mode: TaskModeSchema }),
  removedOp("close", REMOVED_THREAD_CLOSE),
  removedOp("propose_close", REMOVED_THREAD_CLOSE),
  removedOp("reopen", REMOVED_THREAD_CLOSE),
]);

/**
 * ⚠ THE PARSED TYPE IS THE LIVE ARM ALONE. A tombstone never PRODUCES a value (its
 * refinement always fails), so the union's inferred output describes three results the
 * parser cannot return; `Extract` states what `safeParse` can actually hand back.
 */
type TaskUpdateInput = Extract<
  z.infer<typeof TaskUpdateUnion>,
  { op: "set_mode" }
>;
export const TaskUpdateSchema =
  TaskUpdateUnion as unknown as z.ZodType<TaskUpdateInput>;

