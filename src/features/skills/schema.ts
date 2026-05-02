import { z } from "zod";

/**
 * Zod schemas for the skills feature. Both REST handlers and MCP tools
 * parse against these so the service sees a consistent shape from
 * either entry point.
 *
 * Conventions mirror features/knowledge:
 *   - Slugs are kebab-case.
 *   - File names are `[A-Za-z0-9._-]+\.md` — no slashes (no nested
 *     dirs in v1), no leading dot, must end in `.md`.
 *   - Body capped at 1 MB to bound DoS surface (matches KB).
 *   - All `*Update` schemas are partial.
 */

const slugRegex = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const fileNameRegex = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\.md$/;
const fileNameMessage =
  "File name must match [A-Za-z0-9._-]+.md (no slashes; must end in .md)";

const MAX_BODY_BYTES = 1_048_576;
const bodyMaxMessage = "Body must be 1 MB or less";

// ─── Skill ──────────────────────────────────────────────────────────

export const SkillSlugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(slugRegex, "Slug must be kebab-case");
export type SkillSlugInput = z.infer<typeof SkillSlugSchema>;

export const SkillStatusSchema = z.enum(["active", "draft"]);

export const SkillCreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(2000),
  whenToUse: z.string().min(1).max(2000),
  whenNotToUse: z.string().max(2000).nullable().optional(),
  slug: z.string().min(1).max(80).regex(slugRegex).optional(),
  status: SkillStatusSchema.optional(),
  agentWriteEnabled: z.boolean().optional(),
  /** Optional initial body for SKILL.md. Defaults to empty. */
  body: z.string().max(MAX_BODY_BYTES, bodyMaxMessage).optional(),
});
export type SkillCreateInput = z.infer<typeof SkillCreateSchema>;

export const SkillUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().min(1).max(2000).optional(),
  whenToUse: z.string().min(1).max(2000).optional(),
  whenNotToUse: z.string().max(2000).nullable().optional(),
  slug: z.string().min(1).max(80).regex(slugRegex).optional(),
  status: SkillStatusSchema.optional(),
  agentWriteEnabled: z.boolean().optional(),
});
export type SkillUpdateInput = z.infer<typeof SkillUpdateSchema>;

// ─── Skill files ────────────────────────────────────────────────────

export const SkillFileNameSchema = z
  .string()
  .min(4) // shortest valid name is `a.md`
  .max(120)
  .regex(fileNameRegex, fileNameMessage);
export type SkillFileNameInput = z.infer<typeof SkillFileNameSchema>;

export const SkillFileWriteSchema = z.object({
  /** Body content — full overwrite (PUT semantics). */
  body: z.string().max(MAX_BODY_BYTES, bodyMaxMessage),
});
export type SkillFileWriteInput = z.infer<typeof SkillFileWriteSchema>;

export const SkillFileCreateSchema = z.object({
  name: SkillFileNameSchema,
  body: z.string().max(MAX_BODY_BYTES, bodyMaxMessage).optional(),
});
export type SkillFileCreateInput = z.infer<typeof SkillFileCreateSchema>;

export const SkillFileRenameSchema = z.object({
  name: SkillFileNameSchema,
});
export type SkillFileRenameInput = z.infer<typeof SkillFileRenameSchema>;
