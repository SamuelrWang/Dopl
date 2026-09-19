/**
 * S35 — an entity-escaped title is never silent on this surface:
 *   1. the WRITE result says so when the server's decode changed the title;
 *   2. `read_file` and `get_tree` flag a stored title that still LOOKS escaped,
 *      naming the fix, in one line, without erroring.
 */

import { describe, it, expect, vi } from "vitest";
import type {
  DoplClient,
  KnowledgeBase,
  KnowledgeEntry,
  KnowledgeFolder,
} from "@dopl/client";
import {
  escapedTitleLine,
  looksEntityEscaped,
  titleDecodedNote,
} from "./knowledge-entity-titles.js";
import { opGetTree, opReadFile } from "./knowledge-ops-read.js";
import { opWriteFile } from "./knowledge-ops-write.js";

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

describe("looksEntityEscaped — detection only, same class as the schema", () => {
  it("matches the five named forms and both numeric spellings", () => {
    for (const t of ["R&amp;D", "a&lt;b", "a&gt;b", "&quot;x&quot;", "it&apos;s", "it&#39;s", "&#x27;"]) {
      expect(looksEntityEscaped(t)).toBe(true);
    }
  });

  it("does not match a plain ampersand, an unknown name, or a bare `&amp`", () => {
    for (const t of ["R&D", "a & b; c", "&nbsp;", "&amp", "Quarterly plan", ""]) {
      expect(looksEntityEscaped(t)).toBe(false);
    }
  });

  it("is stateless across calls — the regex carries no /g lastIndex", () => {
    expect(looksEntityEscaped("R&amp;D")).toBe(true);
    expect(looksEntityEscaped("R&amp;D")).toBe(true);
  });
});

describe("titleDecodedNote — one clause, only when the decode bit", () => {
  it("names the stored title when the server decoded what was sent", () => {
    expect(titleDecodedNote("R&amp;D", "R&D")).toBe(
      " HTML entities in the title were decoded — address it as `R&D`.",
    );
  });

  it("is silent when no title was sent, when nothing changed, and when the change was not a decode", () => {
    expect(titleDecodedNote(undefined, "R&D")).toBe("");
    expect(titleDecodedNote("Plans", "Plans")).toBe("");
    // A trim is a change, but not this one — the note must not claim it.
    expect(titleDecodedNote(" Plans ", "Plans")).toBe("");
  });
});

describe("write_file states the decode on the result line", () => {
  it("appends the clause when the stored title differs from the argument", async () => {
    const client = {
      listKbBases: vi.fn().mockResolvedValue([BASE]),
      writeKbFileByPath: vi
        .fn()
        .mockResolvedValue({ entry: entry({ id: "e-new", title: "R&D" }) }),
    } as unknown as DoplClient;

    const out = textOf(
      await opWriteFile(client, "my-base", "R&amp;D", "body", "R&amp;D"),
    );
    expect(out).toContain("HTML entities in the title were decoded");
    expect(out).toContain("address it as `R&D`");
  });

  it("says nothing on an ordinary write", async () => {
    const client = {
      listKbBases: vi.fn().mockResolvedValue([BASE]),
      writeKbFileByPath: vi
        .fn()
        .mockResolvedValue({ entry: entry({ id: "e-new", title: "Plans" }) }),
    } as unknown as DoplClient;

    const out = textOf(
      await opWriteFile(client, "my-base", "Plans", "body", "Plans"),
    );
    expect(out).not.toContain("HTML entities");
  });
});

describe("read_file flags a stored title that still looks escaped", () => {
  it("renders the signal under the heading, and does not error", async () => {
    const client = {
      listKbBases: vi.fn().mockResolvedValue([BASE]),
      readKbFileByPath: vi
        .fn()
        .mockResolvedValue(entry({ title: "R&amp;D", body: "hello" })),
    } as unknown as DoplClient;

    const res = await opReadFile(client, "my-base", "R&amp;D");
    const out = textOf(res as { content: Array<{ text: string }> });
    expect(out).toContain("reason=TITLE_ENTITY_ESCAPED");
    expect(out).toContain('fix=op="write_file" with the decoded title');
    // ⚠ The READ succeeded. An `isError` would make a retrying client retry a
    // call that can only answer the same way.
    expect((res as { isError?: boolean }).isError).toBeFalsy();
    // Directly under the title it is about.
    const lines = out.split("\n");
    expect(lines[0]).toBe("# `R&amp;D`");
    expect(lines[1]).toContain("reason=TITLE_ENTITY_ESCAPED");
  });

  it("stays quiet on a clean title", async () => {
    const client = {
      listKbBases: vi.fn().mockResolvedValue([BASE]),
      readKbFileByPath: vi
        .fn()
        .mockResolvedValue(entry({ title: "R&D", body: "hello" })),
    } as unknown as DoplClient;

    const out = textOf(await opReadFile(client, "my-base", "R&D"));
    expect(out).not.toContain("TITLE_ENTITY_ESCAPED");
  });
});

describe("get_tree flags the tree ONCE, counting folders and entries", () => {
  it("names the first offender and how many there are", async () => {
    const client = {
      listKbBases: vi.fn().mockResolvedValue([BASE]),
      getKbTree: vi.fn().mockResolvedValue({
        base: BASE,
        folders: [folder({ id: "f-esc", name: "R&amp;D" })],
        entries: [
          entry({ id: "e-esc", title: "Q1 &amp; Q2", folderId: null }),
          entry({ id: "e-ok", title: "Plans", folderId: null }),
        ],
        entryTotal: 2,
      }),
    } as unknown as DoplClient;

    const out = textOf(await opGetTree(client, "my-base"));
    expect(out).toContain("reason=TITLE_ENTITY_ESCAPED");
    expect(out).toContain("and 1 other here are");
    // One line for the whole tree, never one per row.
    expect(out.split("TITLE_ENTITY_ESCAPED").length - 1).toBe(1);
  });

  it("says nothing when every label is clean", async () => {
    const client = {
      listKbBases: vi.fn().mockResolvedValue([BASE]),
      getKbTree: vi.fn().mockResolvedValue({
        base: BASE,
        folders: [folder({ name: "R&D" })],
        entries: [entry({ title: "Plans" })],
        entryTotal: 1,
      }),
    } as unknown as DoplClient;

    expect(textOf(await opGetTree(client, "my-base"))).not.toContain(
      "TITLE_ENTITY_ESCAPED",
    );
  });
});

describe("escapedTitleLine — the singular/plural forms", () => {
  it("reads naturally at one, two and many", () => {
    expect(escapedTitleLine("R&amp;D")).toContain("`R&amp;D` is stored");
    expect(escapedTitleLine("R&amp;D", 2)).toContain("and 1 other here are");
    expect(escapedTitleLine("R&amp;D", 4)).toContain("and 3 others here are");
  });
});
