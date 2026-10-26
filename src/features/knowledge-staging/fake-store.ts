/**
 * UI-STAGING IN-MEMORY DB for /knowledge. Every "server" write the copied components make lands
 * here (via the staging `knowledge/client/api.ts` and `stubs/revisions-api.ts`) and nowhere else —
 * no Supabase, no fetch, no Electron bridge. `resetKnowledgeStore()` runs on page mount, so a
 * reload is always the seed in `data.ts`.
 */

import type {
  ChannelResourceGrant,
  KnowledgeBase,
  KnowledgeEntry,
  KnowledgeFolder,
} from "@/features/knowledge/types";
import type { TeamView } from "@/features/teams/types";
import type { Revision } from "@/features/revisions/types";
import {
  SEED_BASES,
  SEED_CHANNEL_GRANTS,
  SEED_ENTRIES,
  SEED_FOLDERS,
  SEED_REVISIONS,
  SEED_STARRED,
  SEED_TEAMS,
  STAGING_USER_ID,
} from "./data";
import { STAGING_PEOPLE } from "@/features/ui-staging/staging-stubs";

export interface KnowledgeDb {
  bases: KnowledgeBase[];
  folders: KnowledgeFolder[];
  entries: KnowledgeEntry[];
  /** baseId → channelId → grant. */
  grants: Record<string, Record<string, ChannelResourceGrant>>;
  starred: Set<string>;
  teams: TeamView[];
  revisions: Revision[];
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function seed(): KnowledgeDb {
  return {
    bases: clone(SEED_BASES),
    folders: clone(SEED_FOLDERS),
    entries: clone(SEED_ENTRIES),
    grants: clone(SEED_CHANNEL_GRANTS),
    starred: new Set(SEED_STARRED),
    teams: clone(SEED_TEAMS),
    revisions: clone(SEED_REVISIONS),
  };
}

let db: KnowledgeDb = seed();

export function knowledgeDb(): KnowledgeDb {
  return db;
}

export function resetKnowledgeStore(): void {
  db = seed();
}

/** A short pause so busy states ("Saving…", spinners, pending rows) are visible. */
export function latency(ms = 160): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let idSeq = 0;
export function newId(prefix: string): string {
  idSeq += 1;
  return `${prefix}-staging-${Date.now().toString(36)}-${idSeq}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Appends one changelog row for an entry write, as the server's `recordRevision` would. */
export function recordRevision(
  entry: KnowledgeEntry,
  op: Revision["op"],
  summary: string | null = null
): void {
  const me = STAGING_PEOPLE[0];
  const at = nowIso();
  db.revisions.unshift({
    id: newId("rev"),
    resourceType: "knowledge_entry",
    resourceId: entry.id,
    workspaceId: entry.workspaceId,
    actor: {
      userId: STAGING_USER_ID,
      kind: "user",
      agentSessionId: null,
      displayName: me.displayName ?? null,
      avatarUrl: me.avatarUrl ?? null,
    },
    op,
    summary,
    payload: { body: entry.body, title: entry.title, path: entry.title },
    contentHash: newId("hash"),
    createdAt: at,
    updatedAt: at,
  });
}
