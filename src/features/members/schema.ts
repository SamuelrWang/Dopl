import { z } from "zod";

export const InviteMemberSchema = z.object({
  email: z.string().email("Valid email required"),
  role: z.enum(["admin", "member", "viewer"]),
});
export type InviteMemberInput = z.infer<typeof InviteMemberSchema>;

export const UpdateMemberRoleSchema = z.object({
  role: z.enum(["admin", "member", "viewer"]),
});
export type UpdateMemberRoleInput = z.infer<typeof UpdateMemberRoleSchema>;
