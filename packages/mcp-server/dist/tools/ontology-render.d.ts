/**
 * Shared resolvers + renderers for the `dopl_ontology` tool. Refs are
 * agent-friendly: ids preferred, exact names accepted (ambiguity is an
 * error listing candidates, never a guess).
 */
import type { DoplClient, OntologyObject, OntologySnapshot } from "@dopl/client";
import { type ResponseFormat } from "./response-size";
import { type ToolResponse } from "./respond";
/**
 * 🔒 **THE PERSONAL SHELF, LABELLED ON THE ONTOLOGY LANE** (S29c, 2026-09-18).
 *
 * ⚠ **THE COMPLAINT THIS ANSWERS.** A BRAND-NEW home channel listed two
 * ontologies nobody had put there, with nothing saying where they came from —
 * `createHomeChannel` seeds none, and what is actually happening is that
 * `service-audience.ts › computeAudience` folds the caller's own personal shelf
 * into the read scope, exactly as the knowledge lane does. The KB lane labels
 * its half `container-destination.ts › DESTINATION_HEADINGS.personal`; the
 * ontology lane rendered the widening and never named it, which is how two rows
 * a caller owns read as two rows a caller must go and investigate.
 *
 * ⚠ **THE SPLIT KEYS ON THE ANSWER, NOT ON THE QUESTION**, the same rule
 * `opListBases` states: an ABSENT key means "not answered" and puts every
 * ontology in the unlabelled group, which is byte-identical to what this render
 * did before the field existed. It never files a row under a shelf it did not
 * measure.
 *
 * ⚠ **THE HEADING IS A FACT, SO IT SURVIVES `concise`** — which container a row
 * lives in is not a legend, and the whole point of the label is that a reader
 * is wrong without it.
 *
 * @returns the two groups in render order; the personal one carries the shared
 *          heading text, the other carries `null` (no heading at all).
 */
export declare function personalShelfGroups<T extends {
    id: string;
}>(ontologies: readonly T[], personalOntologyIds: readonly string[] | undefined): Array<readonly [string | null, readonly T[]]>;
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
export interface OntologyRefFields {
    id: string;
    slug: string;
    name: string;
}
export declare function resolveObjectRef<T extends ObjectRefFields>(snapshot: {
    objects: Record<string, T>;
}, ref: string): Resolved<T>;
export declare function resolveOntologyRef<T extends OntologyRefFields>(snapshot: {
    ontologies: T[];
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
