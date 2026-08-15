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
  outcome: string;
  tools: string;
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
  /**
   * Optimistic-concurrency token — the row's `updated_at`. Reads surface it so
   * a write passes it back as `expectedVersion` (X-Updated-At) and 412s if the
   * object changed underneath. Optional: pre-serialization rows omit it.
   */
  updatedAt?: string;
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

/**
 * `GET /api/ontology?view=summary` — same graph SHAPE, every JSONB column left
 * in the database: no `attributes`, `methods`, `template`, cluster `layout`,
 * and no relationships read at all. For map-shaped renders that print names and
 * containment only (`dopl_map` runs before every agent's first substantive
 * reply and was pulling the whole graph to render cluster and column names).
 *
 * ⚠ A DISTINCT TYPE, not a snapshot with empty arrays: `attributes: []` asserts
 * an object HAS none; omitting says this view did not ask. Anything needing a
 * JSONB column takes the detail path (`op="get"` / `getOntologyAnchor` / the
 * object PATCH response). Every field here is also a field of
 * `OntologySnapshot`, so a names-only render accepts either.
 */
export interface OntologyObjectSummary {
  id: string;
  name: string;
  subtitle: string;
  childIds: string[];
}

export interface OntologyClusterSummary {
  id: string;
  slug: string;
  name: string;
  purpose: string;
  columnIds: string[];
}

export interface OntologySummary {
  clusters: OntologyClusterSummary[];
  objects: Record<string, OntologyObjectSummary>;
  /**
   * True when a server row ceiling clipped this view. Absent on older servers
   * — treat `undefined` as "not clipped", never "unknown".
   */
  truncated?: boolean;
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
