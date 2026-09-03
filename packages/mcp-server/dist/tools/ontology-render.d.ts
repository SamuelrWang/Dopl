/**
 * Shared resolvers + renderers for the `dopl_ontology` tool. Refs are
 * agent-friendly: ids preferred, exact names accepted (ambiguity is an
 * error listing candidates, never a guess).
 */
import type { DoplClient, OntologyObject, OntologySnapshot } from "@dopl/client";
import { type ResponseFormat } from "./response-size";
import { type ToolResponse } from "./respond";
export type Resolved<T> = {
    hit: T;
} | {
    fail: ToolResponse;
};
/**
 * ⚠ THE TWO RESOLVERS TAKE THE SUMMARY SHAPE AND HAND BACK WHAT THEY WERE
 * GIVEN. They match on ids, slugs and names and walk `childIds` for a container
 * name — all carried by the cheap `view: "summary"` projection, so requiring
 * `OntologySnapshot` would force a names-only caller to fetch every JSONB
 * column just to typecheck.
 *
 * ⚠ GENERIC, not merely widened: `resolveObjectRef` feeds the DETAIL path
 * (`op="get"` reads `attributes`/`relationships`/`template`/`methods` off the
 * hit, and every write op passes it to `renderObject`), so a non-generic
 * widening strips those fields off the TYPE. {@link renderObject} keeps its
 * `OntologySnapshot` parameter for the same reason — it reads the heavy fields.
 */
export interface ObjectRefFields {
    id: string;
    name: string;
    childIds: string[];
}
export interface ClusterRefFields {
    id: string;
    slug: string;
    name: string;
}
export declare function resolveObjectRef<T extends ObjectRefFields>(snapshot: {
    objects: Record<string, T>;
}, ref: string): Resolved<T>;
export declare function resolveClusterRef<T extends ClusterRefFields>(snapshot: {
    clusters: T[];
}, ref: string): Resolved<T>;
export type ResourceHandles = Map<string, {
    name: string;
    slug: string;
    kind: "kb" | "skill";
} | {
    name: string;
    slug: string;
    kind: "kb-entry";
    path: string;
}>;
export declare function resolveResourceHandles(client: DoplClient, object: OntologyObject): Promise<ResourceHandles>;
export declare function renderObject(object: OntologyObject, snapshot: OntologySnapshot, headline?: string, handles?: ResourceHandles, 
/** A16: `concise` drops the two LEGENDS below and nothing else. */
format?: ResponseFormat): string;
