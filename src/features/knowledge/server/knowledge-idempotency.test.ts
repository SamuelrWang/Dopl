/**
 * **AN IDEMPOTENCY KEY ON KB WRITES, AND THE GUARD `force` USED TO DISARM**
 * (S53 and S40, 2026-09-18).
 *
 * Two promises, one subject — what happens when a caller re-issues a write it
 * could not confirm:
 *   1. **WITH A KEY, THE SECOND CALL WRITES NOTHING** and hands back the first
 *      call's row. This is the answer to "did my timed-out write land", and it
 *      is what makes `force=true` stop being the only recovery on offer.
 *   2. **WITHOUT ONE, A FORCED WRITE AT A VACATED PATH REFUSES.** `write_file`
 *      is an UPSERT, so the old behaviour was to create a SECOND entry at the
 *      path a move had emptied — unrecoverable, because deletion is app-only.
 *
 * ⚠ **THE PROBE MUST RUN BEFORE THE PATH IS RESOLVED**, and one test asserts
 * exactly that: a converging retry must not depend on the path still meaning
 * what it meant, which is precisely what a move between the two calls breaks.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KnowledgeBase, KnowledgeContext } from "../types";

vi.mock("@/features/revisions/server/repository", () => ({
  appendRevision: vi.fn(async () => ({ id: "rev-1" })),
  replaceRevisionSnapshot: vi.fn(async () => ({ id: "rev-1" })),
  findLatestRevision: vi.fn(async () => null),
  findRevisionById: vi.fn(async () => null),
  listRevisionsForResource: vi.fn(async () => []),
  listRevisionsForResources: vi.fn(async () => []),
}));
vi.mock("./repository", () => ({
  findEntryByClientWriteId: vi.fn(),
  insertEntry: vi.fn(),
  updateEntryRow: vi.fn(),
  findEntryById: vi.fn(),
}));
vi.mock("./path", () => ({
  parsePath: (p: string) => p.split("/").filter(Boolean),
  resolvePath: vi.fn(),
  ensureFolderPath: vi.fn(async () => null),
}));
vi.mock("./service-bases", () => ({
  getBaseForWrite: vi.fn(),
  readBaseInContext: vi.fn(),
}));
vi.mock("./service-shared", () => ({
  assertBaseWritable: vi.fn(),
  assertAgentCanDelete: vi.fn(),
  errorCode: (e: unknown) => (e as { code?: string } | null)?.code ?? null,
}));
vi.mock("./service-storage", () => ({
  assertStorageHeadroom: vi.fn(),
  bodyBytes: (s: string) => s.length,
}));
vi.mock("./embeddings", () => ({ scheduleEntryEmbedding: vi.fn() }));
vi.mock("./service-revisions", () => ({
  recordEntryRevision: vi.fn(),
  recordFolderRevision: vi.fn(),
}));

import * as repo from "./repository";
import { resolvePath } from "./path";
import { getBaseForWrite } from "./service-bases";
import { writeFileByPath } from "./service-paths";
import { KnowledgeTargetVanishedError } from "./errors";

const BASE = { id: "base-1", workspaceId: "ws-1" } as unknown as KnowledgeBase;
const CTX = {
  workspaceId: "ws-1",
  userId: "user-1",
  source: "agent",
} as unknown as KnowledgeContext;

const mockRepo = vi.mocked(repo);
const mockResolve = vi.mocked(resolvePath);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getBaseForWrite).mockResolvedValue({
    ctx: CTX,
    value: BASE,
  } as never);
  mockResolve.mockResolvedValue({ kind: "not_found", missingSegment: "notes.md" } as never);
  mockRepo.findEntryByClientWriteId.mockResolvedValue(null);
  mockRepo.insertEntry.mockResolvedValue({ id: "e-new", title: "notes.md" } as never);
});

describe("S53 — the same key twice writes once", () => {
  it("a re-send converges on the first entry and writes NOTHING", async () => {
    const first = { id: "e-first", title: "notes.md", body: "first" };
    mockRepo.findEntryByClientWriteId.mockResolvedValue(first as never);

    const out = await writeFileByPath(CTX, "base-1", "notes.md", {
      body: "a DIFFERENT second body",
      clientWriteId: "key-1",
    });

    expect(out.entry).toBe(first);
    // 🔒 The caller must be TOLD, or it believes its second body is stored.
    expect(out.converged).toBe(true);
    expect(mockRepo.insertEntry).not.toHaveBeenCalled();
    expect(mockRepo.updateEntryRow).not.toHaveBeenCalled();
  });

  it("the probe is AUTHOR-SCOPED and asks before the path is resolved", async () => {
    mockRepo.findEntryByClientWriteId.mockResolvedValue({ id: "e-first" } as never);
    await writeFileByPath(CTX, "base-1", "moved/away.md", {
      body: "b",
      clientWriteId: "key-1",
    });
    expect(mockRepo.findEntryByClientWriteId).toHaveBeenCalledWith(
      "base-1",
      "key-1",
      "user-1",
    );
    // ⚠ A converging retry must not depend on the path still resolving — the
    // move between the two calls is the case this exists for.
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("a MISS writes, and stamps the key with its author", async () => {
    const out = await writeFileByPath(CTX, "base-1", "notes.md", {
      body: "b",
      clientWriteId: "key-1",
    });
    expect(out.converged).toBeUndefined();
    expect(mockRepo.insertEntry).toHaveBeenCalledWith(
      expect.objectContaining({ clientWriteId: "key-1", clientWriteBy: "user-1" }),
    );
  });

  it("no key at all behaves exactly as before — no probe, no stamp", async () => {
    await writeFileByPath(CTX, "base-1", "notes.md", { body: "b" });
    expect(mockRepo.findEntryByClientWriteId).not.toHaveBeenCalled();
    expect(mockRepo.insertEntry).toHaveBeenCalledWith(
      expect.objectContaining({ clientWriteId: undefined }),
    );
  });
});

describe("S40 — a forced write at a vanished path still refuses", () => {
  it("`expectExisting` (what force sends) refuses instead of upserting a duplicate", async () => {
    await expect(
      writeFileByPath(CTX, "base-1", "notes.md", {
        body: "b",
        // ⚠ NO `expectedUpdatedAt` — that is exactly what `force` sends, and it
        // is why the guard used to be skipped on this one path.
        expectExisting: true,
      }),
    ).rejects.toBeInstanceOf(KnowledgeTargetVanishedError);
    expect(mockRepo.insertEntry).not.toHaveBeenCalled();
  });

  it("a precondition refuses too, with the same error rather than a 412", async () => {
    await expect(
      writeFileByPath(CTX, "base-1", "notes.md", {
        body: "b",
        expectedUpdatedAt: "2026-01-01T00:00:00Z",
      }),
    ).rejects.toBeInstanceOf(KnowledgeTargetVanishedError);
  });

  it("🔒 a PLAIN create at a free path still creates — the guard is not a block", async () => {
    await writeFileByPath(CTX, "base-1", "notes.md", { body: "b" });
    expect(mockRepo.insertEntry).toHaveBeenCalledTimes(1);
  });
});
