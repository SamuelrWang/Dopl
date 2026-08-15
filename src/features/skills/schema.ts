import { z } from "zod";
import { safeLabel, safeOptionalLabel } from "@/shared/lib/safe-label";

/**
 * Zod schemas for skills. REST handlers and MCP tools both parse against
 * these, so the service sees one shape from either entry point.
 * Kebab-case slugs; single SKILL.md body capped at 1 MB (DoS bound, matches
 * KB); all `*Update` schemas partial.
 */

const slugRegex = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const MAX_BODY_BYTES = 1_048_576;
const bodyMaxMessage = "Body must be 1 MB or less";

/**
 * `name` and `folder` are the skill's short labels in agent narration
 * (`dopl_map`, `dopl_skill` op="list", `dopl_search` hit headers), so both
 * are charset-bounded per `@/shared/lib/safe-label`. ⚠ `skills_editor_update`
 * is a `public` UPDATE policy, so the matching DB CHECK is the half that
 * actually holds.
 * ⚠ `description`, `whenToUse`, `whenNotToUse` and the body are NOT bounded
 * and must not be — they are the procedure, legitimately multi-line markdown.
 */
const SkillNameSchema = safeLabel("Skill name", 120);
/** Trimmed; the service maps empty → unfiled (null). */
const SkillFolderSchema = safeOptionalLabel("Skill folder", 80);

// ─── Skill ──────────────────────────────────────────────────────────

export const SkillSlugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(slugRegex, "Slug must be kebab-case");
export type SkillSlugInput = z.infer<typeof SkillSlugSchema>;

export const SkillStatusSchema = z.enum(["active", "draft"]);

export const SkillCreateSchema = z.object({
  name: SkillNameSchema,
  description: z.string().min(1).max(2000),
  whenToUse: z.string().min(1).max(2000),
  whenNotToUse: z.string().max(2000).nullable().optional(),
  slug: z.string().min(1).max(80).regex(slugRegex).optional(),
  status: SkillStatusSchema.optional(),
  agentWriteEnabled: z.boolean().optional(),
  /** Trimmed; empty → unfiled (null). */
  folder: SkillFolderSchema.nullable().optional(),
  /** Initial SKILL.md body. Defaults to empty. */
  body: z.string().max(MAX_BODY_BYTES, bodyMaxMessage).optional(),
  /** Omitted → `createSkill` defaults to `'private'`. Full enum accepted so
   *  a "New public skill" affordance needs no schema change. */
  visibility: z.enum(["public", "private"]).optional(),
});
export type SkillCreateInput = z.infer<typeof SkillCreateSchema>;

export const SkillUpdateSchema = z
  .object({
    name: SkillNameSchema.optional(),
    description: z.string().min(1).max(2000).optional(),
    whenToUse: z.string().min(1).max(2000).optional(),
    whenNotToUse: z.string().max(2000).nullable().optional(),
    slug: z.string().min(1).max(80).regex(slugRegex).optional(),
    status: SkillStatusSchema.optional(),
    agentWriteEnabled: z.boolean().optional(),
    /** Trimmed; empty → unfiled (null). */
    folder: SkillFolderSchema.nullable().optional(),
    /** Three-way sharing: 'public' pairs with accessMode 'workspace'
     *  (everyone) or 'teams' (granted teams). Owner / workspace admin only,
     *  enforced in the service. */
    visibility: z.enum(["public", "private"]).optional(),
    accessMode: z.enum(["workspace", "teams"]).optional(),
    /** Teams granted read access; only meaningful with accessMode 'teams'. */
    teamIds: z.array(z.string().uuid()).max(50).optional(),
  })
  .refine(
    (patch) =>
      patch.teamIds === undefined ||
      (patch.visibility === "public" && patch.accessMode === "teams"),
    { message: "teamIds requires visibility 'public' + accessMode 'teams'" }
  )
  .refine(
    (patch) => patch.accessMode === undefined || patch.visibility !== undefined,
    {
      message:
        "accessMode is only meaningful alongside visibility — pass both to change sharing",
    }
  );
export type SkillUpdateInput = z.infer<typeof SkillUpdateSchema>;

// ─── Skill body (the single SKILL.md) ───────────────────────────────

export const SkillFileWriteSchema = z.object({
  /** Full overwrite (PUT semantics) of the SKILL.md. */
  body: z.string().max(MAX_BODY_BYTES, bodyMaxMessage),
});
export type SkillFileWriteInput = z.infer<typeof SkillFileWriteSchema>;
