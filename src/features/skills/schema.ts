import { z } from "zod";
import { safeLabel, safeOptionalLabel } from "@/shared/lib/safe-label";

/**
 * Zod schemas for the skills feature. Both REST handlers and MCP tools
 * parse against these so the service sees a consistent shape from
 * either entry point.
 *
 * Conventions mirror features/knowledge:
 *   - Slugs are kebab-case.
 *   - Skills are single-file; the body is the one SKILL.md procedure.
 *   - Body capped at 1 MB to bound DoS surface (matches KB).
 *   - All `*Update` schemas are partial.
 */

const slugRegex = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const MAX_BODY_BYTES = 1_048_576;
const bodyMaxMessage = "Body must be 1 MB or less";

/**
 * `name` and `folder` are the skill's two short labels — `dopl_map` prints
 * the name at session start, `dopl_skill` op="list" prints both, and
 * `dopl_search` prints the name as a hit header. Charset-bounded per
 * `@/shared/lib/safe-label`; `skills_editor_update` is a `public` UPDATE
 * policy, so the matching DB CHECK is the half that actually holds.
 *
 * `description`, `whenToUse`, `whenNotToUse` and the SKILL.md body are
 * NOT bounded and must not be: they are the procedure itself, legitimately
 * multi-line markdown, and rendered as bodies under framing that says so.
 */
const SkillNameSchema = safeLabel("Skill name", 120);
/** Organizing folder label. Trimmed; the service maps empty → unfiled (null). */
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
  /** Optional organizing folder label. Trimmed; empty → unfiled (null). */
  folder: SkillFolderSchema.nullable().optional(),
  /** Optional initial body for SKILL.md. Defaults to empty. */
  body: z.string().max(MAX_BODY_BYTES, bodyMaxMessage).optional(),
  /**
   * Optional visibility. Service-level `createSkill` defaults to
   * `'private'` when omitted (start drafty, opt to publish later).
   * The full enum is accepted so a future "+ New public skill"
   * affordance can plumb `'public'` without schema churn.
   */
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
    /** Organizing folder label. Trimmed; empty → unfiled (null). */
    folder: SkillFolderSchema.nullable().optional(),
    /**
     * Full three-way sharing (skill_team_sharing migration): visibility
     * is two-way, and 'public' pairs with accessMode 'workspace'
     * (everyone) or 'teams' (granted teams only). Owner or workspace
     * admin only — enforced in the service.
     */
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
  /** Body content — full overwrite (PUT semantics) of the SKILL.md. */
  body: z.string().max(MAX_BODY_BYTES, bodyMaxMessage),
});
export type SkillFileWriteInput = z.infer<typeof SkillFileWriteSchema>;
