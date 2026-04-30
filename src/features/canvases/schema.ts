import { z } from "zod";

export const CanvasCreateSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  description: z.string().max(2000).optional(),
});
export type CanvasCreateInput = z.infer<typeof CanvasCreateSchema>;

export const CanvasUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
});
export type CanvasUpdateInput = z.infer<typeof CanvasUpdateSchema>;

export const InvitationCreateSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "editor", "viewer"]),
});
export type InvitationCreateInput = z.infer<typeof InvitationCreateSchema>;
