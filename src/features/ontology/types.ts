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

/**
 * One field of a column's object template: a label + kind with no
 * value. New children of the column are born with these as empty
 * attributes, ready to fill.
 */
export interface TemplateField {
  key: string;
  label: string;
  kind: AttributeValue["kind"];
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
  /**
   * Column-only: default fields for new children. The column's own
   * `type` doubles as the default type of new children.
   */
  template: TemplateField[];
}

export interface OntologyCluster {
  id: string;
  /** URL handle (`/[workspace]/ontology/[slug]`). Stable across renames. */
  slug: string;
  name: string;
  purpose: string;
  /** The cluster's columns — each a container object whose children are the cards. */
  columnIds: string[];
}

/** Full workspace ontology as the API serves it — the UI store's shape. */
export interface OntologySnapshot {
  clusters: OntologyCluster[];
  objects: Record<string, OntologyObject>;
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
