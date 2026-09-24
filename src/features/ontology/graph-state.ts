"use client";

import type {
  ObjectAttribute,
  ObjectMethod,
  Ontology,
  OntologyObject,
  OntologySnapshot,
} from "./types";

/**
 * Client-side graph store. Actions mutate local state optimistically;
 * `use-ontology.ts` mirrors them to the API. Columns are container objects:
 * ontology holds columnIds, a column's childIds are its cards.
 */

export interface GraphState {
  ontologies: Ontology[];
  objects: Record<string, OntologyObject>;
}

/**
 * ⚠ CACHE-SHAPE FALLBACK (INVARIANTS §8). A snapshot persisted before 2026-09-23 carries its
 * list under the retired key and no `ontologies`, and the persisted query cache restores it
 * before the first refetch. It reads as EMPTY until that refetch lands — never a crash. Every
 * snapshot-to-state entry point reads the list through here.
 */
export function ontologiesOf(snapshot: OntologySnapshot): Ontology[] {
  return (snapshot as Partial<OntologySnapshot>).ontologies ?? [];
}

export const EMPTY_GRAPH: GraphState = { ontologies: [], objects: {} };

export type GraphAction =
  | { type: "SNAPSHOT_SET"; snapshot: OntologySnapshot }
  | { type: "ONTOLOGY_ADD"; ontology: Ontology }
  /**
   * Optimistic-create reconcile: provisional ids from `optimistic-create.ts`
   * swapped for the server's wherever referenced, plus server-minted slugs.
   * `map` = provisional → real; `slugs` keyed by the real ontology id.
   * A swap, not a re-seed — rows stay as they are on screen.
   */
  | {
      type: "CREATE_RESOLVE";
      map: Readonly<Record<string, string>>;
      slugs?: Readonly<Record<string, string>>;
    }
  | { type: "ONTOLOGY_UPDATE"; id: string; patch: { name?: string; purpose?: string } }
  | { type: "ONTOLOGY_DELETE"; id: string }
  | {
      type: "OBJECT_ADD";
      object: OntologyObject;
      ontologyId?: string;
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

/** Name of an object's container (its column, or its nesting parent). Null for
 *  top-level columns and orphans. */
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
 * Rewrite provisional ids everywhere the graph names one: the object map's keys,
 * `id`, `columnIds`, `childIds`, relationship targets, `ref` attribute values and
 * each ontology's `layout` keys. Total on purpose — any on-screen id can be picked
 * as a relationship/`ref` target mid-round-trip, and a missed rewrite dangles.
 * `layout`'s KEYS are ids though it has no id-shaped field, so a row-shape-driven
 * enumeration skips it and the stale key rides `pending:<uuid>` into the next write.
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
    ontologies: state.ontologies.map((c) => {
      const id = to(c.id);
      const layout: Ontology["layout"] = {};
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

/** Every object an ontology owns: columns + all childIds descendants.
 *  Visited-set guards cycles from objects shared across parents. */
function collectOntologyObjectIds(state: GraphState, ontology: Ontology): Set<string> {
  const removed = new Set<string>();
  const stack = [...ontology.columnIds];
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
 * Ids left unreachable by deleting `objectId` — what `cascade_hard_delete_object`
 * (migration `20260807140000`) sweeps alongside the target, target excluded. Must
 * stay in sync with that RPC or the confirm dialog's count lies. Not a plain
 * subtree walk: a descendant also hanging under a surviving parent stays alive.
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
          state.ontologies.some((c) => c.columnIds.includes(childId)) ||
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

/** Ids of every object a `ONTOLOGY_DELETE` removes — columns and all descendants. */
export function ontologyObjectIds(state: GraphState, ontologyId: string): string[] {
  const ontology = state.ontologies.find((c) => c.id === ontologyId);
  if (!ontology) return [];
  return [...collectOntologyObjectIds(state, ontology)];
}

export function graphReducer(state: GraphState, action: GraphAction): GraphState {
  switch (action.type) {
    case "SNAPSHOT_SET":
      return { ontologies: ontologiesOf(action.snapshot), objects: action.snapshot.objects };
    case "ONTOLOGY_ADD":
      return { ...state, ontologies: [...state.ontologies, action.ontology] };
    case "CREATE_RESOLVE":
      return resolveIds(state, action.map, action.slugs);
    case "ONTOLOGY_UPDATE":
      return {
        ...state,
        ontologies: state.ontologies.map((c) =>
          c.id === action.id ? { ...c, ...action.patch } : c
        ),
      };
    case "ONTOLOGY_DELETE": {
      const ontology = state.ontologies.find((c) => c.id === action.id);
      if (!ontology) return state;
      const removed = collectOntologyObjectIds(state, ontology);
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
        ontologies: state.ontologies.filter((c) => c.id !== action.id),
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
        ontologies: state.ontologies.map((c) =>
          c.id === action.ontologyId
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
        ontologies: state.ontologies.map((c) => ({
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
