/**
 * One scope's search — four MCP-native reads plus the app's own search — shared by `dopl_search`'s
 * single-scope path and every `scope="everywhere"` leg (P8-10). Only the renderers differ; what is read, matched, capped and
 * reported as partial is decided here once.
 */
import type { AgentIdentity, AppSearchGroup, DoplClient, KnowledgeSearchHit, OntologyObjectSummary, Skill } from "@dopl/client";
import type { AudienceLabel } from "./audience-label.js";
/** The app-search groups this tool renders, in the popup's order. Knowledge, skills and identities
 *  come from the four MCP-native reads (entries match on BODIES there, titles only in the app). */
export declare const APP_GROUP_ORDER: readonly ["channels", "messages", "threads", "artifacts", "members", "chats"];
export type Matcher = (...fields: Array<string | null | undefined>) => boolean;
/** A capped group: the hits shown and how many matched before the cap. */
export interface Group<T> {
    hits: T[];
    matched: number;
}
export interface ScopeHits {
    entries: KnowledgeSearchHit[];
    skills: Group<Skill>;
    objects: Group<OntologyObjectSummary>;
    identities: Group<AgentIdentity>;
    /** The app-search groups in {@link APP_GROUP_ORDER}; a group with no match is absent. */
    app: AppSearchGroup[];
    /** False when no container id was known, so the app search could not be asked. */
    appSearched: boolean;
    /** The ontology read was itself a prefix, so "no match" says nothing about the rest. */
    ontologyTruncated: boolean;
    /** Neutralized name of the object holding `id`, or `"object"`. */
    containerOf: (id: string) => string;
    /** "Who can see this" for an identity hit, from its container, not its column (S21/S23). */
    audienceOf: (ident: AgentIdentity) => AudienceLabel;
    /** `partialRead`'s notice; "" when every group answered. */
    notice: string;
}
/**
 * Tokenize + punctuation-fold the query so "duplicate name" matches "duplicate-name", word order is
 * free and every term must appear. A whitespace- or punctuation-only query matches nothing.
 * Governs skills / objects / identities only — knowledge uses the backend hybrid search.
 */
export declare function termMatcher(query: string): Matcher;
/**
 * Search the scope the client is currently addressed to. Fail-soft per group: a failed read
 * renders like an empty one, so `notice` must name it.
 */
export declare function searchScope(client: DoplClient, opts: {
    query: string;
    limit: number;
    matches: Matcher;
    inHomeChannel: boolean;
    /** The container searched; null = unknown, and the app search is skipped (and says so). */
    containerId: string | null;
    /** From the Home space: the app groups also cover these containers (the home channels). */
    appAcross?: ReadonlySet<string>;
}): Promise<ScopeHits>;
/** Beside the ontology group when its read was clipped; a capped group is `more()`'s, not this. */
export declare const ONTOLOGY_CLIPPED_NOTE: string;
/** A knowledge-entry snippet as a VALUE: highlight tags dropped (never turned into markdown), neutralized. */
export declare function snippet(raw: string): string;
/** The address `dopl_kb(op="read_file")` takes; `baseSlug`/`path` are absent on an older server (§8). */
export declare function entryAddress(h: {
    entryId: string;
    baseSlug?: string;
    path?: string;
}): string;
/** "Showing N of M" for a capped group, or nothing. */
export declare function more(group: Group<unknown>, noun: string): string[];
