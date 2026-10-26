/**
 * The fixture search source: a data table behind a real `SearchFetcher`, for tests and for
 * a surface reviewed without a server (the UI-staging playground's story,
 * `ui-staging/data/search-results.ts`).
 *
 * Only the DATA is fixture. Rows are held to the server's own word-start rule and their
 * snippets are minted by the server's own builder (`highlight.ts`), so a fixture answer
 * marks the same words the endpoint would; the debounce, abort, grouping, keyboard order,
 * recents and navigation are the real code paths.
 */

import {
  CONTAINER_ONLY_SEARCH_GROUPS,
  SEARCH_GROUP_ITEM_CAP,
  SEARCH_GROUP_ORDER,
  type SearchGroup,
  type SearchItem,
  type SearchResponse,
} from "./contracts";
import { buildSnippet, highlightPattern, highlightTerms, queryMatcher } from "./highlight";
import type { SearchFetcher } from "./use-search";

/** A row as the repository reads it: the body is plain text, the snippet is minted per query. */
export type FixtureRow = Omit<SearchItem, "snippet"> & { body?: string };

const CONTAINER_ONLY: ReadonlySet<string> = new Set(CONTAINER_ONLY_SEARCH_GROUPS);
const FIXTURE_LATENCY_MS = 120;

function answer(rows: readonly FixtureRow[], q: string, scope: SearchResponse["scope"]): SearchGroup[] {
  const matches = queryMatcher(q);
  const pattern = highlightPattern(highlightTerms(q));
  const hits = rows.filter(
    (row) =>
      (scope === "container" || !CONTAINER_ONLY.has(row.kind)) &&
      (matches?.([row.title, row.subtitle, row.body]) ?? false)
  );
  return SEARCH_GROUP_ORDER.flatMap((kind) => {
    const own = hits.filter((row) => row.kind === kind);
    if (own.length === 0) return [];
    const items = own.slice(0, SEARCH_GROUP_ITEM_CAP).map(({ body, ...item }): SearchItem => {
      const snippet = buildSnippet(body, pattern);
      return snippet === undefined ? item : { ...item, snippet };
    });
    return [{ kind, total: own.length, items }];
  });
}

export function createFixtureFetcher(rows: readonly FixtureRow[]): SearchFetcher {
  return ({ q, scope, signal }) =>
    new Promise<SearchResponse>((resolve, reject) => {
      const timer = setTimeout(
        () => resolve({ q, scope, tookMs: FIXTURE_LATENCY_MS, groups: answer(rows, q, scope) }),
        FIXTURE_LATENCY_MS
      );
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true }
      );
    });
}

/** Shown under the empty field while this machine has remembered no queries of its own. */
export const FIXTURE_RECENTS = ["orchestrator", "credit model", "q4-outbound"];

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const ROWS: FixtureRow[] = [
  {
    id: "ch-q4",
    kind: "channels",
    title: "q4-outbound",
    // A channel's subtitle is its description (`channels.topic`); none is the ordinary case.
    subtitle: "Outbound sequences and replies for the quarter",
    containerId: "ws-orig",
    containerName: "Original",
    channelId: "ch-q4",
    updatedAt: ago(12 * MIN),
  },
  {
    id: "ch-weekly",
    kind: "channels",
    title: "weekly-review",
    containerId: "ws-orig",
    containerName: "Original",
    channelId: "ch-weekly",
    updatedAt: ago(3 * HOUR),
  },
  {
    id: "msg-4821",
    kind: "messages",
    // A message has no name: the server titles it with its channel.
    title: "q4-outbound",
    subtitle: "Original",
    body: "Pushed the orchestrator identity to the shared base, rerun the wave when you get a sec",
    containerId: "ws-orig",
    containerName: "Original",
    channelId: "ch-q4",
    seq: 4821,
    updatedAt: ago(26 * MIN),
  },
  {
    id: "msg-4790",
    kind: "messages",
    title: "weekly-review",
    subtitle: "Original",
    body: "MILESTONE | wave 2 merged, credit model v2.1 migrations applied",
    containerId: "ws-orig",
    containerName: "Original",
    channelId: "ch-weekly",
    seq: 4790,
    updatedAt: ago(5 * HOUR),
  },
  {
    id: "th-221",
    kind: "threads",
    title: "Pricing page rewrite",
    // A thread's subtitle is its parent channel (`server/service-groups.ts › toItem`).
    subtitle: "q4-outbound",
    containerId: "ws-orig",
    containerName: "Original",
    channelId: "ch-q4",
    threadId: "th-221",
    updatedAt: ago(40 * MIN),
  },
  {
    id: "art-31",
    kind: "artifacts",
    title: "Q4 outbound sequence.md",
    subtitle: "q4-outbound",
    containerId: "ws-orig",
    containerName: "Original",
    channelId: "ch-q4",
    updatedAt: ago(DAY),
  },
  {
    id: "kb-orch",
    kind: "knowledge",
    title: "Desktop Orchestrator Protocol",
    subtitle: "Orchestration Guidelines",
    containerId: "ws-orig",
    containerName: "Original",
    updatedAt: ago(9 * DAY),
  },
  {
    id: "tpl-orch",
    kind: "agentIdentities",
    title: "Orchestrator",
    subtitle: "Launches workers, never researches",
    containerId: "ws-orig",
    containerName: "Original",
  },
  {
    id: "mem-priya",
    kind: "members",
    title: "Priya Shah",
    subtitle: "priya@shahco.tax",
    containerId: "ws-orig",
  },
  {
    id: "skill-outreach",
    kind: "skills",
    title: "Consulting outreach",
    containerId: "ws-orig",
    updatedAt: ago(6 * DAY),
  },
  {
    id: "chat-credit",
    kind: "chats",
    title: "Credit model v2.1",
    containerId: "ws-orig",
    updatedAt: ago(7 * DAY),
  },
];

export const fixtureSearchFetcher = createFixtureFetcher(ROWS);
