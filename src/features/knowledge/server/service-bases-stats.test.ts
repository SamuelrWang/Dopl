/**
 * `listBaseStats` — the fold behind `GET /api/knowledge/bases › baseStats`.
 *
 * The shape it produces is a contract the home grid reads directly, and two
 * halves of it are easy to lose in a refactor:
 *
 *   - **ONE query for N bases.** The reason this function exists is that the
 *     grid must not cost a request per card; the repository call is asserted
 *     to happen once, with the whole id set.
 *   - **Zero is a VALUE, "missing" is not.** Every base in the input gets a
 *     key, so the card can render "0 entries" and a missing key can keep
 *     meaning "the route degraded".
 *
 * `lastEntryUpdatedAt` is the newest CONTENT write, which is a different fact
 * from `KnowledgeBase.updatedAt` (the base's own row) — the out-of-order
 * fixture below is what stops a future `stamps[stamps.length - 1]` shortcut.
 *
 * `storageBytes` adds a THIRD property, and it is the one this file most needs
 * to hold: it reads a column that only exists after
 * `20260812120000_knowledge_base_storage_bytes.sql`, so a server deployed ahead
 * of its migration must lose the BAR and keep the COUNTS. `null` is the value
 * that says so, and it is not the same value as `0`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KnowledgeBase, KnowledgeContext } from "../types";

vi.mock("./repository", () => ({
  listEntryStampsForBases: vi.fn(),
  listBaseStorageBytes: vi.fn(),
}));

import * as repo from "./repository";
import { listBaseStats } from "./service-bases";

const mockRepo = vi.mocked(repo);

const CTX = { workspaceId: "ws-1", userId: "u-1" } as KnowledgeContext;

function base(id: string): KnowledgeBase {
  return { id, workspaceId: "ws-1" } as KnowledgeBase;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.listBaseStorageBytes.mockResolvedValue(new Map());
});

describe("listBaseStats", () => {
  it("counts and dates every base in ONE repository call", async () => {
    mockRepo.listEntryStampsForBases.mockResolvedValue([
      { baseId: "kb-1", updatedAt: "2026-08-01T00:00:00Z" },
      // Deliberately not in time order — the newest is not the last row.
      { baseId: "kb-1", updatedAt: "2026-08-09T12:00:00Z" },
      { baseId: "kb-1", updatedAt: "2026-08-03T00:00:00Z" },
      { baseId: "kb-2", updatedAt: "2026-07-01T00:00:00Z" },
    ]);

    const stats = await listBaseStats(CTX, [base("kb-1"), base("kb-2")]);

    expect(mockRepo.listEntryStampsForBases).toHaveBeenCalledTimes(1);
    expect(mockRepo.listEntryStampsForBases).toHaveBeenCalledWith("ws-1", [
      "kb-1",
      "kb-2",
    ]);
    expect(stats).toEqual({
      "kb-1": {
        entryCount: 3,
        lastEntryUpdatedAt: "2026-08-09T12:00:00Z",
        storageBytes: null,
      },
      "kb-2": {
        entryCount: 1,
        lastEntryUpdatedAt: "2026-07-01T00:00:00Z",
        storageBytes: null,
      },
    });
  });

  it("gives an empty base a zeroed entry, not a missing key", async () => {
    mockRepo.listEntryStampsForBases.mockResolvedValue([]);
    mockRepo.listBaseStorageBytes.mockResolvedValue(new Map([["kb-1", 0]]));

    expect(await listBaseStats(CTX, [base("kb-1")])).toEqual({
      "kb-1": { entryCount: 0, lastEntryUpdatedAt: null, storageBytes: 0 },
    });
  });

  it("never queries — or invents a key — for an empty base list", async () => {
    expect(await listBaseStats(CTX, [])).toEqual({});
    expect(mockRepo.listEntryStampsForBases).not.toHaveBeenCalled();
    expect(mockRepo.listBaseStorageBytes).not.toHaveBeenCalled();
  });

  it("drops a stamp for a base outside the visible set", async () => {
    // The id list is the fence. A row for a base the caller cannot see must
    // not materialise a key the response would then carry.
    mockRepo.listEntryStampsForBases.mockResolvedValue([
      { baseId: "kb-1", updatedAt: "2026-08-01T00:00:00Z" },
      { baseId: "kb-hidden", updatedAt: "2026-08-02T00:00:00Z" },
    ]);

    const stats = await listBaseStats(CTX, [base("kb-1")]);
    expect(Object.keys(stats)).toEqual(["kb-1"]);
  });
});

describe("listBaseStats — storageBytes", () => {
  it("reads the stored counter for every base in ONE query", async () => {
    mockRepo.listEntryStampsForBases.mockResolvedValue([]);
    mockRepo.listBaseStorageBytes.mockResolvedValue(
      new Map([
        ["kb-1", 4_231_000],
        ["kb-2", 0],
      ])
    );

    const stats = await listBaseStats(CTX, [base("kb-1"), base("kb-2")]);

    expect(mockRepo.listBaseStorageBytes).toHaveBeenCalledTimes(1);
    expect(mockRepo.listBaseStorageBytes).toHaveBeenCalledWith("ws-1", [
      "kb-1",
      "kb-2",
    ]);
    expect(stats["kb-1"].storageBytes).toBe(4_231_000);
    // An empty base is a REAL zero — the bar renders, empty.
    expect(stats["kb-2"].storageBytes).toBe(0);
  });

  it("keeps the COUNTS when the storage column cannot be read", async () => {
    // THE DEPLOY-ORDER CASE: this build shipped ahead of its migration, so
    // `storage_bytes` does not exist yet. Losing the whole stats map to that
    // would blank the "{N} entries · updated {when}" line the grid has had for
    // longer than the bar. It degrades to `null` — unknown, no bar — instead.
    mockRepo.listEntryStampsForBases.mockResolvedValue([
      { baseId: "kb-1", updatedAt: "2026-08-01T00:00:00Z" },
    ]);
    mockRepo.listBaseStorageBytes.mockRejectedValue(
      new Error('column "storage_bytes" does not exist')
    );

    const stats = await listBaseStats(CTX, [base("kb-1")]);
    expect(stats["kb-1"]).toEqual({
      entryCount: 1,
      lastEntryUpdatedAt: "2026-08-01T00:00:00Z",
      storageBytes: null,
    });
  });

  it("leaves a base the storage query skipped as unknown, not zero", async () => {
    mockRepo.listEntryStampsForBases.mockResolvedValue([]);
    mockRepo.listBaseStorageBytes.mockResolvedValue(new Map([["kb-1", 900]]));

    const stats = await listBaseStats(CTX, [base("kb-1"), base("kb-2")]);
    expect(stats["kb-1"].storageBytes).toBe(900);
    expect(stats["kb-2"].storageBytes).toBeNull();
  });
});
