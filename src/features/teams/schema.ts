import { z } from "zod";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const TeamGrantInputSchema = z.object({
  resourceType: z.enum(["knowledge_base", "workflow"]),
  resourceId: z.string().uuid(),
  level: z.enum(["read", "edit"]),
});

export const TeamCreateSchema = z.object({
  name: z.string().trim().min(1, "Team name required").max(80),
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
  name: z.string().trim().min(1).max(80).optional(),
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
