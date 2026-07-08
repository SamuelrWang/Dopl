import "server-only";
import type { OntologyObject } from "../types";

/**
 * Row interfaces and row→domain mappers for the ontology tables. Row
 * shapes mirror the snake_case Postgres columns; assembly into the
 * graph shape (childIds, relationships) happens in service.ts because
 * it spans tables.
 */

export const ONTOLOGY_CLUSTER_COLS =
  "id, workspace_id, slug, name, purpose, position, created_at, updated_at, deleted_at";

export const ONTOLOGY_OBJECT_COLS =
  "id, workspace_id, name, subtitle, attributes, methods, template, user_id, created_at, updated_at, deleted_at";

export const ONTOLOGY_MEMBERSHIP_COLS =
  "id, workspace_id, cluster_id, parent_object_id, child_object_id, position";

export const ONTOLOGY_RELATIONSHIP_COLS =
  "id, workspace_id, source_object_id, label, target_object_id, position";

export interface OntologyClusterRow {
  id: string;
  workspace_id: string;
  slug: string;
  name: string;
  purpose: string;
  position: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface OntologyObjectRow {
  id: string;
  workspace_id: string;
  name: string;
  subtitle: string;
  attributes: OntologyObject["attributes"];
  methods: OntologyObject["methods"];
  template: OntologyObject["template"];
  user_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface OntologyMembershipRow {
  id: string;
  workspace_id: string;
  cluster_id: string | null;
  parent_object_id: string | null;
  child_object_id: string;
  position: number;
}

export interface OntologyRelationshipRow {
  id: string;
  workspace_id: string;
  source_object_id: string;
  label: string;
  target_object_id: string;
  position: number;
}

/** Bare object — childIds/relationships get attached during assembly. */
export function mapObjectRow(row: OntologyObjectRow): OntologyObject {
  return {
    id: row.id,
    name: row.name,
    subtitle: row.subtitle,
    attributes: row.attributes ?? [],
    methods: row.methods ?? [],
    template: row.template ?? [],
    relationships: [],
    childIds: [],
  };
}
