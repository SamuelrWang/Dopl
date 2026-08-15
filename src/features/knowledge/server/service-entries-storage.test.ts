/**
 * Storage-gate WIRING: which entry write paths consult the gate, and with what
 * DELTA. The gate itself is proved in `service-storage.test.ts`; an update
 * that forgot to subtract the old body would stay green there and refuse
 * shrinking edits in production.
 *
 * ⚠ THE COUNTER IS NOT UNDER TEST and cannot be — `knowledge_bases
 * .storage_bytes` is maintained by a row trigger
 * (`20260812120000_knowledge_base_storage_bytes.sql` §3), which is what counts
 * pure-FK folder/base cascades. Verified by that migration's reconciliation
 * SELECT against a real database.
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
  // ⚠ The real one: delta arithmetic must use the counter's unit; stubbing
  // makes every assertion below vacuous.
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

/** Delta the gate was called with on its Nth (default first) call. */
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
    // Over-cap escape hatch: a positive number (or the new length) here means
    // a user over cap can never shrink their way out.
    mockRepo.findEntryById.mockResolvedValue(entry("aaaaaaaaaa"));
    await updateEntry(CTX, "e-1", { body: "aa" } as never);
    expect(deltaAt()).toBe(-8);
  });

  it("never consults the gate for a title-only patch", async () => {
    // `body: undefined` leaves the column alone — no delta, no read.
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
