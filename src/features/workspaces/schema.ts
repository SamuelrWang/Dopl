import { z } from "zod";

export const WorkspaceCreateSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  description: z.string().max(2000).optional(),
});
export type WorkspaceCreateInput = z.infer<typeof WorkspaceCreateSchema>;

export const WorkspaceUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
});
export type WorkspaceUpdateInput = z.infer<typeof WorkspaceUpdateSchema>;

export const InvitationCreateSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "editor", "viewer"]),
});
export type InvitationCreateInput = z.infer<typeof InvitationCreateSchema>;

export const CanvasCreateSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
});
export type CanvasCreateInput = z.infer<typeof CanvasCreateSchema>;
