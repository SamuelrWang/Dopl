import { z } from "zod";
import { safeLabel, safeOptionalLabel } from "@/shared/lib/safe-label";

/** Skill schemas, shared by REST and MCP. SKILL.md body capped at 1 MB (DoS bound, matches KB). */

const slugRegex = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const MAX_BODY_BYTES = 1_048_576;
const bodyMaxMessage = "Body must be 1 MB or less";

/**
 * `name`/`folder` are charset-bounded because agents narrate them; the DB CHECK is the half that holds
 * (`skills_editor_update` is a public UPDATE policy). Descriptions and body stay free-form markdown.
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

export const SkillStatusSchema = z.enum(["active", "draft"]);

export const SkillCreateSchema = z.object({
  name: SkillNameSchema,
  description: z.string().min(1).max(2000),
  whenToUse: z.string().min(1).max(2000),
  whenNotToUse: z.string().max(2000).nullable().optional(),
  slug: z.string().min(1).max(80).regex(slugRegex).optional(),
  status: SkillStatusSchema.optional(),
  agentWriteEnabled: z.boolean().optional(),
  folder: SkillFolderSchema.nullable().optional(),
  /** Initial SKILL.md body. Defaults to empty. */
  body: z.string().max(MAX_BODY_BYTES, bodyMaxMessage).optional(),
  /** Omitted → `createSkill` picks per caller: private for a person, public for a shared credential. */
  visibility: z.enum(["public", "private"]).optional(),
  /** "I know this publishes into a room others are in": a precondition, not a permission (`shared-publish.ts`). */
  acknowledgeShared: z.boolean().optional(),
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
      folder: SkillFolderSchema.nullable().optional(),
    /** 'public' pairs with accessMode 'workspace' or 'teams'; owner / admin only (service-enforced). */
    visibility: z.enum(["public", "private"]).optional(),
    accessMode: z.enum(["workspace", "teams"]).optional(),
    teamIds: z.array(z.string().uuid()).max(50).optional(),
    /** See `SkillCreateSchema.acknowledgeShared`. */
    acknowledgeShared: z.boolean().optional(),
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
