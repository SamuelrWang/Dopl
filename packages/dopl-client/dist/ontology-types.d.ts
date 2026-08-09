/** Wire types for the ontology endpoints (mirrors src/features/ontology/types.ts). */
export type OntologyAttributeValue = {
    kind: "text";
    value: string;
} | {
    kind: "pill";
    value: string;
} | {
    kind: "ref";
    value: string[];
} | {
    kind: "knowledge";
    value: string[];
} | {
    kind: "skill";
    value: string[];
};
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
    /** Tools the agent should use to perform it. */
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
     * Optimistic-concurrency token — the row's `updated_at`. Read ops surface
     * it so a write can pass it back as `expectedVersion` (X-Updated-At) and
     * be rejected (412) if the object changed underneath. Optional: rows
     * written before the field was serialized simply omit it.
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
 * `GET /api/ontology?view=summary` — the same graph SHAPE with every JSONB
 * column left in the database: no `attributes`, no `methods`, no `template`, no
 * cluster `layout`, and no relationships read at all.
 *
 * It exists for map-shaped renders — the ones that print names and containment
 * and nothing else. `dopl_map` is the reason: the server instructions mandate
 * it before every agent's first substantive reply, and it was pulling the whole
 * graph, JSONB and all, to render cluster names and column names.
 *
 * A DISTINCT TYPE, not a snapshot with empty arrays. `attributes: []` asserts
 * that an object has no attributes; omitting the field says this view did not
 * ask. Anything that needs a JSONB column takes the detail path — `op="get"` /
 * `getOntologyAnchor` / the object PATCH response — which returns one object in
 * full. Every field here is also a field of `OntologySnapshot`, so a render
 * that only reads names accepts either.
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
     * True when a server-side row ceiling clipped this view. Absent on older
     * servers, so treat `undefined` as "not clipped" — never as "unknown".
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
