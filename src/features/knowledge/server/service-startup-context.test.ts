/**
 * THE PINNED LAUNCH PAYLOAD (T81) — the properties that make a capped read
 * honest, and the fence that makes it safe:
 *   1. an item is included WHOLE or not at all — the one that exactly fits is
 *      IN, the next is a POINTER, and no body is ever halved;
 *   2. `truncated` is load-bearing BOTH ways (INVARIANTS §9): false on an
 *      exhausted read, true the moment anything was left out;
 *   3. de-dup between a pinned base and a pinned entry inside it, so one
 *      document cannot spend the cap twice;
 *   4. the empty case is a real answer, not a gap;
 *   5. 🔒 every read is fenced by the id set `listBases` produced.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KnowledgeBase, KnowledgeContext, KnowledgeEntry } from "../types";

vi.mock("./repository", () => ({
  listPinnedEntriesForBases: vi.fn(),
  listFolderNodesForBases: vi.fn(),
}));

vi.mock("./service-bases", () => ({
  listBases: vi.fn(),
}));

vi.mock("./service-pins", () => ({
  listPinnedBaseIds: vi.fn(),
}));

import * as repo from "./repository";
import { listBases } from "./service-bases";
import { listPinnedBaseIds } from "./service-pins";
import {
  getStartupContext,
  STARTUP_CONTEXT_CHAR_CAP,
  STARTUP_CONTEXT_ENTRY_LIMIT,
} from "./service-startup-context";

const mockRepo = vi.mocked(repo);
const mockListBases = vi.mocked(listBases);
const mockPinnedIds = vi.mocked(listPinnedBaseIds);

const CTX = { workspaceId: "ws-1", userId: "u-me" } as KnowledgeContext;

function base(id: string, name = id, slug = id): KnowledgeBase {
  return { id, name, slug, workspaceId: "ws-1" } as KnowledgeBase;
}

function entry(
  id: string,
  baseId: string,
  body: string,
  extra: Partial<KnowledgeEntry> = {}
): KnowledgeEntry {
  return {
    id,
    knowledgeBaseId: baseId,
    workspaceId: "ws-1",
    title: `${id} title`,
    folderId: null,
    body,
    ...extra,
  } as KnowledgeEntry;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListBases.mockResolvedValue([base("kb-1")]);
  mockPinnedIds.mockResolvedValue(["kb-1"]);
  mockRepo.listPinnedEntriesForBases.mockResolvedValue([]);
  mockRepo.listFolderNodesForBases.mockResolvedValue([]);
});

describe("the visibility fence", () => {
  it("reads entries only over the id set listBases produced", async () => {
    mockListBases.mockResolvedValue([base("kb-1"), base("kb-2")]);
    mockPinnedIds.mockResolvedValue(["kb-2"]);
    mockRepo.listPinnedEntriesForBases.mockResolvedValue([
      entry("e-1", "kb-2", "x"),
    ]);

    await getStartupContext(CTX);

    expect(mockRepo.listPinnedEntriesForBases).toHaveBeenCalledWith(
      "ws-1",
      ["kb-1", "kb-2"],
      ["kb-2"],
      STARTUP_CONTEXT_ENTRY_LIMIT
    );
  });

  it("issues NO read at all when the caller can see no base", async () => {
    mockListBases.mockResolvedValue([]);

    expect(await getStartupContext(CTX)).toEqual({
      items: [],
      omitted: [],
      chars: 0,
      truncated: false,
    });
    expect(mockRepo.listPinnedEntriesForBases).not.toHaveBeenCalled();
  });
});

describe("the empty case", () => {
  it("answers an EXHAUSTED read, not a clipped one", async () => {
    // `truncated: false` is the assertion "this is all of it" — and nothing
    // pinned is a legitimate state, not a degraded one.
    expect(await getStartupContext(CTX)).toEqual({
      items: [],
      omitted: [],
      chars: 0,
      truncated: false,
    });
  });
});

describe("the cap boundary", () => {
  it("includes an item that EXACTLY fills the cap and points at the next", async () => {
    mockRepo.listPinnedEntriesForBases.mockResolvedValue([
      entry("e-fits", "kb-1", "a".repeat(STARTUP_CONTEXT_CHAR_CAP)),
      entry("e-over", "kb-1", "b"),
    ]);

    const ctxOut = await getStartupContext(CTX);

    expect(ctxOut.items.map((i) => i.entryId)).toEqual(["e-fits"]);
    expect(ctxOut.chars).toBe(STARTUP_CONTEXT_CHAR_CAP);
    expect(ctxOut.omitted.map((p) => p.entryId)).toEqual(["e-over"]);
  });

  it("omits the FIRST item that would cross, whole — never half a body", async () => {
    mockRepo.listPinnedEntriesForBases.mockResolvedValue([
      entry("e-1", "kb-1", "a".repeat(STARTUP_CONTEXT_CHAR_CAP - 1)),
      entry("e-2", "kb-1", "bb"),
    ]);

    const ctxOut = await getStartupContext(CTX);

    expect(ctxOut.items).toHaveLength(1);
    expect(ctxOut.items[0].body).toHaveLength(STARTUP_CONTEXT_CHAR_CAP - 1);
    expect(ctxOut.chars).toBe(STARTUP_CONTEXT_CHAR_CAP - 1);
    expect(ctxOut.omitted).toHaveLength(1);
  });

  it("does NOT skip ahead to a smaller entry once anything was omitted", async () => {
    // A payload whose contents depend on the sizes of the documents NOT in it is
    // one nobody can reason about — and the tiny entry would arrive without the
    // document that precedes it.
    mockRepo.listPinnedEntriesForBases.mockResolvedValue([
      entry("e-big", "kb-1", "a".repeat(STARTUP_CONTEXT_CHAR_CAP + 1)),
      entry("e-tiny", "kb-1", "b"),
    ]);

    const ctxOut = await getStartupContext(CTX);

    expect(ctxOut.items).toEqual([]);
    expect(ctxOut.omitted.map((p) => p.entryId)).toEqual(["e-big", "e-tiny"]);
  });

  it("a pointer carries an ADDRESS and never a body", async () => {
    mockRepo.listPinnedEntriesForBases.mockResolvedValue([
      entry("e-over", "kb-1", "a".repeat(STARTUP_CONTEXT_CHAR_CAP + 1)),
    ]);

    const [pointer] = (await getStartupContext(CTX)).omitted;

    expect(pointer).toEqual({
      baseId: "kb-1",
      baseSlug: "kb-1",
      entryId: "e-over",
      path: "e-over title",
      title: "e-over title",
    });
    expect(Object.keys(pointer)).not.toContain("body");
  });
});

describe("truncated", () => {
  it("is FALSE when everything pinned fitted", async () => {
    mockRepo.listPinnedEntriesForBases.mockResolvedValue([
      entry("e-1", "kb-1", "short"),
    ]);

    const ctxOut = await getStartupContext(CTX);
    expect(ctxOut.truncated).toBe(false);
    expect(ctxOut.omitted).toEqual([]);
  });

  it("is TRUE the moment one entry became a pointer", async () => {
    mockRepo.listPinnedEntriesForBases.mockResolvedValue([
      entry("e-1", "kb-1", "a".repeat(STARTUP_CONTEXT_CHAR_CAP)),
      entry("e-2", "kb-1", "b"),
    ]);

    expect((await getStartupContext(CTX)).truncated).toBe(true);
  });

  it("is TRUE at the ROW ceiling too, where `omitted` cannot name what was missed", async () => {
    // AT a ceiling is indistinguishable from over it, so the read reports the
    // clip even though every row it DID get fitted under the character cap.
    mockRepo.listPinnedEntriesForBases.mockResolvedValue(
      Array.from({ length: STARTUP_CONTEXT_ENTRY_LIMIT }, (_, i) =>
        entry(`e-${i}`, "kb-1", "")
      )
    );

    const ctxOut = await getStartupContext(CTX);
    expect(ctxOut.items).toHaveLength(STARTUP_CONTEXT_ENTRY_LIMIT);
    expect(ctxOut.omitted).toEqual([]);
    expect(ctxOut.truncated).toBe(true);
  });
});

describe("de-dup", () => {
  it("counts an entry pinned INSIDE a pinned base exactly once", async () => {
    // The two arms of the read overlap by construction; handing the document
    // over twice would spend the cap on it twice.
    mockRepo.listPinnedEntriesForBases.mockResolvedValue([
      entry("e-1", "kb-1", "12345"),
      entry("e-1", "kb-1", "12345"),
      entry("e-2", "kb-1", "12345"),
    ]);

    const ctxOut = await getStartupContext(CTX);

    expect(ctxOut.items.map((i) => i.entryId)).toEqual(["e-1", "e-2"]);
    expect(ctxOut.chars).toBe(10);
  });
});

describe("paths and ordering", () => {
  it("addresses an entry by its folder chain plus its title", async () => {
    mockRepo.listPinnedEntriesForBases.mockResolvedValue([
      entry("e-1", "kb-1", "x", { folderId: "f-child", title: "Notes.md" }),
    ]);
    mockRepo.listFolderNodesForBases.mockResolvedValue([
      { id: "f-child", knowledgeBaseId: "kb-1", parentId: "f-root", name: "sub" },
      { id: "f-root", knowledgeBaseId: "kb-1", parentId: null, name: "projects" },
    ]);

    const [item] = (await getStartupContext(CTX)).items;
    expect(item.path).toBe("projects/sub/Notes.md");
  });

  it("terminates on a folder CYCLE rather than hanging the launch path", async () => {
    mockRepo.listPinnedEntriesForBases.mockResolvedValue([
      entry("e-1", "kb-1", "x", { folderId: "f-a", title: "Loop" }),
    ]);
    mockRepo.listFolderNodesForBases.mockResolvedValue([
      { id: "f-a", knowledgeBaseId: "kb-1", parentId: "f-b", name: "a" },
      { id: "f-b", knowledgeBaseId: "kb-1", parentId: "f-a", name: "b" },
    ]);

    const [item] = (await getStartupContext(CTX)).items;
    expect(item.path.endsWith("Loop")).toBe(true);
  });

  it("orders by the base order listBases produced, not by the row order", async () => {
    mockListBases.mockResolvedValue([base("kb-old"), base("kb-new")]);
    mockPinnedIds.mockResolvedValue(["kb-old", "kb-new"]);
    mockRepo.listPinnedEntriesForBases.mockResolvedValue([
      entry("e-new", "kb-new", "x"),
      entry("e-old", "kb-old", "x"),
    ]);

    const ctxOut = await getStartupContext(CTX);
    expect(ctxOut.items.map((i) => i.entryId)).toEqual(["e-old", "e-new"]);
  });

  it("reads the folder skeleton ONCE, over the bases that actually have entries", async () => {
    mockListBases.mockResolvedValue([base("kb-1"), base("kb-2")]);
    mockRepo.listPinnedEntriesForBases.mockResolvedValue([
      entry("e-1", "kb-1", "x"),
    ]);

    await getStartupContext(CTX);

    expect(mockRepo.listFolderNodesForBases).toHaveBeenCalledTimes(1);
    expect(mockRepo.listFolderNodesForBases).toHaveBeenCalledWith("ws-1", ["kb-1"]);
  });
});
