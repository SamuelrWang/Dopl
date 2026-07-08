import { z } from "zod";

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
  requires: z.array(z.string().max(300)).max(50),
});

const relationshipSchema = z.object({
  label: z.string().max(200),
  targetIds: z.array(z.string().uuid()).max(100),
});

const objectTypeSchema = z.enum(["person", "team", "client", "policy", "document"]);

export const OntologyClusterCreateSchema = z.object({
  name: z.string().min(1).max(200),
  purpose: z.string().max(1000).optional(),
});
export type OntologyClusterCreateInput = z.infer<typeof OntologyClusterCreateSchema>;

export const OntologyClusterUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  purpose: z.string().max(1000).optional(),
});
export type OntologyClusterUpdateInput = z.infer<typeof OntologyClusterUpdateSchema>;

export const OntologyObjectCreateSchema = z
  .object({
    clusterId: z.string().uuid().optional(),
    parentObjectId: z.string().uuid().optional(),
    /** Omitted on a card create → inherits the parent column's type. */
    objectType: objectTypeSchema.optional(),
    name: z.string().min(1).max(300),
  })
  .refine((v) => Boolean(v.clusterId) !== Boolean(v.parentObjectId), {
    message: "Provide exactly one of clusterId (new column) or parentObjectId (new card)",
  });
export type OntologyObjectCreateInput = z.infer<typeof OntologyObjectCreateSchema>;

export const OntologyObjectUpdateSchema = z.object({
  name: z.string().min(1).max(300).optional(),
  subtitle: z.string().max(1000).optional(),
  objectType: objectTypeSchema.optional(),
  attributes: z.array(attributeSchema).max(100).optional(),
  methods: z.array(methodSchema).max(50).optional(),
  relationships: z.array(relationshipSchema).max(100).optional(),
  template: z.array(templateFieldSchema).max(100).optional(),
});
export type OntologyObjectUpdateInput = z.infer<typeof OntologyObjectUpdateSchema>;
