/**
 * Shared resolvers + renderers for the `dopl_ontology` tool. Refs are
 * agent-friendly: ids preferred, exact names accepted (ambiguity is an
 * error listing candidates, never a guess).
 */
import type { DoplClient, OntologyObject, OntologySnapshot } from "@dopl/client";
import { type ToolResponse } from "./respond";
export type Resolved<T> = {
    hit: T;
} | {
    fail: ToolResponse;
};
/**
 * THE TWO RESOLVERS TAKE THE SUMMARY SHAPE AND HAND BACK WHAT THEY WERE GIVEN.
 *
 * Both match on ids, slugs and names, and the ambiguity message walks
 * `childIds` for a container name — every field of which the cheap
 * `view: "summary"` projection carries. Typing the parameter as
 * `OntologySnapshot` was therefore stricter than the code: it forced a caller
 * that only needs names to fetch every JSONB column so the ARGUMENT would
 * typecheck.
 *
 * They are GENERIC rather than simply widened to the summary types, and that is
 * the load-bearing half. `resolveObjectRef` feeds the DETAIL path —
 * `op="get"` renders `attributes` / `relationships` / `template` / `methods` off
 * the hit, and every write op passes it to `renderObject` — so a non-generic
 * widening would have handed those callers an object with the fields stripped
 * off its TYPE. Preserving `T` means a full snapshot in still yields a full
 * `OntologyObject` out, unchanged, and a summary in yields exactly what a
 * summary can back. {@link renderObject} keeps its `OntologySnapshot` parameter
 * for the same reason: it reads the heavy fields, so it must not accept a view
 * that does not have them.
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
export declare function renderObject(object: OntologyObject, snapshot: OntologySnapshot, headline?: string, handles?: ResourceHandles): string;
