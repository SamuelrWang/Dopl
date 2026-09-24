/**
 * One scope's search — four MCP-native reads plus the app's own search — shared by `dopl_search`'s
 * single-scope path and every `scope="everywhere"` leg (P8-10). Only the renderers differ; what is read, matched, capped and
 * reported as partial is decided here once.
 */

import type {
  AgentIdentity,
  AgentIdentityListPayload,
  AppSearchGroup,
  AppSearchResponse,
  DoplClient,
  KnowledgeSearchHit,
  OntologyObjectSummary,
  OntologySummary,
  Skill,
} from "@dopl/client";
import { identityAudience } from "./agent-shared.js";
import type { AudienceLabel } from "./audience-label.js";
import { inlineOr, NO_NAME } from "./narration.js";
import { clippedNote } from "./ontology-clipped.js";
import { partialRead } from "./partial-read.js";

/** The `partialRead` denominator — READS, not groups: the fifth read (the app's search) answers six. */
const SEARCH_READ_COUNT = 5;

/** The app-search groups this tool renders, in the popup's order. Knowledge, skills and identities
 *  come from the four MCP-native reads (entries match on BODIES there, titles only in the app). */
export const APP_GROUP_ORDER = ["channels", "messages", "threads", "artifacts", "members", "chats"] as const;
const APP_READ_LABEL = "Channels, messages, threads, artifacts, members and chats";

const EMPTY_APP: AppSearchResponse = { q: "", scope: "container", tookMs: 0, groups: [] };

const EMPTY_ONTOLOGY: OntologySummary = { ontologies: [], objects: {} };
const EMPTY_IDENTITIES: AgentIdentityListPayload = { identities: [] };
const EMPTY_IDS: readonly string[] = Object.freeze([]);

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
export function termMatcher(query: string): Matcher {
  const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const terms = fold(query).split(" ").filter(Boolean);
  return (...fields) => {
    if (terms.length === 0) return false;
    const hay = ` ${fields.map((f) => fold(f ?? "")).join(" ")} `;
    return terms.every((t) => hay.includes(t));
  };
}

/** An account-wide answer narrowed to `ids`; a group's total becomes what survived when any row fell. */
function withinContainers(groups: AppSearchGroup[], ids: ReadonlySet<string>): AppSearchGroup[] {
  return groups.flatMap((g) => {
    const items = g.items.filter((i) => ids.has(i.containerId));
    if (items.length === 0) return [];
    return [{ ...g, items, total: items.length === g.items.length ? g.total : items.length }];
  });
}

const cap = <T>(all: T[], limit: number): Group<T> => ({
  hits: all.slice(0, limit),
  matched: all.length,
});

/**
 * Search the scope the client is currently addressed to. Fail-soft per group: a failed read
 * renders like an empty one, so `notice` must name it.
 */
export async function searchScope(
  client: DoplClient,
  opts: {
    query: string;
    limit: number;
    matches: Matcher;
    inHomeChannel: boolean;
    /** The container searched; null = unknown, and the app search is skipped (and says so). */
    containerId: string | null;
    /** From the Home space: the app groups also cover these containers (the home channels). */
    appAcross?: ReadonlySet<string>;
  },
): Promise<ScopeHits> {
  const { query, limit, matches } = opts;
  const reads = partialRead();
  const [entryHits, skills, ontology, identityPayload, appSearch] = await Promise.all([
    reads.soft("Knowledge entries", client.searchKb(query, { limit }), []),
    reads.soft("Skills", client.listSkills(), []),
    // Summary projection: the graph's JSONB columns are ~8× the bytes and none are read here.
    reads.soft("Ontology objects", client.getOntology({ view: "summary" }), EMPTY_ONTOLOGY),
    // No `shelf` filter: a find surface searches both shelves.
    reads.soft("Agent identities", client.listAgentIdentitiesPayload(), EMPTY_IDENTITIES),
    // ONE implementation: the popup's own server search, fenced by the caller's memberships and lock.
    opts.containerId
      ? reads.soft(
          APP_READ_LABEL,
          // Deferred, so even a synchronous throw is a named partial read, not a failed search.
          Promise.resolve().then(() =>
            opts.appAcross
              ? client.searchAccount(query)
              : client.searchContainer(query, opts.containerId as string),
          ),
          EMPTY_APP,
        )
      : Promise.resolve(EMPTY_APP),
  ]);
  const byKind = new Map(
    (opts.appAcross ? withinContainers(appSearch.groups ?? [], opts.appAcross) : appSearch.groups ?? []).map(
      (g) => [g.kind, g],
    ),
  );

  const objects = Object.values(ontology.objects);
  // Absent key (older server) groups nothing as personal.
  const personalIds = new Set(identityPayload.homeScopedIdentityIds ?? EMPTY_IDS);
  return {
    entries: entryHits.slice(0, limit),
    skills: cap(
      skills.filter((s) => s.status === "active" && matches(s.name, s.description, s.whenToUse)),
      limit,
    ),
    objects: cap(objects.filter((o) => matches(o.name, o.subtitle)), limit),
    // Name + description only, never `instructions`: another member's prompt must not decide
    // which identity a stranger's agent surfaces.
    identities: cap(
      identityPayload.identities.filter((ident) => matches(ident.name, ident.description)),
      limit,
    ),
    app: APP_GROUP_ORDER.flatMap((k) => {
      const g = byKind.get(k);
      return g ? [{ ...g, items: g.items.slice(0, limit) }] : [];
    }),
    appSearched: opts.containerId !== null,
    ontologyTruncated: ontology.truncated === true,
    containerOf: (id) => {
      const name = objects.find((c) => c.childIds.includes(id))?.name;
      return name ? inlineOr(name, NO_NAME) : "object";
    },
    audienceOf: (ident) =>
      identityAudience(ident, {
        personal: personalIds.has(ident.id),
        inHomeChannel: opts.inHomeChannel,
      }),
    notice: reads.notice(opts.containerId ? SEARCH_READ_COUNT : SEARCH_READ_COUNT - 1, "reads"),
  };
}

/** Beside the ontology group when its read was clipped; a capped group is `more()`'s, not this. */
export const ONTOLOGY_CLIPPED_NOTE = clippedNote(
  "the ontology group searched a prefix of the graph and a match outside it could not appear",
);

/** A knowledge-entry snippet as a VALUE: highlight tags dropped (never turned into markdown), neutralized. */
export function snippet(raw: string): string {
  return inlineOr(raw.replace(/<\/?b>/g, ""), "`(no snippet)`");
}

/** The address `dopl_kb(op="read_file")` takes; `baseSlug`/`path` are absent on an older server (§8). */
export function entryAddress(h: { entryId: string; baseSlug?: string; path?: string }): string {
  const where = h.path
    ? `${h.baseSlug ? `base \`${h.baseSlug}\` · ` : ""}path ${inlineOr(h.path, "`(unreadable path)`")} · `
    : "";
  return `${where}entry id: \`${h.entryId}\``;
}

/** "Showing N of M" for a capped group, or nothing. */
export function more(group: Group<unknown>, noun: string): string[] {
  return group.matched > group.hits.length
    ? [
        `_Showing ${group.hits.length} of ${group.matched} matching ${noun}. Raise \`limit\` or narrow the query._`,
      ]
    : [];
}
