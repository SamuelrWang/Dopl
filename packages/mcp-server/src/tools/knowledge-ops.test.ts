/**
 * `dopl_kb` folder-description / entry-excerpt surfacing:
 *   1. get_tree / list_dir render each row's description/excerpt inline,
 *      flattened to one line and bounded, with the separator appearing only
 *      when a summary exists;
 *   2. create_folder threads `description` and write_file threads `excerpt`
 *      through to the @dopl/client calls.
 */

import { describe, it, expect, vi } from "vitest";
import type {
  DoplClient,
  KnowledgeBase,
  KnowledgeEntry,
  KnowledgeFolder,
} from "@dopl/client";
import { opGetTree, opListDir } from "./knowledge-ops-read.js";
import { opCreateFolder, opWriteFile } from "./knowledge-ops-write.js";

const BASE: KnowledgeBase = {
  id: "base-1",
  workspaceId: "ws-1",
  name: "My Base",
  slug: "my-base",
  publicId: "pub-1",
  description: null,
  agentWriteEnabled: true,
  visibility: "public",
  createdBy: "u1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  deletedAt: null,
};

function folder(over: Partial<KnowledgeFolder>): KnowledgeFolder {
  return {
    id: "f1",
    workspaceId: "ws-1",
    knowledgeBaseId: "base-1",
    parentId: null,
    name: "Folder",
    description: null,
    position: 0,
    createdBy: "u1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: null,
    ...over,
  };
}

function entry(over: Partial<KnowledgeEntry>): KnowledgeEntry {
  return {
    id: "e1",
    workspaceId: "ws-1",
    knowledgeBaseId: "base-1",
    folderId: null,
    title: "Entry",
    excerpt: null,
    body: "",
    entryType: "note",
    position: 0,
    createdBy: "u1",
    lastEditedBy: null,
    lastEditedSource: "agent",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: null,
    ...over,
  };
}

function textOf(res: { content: Array<{ text: string }> }): string {
  return res.content.map((c) => c.text).join("\n");
}

describe("get_tree renders folder descriptions + entry excerpts", () => {
  it("shows `— summary`, flattens newlines, and truncates long text", async () => {
    const longDesc = "a".repeat(200);
    const client = {
      listKbBases: vi.fn().mockResolvedValue([BASE]),
      getKbTree: vi.fn().mockResolvedValue({
        base: BASE,
        folders: [
          folder({ id: "f-long", name: "Deep", description: longDesc }),
          folder({ id: "f-multi", name: "Notes", description: "line1\nline2" }),
          folder({ id: "f-bare", name: "Empty", description: null }),
        ],
        entries: [
          entry({ id: "e-desc", title: "Guide", excerpt: "how to X", folderId: null }),
          entry({ id: "e-bare", title: "Plain", excerpt: null, folderId: null }),
        ],
        entryTotal: 2,
      }),
    } as unknown as DoplClient;

    const out = textOf(await opGetTree(client, "my-base"));

    // ⚠ `descSuffix` defers to the shared neutralizer, so the bound is
    // INLINE_TEXT_MAX and the row renders as a VALUE — bounded, one line,
    // separator only when there is something to show.
    expect(out).toContain(`📁 \`Deep\`/ — \`${"a".repeat(157)}...\``);
    expect(out).not.toContain("a".repeat(200));
    expect(out).toContain("📁 `Notes`/ — `line1 line2`");
    expect(out).toContain("📁 `Empty`/");
    expect(out).not.toContain("Empty`/ —");
    expect(out).toContain("📄 `Guide` — `how to X`");
    expect(out).toContain("📄 `Plain`");
    expect(out).not.toContain("Plain` —");
  });
});

describe("list_dir renders folder descriptions + entry excerpts", () => {
  it("shows `— summary` on rows and truncates long text", async () => {
    const longDesc = "b".repeat(150);
    const client = {
      listKbBases: vi.fn().mockResolvedValue([BASE]),
      listKbDirByPath: vi.fn().mockResolvedValue({
        folder: null,
        folders: [folder({ id: "f-long", name: "Deep", description: longDesc })],
        entries: [entry({ id: "e-desc", title: "Guide", excerpt: "short" })],
      }),
    } as unknown as DoplClient;

    const out = textOf(await opListDir(client, "my-base", ""));
    // Under INLINE_TEXT_MAX, so this survives whole.
    expect(out).toContain(`📁 \`Deep\`/ — \`${"b".repeat(150)}\``);
    expect(out).toContain("📄 `Guide` — `short`");
  });
});

describe("write paths thread the new args", () => {
  it("create_folder forwards `description` (and undefined when omitted)", async () => {
    const create = vi
      .fn()
      .mockResolvedValue(folder({ id: "f-new", name: "foo" }));
    const client = {
      listKbBases: vi.fn().mockResolvedValue([BASE]),
      createKbFolderByPath: create,
    } as unknown as DoplClient;

    await opCreateFolder(client, "my-base", "foo", "a summary");
    expect(create).toHaveBeenCalledWith("base-1", "foo", "a summary");

    await opCreateFolder(client, "my-base", "bar");
    expect(create).toHaveBeenLastCalledWith("base-1", "bar", undefined);
  });

  it("write_file forwards `excerpt` in the write input", async () => {
    const write = vi.fn().mockResolvedValue({
      entry: entry({ id: "e-new", title: "notes", excerpt: "sum" }),
    });
    const client = {
      listKbBases: vi.fn().mockResolvedValue([BASE]),
      writeKbFileByPath: write,
    } as unknown as DoplClient;

    await opWriteFile(
      client,
      "my-base",
      "notes.md",
      "body text",
      undefined,
      undefined,
      undefined,
      "sum"
    );
    expect(write).toHaveBeenCalledWith(
      "base-1",
      "notes.md",
      { body: "body text", title: undefined, excerpt: "sum" },
      undefined
    );
  });
});
