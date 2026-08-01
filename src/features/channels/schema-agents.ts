import { z } from "zod";

/**
 * Request schemas for the MULTIPLAYER surface: channel agents and thread
 * participants. Kept out of `schema.ts` (365 lines, mid soft-cap) so neither
 * file drifts toward the §2 ceiling — and because these two answer their own
 * question: what a caller may say about an agent identity, as opposed to what a
 * caller may say about a channel or a message. `schema.ts` re-exports every
 * name here, so a consumer still has ONE import site.
 */

/**
 * THE HANDLE CHARSET — one definition, and this is it.
 *
 * Character for character the `channel_agents.name` CHECK
 * (`20260731120000_channel_agents.sql`): a lowercase letter, then 1..30 more
 * lowercase letters, digits or hyphens (so 2..31 characters total). It is the
 * ADDRESSING contract, not a cosmetic bound — `@quartz` has to be
 * unambiguously lexable out of a composer line, and the pool in
 * `server/agent-names.ts` is built to satisfy it.
 *
 * Exported because three other lanes need the same rule (the web composer's
 * client-side validation, the rename field, the MCP tool description). None of
 * them may restate it: a second copy is a second thing to drift, and a client
 * regex looser than the column CHECK turns a typo into a 500.
 */
export const AGENT_HANDLE_RE = /^[a-z][a-z0-9-]{1,30}$/;

const AGENT_HANDLE_MESSAGE =
  "Agent handle must be 2-31 characters: a lowercase letter, then lowercase letters, digits, or hyphens";

/**
 * A handle as a caller may type it. Trimmed and CASE-FOLDED before the charset
 * check, so `@Quartz` from a human's composer is accepted and stored as
 * `quartz` — which is what the `(channel_id, lower(name))` unique index treats
 * it as anyway. Folding rather than rejecting keeps the wire consistent with
 * the index: two callers who type the same name in different cases get the same
 * answer (one of them a 409) instead of one of them a validation error.
 */
const AgentHandleSchema = z
  .string()
  .trim()
  .transform((value) => value.toLowerCase())
  .refine((value) => AGENT_HANDLE_RE.test(value), {
    message: AGENT_HANDLE_MESSAGE,
  });

/** The lifecycle states a caller may set (the full union — see `types.ts`). */
const AgentStatusSchema = z.enum([
  "summoned",
  "active",
  "parked",
  "dismissed",
]);

/**
 * POST /agents — summon an agent. `name` is OPTIONAL and normally absent: the
 * server picks the next free handle from the curated pool, which is the whole
 * point of the pool (a room of agents reads as a set of names, and a caller
 * that never chooses one can never collide). An explicit name is validated
 * against the charset here and against per-channel uniqueness in the service.
 */
export const ChannelAgentCreateSchema = z.object({
  name: AgentHandleSchema.optional(),
});
export type ChannelAgentCreateInput = z.infer<typeof ChannelAgentCreateSchema>;

/**
 * PATCH /agents/[agentId] — rename it, move it along its lifecycle, or
 * DISENGAGE it. A discriminated union so the ops cannot bleed fields into each
 * other (same shape as `TaskUpdateSchema`). Authorization is the SERVICE's, not
 * this schema's, and it is NOT uniform:
 *   - `rename` / `set_status` — OWNER only (they describe a process on the
 *     owner's machine).
 *   - `disengage` — the owner OR the human who engaged it. Whoever put an agent
 *     on standing duty must be able to take it off again without owning it,
 *     and `set_status` is the wrong instrument for that (parking someone else's
 *     agent reaches into their machine; ending its attention to YOUR messages
 *     does not).
 *
 * `disengage` carries no payload — it clears `engaged_at` / `engaged_by`
 * server-side, and is idempotent (an already-idle agent is not an error).
 */
export const ChannelAgentUpdateSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("rename"), name: AgentHandleSchema }),
  z.object({ op: z.literal("set_status"), status: AgentStatusSchema }),
  z.object({ op: z.literal("disengage") }),
]);
export type ChannelAgentUpdateInput = z.infer<typeof ChannelAgentUpdateSchema>;

/**
 * One identity in a thread's participant set: a human member (`kind:"user"`,
 * `id` = user id) or a summoned agent (`kind:"agent"`, `id` = agent id). One
 * `id` field rather than `userId` / `agentId` so the wire matches the row's own
 * discriminated shape — the DB CHECK says exactly one of the two columns is set
 * per kind, and a two-field body could say otherwise.
 */
export const ThreadParticipantRefSchema = z.object({
  kind: z.enum(["user", "agent"]),
  id: z.string().uuid(),
});
export type ThreadParticipantRef = z.infer<typeof ThreadParticipantRefSchema>;

/** POST / DELETE /tasks/[taskId]/participants body: the identity to add/remove. */
export const ThreadParticipantMutateSchema = ThreadParticipantRefSchema;
export type ThreadParticipantMutateInput = ThreadParticipantRef;

/**
 * The extra participants a `create_thread` may seed. Bounded: a participant set
 * is a breakout room's membership, not a mailing list, and an unbounded array
 * is one insert loop per element. The creator and the target are added by the
 * SERVICE and need not appear here.
 */
export const ThreadParticipantSeedSchema = z
  .array(ThreadParticipantRefSchema)
  .max(20);
