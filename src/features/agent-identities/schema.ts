import { z } from "zod";
import {
  SAFE_LABEL_RE,
  safeLabel,
  safeLabelMessage,
  safeOptionalProse,
} from "@/shared/lib/safe-label";
import {
  LAUNCH_RUNTIME_ID_MESSAGE,
  LAUNCH_RUNTIME_ID_RE,
} from "@/features/channels/schema-launch-modes";
import { IDENTITY_FIELD_TYPES, type IdentityVisibility } from "./types";
import { MAX_DESCRIPTION_CHARS, MAX_NAME_CHARS } from "./lib/bounds";

export { MAX_DESCRIPTION_CHARS, MAX_NAME_CHARS };

/**
 * Zod schemas for agent identities. A label (name, model, both halves of every field) is spliced into
 * lines the server writes, so it is charset-bounded; prose (description, instructions) is not.
 * Bounds are exported constants; `schema-sql.test.ts` pins them against the CHECKs and the desktop.
 */

const NameSchema = safeLabel("Identity name", MAX_NAME_CHARS);

/** Empty string preserved: a cleared textarea sends one and the service maps it to NULL. */
const DescriptionSchema = safeOptionalProse(
  "Identity description",
  MAX_DESCRIPTION_CHARS
);

/** Matches the DB CHECK; prepended to every turn, so the bound is a cost signal too. */
export const MAX_INSTRUCTIONS_CHARS = 32_768;
const InstructionsSchema = safeOptionalProse(
  "Instructions",
  MAX_INSTRUCTIONS_CHARS
);

/** Not an enum — the model roster is the desktop's and moves faster than this repo deploys. */
export const MAX_MODEL_CHARS = 120;
const ModelSchema = safeLabel("Model", MAX_MODEL_CHARS);

/** The runtime an identity prefers. Grammar only (the roster is the desktop's);
 *  paired with `agent_identities_runtime_shape_check`. */
const RuntimeSchema = z.string().trim().regex(LAUNCH_RUNTIME_ID_RE, LAUNCH_RUNTIME_ID_MESSAGE);

// ─── Custom fields ──────────────────────────────────────────────────────

/**
 * The real bound, also a DB CHECK (`octet_length(fields::text) <= 8192`): UTF-8 bytes of the
 * serialized array, measured with TextEncoder — the same bytes the CHECK measures.
 */
export const MAX_FIELDS_BYTES = 8192;

/** Sanity rails below the byte cap; zod-only (the DB bounds only size and array-ness). */
export const MAX_FIELD_COUNT = 50;
export const MAX_FIELD_KEY_CHARS = 80;
export const MAX_FIELD_VALUE_CHARS = 1000;

export const IdentityFieldSchema = z.object({
  key: safeLabel("Field key", MAX_FIELD_KEY_CHARS),
  /** A label, not prose: a newline would forge a launch-payload line. `""` is legal (a half-filled
   *  form) — `safeLabel` has `.min(1)`, so `SAFE_LABEL_RE` is applied directly, never re-typed. */
  value: z
    .string()
    .trim()
    .max(MAX_FIELD_VALUE_CHARS)
    .refine((v) => v === "" || SAFE_LABEL_RE.test(v), {
      message: safeLabelMessage("Field value"),
    }),
  /** Optional because absent is `text` (older rows, MCP writes); never validated against `value`. */
  type: z.enum(IDENTITY_FIELD_TYPES).optional(),
});

export const IdentityFieldsSchema = z
  .array(IdentityFieldSchema)
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

/** `team` stays legal for a human; an agent credential is refused one layer down (`assertTeamScopeIsHuman`). */
const IdentityVisibilitySchema = z.enum([
  "private",
  "team",
  "workspace",
] as const satisfies readonly IdentityVisibility[]);

const TeamIdsSchema = z.array(z.string().uuid()).max(50);

/** Whole bases (older clients, MCP `knowledge_bases`). A replace-set, like `knowledge`. */
const KnowledgeBaseIdsSchema = z.array(z.string().uuid()).max(50);

/**
 * A discriminated union of strict objects: zod strips unknown keys by default, so
 * `{scope:"base", folderId}` would silently widen to the whole base — strict makes it a 400.
 */
const IdentityKnowledgeScopeSchema = z.discriminatedUnion("scope", [
  z.strictObject({ baseId: z.string().uuid(), scope: z.literal("base") }),
  z.strictObject({
    baseId: z.string().uuid(),
    scope: z.literal("folder"),
    folderId: z.string().uuid(),
  }),
  z.strictObject({
    baseId: z.string().uuid(),
    scope: z.literal("entry"),
    entryId: z.string().uuid(),
  }),
]);

/** Counts scopes (one base can contribute many folders); a DoS floor. */
export const MAX_KNOWLEDGE_SCOPES = 200;
const KnowledgeScopesSchema = z
  .array(IdentityKnowledgeScopeSchema)
  .max(MAX_KNOWLEDGE_SCOPES, `At most ${MAX_KNOWLEDGE_SCOPES} knowledge scopes`);

/** `knowledge` and `knowledgeBaseIds` are two replace-sets over one junction: both at once is a 400, never a merge. */
const KNOWLEDGE_EXCLUSIVE_MESSAGE = {
  message:
    "Send knowledgeBaseIds or knowledge, not both — they are two REPLACE-SETs over one attachment set",
} as const;

const knowledgeFieldsExclusive = (patch: {
  knowledgeBaseIds?: unknown;
  knowledge?: unknown;
}) => patch.knowledgeBaseIds === undefined || patch.knowledge === undefined;

// ─── Create / update ────────────────────────────────────────────────────

/** `teamIds` without `visibility: 'team'` is refused, not ignored (a 2xx that moved nothing would lie). */
const teamIdsMatchVisibility = (patch: {
  visibility?: IdentityVisibility;
  teamIds?: string[];
}) => patch.teamIds === undefined || patch.visibility === "team";

const TEAM_IDS_MESSAGE = {
  message: "teamIds requires visibility 'team'",
} as const;

export const AgentIdentityCreateSchema = z
  .object({
    name: NameSchema,
    description: DescriptionSchema.nullable().optional(),
    instructions: InstructionsSchema.nullable().optional(),
    model: ModelSchema.nullable().optional(),
    runtime: RuntimeSchema.nullable().optional(),
    fields: IdentityFieldsSchema.optional(),
    /** Omitted → the service's default (`private`, or `workspace` for a shared credential). */
    visibility: IdentityVisibilitySchema.optional(),
    teamIds: TeamIdsSchema.optional(),
    knowledgeBaseIds: KnowledgeBaseIdsSchema.optional(),
    knowledge: KnowledgeScopesSchema.optional(),
    /** A request to file the row in the caller's personal container; routes, never stored. */
    homeScoped: z.boolean().optional(),
    /** G16's precondition (`workspaces/server/shared-publish.ts`); ignored where it does not apply. */
    acknowledgeShared: z.boolean().optional(),
  })
  .refine(teamIdsMatchVisibility, TEAM_IDS_MESSAGE)
  .refine(knowledgeFieldsExclusive, KNOWLEDGE_EXCLUSIVE_MESSAGE);
export type AgentIdentityCreateInput = z.infer<typeof AgentIdentityCreateSchema>;

/** What `updateIdentity` can move; `acknowledgeShared` changes nothing, so it cannot satisfy the refine. */
const MUTABLE_UPDATE_KEYS = [
  "name",
  "description",
  "instructions",
  "model",
  "runtime",
  "fields",
  "visibility",
  "teamIds",
  "knowledgeBaseIds",
  "knowledge",
] as const;

/** Absent leaves a column alone, `null` clears it; `fields` / `teamIds` / knowledge are replace-sets. */
export const AgentIdentityUpdateSchema = z
  .object({
    name: NameSchema.optional(),
    description: DescriptionSchema.nullable().optional(),
    instructions: InstructionsSchema.nullable().optional(),
    model: ModelSchema.nullable().optional(),
    runtime: RuntimeSchema.nullable().optional(),
    fields: IdentityFieldsSchema.optional(),
    visibility: IdentityVisibilitySchema.optional(),
    teamIds: TeamIdsSchema.optional(),
    knowledgeBaseIds: KnowledgeBaseIdsSchema.optional(),
    knowledge: KnowledgeScopesSchema.optional(),
    acknowledgeShared: z.boolean().optional(),
  })
  .refine(
    // An acknowledgement alone moves no column (the F-404 empty-body class).
    (patch) => MUTABLE_UPDATE_KEYS.some((key) => patch[key] !== undefined),
    { message: "Patch must change at least one field" }
  )
  .refine(teamIdsMatchVisibility, TEAM_IDS_MESSAGE)
  .refine(knowledgeFieldsExclusive, KNOWLEDGE_EXCLUSIVE_MESSAGE);
export type AgentIdentityUpdateInput = z.infer<typeof AgentIdentityUpdateSchema>;
