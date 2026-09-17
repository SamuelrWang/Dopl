/**
 * THE FIXTURE SEARCH SOURCE — a data table, so the popup can be REVIEWED LIVE
 * before `GET /api/search` exists (Samuel, 2026-09-17: he wants to see the UI
 * now; the endpoint is being built in parallel on `feat/search-api`).
 *
 * ⚠ **ONLY THE DATA IS FIXTURE.** The debounce, the abort, the grouping, the
 * keyboard order, the recents and the navigation are the real code paths — this
 * module is a `SearchFetcher` like any other, so nothing downstream of it knows
 * it is reading a table.
 *
 * ⚠ **THE SWAP IS ONE IMPORT.** A host names `fixtureSearchFetcher` today and
 * `apiSearchFetcher` (`./search-client.ts`) the day the endpoint lands; there is
 * no flag, no branch and no second code path to delete.
 *
 * ⚠ **IT FILTERS FOR REAL** — a query that matches nothing returns no groups, so
 * the "No results" line and the empty-group omission are reviewable too.
 */

import type { SearchGroup, SearchItem, SearchResponse } from "./contracts";
import type { SearchFetcher } from "./use-search";

/** Shown under the field before anything is typed, when this machine has no
 *  remembered queries of its own yet. */
export const FIXTURE_RECENTS = ["orchestrator", "credit model", "q4-outbound"];

const ACCOUNT_ROWS: SearchItem[] = [
  {
    id: "ch-q4",
    kind: "channels",
    title: "q4-outbound",
    // ⚠ THE CHANNEL'S DESCRIPTION — `channels.topic`, which is what the server
    // sends as a channel row's subtitle (`server/repository-channel-rows.ts ›
    // searchChannels`). It is NOT a roster: the row draws one line.
    subtitle: "Outbound sequences and replies for the quarter",
    containerId: "ws-orig",
    containerName: "Original",
    channelId: "ch-q4",
    updatedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
  },
  {
    id: "ch-weekly",
    kind: "channels",
    title: "weekly-review",
    // ⚠ AND ONE WITH NO DESCRIPTION IS THE ORDINARY CASE — `topic` is NOT NULL
    // DEFAULT `''`, so most channels ride out with no subtitle at all and the
    // row omits the span.
    containerId: "ws-orig",
    containerName: "Original",
    channelId: "ch-weekly",
    updatedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  },
  {
    id: "msg-4821",
    kind: "messages",
    title: "Priya Shah",
    snippet:
      "pushed the <mark>orchestrator</mark> template to the shared base — rerun the wave when you get a sec",
    containerId: "ws-orig",
    containerName: "q4-outbound",
    channelId: "ch-q4",
    seq: 4821,
    updatedAt: new Date(Date.now() - 26 * 60_000).toISOString(),
  },
  {
    id: "msg-4790",
    kind: "messages",
    title: "Dopl Main",
    snippet:
      "MILESTONE | wave 2 merged, <mark>credit model</mark> v2.1 migrations applied",
    containerId: "ws-orig",
    containerName: "weekly-review",
    channelId: "ch-weekly",
    seq: 4790,
    updatedAt: new Date(Date.now() - 5 * 3_600_000).toISOString(),
  },
  {
    id: "msg-4655",
    kind: "messages",
    title: "Marcus Webb",
    snippet: "the <mark>q4-outbound</mark> list is in the artifact, not the thread",
    containerId: "ws-orig",
    containerName: "q4-outbound",
    channelId: "ch-q4",
    seq: 4655,
    updatedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  },
  {
    id: "th-221",
    kind: "threads",
    title: "Pricing page rewrite",
    // ⚠ THE PARENT CHANNEL, which is what `service-groups.ts › toItem` fills a
    // thread's subtitle with — never a reply count and never "Direct message".
    subtitle: "q4-outbound",
    containerId: "ws-orig",
    containerName: "Original",
    channelId: "ch-q4",
    threadId: "th-221",
    updatedAt: new Date(Date.now() - 40 * 60_000).toISOString(),
  },
  {
    id: "th-198",
    kind: "threads",
    title: "Desktop sign-out loop",
    subtitle: "weekly-review",
    containerId: "ws-orig",
    containerName: "Original",
    channelId: "ch-weekly",
    threadId: "th-198",
    updatedAt: new Date(Date.now() - 4 * 86_400_000).toISOString(),
  },
  {
    id: "art-31",
    kind: "artifacts",
    title: "Q4 outbound sequence.md",
    subtitle: "Artifact · q4-outbound",
    containerId: "ws-orig",
    containerName: "Original",
    channelId: "ch-q4",
    updatedAt: new Date(Date.now() - 86_400_000).toISOString(),
  },
  {
    id: "kb-orch",
    kind: "knowledge",
    title: "Desktop Orchestrator Protocol",
    subtitle: "Orchestration Guidelines",
    containerId: "ws-orig",
    containerName: "Original",
    updatedAt: new Date(Date.now() - 9 * 86_400_000).toISOString(),
  },
  {
    id: "kb-comms",
    kind: "knowledge",
    title: "Agent Communication Protocol",
    subtitle: "Orchestration Guidelines",
    containerId: "ws-orig",
    containerName: "Original",
    updatedAt: new Date(Date.now() - 9 * 86_400_000).toISOString(),
  },
  {
    id: "tpl-orch",
    kind: "agentTemplates",
    title: "Orchestrator",
    subtitle: "Fable · launches workers, never researches",
    color: "var(--agent-color-03)",
    containerId: "ws-orig",
    containerName: "Original",
  },
  {
    id: "tpl-coder",
    kind: "agentTemplates",
    title: "Coder",
    subtitle: "Opus · builds and ships one branch",
    color: "var(--agent-color-09)",
    containerId: "ws-orig",
    containerName: "Original",
  },
];

/** Only a STANDARD workspace has these three (INVARIANTS §4A). */
const WORKSPACE_ROWS: SearchItem[] = [
  {
    id: "mem-priya",
    kind: "members",
    title: "Priya Shah",
    subtitle: "priya@shahco.tax · member",
    containerId: "ws-orig",
    avatarUrls: ["https://avatars.dopl.app/priya-shah.png"],
  },
  {
    id: "mem-marcus",
    kind: "members",
    title: "Marcus Webb",
    subtitle: "marcus@webb.dev · guest",
    containerId: "ws-orig",
    avatarUrls: ["https://avatars.dopl.app/marcus-webb.png"],
  },
  {
    id: "skill-outreach",
    kind: "skills",
    title: "Consulting outreach",
    subtitle: "Skill · 2 procedures",
    containerId: "ws-orig",
    updatedAt: new Date(Date.now() - 6 * 86_400_000).toISOString(),
  },
  {
    id: "chat-credit",
    kind: "chats",
    title: "Credit model v2.1",
    subtitle: "Chat · 38 messages",
    containerId: "ws-orig",
    updatedAt: new Date(Date.now() - 7 * 86_400_000).toISOString(),
  },
];

/** `<mark>` is the server's highlight, so it is not part of the text a query
 *  matches against. */
const plain = (item: SearchItem) =>
  `${item.title} ${item.subtitle ?? ""} ${(item.snippet ?? "").replace(/<\/?mark>/g, "")}`.toLowerCase();

function groupRows(rows: SearchItem[]): SearchGroup[] {
  const byKind = new Map<SearchItem["kind"], SearchItem[]>();
  for (const row of rows) {
    const list = byKind.get(row.kind) ?? [];
    list.push(row);
    byKind.set(row.kind, list);
  }
  return [...byKind].map(([kind, items]) => ({
    kind,
    total: items.length,
    items,
  }));
}

export const fixtureSearchFetcher: SearchFetcher = ({ q, scope, signal }) =>
  new Promise<SearchResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      const needle = q.toLowerCase();
      const pool =
        scope === "container"
          ? [...ACCOUNT_ROWS, ...WORKSPACE_ROWS]
          : ACCOUNT_ROWS;
      resolve({
        q,
        scope,
        tookMs: 120,
        groups: groupRows(pool.filter((row) => plain(row).includes(needle))),
      });
    }, 120);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
