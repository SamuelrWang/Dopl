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
    requires: string[];
}
export interface OntologyRelationship {
    label: string;
    targetIds: string[];
}
export interface OntologyObject {
    id: string;
    type: string;
    name: string;
    subtitle: string;
    attributes: OntologyAttribute[];
    methods: OntologyMethod[];
    relationships: OntologyRelationship[];
    childIds: string[];
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
    objectType: string;
    name: string;
}
export interface OntologyObjectPatch {
    name?: string;
    subtitle?: string;
    objectType?: string;
    attributes?: OntologyAttribute[];
    methods?: OntologyMethod[];
    relationships?: OntologyRelationship[];
}
