import { z } from "zod";
import { safeLabel } from "@/shared/lib/safe-label";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Team name renders into `dopl_members` narration, so it is a label an agent
 * reads as the server speaking. ⚠ `teams_admin_write` is `FOR ALL` for
 * `public` and `authenticated` holds UPDATE, so an admin can rename straight
 * through PostgREST without passing this schema — the matching DB CHECK is
 * the load-bearing half. Description stays prose; it renders only in the UI.
 */
const TeamNameSchema = safeLabel("Team name", 80);

/**
 * Resource types the MEMBERS CONSOLE may address — exactly what
 * `getAccessMatrix` puts in its `resources` array.
 * ⚠ `chat` and `chat_folder` are DELIBERATELY absent. They are valid
 * `TeamResourceType` values and real `team_resource_access` rows, but the
 * matrix never emits them and their scope is not independently settable: a
 * folder's scope is authoritative for its chats and propagates to them. Chat
 * sharing belongs to the chats surface; a grant written here sidesteps it.
 */
const CONSOLE_RESOURCE_TYPES = ["knowledge_base", "skill"] as const;

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

/** `level: null` removes the grant. */
export const TeamGrantSetSchema = z.object({
  resourceType: z.enum(CONSOLE_RESOURCE_TYPES),
  resourceId: z.string().uuid(),
  level: z.enum(["read", "edit"]).nullable(),
});
export type TeamGrantSetInput = z.infer<typeof TeamGrantSetSchema>;

export const AccessModeSetSchema = z.object({
  resourceType: z.enum(CONSOLE_RESOURCE_TYPES),
  resourceId: z.string().uuid(),
  accessMode: z.enum(["workspace", "teams"]),
});
export type AccessModeSetInput = z.infer<typeof AccessModeSetSchema>;
