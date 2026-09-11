import { z } from "zod";
import { graphLayoutSchema } from "@/shared/graph/layout-schema";
import { safeLabel } from "@/shared/lib/safe-label";
import { ONTOLOGY_LEVELS } from "./types";

/**
 * Cluster/object names are the ontology's short labels (`dopl_map` and
 * `dopl_ontology` print them). Real columns on editor-writable tables → both
 * get the charset rule and a matching DB CHECK.
 *
 * ⚠ Labels NESTED IN JSONB (`attributes[].label`, `template[].label`,
 * `relationships[].label`, `methods[].name`) are deliberately left alone: a
 * CHECK means walking a jsonb array on every write, and `ontology_objects` has
 * an editor-scoped UPDATE policy for `public`, so a zod-only bound would be a
 * fence beside an open gate. `purpose`, `subtitle`, method descriptions and
 * text attribute values are prose and stay prose.
 */
const OntologyClusterNameSchema = safeLabel("Ontology name", 200);
const OntologyObjectNameSchema = safeLabel("Object name", 300);

const attributeValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), value: z.string().max(4000) }),
  z.object({ kind: z.literal("pill"), value: z.string().max(400) }),
  z.object({ kind: z.literal("ref"), value: z.array(z.string().uuid()).max(50) }),
  z.object({ kind: z.literal("knowledge"), value: z.array(z.string()).max(50) }),
  z.object({ kind: z.literal("skill"), value: z.array(z.string()).max(50) }),
]);

const attributeSchema = z.object({
  key: z.string().min(1).max(200),
  label: z.string().max(200),
  value: attributeValueSchema,
});

const templateFieldSchema = z.object({
  key: z.string().min(1).max(200),
  label: z.string().max(200),
  kind: z.enum(["text", "pill", "ref", "knowledge", "skill"]),
});

const methodSchema = z.object({
  name: z.string().max(300),
  description: z.string().max(2000),
  outcome: z.string().max(2000),
  // ⚠ Default, not required: methods stored before this field existed sync
  // back without it.
  tools: z.string().max(2000).default(""),
});

const relationshipSchema = z.object({
  label: z.string().max(200),
  targetIds: z.array(z.string().uuid()).max(100),
});

export const OntologyClusterCreateSchema = z.object({
  name: OntologyClusterNameSchema,
  purpose: z.string().max(1000).optional(),
});
export type OntologyClusterCreateInput = z.infer<typeof OntologyClusterCreateSchema>;

export const OntologyClusterUpdateSchema = z.object({
  name: OntologyClusterNameSchema.optional(),
  purpose: z.string().max(1000).optional(),
  layout: graphLayoutSchema.optional(),
  /**
   * 🔒 SAMUEL'S SOLO TOGGLE — "a setting where they can toggle it so that their
   * agents can only view, and not edit". It only ever NARROWS, and it is ALSO
   * the seed for `ownerAgentsLevel` at first share (Q2).
   *
   * ⚠ REFUSED FROM AN AGENT IN THE SERVICE, not by a route field gate. It is a
   * CONTAINMENT control — a Bash-capable session could otherwise read its own
   * bearer off disk and durably re-widen itself — and the service refusal covers
   * the MCP path too, which a route-level `SESSION_ONLY_FIELDS` would not.
   */
  agentsMayEdit: z.boolean().optional(),
});
export type OntologyClusterUpdateInput = z.infer<typeof OntologyClusterUpdateSchema>;

export const OntologyObjectCreateSchema = z
  .object({
    clusterId: z.string().uuid().optional(),
    parentObjectId: z.string().uuid().optional(),
    name: OntologyObjectNameSchema,
  })
  .refine((v) => Boolean(v.clusterId) !== Boolean(v.parentObjectId), {
    message: "Provide exactly one of clusterId (new object) or parentObjectId (new card)",
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
 * THE SHARE WRITE — one `(ontology, channel)` row, stated as a COMPLETE end
 * state for all three audiences (I4), so a retry after an ambiguous failure is
 * idempotent. The `channel-grants` PUT contract, with a LADDER instead of an
 * audience word.
 *
 * ⚠ `ownerAgentsLevel` IS OPTIONAL AND THAT IS Q2, NOT A CONVENIENCE. Absent on
 * the FIRST share seeds it from the ontology's `agents_may_edit` toggle; absent
 * on a row that already exists KEEPS the stored value. A share write must never
 * silently re-decide what the owner already said about their own agents.
 *
 * ⚠ UNSHARING IS `DELETE`, never three `none`s (I4): absence is the third state
 * and it is what the FK cascade (Q4) is written against.
 */
export const OntologyShareWriteSchema = z.object({
  channelId: z.string().uuid(),
  membersLevel: z.enum(ONTOLOGY_LEVELS),
  guestsLevel: z.enum(ONTOLOGY_LEVELS),
  ownerAgentsLevel: z.enum(ONTOLOGY_LEVELS).optional(),
});
export type OntologyShareWriteInput = z.infer<typeof OntologyShareWriteSchema>;
