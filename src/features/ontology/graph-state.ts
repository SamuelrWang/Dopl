"use client";

import { useReducer } from "react";
import { CLUSTERS, OBJECTS } from "./seed";
import type {
  ObjectAttribute,
  ObjectMethod,
  ObjectTypeId,
  OntologyCluster,
  OntologyObject,
} from "./types";

/**
 * In-memory graph editor state. The whole page is a static preview —
 * edits mutate this local store only; nothing persists. Columns are
 * container objects: a cluster holds columnIds, a column's childIds are
 * its cards.
 */

export interface GraphState {
  objects: Record<string, OntologyObject>;
  clusters: OntologyCluster[];
}

export type GraphAction =
  | { type: "OBJECT_UPDATE"; id: string; patch: Partial<OntologyObject> }
  | {
      type: "OBJECT_CREATE";
      /** Cluster to attach a new COLUMN to (when no parentId). */
      clusterId: string;
      /** Container (column or object) the new object nests under. */
      parentId?: string;
      object: OntologyObject;
    }
  | { type: "OBJECT_DELETE"; id: string }
  | { type: "ATTRIBUTE_UPSERT"; id: string; index: number | null; attribute: ObjectAttribute }
  | { type: "ATTRIBUTE_DELETE"; id: string; index: number }
  | { type: "RELATIONSHIP_SET"; id: string; label: string; targetIds: string[] }
  | { type: "RELATIONSHIP_RENAME"; id: string; index: number; label: string }
  | { type: "RELATIONSHIP_DELETE"; id: string; label: string }
  | { type: "METHOD_UPSERT"; id: string; index: number | null; method: ObjectMethod }
  | { type: "METHOD_DELETE"; id: string; index: number }
  | { type: "CLUSTER_CREATE"; cluster: OntologyCluster };

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
    case "OBJECT_UPDATE":
      return patchObject(state, action.id, (o) => ({ ...o, ...action.patch }));
    case "OBJECT_CREATE": {
      const objects = { ...state.objects, [action.object.id]: action.object };
      if (action.parentId) {
        const parent = objects[action.parentId];
        if (parent) {
          objects[action.parentId] = {
            ...parent,
            childIds: [...parent.childIds, action.object.id],
          };
        }
        return { ...state, objects };
      }
      return {
        ...state,
        objects,
        clusters: state.clusters.map((c) =>
          c.id === action.clusterId
            ? { ...c, columnIds: [...c.columnIds, action.object.id] }
            : c
        ),
      };
    }
    case "OBJECT_DELETE": {
      const objects = { ...state.objects };
      delete objects[action.id];
      for (const [oid, obj] of Object.entries(objects)) {
        if (obj.childIds.includes(action.id)) {
          objects[oid] = {
            ...obj,
            childIds: obj.childIds.filter((cid) => cid !== action.id),
          };
        }
      }
      return {
        ...state,
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
    case "CLUSTER_CREATE":
      return { ...state, clusters: [...state.clusters, action.cluster] };
  }
}

let nextId = 1;

export function newObjectId(): string {
  return `obj-new-${nextId++}`;
}

export function newClusterId(): string {
  return `cl-new-${nextId++}`;
}

export function makeBlankObject(
  id: string,
  type: ObjectTypeId,
  name = "New object"
): OntologyObject {
  return {
    id,
    type,
    name,
    subtitle: "",
    attributes: [],
    relationships: [],
    methods: [],
    childIds: [],
  };
}

export function useGraph() {
  return useReducer(graphReducer, { objects: OBJECTS, clusters: CLUSTERS });
}
