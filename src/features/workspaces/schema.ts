import { z } from "zod";
import { safeLabel, safeOptionalProse } from "@/shared/lib/safe-label";

/**
 * ⚠ SECURITY: `name` / `description` are the HIGHEST-REACH untrusted strings in
 * the MCP surface. A workspace enters your directory the moment you accept an
 * invitation or join link, and both fields are spliced into the two surfaces a
 * model trusts most: the MCP `instructions` block and the `_dopl_status` footer
 * on EVERY successful tool response. `packages/mcp-server/src/server.ts`
 * neutralizes both at render time (`UNTRUSTED_DIRECTORY_NOTE`); this is the
 * INPUT half. See `@/shared/lib/safe-label` for why both layers exist.
 *
 * ⚠ Description is charset-bounded too, so a newline is now a validation error
 * — both editors still render a `<textarea rows={3}>`
 * (`workspace-settings-form.tsx`, `create-workspace-dialog.tsx`). Follow-up:
 * make those inputs single-line so the affordance matches the rule.
 */
const WorkspaceNameSchema = safeLabel("Workspace name", 120);

/** Empty is legitimate (the settings form sends the field cleared). */
const WorkspaceDescriptionSchema = safeOptionalProse("Workspace description", 2000);

export const WorkspaceCreateSchema = z.object({
  name: WorkspaceNameSchema,
  description: WorkspaceDescriptionSchema.optional(),
});
export type WorkspaceCreateInput = z.infer<typeof WorkspaceCreateSchema>;

// ⚠ Must match the output of slugifyWorkspaceName: lowercase alphanumeric +
// hyphen, no leading/trailing hyphen.
const slugRegex = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export const WorkspaceUpdateSchema = z.object({
  name: WorkspaceNameSchema.optional(),
  description: WorkspaceDescriptionSchema.nullable().optional(),
  // Caller may override the auto-derived slug; service validates against
  // RESERVED_WORKSPACE_SLUGS + the owner's existing slugs (with the
  // (owner_id, slug) UNIQUE backstop). Omit to keep the current slug.
  slug: z.string().min(1).max(60).regex(slugRegex, "Slug must be kebab-case").optional(),
});
export type WorkspaceUpdateInput = z.infer<typeof WorkspaceUpdateSchema>;

export const InvitationCreateSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member", "viewer"]),
  teamIds: z.array(z.string().uuid()).max(20).optional(),
});
export type InvitationCreateInput = z.infer<typeof InvitationCreateSchema>;
