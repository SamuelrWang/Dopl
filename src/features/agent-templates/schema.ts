import { z } from "zod";
import {
  SAFE_LABEL_RE,
  safeLabel,
  safeLabelMessage,
  safeOptionalProse,
} from "@/shared/lib/safe-label";

/**
 * Zod schemas for agent templates. REST handlers parse against these, so the
 * service sees one shape whatever the entry point is — the same contract
 * `src/features/skills/schema.ts` holds for skills.
 *
 * ⚠ THE LABEL/PROSE SPLIT IS THE WHOLE DESIGN HERE, and it is not about
 * length. A LABEL is spliced into a line the server writes (the launch payload
 * an agent reads back, a picker row); PROSE is rendered as itself. So `name`,
 * `model` and BOTH HALVES OF EVERY CUSTOM FIELD are charset-bounded, while
 * `description` and `instructions` are not — instructions is a system prompt
 * and multi-line markdown in it is the point.
 */

/**
 * ⚠ THE BOUNDS ARE NAMED CONSTANTS, NOT LITERALS, AND EVERY ONE IS EXPORTED
 * (2026-08-30, G3). `schema-sql.test.ts` reads the migration and pins each of
 * these against the `CHECK` it pairs with — a comment claiming a pairing is not
 * a gate, which is what this file's own header used to rely on.
 */

/** Rendered into the template picker and into the launch payload. Matches the
 *  `agent_templates_name_charset_check` bound in the migration. */
export const MAX_NAME_CHARS = 120;
const NameSchema = safeLabel("Template name", MAX_NAME_CHARS);

/** Prose. Newline/tab allowed; empty string preserved (a cleared textarea
 *  sends one, and the service maps it to NULL). */
export const MAX_DESCRIPTION_CHARS = 2000;
const DescriptionSchema = safeOptionalProse(
  "Template description",
  MAX_DESCRIPTION_CHARS
);

/**
 * The system-prompt block. 32 KB, matching the DB CHECK.
 * ⚠ NOT bounded to 1 MB like `skills.body`: a skill body is a PROCEDURE meant
 * to be long, and a template's instructions are a system prompt that is
 * prepended to every turn of every session spawned from it. The bound is a
 * cost signal as much as a DoS floor.
 */
export const MAX_INSTRUCTIONS_CHARS = 32_768;
const InstructionsSchema = safeOptionalProse(
  "Instructions",
  MAX_INSTRUCTIONS_CHARS
);

/**
 * Model identifier. ⚠ DELIBERATELY NOT AN ENUM. The model roster lives in the
 * desktop and moves faster than this repo deploys; an enum here would mean a
 * server release to accept a model the desktop already runs, and the failure
 * mode would be a 400 on a value the operator can see in their own picker.
 * Charset-bounded because it renders into the launch payload.
 * ⚠ Deliberately the SAME number as `MAX_NAME_CHARS`, and the migration pairs
 * them the same way (`agent_templates_model_charset_check`). Named separately
 * because they are two columns, not one shared rule.
 */
export const MAX_MODEL_CHARS = 120;
const ModelSchema = safeLabel("Model", MAX_MODEL_CHARS);

// ─── Custom fields ──────────────────────────────────────────────────────

/**
 * ⚠ THE SERIALIZED SIZE CAP IS THE REAL BOUND AND IT LIVES IN TWO PLACES ON
 * PURPOSE. Per-field lengths below stop one absurd value; this stops a
 * thousand reasonable ones. It is re-asserted as a CHECK in the migration
 * (`octet_length(fields::text) <= 8192`) because the service is the only
 * writer and a schema is a fence the DB cannot see.
 * ⚠ Measured the same way the CHECK measures — UTF-8 BYTES of the serialized
 * array, not `.length` — so a CJK or emoji payload cannot pass zod and then
 * fail the constraint as an opaque 500.
 */
export const MAX_FIELDS_BYTES = 8192;

/** Bounds chosen so `MAX_FIELD_COUNT` fields at max size lands ABOVE the byte
 *  cap — the count is a sanity rail, the bytes are the contract.
 *  ⚠ NO SQL COUNTERPART, on purpose: the migration bounds the SERIALIZED size
 *  and the array-ness, and leaves element shape to zod. */
export const MAX_FIELD_COUNT = 50;

/** Per-field halves. ⚠ Also zod-only — see `MAX_FIELD_COUNT`. */
export const MAX_FIELD_KEY_CHARS = 80;
export const MAX_FIELD_VALUE_CHARS = 1000;

export const TemplateFieldSchema = z.object({
  key: safeLabel("Field key", MAX_FIELD_KEY_CHARS),
  /** ⚠ A LABEL, not prose: field values are spliced into the launch payload
   *  line-by-line, so a newline in one forges a line in the server's voice.
   *  Empty is legal — a key with no value yet is a legitimate half-filled
   *  form, and `safeLabel` would reject `""` (it carries a `.min(1)`).
   *  ⚠ `SAFE_LABEL_RE` is IMPORTED, never re-typed: `@/shared/lib/safe-label`
   *  is explicit that two copies of a neutralizer drift, and the copy that
   *  drifts is the one that stops neutralizing. */
  value: z
    .string()
    .trim()
    .max(MAX_FIELD_VALUE_CHARS)
    .refine((v) => v === "" || SAFE_LABEL_RE.test(v), {
      message: safeLabelMessage("Field value"),
    }),
});

export const TemplateFieldsSchema = z
  .array(TemplateFieldSchema)
  .max(MAX_FIELD_COUNT, `At most ${MAX_FIELD_COUNT} custom fields`)
  .refine(
    (fields) =>
      new Set(fields.map((f) => f.key)).size === fields.length,
    { message: "Custom field keys must be unique" }
  )
  .refine(
    (fields) =>
      new TextEncoder().encode(JSON.stringify(fields)).length <= MAX_FIELDS_BYTES,
    { message: `Custom fields must serialize to ${MAX_FIELDS_BYTES} bytes or less` }
  );

// ─── Visibility ─────────────────────────────────────────────────────────

/**
 * ⚠ **`team` IS STILL ACCEPTED HERE AND IS REFUSED FOR AN AGENT ONE LAYER DOWN**
 * (2026-09-02). A8 took the value off `dopl_agent`'s enum, so the MCP surface
 * refuses it in zod before any round trip — but this schema is the REST route's,
 * an agent credential reaches that route directly, and a rule enforced only where
 * the caller happens to enter is not enforced. `server/service-writes.ts ›
 * assertTeamScopeIsHuman` is the fence, on the create AND the update path.
 * ⚠ It stays in the enum because the value is still legal for a HUMAN: taking it
 * out of the DB is B4, and B4 has not been ruled.
 */
export const TemplateVisibilitySchema = z.enum([
  "private",
  "team",
  "workspace",
]);

/** Same bound `SkillUpdateSchema.teamIds` uses. */
const TeamIdsSchema = z.array(z.string().uuid()).max(50);

/** Attached KB ids. The set is REPLACED, never merged — see `updateTemplate`. */
const KnowledgeBaseIdsSchema = z.array(z.string().uuid()).max(50);

// ─── Create / update ────────────────────────────────────────────────────

/**
 * ⚠ `teamIds` REQUIRES `visibility: 'team'`, refused rather than ignored.
 * Mirrors `SkillUpdateSchema`'s refine: silently dropping the field would
 * return a 2xx while the grant set never moved, and the client would render a
 * sharing state the server does not hold.
 */
const teamIdsMatchVisibility = (patch: {
  visibility?: "private" | "team" | "workspace";
  teamIds?: string[];
}) => patch.teamIds === undefined || patch.visibility === "team";

const TEAM_IDS_MESSAGE = {
  message: "teamIds requires visibility 'team'",
} as const;

export const AgentTemplateCreateSchema = z
  .object({
    name: NameSchema,
    description: DescriptionSchema.nullable().optional(),
    instructions: InstructionsSchema.nullable().optional(),
    model: ModelSchema.nullable().optional(),
    fields: TemplateFieldsSchema.optional(),
    /** Omitted → the service defaults to `'private'`, matching `createSkill`
     *  and `createBase`. */
    visibility: TemplateVisibilitySchema.optional(),
    teamIds: TeamIdsSchema.optional(),
    knowledgeBaseIds: KnowledgeBaseIdsSchema.optional(),
    /**
     * Put the new template on the PERSONAL SHELF (`types.ts › TemplateShelf`)
     * instead of the workspace Agents page. ⚠ A REQUEST, NOT A DECISION, AND IT
     * ROUTES THE ROW RATHER THAN BEING STORED ON IT (2026-09-02, slice B15) —
     * the twin of `knowledge/schema.ts › homeScoped`, which carries the
     * argument. `shared/tenancy/personal-container.ts › personalWriteWorkspaceId`
     * is the fence and it 403s rather than downgrading. Omitted/false = the
     * container the call is in, which is every existing caller.
     */
    homeScoped: z.boolean().optional(),
    /**
     * 🔒 "I know this publishes into a room somebody else is standing in."
     *
     * ⚠ A PRECONDITION, NOT A PERMISSION, AND IT IS REQUIRED ONLY ON THE NARROW
     * PREDICATE — `kind='link'` container, two or more active members, and the
     * row landing at `visibility: 'workspace'`. Everywhere else it is IGNORED,
     * never refused: see `features/workspaces/server/shared-publish.ts`, which
     * is the one statement of both the predicate and the 400.
     */
    acknowledgeShared: z.boolean().optional(),
  })
  .refine(teamIdsMatchVisibility, TEAM_IDS_MESSAGE);
export type AgentTemplateCreateInput = z.infer<typeof AgentTemplateCreateSchema>;

/**
 * All fields optional. ⚠ `null` and ABSENT differ and both are meaningful:
 * absent leaves the column alone, `null` CLEARS it. `fields`,
 * `knowledgeBaseIds` and `teamIds` are REPLACE-SET (absent = untouched,
 * `[]` = empty it) — there is no add/remove verb, because a partial mutation
 * over a set that two clients can edit is how sets silently diverge.
 */
/**
 * The columns and junctions `updateTemplate` can actually move. ⚠ NAMED so the
 * "changes at least one field" refine cannot silently count a field that
 * changes nothing — `acknowledgeShared` is the first such field and will not be
 * the last.
 */
const MUTABLE_UPDATE_KEYS = [
  "name",
  "description",
  "instructions",
  "model",
  "fields",
  "visibility",
  "teamIds",
  "knowledgeBaseIds",
] as const;

export const AgentTemplateUpdateSchema = z
  .object({
    name: NameSchema.optional(),
    description: DescriptionSchema.nullable().optional(),
    instructions: InstructionsSchema.nullable().optional(),
    model: ModelSchema.nullable().optional(),
    fields: TemplateFieldsSchema.optional(),
    visibility: TemplateVisibilitySchema.optional(),
    teamIds: TeamIdsSchema.optional(),
    knowledgeBaseIds: KnowledgeBaseIdsSchema.optional(),
    /**
     * 🔒 "I know this publishes into a room somebody else is standing in."
     *
     * ⚠ A PRECONDITION, NOT A PERMISSION, AND IT IS REQUIRED ONLY ON THE NARROW
     * PREDICATE — `kind='link'` container, two or more active members, and the
     * row landing at `visibility: 'workspace'`. Everywhere else it is IGNORED,
     * never refused: see `features/workspaces/server/shared-publish.ts`, which
     * is the one statement of both the predicate and the 400.
     */
    acknowledgeShared: z.boolean().optional(),
  })
  .refine(
    // ⚠ `acknowledgeShared` IS NOT A FIELD THIS PATCH CHANGES, so it may not
    // satisfy the "at least one" rule on its own. It is an assertion ABOUT the
    // change, and a PATCH carrying nothing but an acknowledgement changes no
    // column — which is exactly the empty-body 500 class `service-writes.ts`
    // guards (F-404), reached one layer earlier.
    (patch) => MUTABLE_UPDATE_KEYS.some((key) => patch[key] !== undefined),
    { message: "Patch must change at least one field" }
  )
  .refine(teamIdsMatchVisibility, TEAM_IDS_MESSAGE);
export type AgentTemplateUpdateInput = z.infer<typeof AgentTemplateUpdateSchema>;
