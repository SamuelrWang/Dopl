/**
 * The seed's WRITE SHAPE and cross-reference map. ⚠ It runs inside the
 * post-signup redirect, so the awaited round-trip count is the point: two
 * statements total, whatever the corpus size.
 *
 * `entryIdByKey` is what the ontology seed's knowledge attributes resolve
 * against, asserted here because the orchestrator test mocks this module.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");

import * as repo from "./repository";
import { buildSeedKnowledgeBases, DOPL_GUIDE_SLUG, GUIDE_ENTRY_KEYS } from "./seed";
import type { KnowledgeContext } from "../types";
import { seedWorkspace } from "./service-seed";

const WS = "ws-1";
const USER = "user-1";

const CTX: KnowledgeContext = {
  workspaceId: WS,
  userId: USER,
  credentialSubjectUserId: USER,
  source: "user",
  role: "owner",
  apiKeyWorkspaceId: null,
};

const FIXTURES = buildSeedKnowledgeBases();

function insertedEntries() {
  return vi.mocked(repo.insertEntries).mock.calls[0][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.listBasesForWorkspace).mockResolvedValue([]);
  vi.mocked(repo.listBaseSlugsForWorkspace).mockResolvedValue([]);
  vi.mocked(repo.insertBases).mockImplementation(async (argsList) =>
    argsList.map((args, i) => ({ id: `base-${i}`, slug: args.slug }) as never)
  );
  vi.mocked(repo.insertEntries).mockResolvedValue([]);
});

describe("knowledge seed — write shape", () => {
  it("writes the whole corpus in two statements", async () => {
    await seedWorkspace(CTX);

    expect(repo.insertBases).toHaveBeenCalledTimes(1);
    expect(repo.insertEntries).toHaveBeenCalledTimes(1);
    expect(repo.insertBase).not.toHaveBeenCalled();
    expect(repo.insertEntry).not.toHaveBeenCalled();
  });

  it("inserts every fixture entry, with an explicit position", async () => {
    await seedWorkspace(CTX);

    const expected = FIXTURES.reduce((n, f) => n + f.rootEntries.length, 0);
    const rows = insertedEntries();
    expect(rows).toHaveLength(expected);
    // Explicit positions let the batch skip the per-entry max-position read;
    // index order reproduces the max+1 sequence.
    expect(rows.map((r) => r.position)).toEqual(
      FIXTURES.flatMap((f) => f.rootEntries.map((_, i) => i))
    );
    for (const row of rows) {
      expect(row.workspaceId).toBe(WS);
      expect(row.createdBy).toBe(USER);
      // System-origin even when an agent triggered the seed.
      expect(row.source).toBe("user");
    }
  });

  it("is a no-op when the workspace already has a base", async () => {
    vi.mocked(repo.listBasesForWorkspace).mockResolvedValue([{ id: "kb" } as never]);

    const result = await seedWorkspace(CTX);

    expect(result).toEqual({ basesCreated: 0, guide: null });
    expect(repo.insertBases).not.toHaveBeenCalled();
    expect(repo.insertEntries).not.toHaveBeenCalled();
  });
});

describe("knowledge seed — the cross-reference map", () => {
  it("maps every authored guide key to an id that was actually inserted", async () => {
    const result = await seedWorkspace(CTX);

    const guideFixture = FIXTURES.find((f) => f.slug === DOPL_GUIDE_SLUG)!;
    expect(result.guide).not.toBeNull();
    expect(result.guide?.slug).toBe(DOPL_GUIDE_SLUG);

    const insertedIds = new Set(insertedEntries().map((r) => r.id));
    const authoredKeys = guideFixture.rootEntries
      .map((e) => e.key)
      .filter((k): k is string => Boolean(k));

    expect(Object.keys(result.guide!.entryIdByKey).sort()).toEqual(
      [...authoredKeys].sort()
    );
    // Guards against a dangling ref reaching the ontology attributes.
    for (const key of authoredKeys) {
      const ref = result.guide!.entryIdByKey[key];
      expect(insertedIds.has(ref.id)).toBe(true);
      expect(ref.title).toBeTruthy();
    }
  });

  it("covers the keys the ontology seed references by name", async () => {
    const result = await seedWorkspace(CTX);
    for (const key of Object.values(GUIDE_ENTRY_KEYS)) {
      expect(result.guide?.entryIdByKey[key]).toBeDefined();
    }
  });

  it("files the guide entries under the guide base it just created", async () => {
    const result = await seedWorkspace(CTX);
    const guideId = result.guide!.baseId;
    const guideEntryIds = new Set(
      Object.values(result.guide!.entryIdByKey).map((v) => v.id)
    );

    for (const row of insertedEntries()) {
      if (guideEntryIds.has(row.id!)) {
        expect(row.knowledgeBaseId).toBe(guideId);
        expect(row.folderId).toBeNull();
      }
    }
  });

  it("de-conflicts the base slug against slugs already taken", async () => {
    vi.mocked(repo.listBaseSlugsForWorkspace).mockResolvedValue([DOPL_GUIDE_SLUG]);

    const result = await seedWorkspace(CTX);

    const inserted = vi.mocked(repo.insertBases).mock.calls[0][0];
    expect(inserted[0].slug).not.toBe(DOPL_GUIDE_SLUG);
    // …and entries land under the base created with the de-conflicted slug.
    expect(result.guide?.slug).toBe(inserted[0].slug);
    expect(insertedEntries()[0].knowledgeBaseId).toBe("base-0");
  });
});
