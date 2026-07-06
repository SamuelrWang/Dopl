export type ObjectTypeId = "person" | "team" | "client" | "policy" | "document";

export interface ObjectTypeMeta {
  id: ObjectTypeId;
  label: string;
  /** Pill colors, study-notes question-pill style: dark border, light fill. */
  border: string;
  bg: string;
  text: string;
}

export type AttributeValue =
  | { kind: "text"; value: string }
  | { kind: "pill"; value: string }
  | { kind: "files"; value: string[] };

export interface ObjectAttribute {
  key: string;
  label: string;
  value: AttributeValue;
}

export interface ObjectRelationship {
  /** Edge label, e.g. "member of", "assigned to". */
  label: string;
  targetIds: string[];
}

export interface ObjectMethod {
  name: string;
  description: string;
  /** The context recipe: attribute/edge paths the action pulls. */
  requires: string[];
}

export interface OntologyObject {
  id: string;
  type: ObjectTypeId;
  name: string;
  subtitle: string;
  attributes: ObjectAttribute[];
  relationships: ObjectRelationship[];
  methods: ObjectMethod[];
  /** Nested objects (e.g. a client's correspondents). */
  childIds: string[];
}

export interface OntologyCluster {
  id: string;
  name: string;
  purpose: string;
  objectIds: string[];
}
