import "server-only";
import type {
  Ontology,
  OntologyContext,
  OntologyObject,
  OntologySnapshot,
} from "../types";
import {
  mapObjectRow,
  ONTOLOGY_READ_LIMITS,
  pushEdge,
  type OntologyRow,
  type OntologyListItem,
  type OntologyMembershipRow,
  type OntologyObjectSummary,
  type OntologySummary,
} from "./dto";
import * as repo from "./repository";
import * as narrow from "./repository-projections";
import { countSharesForOntologies } from "./repository-shares";
import {
  audienceAdmits,
  resolveOntologyAudience,
  type AudienceOntologyFacts,
  type OntologyAudience,
} from "./service-audience";

/**
 * The two graph reads, audience-filtered (spec §4 sites 2 and 3, risks R1/R2).
 *
 * ── The order, and why it is not negotiable ─────────────────────────────────
 * ```
 * 1. resolve the audience          — one ceiling for the request
 * 2. read ontologies in its SCOPE    — wider than the caller's container (the lend)
 * 3. FILTER them by level          — the authorization; step 2 is not one
 * 4. WALK memberships from those   — Q8: the ontology's membership walk IS the
 *                                    boundary, so an object reachable only from
 *                                    another ontology is not in this answer
 * 5. read objects and edges BY ID  — never by container
 * ```
 * Steps 2 and 3 are a pair: widening the scope and keeping the filter is safe;
 * keeping the scope and dropping the filter serves the lender's whole shelf to
 * whoever they lent ONE ontology to.
 *
 * One deliberate consequence for the unrestricted arm too: the walk replaces
 * a whole-container object read, so an ORPHAN — an object no membership chain
 * reaches an ontology from — stops appearing even in a standard workspace. That
 * is a bug STATE, not a product one (every create writes a membership in the
 * same call, and nothing renders an orphan). A `kind:"ref"` attribute into
 * ANOTHER ontology still resolves under `unrestricted` — every ontology is a root
 * there — and does not under a `resolved` audience, which is Q8.
 */

/** The membership rows reachable from an ADMITTED ontology, and the objects they
 *  reach. Rows outside the walk are DROPPED, never merely unrendered — they
 *  are what would otherwise attach a foreign column to a visible board. */
interface OntologyWalk {
  objectIds: string[];
  rows: OntologyMembershipRow[];
}

/** EXPORTED FOR THE ONTOLOGY ROLL-UP (`./service-revisions-read.ts ›
 *  listOntologyRevisions`), which needs the SAME boundary — a second downward
 *  walk is how a history comes to name an object the board does not show. */
export function walkAdmittedOntologies(
  admittedOntologyIds: Set<string>,
  memberships: OntologyMembershipRow[]
): OntologyWalk {
  const byParent = new Map<string, OntologyMembershipRow[]>();
  const roots: OntologyMembershipRow[] = [];
  for (const m of memberships) {
    if (m.ontology_id) {
      if (admittedOntologyIds.has(m.ontology_id)) roots.push(m);
    } else if (m.parent_object_id) {
      const bucket = byParent.get(m.parent_object_id);
      if (bucket) bucket.push(m);
      else byParent.set(m.parent_object_id, [m]);
    }
  }

  const rows: OntologyMembershipRow[] = [];
  const seen = new Set<string>();
  const frontier: string[] = [];
  const take = (m: OntologyMembershipRow) => {
    rows.push(m);
    if (seen.has(m.child_object_id)) return;
    seen.add(m.child_object_id);
    frontier.push(m.child_object_id);
  };
  for (const m of roots) take(m);
    // `seen` is what terminates this: a card hanging under two parents is
  // visited once, and a malformed cycle cannot spin.
  while (frontier.length > 0) {
    const parent = frontier.pop() as string;
    for (const m of byParent.get(parent) ?? []) take(m);
  }
  return { objectIds: [...seen], rows };
}

/** Steps 1-4 of the order above, for either ontology projection — the two reads
 *  differ only in WHICH columns they pull, never in the fence. */
async function admittedWalk<T extends AudienceOntologyFacts>(
  ctx: OntologyContext,
  readOntologies: (workspaceIds: readonly string[]) => Promise<T[]>
): Promise<{
  audience: OntologyAudience;
  ontologyCount: number;
  membershipCount: number;
  admitted: T[];
  walk: OntologyWalk;
}> {
  const audience = await resolveOntologyAudience(ctx);
  const [ontologyRows, membershipRows] = await Promise.all([
    readOntologies(audience.workspaceIds),
    repo.listMemberships(audience.workspaceIds),
  ]);
  const admitted = ontologyRows.filter((row) => audienceAdmits(ctx, audience, row));
  return {
    audience,
    ontologyCount: ontologyRows.length,
    membershipCount: membershipRows.length,
    admitted,
    walk: walkAdmittedOntologies(new Set(admitted.map((c) => c.id)), membershipRows),
  };
}

/** Hang the walk's rows on their parents. A row whose child did not survive
 *  the object read is skipped, never rendered as an empty node. */
function attachWalkRows(
  walk: OntologyWalk,
  ontologiesById: ReadonlyMap<string, { columnIds: string[] }>,
  objects: Record<string, { childIds: string[] } | undefined>
): void {
  for (const m of walk.rows) {
    if (!objects[m.child_object_id]) continue;
    if (m.ontology_id) {
      ontologiesById.get(m.ontology_id)?.columnIds.push(m.child_object_id);
    } else if (m.parent_object_id) {
      objects[m.parent_object_id]?.childIds.push(m.child_object_id);
    }
  }
}

/** Whole-ontology graph in the store shape UI and MCP share, bounded by the
 *  caller's audience. Memberships and edges pointing at soft-deleted objects
 *  are dropped here, as they always were. */
export async function getSnapshot(ctx: OntologyContext): Promise<OntologySnapshot> {
  const { audience, admitted, walk } = await admittedWalk(ctx, (ids) =>
    repo.listOntologies(ids)
  );

  const [objectRows, relationshipRows, shareCounts] = await Promise.all([
    repo.listObjectsByIds(audience.workspaceIds, walk.objectIds),
    repo.listRelationshipsForSources(audience.workspaceIds, walk.objectIds),
    // One read for the whole list, and it rides THIS fan rather than adding a
    // round trip — the `grantedResourceIds` shape (spec §3 reason 4).
    countSharesForOntologies(ownedOntologyIds(audience, admitted)),
  ]);

  const objects: Record<string, OntologyObject> = {};
  for (const row of objectRows) objects[row.id] = mapObjectRow(row);

  const ontologies = admitted.map((row) =>
    mapOntologyRow(row, shareCounts.get(row.id))
  );
  attachWalkRows(walk, new Map(ontologies.map((c) => [c.id, c])), objects);

  for (const r of relationshipRows) {
    const source = objects[r.source_object_id];
    if (!source || !objects[r.target_object_id]) continue;
    pushEdge(source.relationships, r.label, r.target_object_id);
  }

  return { ontologies, objects, personalOntologyIds: personalOntologyIds(audience, admitted) };
}

/**
 * 🔒 **WHICH ADMITTED ONTOLOGIES CAME OFF THE CALLER'S OWN PERSONAL SHELF**
 * (S29c, 2026-09-18) — the ontology twin of the knowledge lane's
 * `homeScopedBaseIds`, and the only thing a reader needs to stop calling them
 * mystery rows.
 *
 * ⚠ **A LABEL OVER ROWS THAT ALREADY CLEARED THE FENCE.** It is computed from
 * the SAME `admitted` list the response carries, so it can neither add a row nor
 * hide one; `service-audience.ts › personalWorkspaceIds` is where the widening
 * itself is decided and argued.
 *
 * ⚠ **`unrestricted` ANSWERS AN EMPTY LIST, NOT A GUESS.** A standard workspace
 * resolves no shelf at all (`computeAudience`'s first arm returns before
 * `personalShelfContainerIds` is ever called), so nothing there is personal and
 * saying so costs one empty array.
 */
function personalOntologyIds(
  audience: OntologyAudience,
  admitted: readonly { id: string; workspace_id: string }[]
): string[] {
  if (audience.kind !== "resolved") return [];
  const shelf = new Set(audience.personalWorkspaceIds);
  if (shelf.size === 0) return [];
  return admitted.filter((c) => shelf.has(c.workspace_id)).map((c) => c.id);
}

/**
 * One ontology row → the wire shape.
 *
 * It carries `agentsMayEdit` and `sharedChannelCount`, both read by the
 * /home card (`pages/home/ontology-panels.tsx › OntologyCard` through
 * `../hooks/use-ontologies.ts › ontologyListRows`). Emitting neither renders
 * the FALLBACKS — "agents may edit" for an ontology whose owner turned that off
 * — which exist for a STALE CACHE, never as this mapper's output.
 *
 * `sharedChannelCount` is omitted, not zeroed, when the caller does not own
 * the row: how widely somebody else's ontology is lent is their business, and
 * `undefined` is the "nobody looked" the card renders as nothing.
 */
export function mapOntologyRow(
  row: OntologyRow,
  sharedChannelCount?: number
): Ontology {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    purpose: row.purpose,
    layout: row.layout ?? {},
    columnIds: [],
    agentsMayEdit: row.agents_may_edit,
    ...(sharedChannelCount === undefined ? {} : { sharedChannelCount }),
  };
}

/** The admitted ontologies the caller OWNS — the only ones a share count is
 *  emitted for. `unrestricted` answers NOTHING: a standard-workspace board
 *  never lends into a home channel, so the hot path pays no share read. */
function ownedOntologyIds(
  audience: OntologyAudience,
  admitted: readonly { id: string; created_by: string | null }[]
): string[] {
  if (audience.kind !== "resolved" || audience.userId === null) return [];
  const userId = audience.userId;
  return admitted.filter((c) => c.created_by === userId).map((c) => c.id);
}

/**
 * Map-shaped read: `getSnapshot`'s structure minus every JSONB column and the
 * relationships table. Backs `dopl_map`. `truncated` = clipped by
 * `ONTOLOGY_READ_LIMITS`.
 *
 * The same fence as `getSnapshot` — R2: a leak here lands on the routing
 * surface every agent calls FIRST.
 *
 * Relationships deliberately unfetched (nothing map-shaped draws an edge, and
 * that table grows quadratically); per-object edges stay reachable via
 * `op="get"`.
 */
export async function getSummary(ctx: OntologyContext): Promise<OntologySummary> {
  const { audience, ontologyCount, membershipCount, admitted, walk } =
    await admittedWalk(ctx, (ids) => narrow.listOntologySummaries(ids));
  const objectRows = await narrow.listObjectSummariesByIds(
    audience.workspaceIds,
    walk.objectIds
  );

  const objects: Record<string, OntologyObjectSummary> = {};
  for (const row of objectRows) {
    objects[row.id] = {
      id: row.id,
      name: row.name,
      subtitle: row.subtitle,
      childIds: [],
    };
  }

  const ontologies: OntologyListItem[] = admitted.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    purpose: row.purpose,
    columnIds: [],
  }));
  attachWalkRows(walk, new Map(ontologies.map((c) => [c.id, c])), objects);

  // At-ceiling is indistinguishable from exhausted → counts as clipped.
  const truncated =
    ontologyCount >= ONTOLOGY_READ_LIMITS.ontologies ||
    objectRows.length >= ONTOLOGY_READ_LIMITS.objects ||
    membershipCount >= ONTOLOGY_READ_LIMITS.memberships;

  return {
    ontologies,
    objects,
    truncated,
    personalOntologyIds: personalOntologyIds(audience, admitted),
  };
}
