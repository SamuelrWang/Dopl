/**
 * Shared resolvers + renderers for the `dopl_ontology` tool. Refs are
 * agent-friendly: ids preferred, exact names accepted (ambiguity is an
 * error listing candidates, never a guess).
 */
import type { DoplClient, OntologyCluster, OntologyObject, OntologySnapshot } from "@dopl/client";
import { type ToolResponse } from "./respond";
export type Resolved<T> = {
    hit: T;
} | {
    fail: ToolResponse;
};
export declare function resolveObjectRef(snapshot: OntologySnapshot, ref: string): Resolved<OntologyObject>;
export declare function resolveClusterRef(snapshot: OntologySnapshot, ref: string): Resolved<OntologyCluster>;
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
