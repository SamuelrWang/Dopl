/**
 * **EVERY KNOWLEDGE WRITE PATH RECORDS EXACTLY ONE REVISION.**
 *
 * The claim is a COUNT, not a presence: a path that records twice makes the
 * changelog show one save as two versions, and a path that records none makes a
 * document change with nothing to say it did. Both are silent, and only a count
 * assertion catches either.
 *
 * ⚠ **THE OP IS ASSERTED TOO.** `edit` is the only op the human coalescing
 * window joins (`revisions/server/service.ts › COALESCE_WINDOW_MS`), so a
 * rename mis-labelled as an edit would silently absorb the next five minutes of
 * somebody's typing into a row called "Renamed".
 *
 * ⚠ **MUTATION-VERIFIED — three reverts, three failures:** deleting the capture
 * in `createEntry` (1 red); classifying a body+title save as a `rename` by
 * reordering `entryOpFor`'s arms (2 red); and recording the capture in
 * `updateEntry` BEFORE the CAS check, so a lost race still leaves a revision
 * (4 red).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeBase, KnowledgeContext, KnowledgeEntry } from "../types";

vi.mock("@/features/revisions/server/service", () => ({
  recordRevision: vi.fn(async () => ({ id: "rev-1" })),
}));

vi.mock("./repository", () => ({
  findBaseById: vi.fn(),
  findEntryById: vi.fn(),
  findFolderById: vi.fn(),
  insertEntry: vi.fn(),
  insertFolder: vi.fn(),
  updateEntryRow: vi.fn(),
  updateFolderRow: vi.fn(),
  hardDeleteEntry: vi.fn(),
  hardDeleteFolder: vi.fn(),
  listFolderAncestors: vi.fn(),
}));

vi.mock("./embeddings", () => ({ scheduleEntryEmbedding: vi.fn() }));

vi.mock("./service-bases", () => ({
  getBaseById: vi.fn(),
  readBaseById: vi.fn(),
}));

vi.mock("./service-storage", () => ({
  assertStorageHeadroom: vi.fn(),
  bodyBytes: (s?: string | null) => (s ?? "").length,
}));

vi.mock("./service-shared", () => ({
  assertAgentCanDelete: vi.fn(),
  assertBaseWritable: vi.fn(),
  assertSameWorkspace: vi.fn(),
  canSeeBase: vi.fn(() => true),
  baseGrantsFor: vi.fn(),
  filterTeamVisibleBases: vi.fn(),
}));

vi.mock("./service-audience", () => ({
  audienceAdmits: vi.fn(() => true),
  resolveAgentAudience: vi.fn(),
}));

import { recordRevision } from "@/features/revisions/server/service";
import * as repo from "./repository";
import { getBaseById } from "./service-bases";
import { createEntry, deleteEntry, moveEntry, updateEntry } from "./service-entries";
import { createFolder, moveFolder, updateFolder } from "./service-folders";
import { entryOpFor, entryPath } from "./service-revisions";

const mockRepo = vi.mocked(repo);
const record = vi.mocked(recordRevision);

const CTX = {
  workspaceId: "ws-1",
  userId: "u-me",
  source: "user",
  role: "member",
  credentialSubjectUserId: "u-me",
} as KnowledgeContext;

const BASE = { id: "kb-1", workspaceId: "ws-1" } as KnowledgeBase;

function entry(over: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: "e-1",
    workspaceId: "ws-1",
    knowledgeBaseId: "kb-1",
    folderId: null,
    title: "Notes",
    body: "body",
    updatedAt: "2026-09-09T12:00:00.000Z",
    ...over,
  } as KnowledgeEntry;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getBaseById).mockResolvedValue(BASE);
  mockRepo.findBaseById.mockResolvedValue(BASE);
  mockRepo.findEntryById.mockResolvedValue(entry());
  mockRepo.insertEntry.mockResolvedValue(entry());
  mockRepo.updateEntryRow.mockResolvedValue(entry());
  mockRepo.hardDeleteEntry.mockResolvedValue(undefined as never);
  mockRepo.listFolderAncestors.mockResolvedValue([]);
});

/** The one call this suite is about, unpacked. */
function recorded() {
  expect(record).toHaveBeenCalledTimes(1);
  return record.mock.calls[0][1];
}

describe("entry writes — exactly one revision each", () => {
  it("createEntry records ONE `create` with the POST-write snapshot", async () => {
    mockRepo.insertEntry.mockResolvedValue(entry({ body: "written", title: "T" }));
    await createEntry(CTX, { knowledgeBaseId: "kb-1", title: "T", body: "written" } as never);
    const input = recorded();
    expect(input.op).toBe("create");
    expect(input.resourceType).toBe("knowledge_entry");
    expect(input.payload).toEqual({ body: "written", title: "T", path: "T" });
  });

  it("updateEntry with a BODY records ONE `edit`", async () => {
    mockRepo.updateEntryRow.mockResolvedValue(entry({ body: "next" }));
    await updateEntry(CTX, "e-1", { body: "next" } as never);
    expect(recorded().op).toBe("edit");
  });

  it("🔒 a body+title save is an `edit`, NEVER a `rename`", async () => {
    // ⚠ The coalescing window joins `edit` only. Calling this a rename would
    // seal the open row every time the title bar was touched mid-sentence.
    mockRepo.updateEntryRow.mockResolvedValue(entry({ body: "next", title: "New" }));
    await updateEntry(CTX, "e-1", { body: "next", title: "New" } as never);
    expect(recorded().op).toBe("edit");
  });

  it("a TITLE-only save is a `rename`", async () => {
    mockRepo.updateEntryRow.mockResolvedValue(entry({ title: "New" }));
    await updateEntry(CTX, "e-1", { title: "New" } as never);
    expect(recorded().op).toBe("rename");
  });

  it("🔒 records NOTHING when the CAS loses the race", async () => {
    // ⚠ THE MUTATION: recording before the `saved === null` check leaves a
    // revision for a write that never landed.
    mockRepo.updateEntryRow.mockResolvedValue(null as never);
    await expect(
      updateEntry(CTX, "e-1", { body: "next" } as never, "2026-01-01T00:00:00.000Z")
    ).rejects.toBeTruthy();
    expect(record).not.toHaveBeenCalled();
  });

  it("a RESTORE overrides the derived op and carries its summary", async () => {
    mockRepo.updateEntryRow.mockResolvedValue(entry({ body: "old" }));
    await updateEntry(CTX, "e-1", { body: "old" } as never, undefined, {
      op: "restore",
      summary: "Restored the version from 2026-09-08",
    });
    const input = recorded();
    expect(input.op).toBe("restore");
    expect(input.summary).toBe("Restored the version from 2026-09-08");
  });

  it("moveEntry records ONE `move`", async () => {
    mockRepo.updateEntryRow.mockResolvedValue(entry({ folderId: "f-1" }));
    mockRepo.findFolderById.mockResolvedValue({
      id: "f-1",
      workspaceId: "ws-1",
      knowledgeBaseId: "kb-1",
    } as never);
    await moveEntry(CTX, "e-1", { folderId: "f-1", position: 0 } as never);
    expect(recorded().op).toBe("move");
  });

  it("deleteEntry records ONE `delete` holding the LAST state", async () => {
    mockRepo.findEntryById.mockResolvedValue(entry({ body: "the last words" }));
    await deleteEntry(CTX, "e-1");
    const input = recorded();
    expect(input.op).toBe("delete");
    expect(input.payload.body).toBe("the last words");
    // ⚠ The snapshot is the only place it survives — knowledge deletes are hard.
    expect(mockRepo.hardDeleteEntry).toHaveBeenCalled();
  });
});

describe("folder writes — exactly one revision each", () => {
  const FOLDER = {
    id: "f-1",
    workspaceId: "ws-1",
    knowledgeBaseId: "kb-1",
    name: "Specs",
  };

  beforeEach(() => {
    mockRepo.findFolderById.mockResolvedValue(FOLDER as never);
    mockRepo.insertFolder.mockResolvedValue(FOLDER as never);
    mockRepo.updateFolderRow.mockResolvedValue(FOLDER as never);
  });

  it("createFolder records ONE `create`", async () => {
    await createFolder(CTX, { knowledgeBaseId: "kb-1", name: "Specs" } as never);
    const input = recorded();
    expect(input.op).toBe("create");
    expect(input.resourceType).toBe("knowledge_folder");
  });

  it("a folder RENAME and a DESCRIPTION edit are different ops", async () => {
    await updateFolder(CTX, "f-1", { name: "Renamed" } as never);
    expect(recorded().op).toBe("rename");
    record.mockClear();
    await updateFolder(CTX, "f-1", { description: "why" } as never);
    expect(recorded().op).toBe("edit");
  });

  it("moveFolder records ONE `move`", async () => {
    await moveFolder(CTX, "f-1", { parentId: null, position: 0 } as never);
    expect(recorded().op).toBe("move");
  });
});

describe("entryPath", () => {
  it("costs NO query for a root-level entry", async () => {
    expect(await entryPath(entry({ folderId: null, title: "Notes" }))).toBe("Notes");
    expect(mockRepo.listFolderAncestors).not.toHaveBeenCalled();
  });

  it("walks the ancestors ROOT-FIRST so the join is a path", async () => {
    // `listFolderAncestors` answers the chain from the folder upwards.
    mockRepo.listFolderAncestors.mockResolvedValue([
      { name: "specs" },
      { name: "product" },
    ] as never);
    expect(await entryPath(entry({ folderId: "f-1", title: "api.md" }))).toBe(
      "product/specs/api.md"
    );
  });
});

describe("entryOpFor", () => {
  it("body wins over title, title over position, and the fallback is `edit`", () => {
    expect(entryOpFor({ body: "x", title: "y" })).toBe("edit");
    expect(entryOpFor({ title: "y" })).toBe("rename");
    expect(entryOpFor({ folderId: "f" })).toBe("move");
    expect(entryOpFor({ position: 3 })).toBe("move");
    expect(entryOpFor({})).toBe("edit");
  });
});
