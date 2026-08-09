import "server-only";
import type { GraphLayout } from "@/shared/graph";
import type { OntologyObject } from "../types";

/**
 * Row interfaces and row→domain mappers for the ontology tables. Row
 * shapes mirror the snake_case Postgres columns; assembly into the
 * graph shape (childIds, relationships) happens in service.ts because
 * it spans tables.
 */

export const ONTOLOGY_CLUSTER_COLS =
  "id, workspace_id, slug, name, purpose, layout, position, created_at, updated_at, deleted_at";

export const ONTOLOGY_OBJECT_COLS =
  "id, workspace_id, name, subtitle, attributes, methods, template, user_id, created_at, updated_at, deleted_at";

export const ONTOLOGY_MEMBERSHIP_COLS =
  "id, workspace_id, cluster_id, parent_object_id, child_object_id, position";

export const ONTOLOGY_RELATIONSHIP_COLS =
  "id, workspace_id, source_object_id, label, target_object_id, position";

/**
 * THE SUMMARY PROJECTION — the same graph SHAPE with every JSONB column left
 * in the database (P0-3).
 *
 * `ONTOLOGY_OBJECT_COLS` ships `attributes`, `methods` and `template`; the
 * schema caps each at 100 entries and a text attribute at 4000 chars, so one
 * object's ceiling is measured in hundreds of KB and a whole-workspace pull has
 * no ceiling at all. `ONTOLOGY_CLUSTER_COLS` ships `layout`, one x/y pair per
 * node in the cluster. NONE of it reaches a map-shaped render: `dopl_map` — the
 * call the server instructions mandate before every agent's first reply — turns
 * this graph into cluster names and column names and throws the rest away.
 *
 * So the map-shaped reads select these columns instead. Everything a router
 * needs (who exists, what it is called, what contains it), nothing a router
 * reads past. Anything that genuinely needs a JSONB column goes to the DETAIL
 * path — `findObjectById` / the object PATCH response / the anchor read — which
 * still selects `ONTOLOGY_OBJECT_COLS` in full, for ONE row.
 *
 * `position` / `created_at` are absent on purpose: PostgREST orders on columns
 * it does not have to return.
 */
export const ONTOLOGY_CLUSTER_SUMMARY_COLS = "id, slug, name, purpose";

export const ONTOLOGY_OBJECT_SUMMARY_COLS = "id, name, subtitle";

/**
 * Hard row ceilings for the whole-workspace list reads.
 *
 * Every one of these queries used to be `select(...).eq("workspace_id", …)`
 * with no `limit` — the row count was whatever the workspace happened to hold,
 * on a paid plan with no object cap, on a path any member can hit repeatedly.
 * An unbounded read is not a slow read, it is an unpriced one: nothing in the
 * system says how large the response CAN get.
 *
 * The values are set well above any workspace shape the product produces (the
 * free multi-member cap is 100 objects; a heavily-used paid board is in the
 * hundreds), so hitting one means something has gone wrong — a runaway agent
 * loop, an import, a bug — which is exactly the case an unbounded query serves
 * worst. Reads that clip are REPORTED, never silently short: `getSummary`
 * returns `truncated: true` and `dopl_map` renders a line saying so. A cap that
 * renders identically to an exhausted list is the bug this file already fixed
 * once for `op="resolve"`.
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

export interface OntologyClusterSummaryRow {
  id: string;
  slug: string;
  name: string;
  purpose: string;
}

export interface OntologyObjectSummaryRow {
  id: string;
  name: string;
  subtitle: string;
}

/**
 * The summary wire shapes. Structurally a SUBSET of `OntologyObject` /
 * `OntologyCluster`, so the same render code reads either — but a DISTINCT
 * type, deliberately, rather than a snapshot with `attributes: []` filled in.
 * An empty array is a claim ("this object has no attributes"); an absent field
 * is the truth ("this view did not ask"). The mirror of these lives in
 * `packages/dopl-client/src/ontology-types.ts`.
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
   * True when one of the `ONTOLOGY_READ_LIMITS` ceilings clipped this view, so
   * a caller can say "there is more" instead of presenting a partial graph as
   * the whole one.
   */
  truncated: boolean;
}

/** Bare object — childIds/relationships get attached during assembly. */
export function mapObjectRow(row: OntologyObjectRow): OntologyObject {
  return {
    id: row.id,
    name: row.name,
    subtitle: row.subtitle,
    attributes: row.attributes ?? [],
    // Backfill fields added after rows were written (additive-only —
    // never assume stored JSON has the newest shape).
    methods: (row.methods ?? []).map((m) => ({ ...m, tools: m.tools ?? "" })),
    template: row.template ?? [],
    relationships: [],
    childIds: [],
    // Optimistic-concurrency token surfaced to read paths (op="get"/anchor).
    updatedAt: row.updated_at,
  };
}
