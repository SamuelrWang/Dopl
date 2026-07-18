/**
 * INVARIANT SUITE — knowledge purge (permanent delete of a trashed row).
 *
 * Exercises the auth + state gates on `purgeBase` / `purgeFolder` /
 * `purgeEntry` through the public service surface, with the repository and
 * the teams access module mocked (no Supabase, no network):
 *   - a purge succeeds only on a row that is soft-deleted,
 *   - a LIVE row is refused (KnowledgeNotTrashedError) — no hard delete,
 *   - a row in another workspace is refused (KnowledgeBaseMismatchError),
 *   - an AGENT cannot purge a base flagged agent_write_enabled=false.
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
  purgeBaseRow: vi.fn(),
  purgeFolderRow: vi.fn(),
  purgeEntryRow: vi.fn(),
}));

vi.mock("@/features/teams/server/access", () => ({
  requireEffectiveAccess: vi.fn(),
  effectiveResourceAccess: vi.fn(),
  listEffectiveAccess: vi.fn(),
  resolveLevel: vi.fn(),
}));

import * as repo from "./repository";
import { purgeBase, purgeFolder, purgeEntry } from "./service";
import {
  AgentWriteDisabledError,
  KnowledgeBaseMismatchError,
  KnowledgeNotTrashedError,
} from "./errors";

const mockRepo = vi.mocked(repo);

const OWNER = "user-owner";
const TRASHED_AT = "2026-02-01T00:00:00Z";

function ctx(overrides: Partial<KnowledgeContext> = {}): KnowledgeContext {
  return {
    workspaceId: "ws-1",
    userId: OWNER,
    source: "user",
    role: "member",
    apiKeyWorkspaceId: null,
    ...overrides,
  };
}

function base(overrides: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: "base-x",
    workspaceId: "ws-1",
    name: "Base X",
    slug: "base-x",
    publicId: "pub-x",
    description: null,
    agentWriteEnabled: true,
    visibility: "public",
    accessMode: "workspace",
    createdBy: OWNER,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: TRASHED_AT,
    ...overrides,
  };
}

function folder(overrides: Partial<KnowledgeFolder> = {}): KnowledgeFolder {
  return {
    id: "folder-x",
    workspaceId: "ws-1",
    knowledgeBaseId: "base-x",
    parentId: null,
    name: "Folder X",
    description: null,
    position: 0,
    createdBy: OWNER,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: TRASHED_AT,
    ...overrides,
  };
}

function entry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: "entry-x",
    workspaceId: "ws-1",
    knowledgeBaseId: "base-x",
    folderId: null,
    title: "Entry X",
    excerpt: null,
    body: "",
    entryType: "note",
    position: 0,
    createdBy: OWNER,
    lastEditedBy: null,
    lastEditedSource: "user",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: TRASHED_AT,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("purgeEntry", () => {
  it("hard-deletes a trashed entry (workspace-scoped)", async () => {
    mockRepo.findEntryById.mockResolvedValue(entry());
    mockRepo.findBaseById.mockResolvedValue(base());

    await purgeEntry(ctx(), "entry-x");

    expect(mockRepo.purgeEntryRow).toHaveBeenCalledWith("ws-1", "entry-x");
  });

  it("refuses a LIVE entry and never hard-deletes", async () => {
    mockRepo.findEntryById.mockResolvedValue(entry({ deletedAt: null }));
    mockRepo.findBaseById.mockResolvedValue(base({ deletedAt: null }));

    await expect(purgeEntry(ctx(), "entry-x")).rejects.toBeInstanceOf(
      KnowledgeNotTrashedError
    );
    expect(mockRepo.purgeEntryRow).not.toHaveBeenCalled();
  });

  it("refuses an entry in another workspace", async () => {
    mockRepo.findEntryById.mockResolvedValue(entry({ workspaceId: "ws-other" }));

    await expect(purgeEntry(ctx(), "entry-x")).rejects.toBeInstanceOf(
      KnowledgeBaseMismatchError
    );
    expect(mockRepo.purgeEntryRow).not.toHaveBeenCalled();
  });
});

describe("purgeFolder", () => {
  it("hard-deletes a trashed folder", async () => {
    mockRepo.findFolderById.mockResolvedValue(folder());
    mockRepo.findBaseById.mockResolvedValue(base());

    await purgeFolder(ctx(), "folder-x");

    expect(mockRepo.purgeFolderRow).toHaveBeenCalledWith("ws-1", "folder-x");
  });

  it("refuses a LIVE folder", async () => {
    mockRepo.findFolderById.mockResolvedValue(folder({ deletedAt: null }));
    mockRepo.findBaseById.mockResolvedValue(base({ deletedAt: null }));

    await expect(purgeFolder(ctx(), "folder-x")).rejects.toBeInstanceOf(
      KnowledgeNotTrashedError
    );
    expect(mockRepo.purgeFolderRow).not.toHaveBeenCalled();
  });
});

describe("purgeBase", () => {
  it("hard-deletes a trashed base", async () => {
    mockRepo.findBaseById.mockResolvedValue(base());

    await purgeBase(ctx(), "base-x");

    expect(mockRepo.purgeBaseRow).toHaveBeenCalledWith("ws-1", "base-x");
  });

  it("refuses an AGENT purging an agent-read-only base", async () => {
    mockRepo.findBaseById.mockResolvedValue(base({ agentWriteEnabled: false }));

    await expect(
      purgeBase(ctx({ source: "agent" }), "base-x")
    ).rejects.toBeInstanceOf(AgentWriteDisabledError);
    expect(mockRepo.purgeBaseRow).not.toHaveBeenCalled();
  });

  it("refuses a LIVE base", async () => {
    mockRepo.findBaseById.mockResolvedValue(base({ deletedAt: null }));

    await expect(purgeBase(ctx(), "base-x")).rejects.toBeInstanceOf(
      KnowledgeNotTrashedError
    );
    expect(mockRepo.purgeBaseRow).not.toHaveBeenCalled();
  });
});
