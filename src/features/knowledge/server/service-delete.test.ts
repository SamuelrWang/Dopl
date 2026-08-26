/**
 * INVARIANT SUITE — knowledge deletes are PERMANENT. Pins:
 *   - every delete calls the workspace-scoped HARD-delete repo fn, never a
 *     `deleted_at` stamp. `mark*Deleted` / `restore*Row` no longer exist, so
 *     the factory mock can't declare them and a reintroduced soft-delete fails
 *     to resolve;
 *   - the F-10 agent gate refuses an agent on an `agent_write_enabled=false`
 *     base across all four delete paths — the destructive path must not become
 *     more permissive than content writes;
 *   - `deleteByPath` routes folder vs. entry to the right hard delete.
 *
 * ⚠ Folder-delete SUBTREE semantics (entries removed, not SET-NULL-orphaned)
 * are NOT covered here — the repo is mocked. See
 * `scripts/smoke-knowledge-audit-probes.ts` PROBE 7 against a real database.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  KnowledgeBase,
  KnowledgeContext,
  KnowledgeEntry,
  KnowledgeFolder,
} from "../types";

vi.mock("./repository", () => ({
  findBaseById: vi.fn(),
  findFolderById: vi.fn(),
  findEntryById: vi.fn(),
  listFoldersForBase: vi.fn(),
  listEntriesForBase: vi.fn(),
  findActiveFolderByName: vi.fn(),
  findActiveEntryByTitle: vi.fn(),
  hardDeleteBase: vi.fn(),
  hardDeleteFolder: vi.fn(),
  hardDeleteEntry: vi.fn(),
}));

vi.mock("./embeddings", () => ({ scheduleEntryEmbedding: vi.fn() }));

/**
 * ⚠ THE AUDIENCE CEILING IS ON THE AGENT PATH THIS SUITE DRIVES.
 * `getBaseById` now calls `service-audience.ts › resolveAgentAudience`, which
 * reads the workspace's KIND on the service-role client for any `source:
 * "agent"` caller — so without this mock the F-10 cases below reach a real
 * Supabase client and time out. `standard` is the pre-ceiling world: the
 * `unrestricted` branch, one read, nothing narrowed. The ceiling's own
 * behaviour is pinned in `service-audience.test.ts`, not here.
 */
vi.mock("./repository-audience", () => ({
  findWorkspaceKind: vi.fn().mockResolvedValue("standard"),
  countActiveWorkspaceMembers: vi.fn(),
  listChannelIdsForWorkspace: vi.fn(),
  listGrantedBaseIdsForChannels: vi.fn(),
}));

import * as repo from "./repository";
import {
  deleteBase,
  deleteByPath,
  deleteEntry,
  deleteFolder,
} from "./service";

const mockRepo = vi.mocked(repo);

const WS = "ws-1";
const OWNER = "user-owner";
const BASE_ID = "base-1";

function ctx(overrides: Partial<KnowledgeContext> = {}): KnowledgeContext {
  return {
    workspaceId: WS,
    userId: OWNER,
    source: "user",
    role: "admin",
    apiKeyWorkspaceId: null,
    ...overrides,
  };
}

function base(overrides: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: BASE_ID,
    workspaceId: WS,
    name: "Base",
    slug: "base",
    publicId: "pub-1",
    description: null,
    // Agent-writable by default: F-10 gate is opt-in per test.
    agentWriteEnabled: true,
    visibility: "public",
    accessMode: "workspace",
    createdBy: OWNER,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

function folder(overrides: Partial<KnowledgeFolder> = {}): KnowledgeFolder {
  return {
    id: "folder-1",
    workspaceId: WS,
    knowledgeBaseId: BASE_ID,
    parentId: null,
    name: "Folder",
    description: null,
    position: 0,
    createdBy: OWNER,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: null,
    ...overrides,
  } as KnowledgeFolder;
}

function entry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: "entry-1",
    workspaceId: WS,
    knowledgeBaseId: BASE_ID,
    folderId: null,
    title: "Entry",
    excerpt: null,
    body: "",
    entryType: "note",
    position: 0,
    createdBy: OWNER,
    lastEditedBy: OWNER,
    lastEditedSource: "user",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: null,
    ...overrides,
  } as KnowledgeEntry;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.findBaseById.mockResolvedValue(base());
  mockRepo.findFolderById.mockResolvedValue(folder());
  mockRepo.findEntryById.mockResolvedValue(entry());
  mockRepo.listFoldersForBase.mockResolvedValue([]);
  mockRepo.listEntriesForBase.mockResolvedValue([]);
});

describe("deleteBase / deleteFolder / deleteEntry — permanent", () => {
  it("deleteBase hard-deletes, workspace-scoped", async () => {
    await deleteBase(ctx(), BASE_ID);
    expect(mockRepo.hardDeleteBase).toHaveBeenCalledWith(WS, BASE_ID);
  });

  it("deleteFolder hard-deletes, workspace-scoped", async () => {
    await deleteFolder(ctx(), "folder-1");
    expect(mockRepo.hardDeleteFolder).toHaveBeenCalledWith(WS, "folder-1");
  });

  it("deleteEntry hard-deletes, workspace-scoped", async () => {
    await deleteEntry(ctx(), "entry-1");
    expect(mockRepo.hardDeleteEntry).toHaveBeenCalledWith(WS, "entry-1");
  });
});

describe("F-10 — an agent may not delete inside an agent-read-only base", () => {
  const agentCtx = ctx({ source: "agent" });

  beforeEach(() => {
    mockRepo.findBaseById.mockResolvedValue(base({ agentWriteEnabled: false }));
  });

  it("refuses deleteBase (no delete)", async () => {
    await expect(deleteBase(agentCtx, BASE_ID)).rejects.toThrow();
    expect(mockRepo.hardDeleteBase).not.toHaveBeenCalled();
  });

  it("refuses deleteFolder (no delete)", async () => {
    await expect(deleteFolder(agentCtx, "folder-1")).rejects.toThrow();
    expect(mockRepo.hardDeleteFolder).not.toHaveBeenCalled();
  });

  it("refuses deleteEntry (no delete)", async () => {
    await expect(deleteEntry(agentCtx, "entry-1")).rejects.toThrow();
    expect(mockRepo.hardDeleteEntry).not.toHaveBeenCalled();
  });

  it("refuses deleteByPath (no delete)", async () => {
    await expect(deleteByPath(agentCtx, BASE_ID, "notes.md")).rejects.toThrow();
    expect(mockRepo.hardDeleteEntry).not.toHaveBeenCalled();
    expect(mockRepo.hardDeleteFolder).not.toHaveBeenCalled();
  });
});

describe("deleteByPath — routes to the right hard delete", () => {
  it("a resolved entry path hard-deletes the entry", async () => {
    mockRepo.findActiveEntryByTitle.mockResolvedValue(entry({ id: "entry-9" }));

    const result = await deleteByPath(ctx(), BASE_ID, "notes.md");

    expect(result).toEqual({ kind: "entry", id: "entry-9" });
    expect(mockRepo.hardDeleteEntry).toHaveBeenCalledWith(WS, "entry-9");
    expect(mockRepo.hardDeleteFolder).not.toHaveBeenCalled();
  });

  it("a resolved folder path hard-deletes the folder subtree", async () => {
    mockRepo.findActiveEntryByTitle.mockResolvedValue(null);
    mockRepo.findActiveFolderByName.mockResolvedValue(folder({ id: "folder-9" }));

    const result = await deleteByPath(ctx(), BASE_ID, "archive");

    expect(result).toEqual({ kind: "folder", id: "folder-9" });
    expect(mockRepo.hardDeleteFolder).toHaveBeenCalledWith(WS, "folder-9");
    expect(mockRepo.hardDeleteEntry).not.toHaveBeenCalled();
  });

  it("refuses to delete the base root", async () => {
    await expect(deleteByPath(ctx(), BASE_ID, "/")).rejects.toThrow();
    expect(mockRepo.hardDeleteFolder).not.toHaveBeenCalled();
    expect(mockRepo.hardDeleteEntry).not.toHaveBeenCalled();
  });
});
