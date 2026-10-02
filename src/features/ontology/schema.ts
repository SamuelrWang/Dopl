import { z } from "zod";
import { graphLayoutSchema } from "@/shared/graph/layout-schema";
import { safeLabel } from "@/shared/lib/safe-label";
import { ONTOLOGY_LEVELS } from "./types";
import {
  ENUM_OPTION_MAX,
  ENUM_OPTIONS_MAX,
  FIELD_DESCRIPTION_MAX,
  FIELD_KINDS,
  isHttpUrl,
  isIsoDate,
  valueProblem,
} from "./field-kinds";

/**
 * Ontology/object names are the ontology's short labels (`dopl_map` and
 * `dopl_ontology` print them). Real columns on editor-writable tables → both get
 * the charset rule and a matching DB CHECK. Labels nested in jsonb are left alone
 * deliberately: a CHECK means walking a jsonb array on every write, and
 * `ontology_objects` has an editor-scoped UPDATE policy for `public`, so a
 * zod-only bound would be a fence beside an open gate.
 */
const OntologyNameSchema = safeLabel("Ontology name", 200);
const OntologyObjectNameSchema = safeLabel("Object name", 300);

const attributeValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), value: z.string().max(4000) }),
  z.object({ kind: z.literal("pill"), value: z.string().max(400) }),
  // ⚠ MEMBERSHIP in the field's `options` is checked one level up
  // (`attributeSchema`), where the options are in scope.
  z.object({ kind: z.literal("enum"), value: z.string().max(ENUM_OPTION_MAX) }),
  z.object({
    kind: z.literal("date"),
    value: z.string().refine((v) => v === "" || isIsoDate(v), "A date must be YYYY-MM-DD"),
  }),
  z.object({
    kind: z.literal("link"),
    value: z.string().refine((v) => v === "" || isHttpUrl(v), "A link must be an http(s) URL"),
  }),
  z.object({ kind: z.literal("ref"), value: z.array(z.string().uuid()).max(50) }),
  z.object({ kind: z.literal("knowledge"), value: z.array(z.string()).max(50) }),
  z.object({ kind: z.literal("skill"), value: z.array(z.string()).max(50) }),
]);

/** A field's description and (enum) options — shared by attributes and template
 *  fields. Optional, so every row stored before 2026-10-01 parses unchanged. */
const fieldMetaShape = {
  description: z.string().max(FIELD_DESCRIPTION_MAX).optional(),
  options: z
    .array(z.string().trim().min(1).max(ENUM_OPTION_MAX))
    .max(ENUM_OPTIONS_MAX)
    .refine(
      (o) => new Set(o.map((x) => x.toLowerCase())).size === o.length,
      "Options must be unique"
    )
    .optional(),
};

const attributeSchema = z
  .object({
    key: z.string().min(1).max(200),
    label: z.string().max(200),
    value: attributeValueSchema,
    ...fieldMetaShape,
  })
  .superRefine((attr, ctx) => {
    // ⚠ THE ENUM FENCE. An enum value outside its options is refused here, at the
    // one parse every write (panel, MCP, REST) goes through.
    if (attr.value.kind === "enum") {
      const problem = valueProblem(attr.value, attr.options);
      if (problem) ctx.addIssue({ code: "custom", path: ["value"], message: problem });
    }
  });

const templateFieldSchema = z.object({
  key: z.string().min(1).max(200),
  label: z.string().max(200),
  kind: z.enum(FIELD_KINDS),
  ...fieldMetaShape,
});

const methodSchema = z.object({
  name: z.string().max(300),
  description: z.string().max(2000),
  outcome: z.string().max(2000),
  // Default, not required: methods stored before this field existed sync back
  // without it.
  tools: z.string().max(2000).default(""),
});

const relationshipSchema = z.object({
  label: z.string().max(200),
  targetIds: z.array(z.string().uuid()).max(100),
});

export const OntologyCreateSchema = z.object({
  name: OntologyNameSchema,
  purpose: z.string().max(1000).optional(),
});
export type OntologyCreateInput = z.infer<typeof OntologyCreateSchema>;

export const OntologyUpdateSchema = z.object({
  name: OntologyNameSchema.optional(),
  purpose: z.string().max(1000).optional(),
  layout: graphLayoutSchema.optional(),
  /**
   * Owner toggle: agents may view but not edit. It only ever narrows, and it
   * seeds `ownerAgentsLevel` at first share (Q2).
   *
   * Refused from an agent in the SERVICE, not by a route field gate: it is a
   * containment control — a Bash-capable session could otherwise read its own
   * bearer off disk and durably re-widen itself — and the service refusal covers
   * the MCP path too, which a route-level `SESSION_ONLY_FIELDS` would not.
   */
  agentsMayEdit: z.boolean().optional(),
});
export type OntologyUpdateInput = z.infer<typeof OntologyUpdateSchema>;

export const OntologyObjectCreateSchema = z
  .object({
    ontologyId: z.string().uuid().optional(),
    parentObjectId: z.string().uuid().optional(),
    name: OntologyObjectNameSchema,
  })
  .refine((v) => Boolean(v.ontologyId) !== Boolean(v.parentObjectId), {
    message: "Provide exactly one of ontologyId (new object) or parentObjectId (new card)",
  });
export type OntologyObjectCreateInput = z.infer<typeof OntologyObjectCreateSchema>;

export const OntologyObjectUpdateSchema = z.object({
  name: OntologyObjectNameSchema.optional(),
  subtitle: z.string().max(1000).optional(),
  attributes: z.array(attributeSchema).max(100).optional(),
  methods: z.array(methodSchema).max(50).optional(),
  relationships: z.array(relationshipSchema).max(100).optional(),
  template: z.array(templateFieldSchema).max(100).optional(),
});
export type OntologyObjectUpdateInput = z.infer<typeof OntologyObjectUpdateSchema>;

/**
 * The share write: one `(ontology, channel)` row, stated as a complete end state
 * for all three audiences (I4), so a retry after an ambiguous failure is idempotent.
 *
 * `ownerAgentsLevel` is optional by Q2, not for convenience: absent on the FIRST
 * share seeds it from the ontology's `agents_may_edit` toggle; absent on an
 * existing row keeps the stored value.
 *
 * Unsharing is `DELETE`, never three `none`s (I4): absence is the third state, and
 * what the FK cascade (Q4) is written against.
 */
export const OntologyShareWriteSchema = z.object({
  channelId: z.string().uuid(),
  membersLevel: z.enum(ONTOLOGY_LEVELS),
  guestsLevel: z.enum(ONTOLOGY_LEVELS),
  ownerAgentsLevel: z.enum(ONTOLOGY_LEVELS).optional(),
});
export type OntologyShareWriteInput = z.infer<typeof OntologyShareWriteSchema>;
