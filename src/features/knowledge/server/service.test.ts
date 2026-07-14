/**
 * INVARIANT SUITE — knowledge base visibility (M-10).
 *
 * `resolveEntryRefs` is the public export that funnels through the private
 * `canSeeBase` gate + `filterTeamVisibleBases`, so testing it locks the
 * visibility matrix without needing to export the private helpers:
 *   - a trashed base's entries are dropped,
 *   - a base the caller can't see (private, not owner) is dropped,
 *   - visible entries map to { id, title, baseId, baseName },
 *   - a workspace-scoped API key can't see private bases (even its own).
 *
 * Only the repository is mocked; the visibility logic runs for real. All
 * fixtures use accessMode "workspace" so the team-scope branch short-
 * circuits (no Supabase/teams access needed) — the pure part under test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KnowledgeBase, KnowledgeContext, KnowledgeEntry } from "../types";

vi.mock("./repository", () => ({
  listEntriesByIds: vi.fn(),
  listBasesByIds: vi.fn(),
}));

import * as repo from "./repository";
import { resolveEntryRefs } from "./service";

const mockRepo = vi.mocked(repo);

const OWNER = "user-owner";
const OTHER = "user-other";

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

function base(overrides: Partial<KnowledgeBase>): KnowledgeBase {
  return {
    id: "base-x",
    workspaceId: "ws-1",
    name: "Base X",
    slug: "base-x",
    publicId: "pub-x",
    description: null,
    agentWriteEnabled: false,
    visibility: "public",
    accessMode: "workspace",
    createdBy: OWNER,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

function entry(id: string, baseId: string): KnowledgeEntry {
  return {
    id,
    workspaceId: "ws-1",
    knowledgeBaseId: baseId,
    folderId: null,
    title: `Entry ${id}`,
    excerpt: null,
    body: "",
    entryType: "note",
    position: 0,
    createdBy: OWNER,
    lastEditedBy: null,
    lastEditedSource: "user",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveEntryRefs visibility", () => {
  it("drops trashed + non-visible bases, maps visible ones", async () => {
    const publicBase = base({ id: "b-public", name: "Public", visibility: "public", createdBy: OTHER });
    const ownPrivate = base({ id: "b-own", name: "Own Private", visibility: "private", createdBy: OWNER });
    const otherPrivate = base({ id: "b-other", name: "Other Private", visibility: "private", createdBy: OTHER });
    const trashed = base({ id: "b-trash", name: "Trashed", visibility: "public", createdBy: OWNER, deletedAt: "2026-02-01T00:00:00Z" });

    mockRepo.listEntriesByIds.mockResolvedValue([
      entry("e-public", "b-public"),
      entry("e-own", "b-own"),
      entry("e-other", "b-other"),
      entry("e-trash", "b-trash"),
    ]);
    mockRepo.listBasesByIds.mockResolvedValue([publicBase, ownPrivate, otherPrivate, trashed]);

    const refs = await resolveEntryRefs(ctx(), [
      "e-public",
      "e-own",
      "e-other",
      "e-trash",
    ]);

    expect(refs).toEqual([
      { id: "e-public", title: "Entry e-public", baseId: "b-public", baseName: "Public" },
      { id: "e-own", title: "Entry e-own", baseId: "b-own", baseName: "Own Private" },
    ]);
  });

  it("returns [] for an empty id list without hitting the repo", async () => {
    const refs = await resolveEntryRefs(ctx(), []);
    expect(refs).toEqual([]);
    expect(mockRepo.listEntriesByIds).not.toHaveBeenCalled();
  });

  it("workspace-scoped API key cannot see private bases (even its own)", async () => {
    const ownPrivate = base({ id: "b-own", name: "Own Private", visibility: "private", createdBy: OWNER });
    const publicBase = base({ id: "b-public", name: "Public", visibility: "public", createdBy: OWNER });
    mockRepo.listEntriesByIds.mockResolvedValue([
      entry("e-own", "b-own"),
      entry("e-public", "b-public"),
    ]);
    mockRepo.listBasesByIds.mockResolvedValue([ownPrivate, publicBase]);

    const refs = await resolveEntryRefs(
      ctx({ apiKeyWorkspaceId: "ws-1" }),
      ["e-own", "e-public"],
    );

    // Private base dropped; only the public one survives.
    expect(refs).toEqual([
      { id: "e-public", title: "Entry e-public", baseId: "b-public", baseName: "Public" },
    ]);
  });
});
