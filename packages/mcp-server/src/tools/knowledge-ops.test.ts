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
  it("shows `— summary`, flattens newlines, and renders the FULL 300", async () => {
    // ⚠ **300, NOT 160 — AND THE 300 IS THE FIELD'S OWN CAP** (S36 / Wave 4
    // a3, 2026-09-18). `descSuffix` reclassified the curated excerpt as
    // body-class content: `narration.ts › INLINE_TEXT_MAX` (160) was NOT
    // raised, because it still guards every name, label and error echo.
    const longDesc = "a".repeat(400);
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

    expect(out).toContain(`📁 \`Deep\`/ — ${"a".repeat(300)}`);
    expect(out).not.toContain("a".repeat(301));
    // ⚠ A NEWLINE IS STILL REMOVED. A row is a LINE, and flattening is
    // structural — the fence says where a BLOCK ends, never where a row does.
    expect(out).toContain("📁 `Notes`/ — line1 line2");
    expect(out).toContain("📁 `Empty`/");
    expect(out).not.toContain("Empty`/ —");
    expect(out).toContain("📄 `Guide` — how to X");
    expect(out).toContain("📄 `Plain`");
    expect(out).not.toContain("Plain` —");
  });

  // 🔒 **WAVE 4 a1 — THE TOP ASK IN 3 OF 4 RUNS.** Three runs spent calls
  // guessing heading names; one spent three `outline` calls whose only purpose
  // was learning names it should already have been handed.
  it("carries each entry's heading list on its row", async () => {
    const getKbTree = vi.fn().mockResolvedValue({
      base: BASE,
      folders: [],
      entries: [
        entry({ id: "e-h", title: "Runbook", excerpt: "what to do", folderId: null }),
        entry({ id: "e-none", title: "Stub", excerpt: "a short note", folderId: null }),
      ],
      entryTotal: 2,
      entryHeadings: { "e-h": ["## Setup", "## Escalation Timers"] },
    });
    const client = {
      listKbBases: vi.fn().mockResolvedValue([BASE]),
      getKbTree,
    } as unknown as DoplClient;

    const out = textOf(await opGetTree(client, "my-base"));
    expect(out).toContain("📄 `Runbook` — what to do · ## Setup · ## Escalation Timers");
    // An entry with no headings simply carries none — no empty separator.
    expect(out).toContain("📄 `Stub` — a short note");
    expect(out).not.toContain("a short note ·");
    // ⚠ The flag is what makes the server read the body column at all.
    expect(getKbTree).toHaveBeenCalledWith(
      "base-1",
      expect.objectContaining({ headings: true }),
    );
  });

  // ⚠ §8 STALE-CACHE. A payload from a bundle that predates `entryHeadings`
  // renders every row WITHOUT a heading list rather than crashing or claiming
  // the entries have none.
  it("survives a payload with no entryHeadings key at all", async () => {
    const client = {
      listKbBases: vi.fn().mockResolvedValue([BASE]),
      getKbTree: vi.fn().mockResolvedValue({
        base: BASE,
        folders: [],
        entries: [entry({ id: "e1", title: "Old", excerpt: "from an old server" })],
        entryTotal: 1,
      }),
    } as unknown as DoplClient;

    const out = textOf(await opGetTree(client, "my-base"));
    expect(out).toContain("📄 `Old` — from an old server");
  });

  // 🔒 **THE FENCE IS WHAT PAYS FOR VERBATIM MARKDOWN** (Wave 4 b2). An
  // excerpt may now quote a heading name in backticks, which is only safe
  // because the whole row block is delimited by a tag its author cannot know.
  it("keeps backticks intact, inside a fence, with our narration outside it", async () => {
    const client = {
      listKbBases: vi.fn().mockResolvedValue([BASE]),
      getKbTree: vi.fn().mockResolvedValue({
        base: BASE,
        folders: [],
        entries: [
          entry({
            id: "e1",
            title: "Rates",
            excerpt: "$3.18/gal base peg; the ladder is under `Escalation Timers`",
          }),
        ],
        entryTotal: 1,
      }),
    } as unknown as DoplClient;

    const out = textOf(await opGetTree(client, "my-base"));
    expect(out).toContain("`Escalation Timers`");
    expect(out).toContain("$3.18/gal base peg");
    const open = out.match(/<body_([0-9a-f]{16})>/);
    expect(open).not.toBeNull();
    const suffix = open![1];
    expect(out).toContain(`</body_${suffix}>`);
    // ⚠ The scope line is OURS and must sit OUTSIDE the fence — that boundary
    // is the whole informational content of the delimiter.
    expect(out.indexOf(`</body_${suffix}>`)).toBeLessThan(
      out.indexOf("entries complete for this base"),
    );
  });
});

describe("list_dir renders folder descriptions + entry excerpts", () => {
  it("shows `— summary` on rows, fenced, at the field's own bound", async () => {
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
    expect(out).toContain(`📁 \`Deep\`/ — ${"b".repeat(150)}`);
    expect(out).toContain("📄 `Guide` — short");
    expect(out).toMatch(/<body_[0-9a-f]{16}>/);
  });

  // ⚠ Wave 4 a3: the OLD cut landed mid-clause — one agent quoted
  // `"...the $5..."` as the point where an excerpt died before naming its
  // heading. A clip now backs up to the last clause boundary in the budget.
  it("clips a long excerpt at a clause boundary, not mid-word", async () => {
    const excerpt = `${"x".repeat(240)}. And then a trailing clause that does not fit at all in the budget.`;
    const client = {
      listKbBases: vi.fn().mockResolvedValue([BASE]),
      listKbDirByPath: vi.fn().mockResolvedValue({
        folder: null,
        folders: [],
        entries: [entry({ id: "e1", title: "Long", excerpt })],
      }),
    } as unknown as DoplClient;

    const out = textOf(await opListDir(client, "my-base", ""));
    expect(out).toContain(`📄 \`Long\` — ${"x".repeat(240)}. …`);
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
      entry: entry({ id: "e-new", title: "notes", excerpt: "the on-call rota" }),
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
      "the on-call rota"
    );
    expect(write).toHaveBeenCalledWith(
      "base-1",
      "notes.md",
      { body: "body text", title: undefined, excerpt: "the on-call rota" },
      undefined
    );
  });
});
