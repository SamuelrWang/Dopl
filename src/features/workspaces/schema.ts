import { z } from "zod";
import { safeLabel, safeOptionalProse } from "@/shared/lib/safe-label";

/**
 * `name` / `description` are THE HIGHEST-REACH untrusted strings in the whole
 * MCP surface, and until now they were bounded by LENGTH ALONE.
 *
 * A workspace enters your directory the moment you accept an invitation or a
 * join link — from an owner who need share no other context with you at all —
 * and both fields are then spliced into the two surfaces a model trusts most:
 * the MCP `instructions` block (read once, ahead of every tool result, as the
 * server's own briefing) and the `_dopl_status` footer appended to EVERY
 * successful tool response. `packages/mcp-server/src/server.ts` says the same
 * thing at the top of `UNTRUSTED_DIRECTORY_NOTE`, and neutralizes both at
 * render time. This is the input side of that rule; see
 * `@/shared/lib/safe-label` for why both layers exist.
 *
 * DESCRIPTION IS BOUNDED TOO, and that IS a small product change worth being
 * honest about: both editors render it in a `<textarea rows={3}>`
 * (`workspace-settings-form.tsx`, `create-workspace-dialog.tsx`), so pressing
 * Enter used to be legal and is now a validation error. It is a one-line
 * summary in every surface that reads it back — the directory table renders it
 * as ` — <description>` after the name on a single line — so the textarea was
 * always offering more than the product used. Follow-up: make those two inputs
 * single-line so the affordance matches the rule.
 *
 * The 120 / 2000 caps are unchanged; only the charset rule is new.
 */
const WorkspaceNameSchema = safeLabel("Workspace name", 120);

/** Empty is legitimate (the settings form sends the field cleared). */
const WorkspaceDescriptionSchema = safeOptionalProse("Workspace description", 2000);

export const WorkspaceCreateSchema = z.object({
  name: WorkspaceNameSchema,
  description: WorkspaceDescriptionSchema.optional(),
});
export type WorkspaceCreateInput = z.infer<typeof WorkspaceCreateSchema>;

// Slug regex matches the output of slugifyWorkspaceName: lowercase
// alphanumeric + hyphen, no leading/trailing hyphen.
const slugRegex = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export const WorkspaceUpdateSchema = z.object({
  name: WorkspaceNameSchema.optional(),
  description: WorkspaceDescriptionSchema.nullable().optional(),
  // Audit fix S-11: callers can override the auto-derived slug. Service
  // validates it against RESERVED_WORKSPACE_SLUGS + the owner's existing
  // slugs (with the (owner_id, slug) UNIQUE backstop). Omit to keep the
  // current slug; pass a value to force a specific one.
  slug: z.string().min(1).max(60).regex(slugRegex, "Slug must be kebab-case").optional(),
});
export type WorkspaceUpdateInput = z.infer<typeof WorkspaceUpdateSchema>;

export const InvitationCreateSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member", "viewer"]),
  teamIds: z.array(z.string().uuid()).max(20).optional(),
});
export type InvitationCreateInput = z.infer<typeof InvitationCreateSchema>;
