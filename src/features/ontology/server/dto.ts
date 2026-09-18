import "server-only";
import type { GraphLayout } from "@/shared/graph";
import type { OntologyObject, OntologyWriteSource } from "../types";

/**
 * Row interfaces + row→domain mappers. Row shapes mirror the snake_case
 * Postgres columns; assembly into the graph shape (childIds, relationships)
 * happens in service.ts because it spans tables.
 */

/** `created_by` and `agents_may_edit` are AUDIENCE INPUTS, not display
 *  fields — `service-audience.ts › levelForCluster` reads both off the row, so
 *  every projection that a gate is applied to must carry them or the gate
 *  silently answers about a cluster with no owner and no toggle. */
export const ONTOLOGY_CLUSTER_COLS =
  "id, workspace_id, slug, name, purpose, layout, position, created_by, agents_may_edit, created_at, updated_at, deleted_at";

export const ONTOLOGY_OBJECT_COLS =
  "id, workspace_id, name, subtitle, attributes, methods, template, user_id, last_edited_by, last_edited_source, created_at, updated_at, deleted_at";

export const ONTOLOGY_MEMBERSHIP_COLS =
  "id, workspace_id, cluster_id, parent_object_id, child_object_id, position";

export const ONTOLOGY_RELATIONSHIP_COLS =
  "id, workspace_id, source_object_id, label, target_object_id, position";

/**
 * The summary projection — same graph SHAPE, every JSONB column left in the DB.
 *
 * The wide sets ship `attributes`/`methods`/`template` (schema caps: 100
 * entries, 4000 chars per text attribute → hundreds of KB per object) and
 * `layout`. A map-shaped render reads none of it. Anything that genuinely needs
 * a JSONB column takes the DETAIL path (`findObjectById`, object PATCH
 * response, anchor read), which selects `ONTOLOGY_OBJECT_COLS` for ONE row.
 *
 * `position`/`created_at` absent on purpose: PostgREST orders on columns it
 * doesn't have to return.
 */
export const ONTOLOGY_CLUSTER_SUMMARY_COLS =
  "id, workspace_id, slug, name, purpose, created_by, agents_may_edit";

export const ONTOLOGY_OBJECT_SUMMARY_COLS = "id, name, subtitle";

/**
 * Hard row ceilings for the whole-workspace list reads. Set well above any
 * workspace shape the product produces (free multi-member cap is 100 objects;
 * a heavy paid board is in the hundreds), so hitting one means a runaway agent
 * loop, an import, or a bug.
 *
 * A clipped read is REPORTED, never silently short: `getSummary` returns
 * `truncated: true` and `dopl_map` renders a line saying so. A cap that renders
 * identically to an exhausted list is the bug.
 */
export const ONTOLOGY_READ_LIMITS = {
  clusters: 500,
  objects: 5_000,
  memberships: 20_000,
  relationships: 20_000,
} as const;

export interface OntologyClusterRow {
  id: string;
  workspace_id: string;
  slug: string;
  name: string;
  purpose: string;
  layout: GraphLayout | null;
  position: number;
  created_by: string | null;
  agents_may_edit: boolean;
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
  /** Q3/Q6 attribution — an edit survives an unshare, attributed to its author.
   *  `null` on rows written before the columns existed. */
  last_edited_by: string | null;
  last_edited_source: OntologyWriteSource | null;
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

export interface OntologyClusterSummaryRow {
  id: string;
  /** An audience input, like `created_by` — `service-shared.ts ›
   *  canSeeOntology` asks which container the row lives in. */
  workspace_id: string;
  slug: string;
  name: string;
  purpose: string;
  created_by: string | null;
  agents_may_edit: boolean;
}

export interface OntologyObjectSummaryRow {
  id: string;
  name: string;
  subtitle: string;
}

/**
 * Summary wire shapes. Structurally a SUBSET of `OntologyObject` /
 * `OntologyCluster` so the same render code reads either, but a DISTINCT type
 * on purpose — an empty array claims "no attributes", an absent field says
 * "this view didn't ask".
 * Mirror lives in `packages/dopl-client/src/ontology-types.ts` — sync both.
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
  /** True when an `ONTOLOGY_READ_LIMITS` ceiling clipped this view — caller
   *  must say "there is more", not present a partial graph as the whole. */
  truncated: boolean;
}

/**
 * Merge one relationship row into an edge list — same-label rows collect under
 * one edge. ONE COPY: the graph read and the per-object read assemble the
 * same shape, and two loops are two orderings waiting to disagree.
 */
export function pushEdge(
  edges: OntologyObject["relationships"],
  label: string,
  targetId: string
): void {
  const edge = edges.find((e) => e.label === label);
  if (edge) edge.targetIds.push(targetId);
  else edges.push({ label, targetIds: [targetId] });
}

/** Bare object — childIds/relationships get attached during assembly. */
export function mapObjectRow(row: OntologyObjectRow): OntologyObject {
  return {
    id: row.id,
    name: row.name,
    subtitle: row.subtitle,
    attributes: row.attributes ?? [],
    // Backfill fields added after rows were written — never assume stored
    // JSON has the newest shape.
    methods: (row.methods ?? []).map((m) => ({ ...m, tools: m.tools ?? "" })),
    template: row.template ?? [],
    relationships: [],
    childIds: [],
    // Optimistic-concurrency token surfaced to read paths (op="get"/anchor).
    updatedAt: row.updated_at,
  };
}
