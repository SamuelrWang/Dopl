/** The staged knowledge-base routes: list, star, channel grants, tree, create, update, delete. */
import type { ChannelGrantSettings, KnowledgeBaseList } from "@/features/knowledge/client/api";
import type {
  ChannelGrantWriteInput,
  KnowledgeBaseCreateInput,
  KnowledgeBaseUpdateInput,
} from "@/features/knowledge/schema";
import type {
  ChannelResourceGrant,
  KnowledgeBase,
  KnowledgeBaseStats,
  KnowledgeEntry,
  KnowledgeFolder,
} from "@/features/knowledge/types";
import { GRANTABLE_CHANNELS, KB_STORAGE_LIMIT, OWNER_NAMES, STAGING_USER_ID } from "../data";
import { knowledgeDb, newId, nowIso } from "../fake-store";
import { notFound } from "./http";

function statsFor(baseId: string): KnowledgeBaseStats {
  const entries = knowledgeDb().entries.filter((e) => e.knowledgeBaseId === baseId);
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

/** `GET /api/knowledge/bases`. Every staged home-workspace base is home-scoped, so `?shelf=` narrows nothing. */
export function listBases(workspaceId: string | undefined, channelId: string | null): KnowledgeBaseList {
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

export function setStar(baseId: string, starred: boolean): { starred: boolean } {
  const { starred: set } = knowledgeDb();
  if (starred) set.add(baseId);
  else set.delete(baseId);
  return { starred };
}

/** The operator owns or administers every staged base. */
export function channelGrants(baseId: string): ChannelGrantSettings {
  return {
    canManage: true,
    channelScopeAllowed: true,
    channels: GRANTABLE_CHANNELS.map((c) => ({ ...c })),
    grants: { ...(knowledgeDb().grants[baseId] ?? {}) },
  };
}

/** `level: "none"` un-shares and answers a null grant. */
export function setChannelGrant(
  baseId: string,
  body: ChannelGrantWriteInput
): { channelId: string; grant: ChannelResourceGrant | null } {
  const map = (knowledgeDb().grants[baseId] ??= {});
  if (body.level === "none") {
    delete map[body.channelId];
    return { channelId: body.channelId, grant: null };
  }
  const grant: ChannelResourceGrant = {
    level: body.level,
    guestWrite: body.level === "visible" ? Boolean(body.guestWrite) : false,
  };
  map[body.channelId] = grant;
  return { channelId: body.channelId, grant: { ...grant } };
}

export function tree(baseId: string): {
  base: KnowledgeBase;
  folders: KnowledgeFolder[];
  entries: KnowledgeEntry[];
} {
  const db = knowledgeDb();
  const base = db.bases.find((b) => b.id === baseId);
  if (!base) throw notFound("Knowledge base");
  return {
    base: { ...base },
    folders: db.folders.filter((f) => f.knowledgeBaseId === baseId).map((f) => ({ ...f })),
    entries: db.entries.filter((e) => e.knowledgeBaseId === baseId).map((e) => ({ ...e })),
  };
}

export function createBase(
  input: KnowledgeBaseCreateInput,
  workspaceId: string | undefined
): { base: KnowledgeBase } {
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
  return { base: { ...base } };
}

export function updateBase(baseId: string, patch: KnowledgeBaseUpdateInput): { base: KnowledgeBase } {
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
  return { base: { ...base } };
}

export function deleteBase(baseId: string): void {
  const db = knowledgeDb();
  db.bases = db.bases.filter((b) => b.id !== baseId);
  db.folders = db.folders.filter((f) => f.knowledgeBaseId !== baseId);
  db.entries = db.entries.filter((e) => e.knowledgeBaseId !== baseId);
  delete db.grants[baseId];
  db.starred.delete(baseId);
}
