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

/**
 * The resource types the MEMBERS CONSOLE may address — exactly what
 * `getAccessMatrix` puts in its `resources` array.
 *
 * `skill` belongs here and was missing: the matrix has emitted skill rows since
 * team sharing landed for them (20260708150000), `use-workspace-resources`
 * keeps them, `member-bits` draws them, and the Access tab renders a scope
 * toggle and per-team grant controls on each one. The enum was the only thing
 * making all of that 400 — so a skill's controls looked live and did nothing.
 *
 * `chat` and `chat_folder` are DELIBERATELY absent. They are valid values of
 * `TeamResourceType` and real rows in `team_resource_access`, but the access
 * matrix never emits them and their scope is not independently settable — a
 * folder's scope is authoritative for its chats and is propagated to them
 * (migration 20260708120000). Chat sharing belongs to the chats surface, which
 * enforces that; a grant written from here would sidestep it.
 */
const CONSOLE_RESOURCE_TYPES = ["knowledge_base", "workflow", "skill"] as const;

const TeamGrantInputSchema = z.object({
  resourceType: z.enum(CONSOLE_RESOURCE_TYPES),
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
  resourceType: z.enum(CONSOLE_RESOURCE_TYPES),
  resourceId: z.string().uuid(),
  level: z.enum(["read", "edit"]).nullable(),
  autoGrant: z.boolean().optional(),
});
export type TeamGrantSetInput = z.infer<typeof TeamGrantSetSchema>;

export const AccessModeSetSchema = z.object({
  resourceType: z.enum(CONSOLE_RESOURCE_TYPES),
  resourceId: z.string().uuid(),
  accessMode: z.enum(["workspace", "teams"]),
  autoGrant: z.boolean().optional(),
});
export type AccessModeSetInput = z.infer<typeof AccessModeSetSchema>;
