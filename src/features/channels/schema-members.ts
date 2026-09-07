import { z } from "zod";
import { closedEnum } from "@/shared/lib/closed-enum";
import type { AgentToolProfile } from "./types";
import type { UnaddressedResponderSetting } from "./lib/agent-mentions";

/**
 * THE MEMBERSHIP WRITE SCHEMAS (§1 split, 2026-09-02, at the cap).
 *
 * ⚠ **`schema.ts` IS THE BARREL** and re-exports every symbol here; there is no
 * second import path. The seam is the one `server/service-writes-members.ts`
 * already draws — these change when MEMBERSHIP changes, and `schema.ts` when a
 * channel or a message shape does.
 */

/** Per-member responding-agent tool scope (self-service preference). */
/** ⚠ Annotated so TS-side drift breaks the build — see `VisibilitySchema`. This
 *  is a CONTAINMENT vocabulary: a value the web offers that main does not know
 *  resolves to `read_only` through `normalizeProfile` (INVARIANTS §11). */
const AgentToolProfileSchema = closedEnum<AgentToolProfile>()([
  "full",
  "dopl_only",
  "read_only",
]);

/**
 * Per-member "who answers my untagged messages here" (2026-09-07, items 10 and 11).
 *
 * ⚠ Annotated for `AgentToolProfileSchema`'s reason — TS-side drift breaks the build — and the
 * set has TWO other spellings that this one must stay level with: the type at
 * `lib/agent-mentions.ts › UnaddressedResponderSetting`, and the SQL CHECK
 * `channel_members_unaddressed_responder_check`. ⚠ There is deliberately NO "pin a specific
 * agent" value: agents are ephemeral, so a stored handle decays into naming nothing, and that
 * decay is the defect the room-wide column had rather than an implementation detail of it.
 */
const UnaddressedResponderSchema = closedEnum<UnaddressedResponderSetting>()([
  "none",
  "last_addressed",
]);

/**
 * PATCH /members: member updates their OWN per-channel settings — the agent
 * tool profile, and whether this channel is one of their favourites.
 * Self-only — service always targets the caller's row. Empty patch rejected.
 *
 * ⚠ NO MEMBER IDENTIFIER, BY CONSTRUCTION, AND THAT IS THE SECOND HALF OF THE
 * SELF-ONLY GUARANTEE. Zod STRIPS unknown keys, so a body naming `userId` (or
 * `user_id`, or `memberId`) parses to a patch that names nobody, and the service
 * writes `ctx.userId`'s row. Adding a member field here would turn one write
 * into two decisions.
 *
 * `notifyScope` is now an unknown key (F-170 removed it) and zod STRIPS it: a
 * stale client sending it alone hits the empty-patch refusal. Intended.
 *
 * `favorite` is a BOOLEAN on the wire and a nullable timestamp in storage
 * (`channel_members.favorited_at`, `20260819120000`): the client asks for a
 * state, the server stamps the clock.
 */
export const ChannelMemberSelfUpdateSchema = z
  .object({
    agentToolProfile: AgentToolProfileSchema.optional(),
    favorite: z.boolean().optional(),
    /**
     * **WHO ANSWERS THIS MEMBER'S UNTAGGED MESSAGES HERE** (2026-09-07, Samuel's ruling on
     * items 10 and 11) — `channel_members.unaddressed_responder`.
     *
     * ⚠ **IT LANDS ON THIS SCHEMA RATHER THAN `ChannelUpdateSchema` BECAUSE THAT IS THE
     * RULING.** It replaced a room-wide field a MANAGER set for everybody; writing it here
     * means a member may only ever answer the question for themselves, which the docblock
     * above enforces by carrying no member identifier at all.
     *
     * ⚠ **NOT `.nullable()`, AND THE ABSENCE OF A CLEAR IS THE POINT.** The old field needed
     * `null` to withdraw a nomination; this one is a CLOSED TWO-VALUE RULE with a `NOT NULL`
     * column, so "no opinion" is not a state a member can be in — `'last_addressed'` IS the
     * unconfigured answer (B1, 2026-09-04). A nullable field here would mint the third state
     * the migration deliberately refused.
     *
     * ⚠ **ANNOTATED SO TS-SIDE DRIFT BREAKS THE BUILD**, on `AgentToolProfileSchema`'s terms:
     * this enum's twin is `channel_members_unaddressed_responder_check` in SQL, and its type
     * is `lib/agent-mentions.ts › UnaddressedResponderSetting`. Three spellings, one set —
     * adding a value means editing all three.
     */
    unaddressedResponder: UnaddressedResponderSchema.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: "Empty patch" });
export type ChannelMemberSelfUpdateInput = z.infer<
  typeof ChannelMemberSelfUpdateSchema
>;

export const ChannelMemberAddSchema = z.object({
  userId: z.string().uuid(),
});
export type ChannelMemberAddInput = z.infer<typeof ChannelMemberAddSchema>;

export const ChannelMemberRemoveSchema = z.object({
  userId: z.string().uuid(),
});
export type ChannelMemberRemoveInput = z.infer<
  typeof ChannelMemberRemoveSchema
>;
