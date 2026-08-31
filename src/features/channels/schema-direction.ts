import { z } from "zod";
import { closedEnum } from "@/shared/lib/closed-enum";
import type { DirectionRefusalReason } from "./types-direction";

/**
 * THE PRIVATE DIRECT LANE's schemas (2026-08-31) — `schema-launch.ts`'s
 * arrangement, re-exported from `schema.ts` so that stays the one barrel.
 *
 * 🔒 **NO SCHEMA HERE HAS AN `operatorUserId` FIELD, AND NONE MAY EVER GET ONE.**
 * The only machine an agent may direct is its own operator's; the service stamps
 * `ctx.userId` and there is no request field that could say otherwise. That
 * absence IS the authorization story, so it is asserted in
 * `server/service-directions.test.ts` rather than left to review.
 */

/** The agent-id grammar, `dopl-desktop-app/main/agent-id.js › AGENT_ID_RE`'s.
 *  ⚠ Restated here AND as the column CHECK — three statements of one rule, the
 *  same arrangement `LaunchDecideSchema`'s `agentId` already has. */
const AGENT_ID_RE = /^[a-z][a-z0-9]{7}$/;

/**
 * FILE A DIRECTION.
 *
 * ⚠ `channel` IS NOT `.uuid()` — a slug or an id, resolved server-side, exactly
 * as `LaunchCreateSchema.channel` is.
 * ⚠ `agentId` IS REQUIRED, where the launch lane has no such field at all. See
 * `types-direction.ts › AgentDirection.agentId` for why there is no fallback.
 * ⚠ `body` IS BOUNDED AT 4000 to match the desktop's own `MESSAGE_CAP` and the
 * preload's `.slice(0, 4000)`. A larger cap here would truncate at the far end
 * and narrate success — the invisible-delivery failure this surface refuses.
 */
export const DirectionCreateSchema = z.object({
  channel: z.string().min(1).max(200),
  agentId: z.string().regex(AGENT_ID_RE, "Invalid agent id"),
  threadId: z.string().uuid().optional(),
  body: z.string().trim().min(1).max(4000),
});
export type DirectionCreateInput = z.infer<typeof DirectionCreateSchema>;

export const DirectionClaimSchema = z.object({
  directionId: z.string().uuid(),
});
export type DirectionClaimInput = z.infer<typeof DirectionClaimSchema>;

/** ⚠ `closedEnum` so TS-side drift BREAKS THE BUILD. The column CHECK is the
 *  third statement of this set and no TypeScript can reach it. */
export const DirectionRefusalReasonSchema = closedEnum<DirectionRefusalReason>()(
  ["no-session", "auth-hold", "busy", "blocked", "no-bridge"]
);

/**
 * DECIDE ONE.
 *
 * ⚠ A DISCRIMINATED UNION, `LaunchDecideSchema`'s shape: a `refused` arm cannot
 * omit its reason and a `delivered` arm cannot smuggle one.
 * ⚠ **`reply` IS OPTIONAL ON THE `delivered` ARM, DELIBERATELY.** A turn whose
 * final text was empty, and a desktop older than the capture, are both honest
 * deliveries — `reply: null` means "not reported", never "the agent said
 * nothing", and requiring it would make an older machine unable to report at all.
 * ⚠ 8000 mirrors the column CHECK. The desktop caps and charset-strips before it
 * sends, because zod validates the whole body and one bad character 400s it
 * unretryably.
 */
export const DirectionDecideSchema = z.discriminatedUnion("status", [
  z.object({
    directionId: z.string().uuid(),
    status: z.literal("delivered"),
    reply: z.string().max(8000).optional(),
  }),
  z.object({
    directionId: z.string().uuid(),
    status: z.literal("refused"),
    refusalReason: DirectionRefusalReasonSchema,
  }),
]);
export type DirectionDecideInput = z.infer<typeof DirectionDecideSchema>;
