import { z } from "zod";
import { closedEnum } from "@/shared/lib/closed-enum";
import type { AgentToolProfile } from "./types";

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
