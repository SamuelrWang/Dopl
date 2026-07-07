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
  | { type: "CLUSTER_UPDATE"; id: string; patch: { name?: string; purpose?: string } }
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

function patchObject(
  state: GraphState,
  id: string,
  fn: (obj: OntologyObject) => OntologyObject
): GraphState {
  const obj = state.objects[id];
  if (!obj) return state;
  return { ...state, objects: { ...state.objects, [id]: fn(obj) } };
}

export function graphReducer(state: GraphState, action: GraphAction): GraphState {
  switch (action.type) {
    case "SNAPSHOT_SET":
      return { clusters: action.snapshot.clusters, objects: action.snapshot.objects };
    case "CLUSTER_ADD":
      return { ...state, clusters: [...state.clusters, action.cluster] };
    case "CLUSTER_UPDATE":
      return {
        ...state,
        clusters: state.clusters.map((c) =>
          c.id === action.id ? { ...c, ...action.patch } : c
        ),
      };
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
