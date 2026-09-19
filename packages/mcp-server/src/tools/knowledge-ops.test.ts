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
// ⚠ THE BASE OPS LIVE IN THEIR OWN MODULE SINCE THE 2026-09-18 SPLIT (A3) —
// `knowledge-ops-write.ts` was AT the 500-line cap. They are re-exported there,
// but a test addresses the file that OWNS the behaviour it is about.
import { opCreateBase, opUpdateBase } from "./knowledge-ops-base-writes.js";

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

/**
 * **A RESULT HANDS BACK THE HANDLE THE NEXT CALL IS ADDRESSED BY** (A3/S30 +
 * S34, 2026-09-18).
 *
 * ⚠ **BOTH GAPS ARE THE SAME GAP.** `create_base` returned a slug alone, so an
 * agent needing the id — to grant the base, to attach it, or to address it from
 * a container where the slug is ambiguous — spent a `list_bases` call finding
 * the row it had just made; and `write_file`'s version WORKS as the next call's
 * `expected_version` (`service-paths.ts` compares `updatedAt` string-equal) but
 * only `read_file` said so, so an agent correcting its own write re-read the
 * entry or reached for `force=true`, which disarms the server's anti-duplicate
 * guard.
 */
describe("write results carry the next call's handle", () => {
  it("create_base returns the id beside the slug", async () => {
    const client = {
      createKbBase: vi.fn().mockResolvedValue(BASE),
    } as unknown as DoplClient;
    const out = textOf(await opCreateBase(client, "u1", { name: "My Base" }));
    expect(out).toContain("slug: `my-base`");
    expect(out).toContain("id: `base-1`");
  });

  it("update_base does too — it is the op that can CHANGE the slug", async () => {
    const client = {
      listKbBases: vi.fn().mockResolvedValue([BASE]),
      updateKbBase: vi.fn().mockResolvedValue({ ...BASE, slug: "renamed" }),
    } as unknown as DoplClient;
    const out = textOf(await opUpdateBase(client, "my-base", "My Base"));
    expect(out).toContain("slug: `renamed`");
    expect(out).toContain("id: `base-1`");
  });

  it("write_file says what the returned version is FOR, in read_file's words", async () => {
    const written = entry({ id: "e-9", title: "Guide", body: "x", updatedAt: "2026-09-18T01:02:03Z" });
    const client = {
      listKbBases: vi.fn().mockResolvedValue([BASE]),
      writeKbFileByPath: vi.fn().mockResolvedValue({ entry: written, outline: null }),
    } as unknown as DoplClient;
    const out = textOf(await opWriteFile(client, "my-base", "Guide", "x"));
    expect(out).toContain("New version: `2026-09-18T01:02:03Z` (pass as expected_version to write_file)");
  });

  it("🔒 and that version round-trips as the next write's precondition", async () => {
    // ⚠ THE CLAIM IS THE POINT, not the string: the result tells the agent to
    // send this value back, so the value it sends back must be the one the
    // client puts on the wire as `expected_version`.
    const first = entry({ id: "e-9", title: "Guide", body: "x", updatedAt: "V1" });
    const writeKbFileByPath = vi.fn().mockResolvedValue({ entry: first, outline: null });
    const client = { listKbBases: vi.fn().mockResolvedValue([BASE]), writeKbFileByPath } as unknown as DoplClient;

    const out = textOf(await opWriteFile(client, "my-base", "Guide", "x"));
    const version = /New version: `([^`]+)`/.exec(out)?.[1];
    expect(version).toBe("V1");

    await opWriteFile(client, "my-base", "Guide", "y", undefined, version);
    expect(writeKbFileByPath).toHaveBeenLastCalledWith(
      "base-1",
      "Guide",
      expect.anything(),
      "V1",
    );
  });
});
