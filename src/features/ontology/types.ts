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
  /** References to other objects — individual cards or whole columns. */
  | { kind: "ref"; value: string[] }
  /** Workspace knowledge-base entries the agent should read (access-gated). */
  | { kind: "knowledge"; value: string[] }
  /** Workspace skills the agent should use (access-gated). */
  | { kind: "skill"; value: string[] };

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
  /** Contained objects. Columns are objects too — their children are the cards. */
  childIds: string[];
}

export interface OntologyCluster {
  id: string;
  name: string;
  purpose: string;
  /** The cluster's columns — each a container object whose children are the cards. */
  columnIds: string[];
}

/** A workspace knowledge base or skill, with the caller's access resolved. */
export interface WorkspaceResource {
  id: string;
  name: string;
  /** Where it's shared from — groups the picker. */
  scope: string;
  /** Resolved per caller — the picker only ever shows accessible items. */
  accessible: boolean;
}
