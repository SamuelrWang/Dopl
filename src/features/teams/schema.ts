import { z } from "zod";
import { safeLabel } from "@/shared/lib/safe-label";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * A team name renders into `dopl_members` narration (`get_team`,
 * `access_matrix`, every membership line), so it is a label an agent reads as
 * the server speaking. `teams_admin_write` is a `FOR ALL` policy for `public`
 * and `authenticated` holds UPDATE, so any workspace ADMIN can rename a team
 * straight through PostgREST without passing this schema — which is why the
 * matching DB CHECK, not this line, is the load-bearing half. Description is
 * left prose: it is a paragraph about what the team does, and it renders only
 * in the web UI.
 */
const TeamNameSchema = safeLabel("Team name", 80);

const TeamGrantInputSchema = z.object({
  resourceType: z.enum(["knowledge_base", "workflow"]),
  resourceId: z.string().uuid(),
  level: z.enum(["read", "edit"]),
});

export const TeamCreateSchema = z.object({
  name: TeamNameSchema,
  description: z.string().trim().max(400).optional(),
  color: z.string().regex(HEX_COLOR, "Color must be a hex value").optional(),
  icon: z.string().max(40).optional(),
  memberIds: z.array(z.string().uuid()).max(200).optional(),
  grants: z.array(TeamGrantInputSchema).max(200).optional(),
  /** Resolve workflow↔KB conflicts in the initial grants by auto-creating read grants. */
  autoGrant: z.boolean().optional(),
});
export type TeamCreateInput = z.infer<typeof TeamCreateSchema>;

export const TeamUpdateSchema = z.object({
  name: TeamNameSchema.optional(),
  description: z.string().trim().max(400).nullable().optional(),
  color: z.string().regex(HEX_COLOR).nullable().optional(),
  icon: z.string().max(40).nullable().optional(),
});
export type TeamUpdateInput = z.infer<typeof TeamUpdateSchema>;

export const TeamMembersAddSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(100),
});
export type TeamMembersAddInput = z.infer<typeof TeamMembersAddSchema>;

/** `level: null` removes the grant. `autoGrant` lets an admin resolve a
 *  workflow↔KB conflict by auto-creating read grants on the missing side. */
export const TeamGrantSetSchema = z.object({
  resourceType: z.enum(["knowledge_base", "workflow"]),
  resourceId: z.string().uuid(),
  level: z.enum(["read", "edit"]).nullable(),
  autoGrant: z.boolean().optional(),
});
export type TeamGrantSetInput = z.infer<typeof TeamGrantSetSchema>;

export const AccessModeSetSchema = z.object({
  resourceType: z.enum(["knowledge_base", "workflow"]),
  resourceId: z.string().uuid(),
  accessMode: z.enum(["workspace", "teams"]),
  autoGrant: z.boolean().optional(),
});
export type AccessModeSetInput = z.infer<typeof AccessModeSetSchema>;
