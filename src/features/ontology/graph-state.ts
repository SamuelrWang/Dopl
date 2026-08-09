"use client";

import type {
  ObjectAttribute,
  ObjectMethod,
  OntologyCluster,
  OntologyObject,
  OntologySnapshot,
} from "./types";

/**
 * Client-side graph store. Actions mutate this local state
 * optimistically; `use-ontology.ts` mirrors them to the API. Columns
 * are container objects: a cluster holds columnIds, a column's
 * childIds are its cards.
 */

export interface GraphState {
  clusters: OntologyCluster[];
  objects: Record<string, OntologyObject>;
}

export const EMPTY_GRAPH: GraphState = { clusters: [], objects: {} };

export type GraphAction =
  | { type: "SNAPSHOT_SET"; snapshot: OntologySnapshot }
  | { type: "CLUSTER_ADD"; cluster: OntologyCluster }
  /**
   * The optimistic-create reconcile: every provisional id minted at submit
   * (`optimistic-create.ts`) swapped for the id the server answered with,
   * wherever it is referenced — and the cluster slugs only the server can mint
   * folded in with it. `map` is provisional id → real id; `slugs` is keyed by
   * the REAL cluster id.
   *
   * A SWAP, not a re-seed: the rows stay exactly as they are on screen. The
   * server's copies are the ones this client just described to it, so replacing
   * them would be a round trip's worth of churn for no new information.
   */
  | {
      type: "CREATE_RESOLVE";
      map: Readonly<Record<string, string>>;
      slugs?: Readonly<Record<string, string>>;
    }
  | { type: "CLUSTER_UPDATE"; id: string; patch: { name?: string; purpose?: string } }
  | { type: "CLUSTER_DELETE"; id: string }
  | {
      type: "OBJECT_ADD";
      object: OntologyObject;
      clusterId?: string;
      parentObjectId?: string;
    }
  | { type: "OBJECT_UPDATE"; id: string; patch: Partial<OntologyObject> }
  | { type: "OBJECT_DELETE"; id: string }
  | { type: "ATTRIBUTE_UPSERT"; id: string; index: number | null; attribute: ObjectAttribute }
  | { type: "ATTRIBUTE_DELETE"; id: string; index: number }
  | { type: "RELATIONSHIP_SET"; id: string; label: string; targetIds: string[] }
  | { type: "RELATIONSHIP_RENAME"; id: string; index: number; label: string }
  | { type: "RELATIONSHIP_DELETE"; id: string; label: string }
  | { type: "METHOD_UPSERT"; id: string; index: number | null; method: ObjectMethod }
  | { type: "METHOD_DELETE"; id: string; index: number };

/** Actions whose target object should be synced to the API (debounced). */
export function objectIdToSync(action: GraphAction): string | null {
  switch (action.type) {
    case "OBJECT_UPDATE":
    case "ATTRIBUTE_UPSERT":
    case "ATTRIBUTE_DELETE":
    case "RELATIONSHIP_SET":
    case "RELATIONSHIP_RENAME":
    case "RELATIONSHIP_DELETE":
    case "METHOD_UPSERT":
    case "METHOD_DELETE":
      return action.id;
    default:
      return null;
  }
}

/**
 * What an object IS, as the UI presents it: the name of its container
 * (its column, or the object it's nested in). Null for top-level
 * columns and orphans.
 */
export function containerNameOf(state: GraphState, id: string): string | null {
  for (const obj of Object.values(state.objects)) {
    if (obj.childIds.includes(id)) return obj.name || null;
  }
  return null;
}

function patchObject(
  state: GraphState,
  id: string,
  fn: (obj: OntologyObject) => OntologyObject
): GraphState {
  const obj = state.objects[id];
  if (!obj) return state;
  return { ...state, objects: { ...state.objects, [id]: fn(obj) } };
}

/**
 * Rewrite provisional ids to real ones EVERYWHERE the graph names an id — the
 * object map's own keys, `id`, `columnIds`, `childIds`, relationship targets,
 * `ref` attribute values, and the KEYS of each cluster's `layout` map.
 *
 * Total on purpose, not just "the parent links of the row that was created":
 * an id that exists on screen can be picked as a relationship or `ref` target
 * during the round trip, and a rewrite that missed one would leave a reference
 * pointing at a row that no longer exists under that name.
 *
 * `layout` is the one that reads as an exception and is not: it is
 * objectId → {x,y}, so its KEYS are ids even though it holds no id-shaped
 * FIELD, and it is the structure an enumeration written from the row shape
 * silently skips. A key left behind there is the quiet failure of the same
 * kind — a dragged position orphaned under a name nothing answers to, the
 * node dropping back to auto-layout, and `pending:<uuid>` riding along in
 * `clusters.layout` on the next write.
 */
function resolveIds(
  state: GraphState,
  map: Readonly<Record<string, string>>,
  slugs?: Readonly<Record<string, string>>
): GraphState {
  if (Object.keys(map).length === 0) return state;
  const to = (id: string): string => map[id] ?? id;
  const objects: Record<string, OntologyObject> = {};
  for (const obj of Object.values(state.objects)) {
    objects[to(obj.id)] = {
      ...obj,
      id: to(obj.id),
      childIds: obj.childIds.map(to),
      relationships: obj.relationships.map((r) => ({
        ...r,
        targetIds: r.targetIds.map(to),
      })),
      attributes: obj.attributes.map((a) =>
        a.value.kind === "ref"
          ? { ...a, value: { kind: "ref" as const, value: a.value.value.map(to) } }
          : a
      ),
    };
  }
  return {
    objects,
    clusters: state.clusters.map((c) => {
      const id = to(c.id);
      const layout: OntologyCluster["layout"] = {};
      for (const [nodeId, point] of Object.entries(c.layout ?? {})) layout[to(nodeId)] = point;
      return {
        ...c,
        id,
        slug: slugs?.[id] ?? c.slug,
        columnIds: c.columnIds.map(to),
        layout,
      };
    }),
  };
}

/**
 * Every object a cluster owns: its columns plus all nested descendants
 * reached through childIds. Visited-set guards against cycles from
 * objects shared across parents.
 */
function collectClusterObjectIds(state: GraphState, cluster: OntologyCluster): Set<string> {
  const removed = new Set<string>();
  const stack = [...cluster.columnIds];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || removed.has(id)) continue;
    removed.add(id);
    const obj = state.objects[id];
    if (obj) stack.push(...obj.childIds);
  }
  return removed;
}

/**
 * Ids of every object that becomes UNREACHABLE when `objectId` is deleted —
 * i.e. what `cascade_hard_delete_object` (migration `20260807140000`) deletes
 * alongside the target, excluding the target itself.
 *
 * This mirrors the RPC exactly and is deliberately NOT a plain subtree walk: a
 * descendant that also hangs under a surviving parent stays alive on the board
 * that still holds it. Membership is the thing being counted, not depth —
 * which is also why deleting an object one row at a time orphans its children
 * rather than removing them (`parent_object_id ON DELETE CASCADE` drops the
 * MEMBERSHIP row, not the child). Keep the two in step: if the RPC's rule
 * changes, this count silently starts lying to the user in the confirm dialog.
 */
export function orphanedByObjectDelete(state: GraphState, objectId: string): string[] {
  if (!state.objects[objectId]) return [];
  const removed = new Set<string>([objectId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const id of [...removed]) {
      for (const childId of state.objects[id]?.childIds ?? []) {
        if (removed.has(childId)) continue;
        const hasSurvivingParent =
          state.clusters.some((c) => c.columnIds.includes(childId)) ||
          Object.values(state.objects).some(
            (o) => !removed.has(o.id) && o.childIds.includes(childId)
          );
        if (!hasSurvivingParent) {
          removed.add(childId);
          grew = true;
        }
      }
    }
  }
  removed.delete(objectId);
  return [...removed];
}

/** Ids of every object a `CLUSTER_DELETE` removes — columns and all descendants. */
export function clusterObjectIds(state: GraphState, clusterId: string): string[] {
  const cluster = state.clusters.find((c) => c.id === clusterId);
  if (!cluster) return [];
  return [...collectClusterObjectIds(state, cluster)];
}

export function graphReducer(state: GraphState, action: GraphAction): GraphState {
  switch (action.type) {
    case "SNAPSHOT_SET":
      return { clusters: action.snapshot.clusters, objects: action.snapshot.objects };
    case "CLUSTER_ADD":
      return { ...state, clusters: [...state.clusters, action.cluster] };
    case "CREATE_RESOLVE":
      return resolveIds(state, action.map, action.slugs);
    case "CLUSTER_UPDATE":
      return {
        ...state,
        clusters: state.clusters.map((c) =>
          c.id === action.id ? { ...c, ...action.patch } : c
        ),
      };
    case "CLUSTER_DELETE": {
      const cluster = state.clusters.find((c) => c.id === action.id);
      if (!cluster) return state;
      const removed = collectClusterObjectIds(state, cluster);
      const objects = { ...state.objects };
      for (const id of removed) delete objects[id];
      for (const [oid, obj] of Object.entries(objects)) {
        const isParent = obj.childIds.some((cid) => removed.has(cid));
        const isSource = obj.relationships.some((r) => r.targetIds.some((t) => removed.has(t)));
        if (!isParent && !isSource) continue;
        objects[oid] = {
          ...obj,
          childIds: obj.childIds.filter((cid) => !removed.has(cid)),
          relationships: obj.relationships
            .map((r) => ({ ...r, targetIds: r.targetIds.filter((t) => !removed.has(t)) }))
            .filter((r) => r.targetIds.length > 0),
        };
      }
      return {
        objects,
        clusters: state.clusters.filter((c) => c.id !== action.id),
      };
    }
    case "OBJECT_ADD": {
      const objects = { ...state.objects, [action.object.id]: action.object };
      if (action.parentObjectId) {
        const parent = objects[action.parentObjectId];
        if (parent) {
          objects[action.parentObjectId] = {
            ...parent,
            childIds: [...parent.childIds, action.object.id],
          };
        }
        return { ...state, objects };
      }
      return {
        objects,
        clusters: state.clusters.map((c) =>
          c.id === action.clusterId
            ? { ...c, columnIds: [...c.columnIds, action.object.id] }
            : c
        ),
      };
    }
    case "OBJECT_UPDATE":
      return patchObject(state, action.id, (o) => ({ ...o, ...action.patch }));
    case "OBJECT_DELETE": {
      const objects = { ...state.objects };
      delete objects[action.id];
      for (const [oid, obj] of Object.entries(objects)) {
        const isParent = obj.childIds.includes(action.id);
        const isSource = obj.relationships.some((r) => r.targetIds.includes(action.id));
        if (!isParent && !isSource) continue;
        objects[oid] = {
          ...obj,
          childIds: obj.childIds.filter((cid) => cid !== action.id),
          relationships: obj.relationships
            .map((r) => ({ ...r, targetIds: r.targetIds.filter((t) => t !== action.id) }))
            .filter((r) => r.targetIds.length > 0),
        };
      }
      return {
        objects,
        clusters: state.clusters.map((c) => ({
          ...c,
          columnIds: c.columnIds.filter((id) => id !== action.id),
        })),
      };
    }
    case "ATTRIBUTE_UPSERT":
      return patchObject(state, action.id, (o) => ({
        ...o,
        attributes:
          action.index === null
            ? [...o.attributes, action.attribute]
            : o.attributes.map((a, i) => (i === action.index ? action.attribute : a)),
      }));
    case "ATTRIBUTE_DELETE":
      return patchObject(state, action.id, (o) => ({
        ...o,
        attributes: o.attributes.filter((_, i) => i !== action.index),
      }));
    case "RELATIONSHIP_SET":
      return patchObject(state, action.id, (o) => {
        const exists = o.relationships.some((r) => r.label === action.label);
        const next = exists
          ? o.relationships.map((r) =>
              r.label === action.label ? { ...r, targetIds: action.targetIds } : r
            )
          : [...o.relationships, { label: action.label, targetIds: action.targetIds }];
        return { ...o, relationships: next.filter((r) => r.targetIds.length > 0) };
      });
    case "RELATIONSHIP_RENAME":
      return patchObject(state, action.id, (o) => ({
        ...o,
        relationships: o.relationships.map((r, i) =>
          i === action.index ? { ...r, label: action.label } : r
        ),
      }));
    case "RELATIONSHIP_DELETE":
      return patchObject(state, action.id, (o) => ({
        ...o,
        relationships: o.relationships.filter((r) => r.label !== action.label),
      }));
    case "METHOD_UPSERT":
      return patchObject(state, action.id, (o) => ({
        ...o,
        methods:
          action.index === null
            ? [...o.methods, action.method]
            : o.methods.map((m, i) => (i === action.index ? action.method : m)),
      }));
    case "METHOD_DELETE":
      return patchObject(state, action.id, (o) => ({
        ...o,
        methods: o.methods.filter((_, i) => i !== action.index),
      }));
  }
}
