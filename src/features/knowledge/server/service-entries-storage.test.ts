/**
 * THE STORAGE GATE'S WIRING — every entry write path, and the DELTA each one
 * hands it.
 *
 * The gate itself is proved in `service-storage.test.ts`. What this file pins
 * is the part a refactor loses silently: WHICH writes consult it, and with
 * WHAT NUMBER. A create that passed its body length as a total, or an update
 * that forgot to subtract the old body, would both stay green against a gate
 * test and both be wrong in production — the second one would refuse a
 * shrinking edit, which is the exact behaviour "gates freeze, never delete"
 * forbids.
 *
 * THE COUNTER IS NOT UNDER TEST HERE and cannot be: `knowledge_bases.
 * storage_bytes` is maintained by a row trigger on `knowledge_entries`
 * (`20260812120000_knowledge_base_storage_bytes.sql` §3), in the same
 * transaction as the write, which is what lets a FOLDER or BASE delete — pure
 * FK cascade, no TypeScript involved — be counted at all. Its verification is
 * the reconciliation SELECT in that migration's footer, run against a real
 * database.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KnowledgeBase, KnowledgeContext, KnowledgeEntry } from "../types";

vi.mock("./repository", () => ({
  insertEntry: vi.fn(),
  updateEntryRow: vi.fn(),
  hardDeleteEntry: vi.fn(),
  findEntryById: vi.fn(),
  findBaseById: vi.fn(),
  findFolderById: vi.fn(),
}));
vi.mock("./service-bases", () => ({ getBaseById: vi.fn() }));
vi.mock("./service-shared", () => ({
  assertBaseWritable: vi.fn(),
  assertAgentCanDelete: vi.fn(),
  assertSameWorkspace: vi.fn(),
}));
vi.mock("./service-storage", () => ({
  assertStorageHeadroom: vi.fn(),
  // The real one — the delta arithmetic under test has to be measured in the
  // same unit the counter uses, and stubbing it would make every assertion
  // below vacuous.
  bodyBytes: (body?: string | null) => (body ? Buffer.byteLength(body, "utf8") : 0),
}));
vi.mock("./embeddings", () => ({ scheduleEntryEmbedding: vi.fn() }));

import * as repo from "./repository";
import { getBaseById } from "./service-bases";
import { assertStorageHeadroom } from "./service-storage";
import { createEntry, deleteEntry, moveEntry, updateEntry } from "./service-entries";

const mockRepo = vi.mocked(repo);
const mockGetBase = vi.mocked(getBaseById);
const mockGate = vi.mocked(assertStorageHeadroom);

const CTX = {
  workspaceId: "ws-1",
  userId: "u-1",
  source: "user",
  role: "member",
  apiKeyWorkspaceId: null,
} as KnowledgeContext;

const BASE = { id: "kb-1", workspaceId: "ws-1", name: "Specs" } as KnowledgeBase;

function entry(body: string): KnowledgeEntry {
  return {
    id: "e-1",
    workspaceId: "ws-1",
    knowledgeBaseId: "kb-1",
    body,
    title: "Note",
    updatedAt: "2026-08-12T00:00:00Z",
  } as KnowledgeEntry;
}

/** The delta the gate was called with on its Nth (default first) call. */
function deltaAt(call = 0): number {
  return mockGate.mock.calls[call][2];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetBase.mockResolvedValue(BASE);
  mockRepo.findBaseById.mockResolvedValue(BASE);
  mockRepo.insertEntry.mockResolvedValue(entry("x"));
  mockRepo.updateEntryRow.mockResolvedValue(entry("x"));
});

describe("createEntry", () => {
  it("gates on the whole body — a create is pure growth", async () => {
    await createEntry(CTX, { knowledgeBaseId: "kb-1", title: "N", body: "hello" } as never);
    expect(mockGate).toHaveBeenCalledTimes(1);
    expect(deltaAt()).toBe(5);
    expect(mockGate.mock.calls[0][1]).toBe(BASE);
  });

  it("measures BYTES, not characters", async () => {
    await createEntry(CTX, { knowledgeBaseId: "kb-1", title: "N", body: "🙂" } as never);
    expect(deltaAt()).toBe(4);
  });

  it("gates BEFORE the insert, so a refusal writes nothing", async () => {
    mockGate.mockRejectedValueOnce(new Error("full"));
    await expect(
      createEntry(CTX, { knowledgeBaseId: "kb-1", title: "N", body: "x" } as never)
    ).rejects.toThrow("full");
    expect(mockRepo.insertEntry).not.toHaveBeenCalled();
  });

  it("still gates a bodiless create, at a delta of zero", async () => {
    await createEntry(CTX, { knowledgeBaseId: "kb-1", title: "N" } as never);
    expect(deltaAt()).toBe(0);
  });
});

describe("updateEntry", () => {
  it("gates on the NET delta — new body minus old", async () => {
    mockRepo.findEntryById.mockResolvedValue(entry("aaa"));
    await updateEntry(CTX, "e-1", { body: "aaaaaaaa" } as never);
    expect(deltaAt()).toBe(5);
  });

  it("passes a NEGATIVE delta for a shrink, so the gate can wave it through", async () => {
    // The over-cap escape hatch. If this arrived as a positive number (or as
    // the new length), a user over their cap could never shrink their way out.
    mockRepo.findEntryById.mockResolvedValue(entry("aaaaaaaaaa"));
    await updateEntry(CTX, "e-1", { body: "aa" } as never);
    expect(deltaAt()).toBe(-8);
  });

  it("never consults the gate for a title-only patch", async () => {
    // `body: undefined` leaves the column alone, so there is no delta and no
    // reason to pay for the read.
    mockRepo.findEntryById.mockResolvedValue(entry("aaa"));
    await updateEntry(CTX, "e-1", { title: "Renamed" } as never);
    expect(mockGate).not.toHaveBeenCalled();
  });

  it("gates BEFORE the row write", async () => {
    mockRepo.findEntryById.mockResolvedValue(entry(""));
    mockGate.mockRejectedValueOnce(new Error("full"));
    await expect(
      updateEntry(CTX, "e-1", { body: "big" } as never)
    ).rejects.toThrow("full");
    expect(mockRepo.updateEntryRow).not.toHaveBeenCalled();
  });
});

describe("the paths a gate must never touch", () => {
  it("never gates a move — bytes do not change and the base cannot", async () => {
    mockRepo.findEntryById.mockResolvedValue(entry("aaaa"));
    await moveEntry(CTX, "e-1", { folderId: null, position: 0 } as never);
    expect(mockGate).not.toHaveBeenCalled();
  });

  it("never gates a delete — deleting is how you get UNDER the cap", async () => {
    mockRepo.findEntryById.mockResolvedValue(entry("aaaa"));
    await deleteEntry(CTX, "e-1");
    expect(mockGate).not.toHaveBeenCalled();
    expect(mockRepo.hardDeleteEntry).toHaveBeenCalledWith("ws-1", "e-1");
  });
});
