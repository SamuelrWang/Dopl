/** Wire types for the ontology endpoints (mirrors src/features/ontology/types.ts). */

export type OntologyAttributeValue =
  | { kind: "text"; value: string }
  | { kind: "pill"; value: string }
  | { kind: "ref"; value: string[] }
  | { kind: "knowledge"; value: string[] }
  | { kind: "skill"; value: string[] };

export interface OntologyAttribute {
  key: string;
  label: string;
  value: OntologyAttributeValue;
}

export interface OntologyMethod {
  name: string;
  description: string;
  /** What the result of the action should be. */
  outcome: string;
}

export interface OntologyRelationship {
  label: string;
  targetIds: string[];
}

export interface OntologyTemplateField {
  key: string;
  label: string;
  kind: OntologyAttributeValue["kind"];
}

export interface OntologyObject {
  id: string;
  name: string;
  subtitle: string;
  attributes: OntologyAttribute[];
  methods: OntologyMethod[];
  relationships: OntologyRelationship[];
  childIds: string[];
  /** Column-only: default fields new children are born with. */
  template: OntologyTemplateField[];
}

export interface OntologyCluster {
  id: string;
  slug: string;
  name: string;
  purpose: string;
  columnIds: string[];
}

export interface OntologySnapshot {
  clusters: OntologyCluster[];
  objects: Record<string, OntologyObject>;
}

export interface OntologyClusterCreateInput {
  name: string;
  purpose?: string;
}

export interface OntologyClusterPatch {
  name?: string;
  purpose?: string;
}

export interface OntologyObjectCreateInput {
  /** Exactly one of clusterId (new column) or parentObjectId (new card). */
  clusterId?: string;
  parentObjectId?: string;
  name: string;
}

export interface OntologyObjectPatch {
  name?: string;
  subtitle?: string;
  attributes?: OntologyAttribute[];
  methods?: OntologyMethod[];
  relationships?: OntologyRelationship[];
  template?: OntologyTemplateField[];
}
