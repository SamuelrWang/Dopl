import { z } from "zod";
import { graphLayoutSchema } from "@/shared/graph/layout-schema";
import { safeLabel } from "@/shared/lib/safe-label";

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
const OntologyClusterNameSchema = safeLabel("Cluster name", 200);
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
});
export type OntologyClusterUpdateInput = z.infer<typeof OntologyClusterUpdateSchema>;

export const OntologyObjectCreateSchema = z
  .object({
    clusterId: z.string().uuid().optional(),
    parentObjectId: z.string().uuid().optional(),
    name: OntologyObjectNameSchema,
  })
  .refine((v) => Boolean(v.clusterId) !== Boolean(v.parentObjectId), {
    message: "Provide exactly one of clusterId (new column) or parentObjectId (new card)",
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
