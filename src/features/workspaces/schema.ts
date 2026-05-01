import { z } from "zod";

export const WorkspaceCreateSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  description: z.string().max(2000).optional(),
});
export type WorkspaceCreateInput = z.infer<typeof WorkspaceCreateSchema>;

// Slug regex matches the output of slugifyWorkspaceName: lowercase
// alphanumeric + hyphen, no leading/trailing hyphen.
const slugRegex = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export const WorkspaceUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  // Audit fix S-11: callers can override the auto-derived slug. Service
  // validates it against RESERVED_WORKSPACE_SLUGS + the owner's existing
  // slugs (with the (owner_id, slug) UNIQUE backstop). Omit to keep the
  // current slug; pass a value to force a specific one.
  slug: z.string().min(1).max(60).regex(slugRegex, "Slug must be kebab-case").optional(),
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
