"use client";

/**
 * ⚠ STAGING COPY of `src/features/knowledge/client/api.ts`. SAME EXPORTS AND SIGNATURES; every
 * body reads/writes the in-memory DB (`../../fake-store.ts`) instead of `apiRequest`. No fetch.
 * The original header follows.
 *
 * Typed client wrappers for knowledge REST endpoints. Each sets
 * `X-Workspace-Id` when `workspaceId` is given, throws `KnowledgeApiError` on
 * `!res.ok`, and returns JSON for 200/201 or `void` for 204.
 */
import {
  knowledgeDb,
  latency,
  newId,
  nowIso,
  recordRevision,
} from "@/features/knowledge-staging/fake-store";
import { KB_STORAGE_LIMIT, OWNER_NAMES, GRANTABLE_CHANNELS, STAGING_USER_ID } from "@/features/knowledge-staging/data";
import type {
  ChannelGrantChannelRef,
  ChannelResourceGrant,
  KbShelf,
  KnowledgeBase,
  KnowledgeBaseStats,
  KnowledgeFolder,
  KnowledgeEntry,
} from "@/features/knowledge/types";
import type {
  ChannelGrantWriteInput,
  KnowledgeBaseCreateInput,
  KnowledgeBaseUpdateInput,
  KnowledgeEntryCreateInput,
  KnowledgeEntryUpdateInput,
  KnowledgeEntryMoveInput,
} from "@/features/knowledge/schema";

// ─── Error type ─────────────────────────────────────────────────────

export class KnowledgeApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "KnowledgeApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ─── Bases ──────────────────────────────────────────────────────────

/** Full `GET /api/knowledge/bases` response: list plus the maps the route folds in. */
export interface KnowledgeBaseList {
  bases: KnowledgeBase[];
  /** Foreign base owners' display names, keyed by user id. */
  ownerNames: Record<string, string>;
  /** Keyed by base id. A missing key means "unknown", never "empty": a base
   *  with no entries still gets a zeroed entry. */
  baseStats: Record<string, KnowledgeBaseStats>;
  /** Workspace per-base storage cap in bytes. `null` = unknown; meters are
   *  suppressed rather than drawn against a guessed cap. */
  kbStorageLimit: number | null;
  /** Caller's own starred base ids. Per-user favourite, not a base property,
   *  so it rides the response not the row. */
  starredBaseIds: string[];
  /**
   * Base ids granted into at least one channel — the set behind the card's
   * `Shared` pill. Read it with `?? EMPTY_SHARED` (INVARIANTS §8): this list is
   * IndexedDB-persisted, so an entry written before the key existed survives
   * the upgrade without it.
   */
  sharedBaseIds: string[];
  /** `{baseId → {level, guestWrite}}` for the channel passed as `channelId`.
   *  `EMPTY_GRANTS` when no channelId was requested or a pre-grant server sent
   *  no key. A base with no grant is simply absent from the map. */
  channelGrants: Record<string, ChannelResourceGrant>;
}

/** Shared frozen empty list — the §8 fallback for `sharedBaseIds`; a fresh `[]`
 *  per read would churn every memo keyed on it. */
export const EMPTY_SHARED: readonly string[] = Object.freeze([]);

/** Shared frozen empty map — §8 fallback for `channelGrants`, for the same
 *  memo-churn reason. */
export const EMPTY_GRANTS: Readonly<Record<string, ChannelResourceGrant>> =
  Object.freeze({});


function notFound(what: string): KnowledgeApiError {
  return new KnowledgeApiError(404, "NOT_FOUND", `${what} not found`);
}

function statsFor(baseId: string): KnowledgeBaseStats {
  const db = knowledgeDb();
  const entries = db.entries.filter((e) => e.knowledgeBaseId === baseId);
  const last = entries
    .map((e) => e.updatedAt)
    .sort()
    .at(-1);
  return {
    entryCount: entries.length,
    lastEntryUpdatedAt: last ?? null,
    storageBytes: entries.reduce((n, e) => n + e.body.length + e.title.length, 0) * 37,
  };
}

export async function fetchBaseList(
  workspaceId?: string,
  /** When set, the response folds in the scope-A `channelGrants` map for that channel. */
  channelId?: string,
  /** When set, only that shelf's bases. Every staged home-workspace base is home-scoped. */
  shelf?: KbShelf
): Promise<KnowledgeBaseList> {
  await latency(120);
  void shelf;
  const db = knowledgeDb();
  const bases = db.bases.filter((b) => !workspaceId || b.workspaceId === workspaceId);
  const baseStats: Record<string, KnowledgeBaseStats> = {};
  for (const b of bases) baseStats[b.id] = statsFor(b.id);
  const channelGrants: Record<string, ChannelResourceGrant> = {};
  if (channelId) {
    for (const b of bases) {
      const g = db.grants[b.id]?.[channelId];
      if (g) channelGrants[b.id] = { ...g };
    }
  }
  return {
    bases: bases.map((b) => ({ ...b })),
    ownerNames: { ...OWNER_NAMES },
    baseStats,
    kbStorageLimit: KB_STORAGE_LIMIT,
    starredBaseIds: bases.filter((b) => db.starred.has(b.id)).map((b) => b.id),
    sharedBaseIds: bases
      .filter((b) => Object.keys(db.grants[b.id] ?? {}).length > 0)
      .map((b) => b.id),
    channelGrants,
  };
}

/** Star/unstar one base for the calling user. */
export async function setBaseStar(
  baseId: string,
  starred: boolean,
  workspaceId?: string
): Promise<void> {
  void workspaceId;
  await latency(80);
  const db = knowledgeDb();
  if (starred) db.starred.add(baseId);
  else db.starred.delete(baseId);
}

// ─── Channel grants (scope-A sharing) ───────────────────────────────

export interface ChannelGrantSettings {
  /** Creator or workspace admin+. False renders the read-only summary. */
  canManage: boolean;
  channelScopeAllowed: boolean;
  channels: ChannelGrantChannelRef[];
  grants: Record<string, ChannelResourceGrant>;
}

export async function fetchChannelGrants(
  baseId: string,
  workspaceId?: string
): Promise<ChannelGrantSettings> {
  void workspaceId;
  await latency(120);
  const db = knowledgeDb();
  return {
    // The operator owns or administers every staged base.
    canManage: true,
    channelScopeAllowed: true,
    channels: GRANTABLE_CHANNELS.map((c) => ({ ...c })),
    grants: { ...(db.grants[baseId] ?? {}) },
  };
}

/** Set one (KB, channel) grant. `level: "none"` un-shares and answers `null`. */
export async function setChannelGrant(
  baseId: string,
  body: ChannelGrantWriteInput,
  workspaceId?: string
): Promise<ChannelResourceGrant | null> {
  void workspaceId;
  await latency();
  const db = knowledgeDb();
  const map = (db.grants[baseId] ??= {});
  if (body.level === "none") {
    delete map[body.channelId];
    return null;
  }
  const grant: ChannelResourceGrant = {
    level: body.level,
    guestWrite: body.level === "visible" ? Boolean(body.guestWrite) : false,
  };
  map[body.channelId] = grant;
  return { ...grant };
}

export async function fetchTree(
  baseId: string,
  workspaceId?: string
): Promise<{ base: KnowledgeBase; folders: KnowledgeFolder[]; entries: KnowledgeEntry[] }> {
  void workspaceId;
  await latency(140);
  const db = knowledgeDb();
  const base = db.bases.find((b) => b.id === baseId);
  if (!base) throw notFound("Knowledge base");
  return {
    base: { ...base },
    folders: db.folders.filter((f) => f.knowledgeBaseId === baseId).map((f) => ({ ...f })),
    entries: db.entries.filter((e) => e.knowledgeBaseId === baseId).map((e) => ({ ...e })),
  };
}

export async function createBase(
  input: KnowledgeBaseCreateInput,
  workspaceId?: string
): Promise<KnowledgeBase> {
  await latency(220);
  const db = knowledgeDb();
  const id = newId("kb");
  const at = nowIso();
  const slug =
    input.slug ??
    input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const base: KnowledgeBase = {
    id,
    workspaceId: workspaceId ?? "staging-default",
    name: input.name,
    slug,
    publicId: id.slice(-6),
    description: input.description ?? null,
    agentWriteEnabled: input.agentWriteEnabled ?? true,
    visibility: input.visibility ?? "private",
    accessMode: input.accessMode ?? "workspace",
    createdBy: STAGING_USER_ID,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
  db.bases.unshift(base);
  if (input.shareToChannelId) {
    db.grants[id] = { [input.shareToChannelId]: { level: "visible", guestWrite: false } };
  }
  for (const grant of input.teamGrants ?? []) {
    db.teams
      .find((t) => t.id === grant.teamId)
      ?.grants.push({
        teamId: grant.teamId,
        resourceType: "knowledge_base",
        resourceId: id,
        level: grant.level,
      });
  }
  return { ...base };
}

export async function updateBase(
  baseId: string,
  patch: KnowledgeBaseUpdateInput,
  workspaceId?: string,
  expectedUpdatedAt?: string
): Promise<KnowledgeBase> {
  void workspaceId;
  void expectedUpdatedAt;
  await latency();
  const db = knowledgeDb();
  const base = db.bases.find((b) => b.id === baseId);
  if (!base) throw notFound("Knowledge base");
  const { teamGrants, ...rest } = patch as KnowledgeBaseUpdateInput & {
    teamGrants?: Array<{ teamId: string; level: "read" | "edit" }>;
  };
  for (const key of Object.keys(rest) as Array<keyof typeof rest>) {
    const value = rest[key];
    if (value !== undefined && key in base) {
      (base as unknown as Record<string, unknown>)[key] = value;
    }
  }
  if (teamGrants) {
    for (const team of db.teams) {
      team.grants = team.grants.filter((g) => g.resourceId !== baseId);
      const next = teamGrants.find((g) => g.teamId === team.id);
      if (next) {
        team.grants.push({
          teamId: team.id,
          resourceType: "knowledge_base",
          resourceId: baseId,
          level: next.level,
        });
      }
    }
  }
  base.updatedAt = nowIso();
  return { ...base };
}

export async function deleteBase(
  baseId: string,
  workspaceId?: string
): Promise<void> {
  void workspaceId;
  await latency(220);
  const db = knowledgeDb();
  db.bases = db.bases.filter((b) => b.id !== baseId);
  db.folders = db.folders.filter((f) => f.knowledgeBaseId !== baseId);
  db.entries = db.entries.filter((e) => e.knowledgeBaseId !== baseId);
  delete db.grants[baseId];
  db.starred.delete(baseId);
}

// ─── Folders ────────────────────────────────────────────────────────
// STAGING: in `./api-folders.ts` only to stay under the 500-line cap; same exports.
export {
  createFolder,
  deleteFolder,
  moveFolder,
  updateFolder,
  type FolderCreateBody,
} from "./api-folders";

// ─── Entries ────────────────────────────────────────────────────────

export async function fetchEntry(
  entryId: string,
  workspaceId?: string
): Promise<KnowledgeEntry> {
  void workspaceId;
  await latency(100);
  const entry = knowledgeDb().entries.find((e) => e.id === entryId);
  if (!entry) throw notFound("Entry");
  return { ...entry };
}

export type EntryCreateBody = Omit<KnowledgeEntryCreateInput, "knowledgeBaseId">;

export async function createEntry(
  baseId: string,
  body: EntryCreateBody,
  workspaceId?: string
): Promise<KnowledgeEntry> {
  await latency();
  const db = knowledgeDb();
  const base = db.bases.find((b) => b.id === baseId);
  if (!base) throw notFound("Knowledge base");
  const at = nowIso();
  const siblings = db.entries.filter(
    (e) => e.knowledgeBaseId === baseId && e.folderId === (body.folderId ?? null)
  );
  const entry: KnowledgeEntry = {
    id: newId("e"),
    workspaceId: workspaceId ?? base.workspaceId,
    knowledgeBaseId: baseId,
    folderId: body.folderId ?? null,
    title: body.title,
    excerpt: body.excerpt ?? null,
    body: body.body ?? "",
    entryType: body.entryType ?? "doc",
    position: body.position ?? siblings.length,
    createdBy: STAGING_USER_ID,
    lastEditedBy: STAGING_USER_ID,
    lastEditedSource: "user",
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
  db.entries.push(entry);
  recordRevision(entry, "create");
  return { ...entry };
}

export async function updateEntry(
  entryId: string,
  patch: KnowledgeEntryUpdateInput,
  workspaceId?: string,
  expectedUpdatedAt?: string
): Promise<KnowledgeEntry> {
  void workspaceId;
  void expectedUpdatedAt;
  await latency(200);
  const entry = knowledgeDb().entries.find((e) => e.id === entryId);
  if (!entry) throw notFound("Entry");
  const renamed = patch.title !== undefined && patch.title !== entry.title;
  const edited = patch.body !== undefined && patch.body !== entry.body;
  if (patch.title !== undefined) entry.title = patch.title;
  if (patch.excerpt !== undefined) entry.excerpt = patch.excerpt;
  if (patch.body !== undefined) entry.body = patch.body;
  if (patch.entryType !== undefined) entry.entryType = patch.entryType;
  if (patch.position !== undefined) entry.position = patch.position;
  entry.updatedAt = nowIso();
  entry.lastEditedBy = STAGING_USER_ID;
  entry.lastEditedSource = "user";
  if (edited) recordRevision(entry, "edit");
  else if (renamed) recordRevision(entry, "rename");
  return { ...entry };
}

export async function deleteEntry(
  entryId: string,
  workspaceId?: string
): Promise<void> {
  void workspaceId;
  await latency();
  const db = knowledgeDb();
  db.entries = db.entries.filter((e) => e.id !== entryId);
}

export async function moveEntry(
  entryId: string,
  input: KnowledgeEntryMoveInput,
  workspaceId?: string
): Promise<KnowledgeEntry> {
  void workspaceId;
  await latency();
  const entry = knowledgeDb().entries.find((e) => e.id === entryId);
  if (!entry) throw notFound("Entry");
  entry.folderId = input.folderId;
  if (input.position !== undefined) entry.position = input.position;
  entry.updatedAt = nowIso();
  recordRevision(entry, "move");
  return { ...entry };
}

// ─── Export / download + Search ─────────────────────────────────────
// STAGING: split into `./api-extras.ts` only to stay under the 500-line cap; same exports.
export {
  downloadKnowledgeExport,
  searchKnowledge,
  type KnowledgeExportKind,
  type KnowledgeSearchHit,
} from "./api-extras";
