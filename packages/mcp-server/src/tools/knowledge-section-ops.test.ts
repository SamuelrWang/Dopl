/**
 * **HEADINGS AS ADDRESSES, AT THE AGENT SURFACE** (2026-09-03).
 *
 * ⚠ What is proved here is what an AGENT SEES, not what the parser does — the
 * split has its own suite in `src/shared/knowledge/markdown-sections.test.ts`
 * and does not run in this package at all. Every assertion below is about a
 * rendered string: does the miss carry the outline (so the retry is free), and
 * does the nudge LEAD (so it is read).
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient, KnowledgeBase, KnowledgeEntry } from "@dopl/client";
import { opOutline, opReadFile } from "./knowledge-ops-read.js";
import { opWriteFile } from "./knowledge-ops-write.js";
import { KB_SECTION_NUDGE_CHARS } from "./knowledge-sections.js";

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

function entry(over: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: "e1",
    workspaceId: "ws-1",
    knowledgeBaseId: "base-1",
    folderId: null,
    title: "Runbook",
    excerpt: null,
    body: "",
    entryType: "note",
    position: 0,
    createdBy: "u1",
    lastEditedBy: null,
    lastEditedSource: "agent",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    deletedAt: null,
    ...over,
  } as KnowledgeEntry;
}

const OUTLINE = {
  sections: [
    { heading: "Title", level: 1, chars: 2612, start: 0, line: 1 },
    { heading: "Setup", level: 2, chars: 812, start: 40, line: 4 },
    { heading: "Errors", level: 2, chars: 640, start: 852, line: 30 },
  ],
  totalChars: 2612,
};

function client(over: Partial<Record<string, unknown>> = {}): DoplClient {
  return {
    listKbBases: vi.fn().mockResolvedValue([BASE]),
    ...over,
  } as unknown as DoplClient;
}

function text(res: { content: Array<{ text?: string }> }): string {
  return res.content.map((c) => c.text ?? "").join("\n");
}

describe('op="outline"', () => {
  it("lists every heading with its cost, and never the body", async () => {
    const readKbFilePart = vi
      .fn()
      .mockResolvedValue({ entry: entry({ body: "" }), outline: OUTLINE });
    const out = text(
      (await opOutline(client({ readKbFilePart }), "my-base", "runbook.md")) as never,
    );
    expect(readKbFilePart).toHaveBeenCalledWith("base-1", "runbook.md", { outline: true });
    expect(out).toContain("## `Setup` · 812");
    expect(out).toContain("## `Errors` · 640");
    expect(out).toContain("2,612 chars");
    // ⚠ The nesting note: a `##` count CONTAINS its children, so the rows do
    // not sum to the total and a reader must be told.
    expect(out).toContain("INCLUDES the sections nested under it");
  });

  it("an entry with no headings reports its SIZE rather than an error", async () => {
    const readKbFilePart = vi.fn().mockResolvedValue({
      entry: entry(),
      outline: { sections: [], totalChars: 300 },
    });
    const res = await opOutline(client({ readKbFilePart }), "my-base", "note.md");
    expect(res.isError).toBeFalsy();
    expect(text(res as never)).toContain("no headings");
    expect(text(res as never)).toContain("300 chars whole");
  });
});

describe('read_file(section=…)', () => {
  it("renders the section and says which one, and what it cost", async () => {
    const readKbFilePart = vi.fn().mockResolvedValue({
      entry: entry({ body: "## Errors\n412 means stale.\n" }),
      outline: OUTLINE,
      section: { ok: true, heading: "Errors", level: 2, start: 852, end: 1492, chars: 640 },
    });
    const out = text(
      (await opReadFile(
        client({ readKbFilePart }),
        "my-base",
        "runbook.md",
        "u1",
        undefined,
        undefined,
        "Errors",
      )) as never,
    );
    expect(out).toContain("412 means stale.");
    expect(out).toContain("Section: ## `Errors` · 640 of 2612 chars");
  });

  it("an unknown heading answers OK with the outline inline — no second call", async () => {
    const readKbFilePart = vi.fn().mockResolvedValue({
      entry: entry({ body: "" }),
      outline: OUTLINE,
      section: { ok: false, reason: "SECTION_NOT_FOUND" },
    });
    const res = await opReadFile(
      client({ readKbFilePart }),
      "my-base",
      "runbook.md",
      "u1",
      undefined,
      undefined,
      "Nope",
    );
    // ⚠ NOT an error: the read succeeded, the heading did not resolve. A client
    // that retries on `isError` would retry a call that can only answer the same.
    expect(res.isError).toBeFalsy();
    const out = text(res as never);
    expect(out).toContain("reason=SECTION_NOT_FOUND");
    expect(out).toContain("## `Setup` · 812");
    expect(out).toContain("## `Errors` · 640");
  });

  // 1.37.1: the server serves every match of a loose heading; the line says which.
  it("names every section served, and how the heading matched", async () => {
    const readKbFilePart = vi.fn().mockResolvedValue({
      entry: entry({ body: "## Notes\na\n## Notes\nb" }),
      outline: OUTLINE,
      section: {
        ok: true,
        heading: "Notes",
        level: 2,
        start: 0,
        end: 20,
        chars: 20,
        served: ["Notes", "Notes"],
        match: "contains",
      },
    });
    const out = text(
      (await opReadFile(
        client({ readKbFilePart }),
        "my-base",
        "runbook.md",
        "u1",
        undefined,
        undefined,
        "Notes",
      )) as never,
    );
    expect(out).toContain("Sections: ## `Notes` + `Notes` (contains match for `Notes`)");
    expect(out).toContain("## Notes\nb");
  });

  // 🔒 **WAVE 4 a1 — THE WHOLE BODY, PLUS THE ADDRESSES FOR NEXT TIME.** A
  // sectionless read now asks for `headings`, which is the opposite trade from
  // `outline`: that one returns the map INSTEAD of the document, this one
  // returns it WITH the document, so no second call buys the heading names.
  it("no section argument reads the whole entry AND lists its headings", async () => {
    const readKbFilePart = vi
      .fn()
      .mockResolvedValue({ entry: entry({ body: "plain" }), outline: OUTLINE });
    const out = text(
      (await opReadFile(
        client({ readKbFilePart }),
        "my-base",
        "runbook.md",
        "u1",
      )) as never,
    );
    expect(readKbFilePart).toHaveBeenCalledWith("base-1", "runbook.md", {
      headings: true,
    });
    expect(out).toContain("plain");
    expect(out).not.toContain("Section:");
    expect(out).toContain("_Sections: # `Title` · ## `Setup` · ## `Errors`_");
  });

  // ⚠ **S32 / WAVE 4 a4.** On the Poor base, agents inferred "unsectioned"
  // only after receiving a wall of prose. The read now says so, with the
  // length, so the reader can decide to page instead of swallowing.
  it("says plainly when an entry has NO headings, and how long it is", async () => {
    const readKbFilePart = vi.fn().mockResolvedValue({
      entry: entry({ body: "z".repeat(3299) }),
      outline: { sections: [], totalChars: 3299 },
    });
    const out = text(
      (await opReadFile(
        client({ readKbFilePart }),
        "my-base",
        "runbook.md",
        "u1",
      )) as never,
    );
    expect(out).toContain("No headings; 3,299 chars whole");
    expect(out).toContain("offset=");
    expect(out).toContain("max_chars=");
  });

  // ⚠ §8 STALE-CACHE. No outline in the payload is a server that did NOT
  // measure, and "no headings" is a claim about the document rather than about
  // the response — so the line is omitted entirely rather than guessed.
  it("says nothing about headings when the payload carries no outline", async () => {
    const readKbFilePart = vi
      .fn()
      .mockResolvedValue({ entry: entry({ body: "plain" }) });
    const out = text(
      (await opReadFile(
        client({ readKbFilePart }),
        "my-base",
        "runbook.md",
        "u1",
      )) as never,
    );
    expect(out).toContain("plain");
    expect(out).not.toContain("No headings");
    expect(out).not.toContain("_Sections:");
  });

  it("offset renders a WINDOW that says so and names the resume point", async () => {
    const readKbFilePart = vi
      .fn()
      .mockResolvedValue({ entry: entry({ body: "0123456789" }) });
    const out = text(
      (await opReadFile(
        client({ readKbFilePart }),
        "my-base",
        "runbook.md",
        "u1",
        undefined,
        4,
        undefined,
        2,
      )) as never,
    );
    expect(out).toContain("⚠ WINDOW — characters 2–6 of 10");
    expect(out).toContain("Resume with offset=6");
    expect(out).toContain("2345");
  });

  // ⚠ The heading list rides a SECTION read too — the fix list asks for it on
  // "every read_file", and a reader that landed on the wrong heading needs the
  // others without paying for `outline`.
  it("lists the headings on a SECTION read as well", async () => {
    const readKbFilePart = vi.fn().mockResolvedValue({
      entry: entry({ body: "## Errors\nbody" }),
      outline: OUTLINE,
      section: { ok: true, heading: "Errors", level: 2, start: 852, end: 1492, chars: 640 },
    });
    const out = text(
      (await opReadFile(
        client({ readKbFilePart }),
        "my-base",
        "runbook.md",
        "u1",
        undefined,
        undefined,
        "Errors",
      )) as never,
    );
    expect(out).toContain("Section: ## `Errors`");
    expect(out).toContain("_Sections: # `Title` · ## `Setup` · ## `Errors`_");
  });
});

describe('write_file(section=…) and the nudge', () => {
  function writer(res: Record<string, unknown>) {
    const writeKbFileByPath = vi.fn().mockResolvedValue(res);
    return { writeKbFileByPath, client: client({ writeKbFileByPath }) };
  }

  it("threads `section` through and says the section was REPLACED", async () => {
    const w = writer({
      entry: entry({ body: "## A\nnew\n" }),
      outline: { sections: [{ heading: "A", level: 2, chars: 9, start: 0, line: 1 }], totalChars: 9 },
      sectionCreated: false,
    });
    const out = text(
      (await opWriteFile(w.client, "my-base", "r.md", "new\n", undefined, "v1", undefined, undefined, "A")) as never,
    );
    expect(w.writeKbFileByPath).toHaveBeenCalledWith(
      "base-1",
      "r.md",
      { body: "new\n", title: undefined, excerpt: undefined, section: "A" },
      "v1",
    );
    expect(out).toContain("Replaced section");
    expect(out).toContain("_Sections: ## `A`_");
  });

  it("says APPENDED when the heading did not exist", async () => {
    const w = writer({
      entry: entry({ body: "x\n\n## New\nc\n" }),
      outline: { sections: [{ heading: "New", level: 2, chars: 9, start: 3, line: 3 }], totalChars: 12 },
      sectionCreated: true,
    });
    const out = text(
      (await opWriteFile(w.client, "my-base", "r.md", "c\n", undefined, "v1", undefined, undefined, "New")) as never,
    );
    expect(out).toContain("APPENDED at `##` level");
  });

  // 🔒 **THE POLARITY FLIPPED ON 2026-09-18, AND IT IS SAMUEL'S RULING THAT
  // FLIPPED IT** (fix list Q1, option A: *"saves should be blocked if there's
  // no description? I think I agree with A"*). This case used to assert the
  // write LANDS with a nudge stapled to it; on the WHOLE-BODY path it is now
  // refused before anything is written. Wave 4 measured what the nudge bought:
  // nothing — 18,000 characters read to extract 900, on a base that had been
  // nudged eight times.
  it("a LONG unsectioned WHOLE-BODY write is refused before it lands", async () => {
    const long = "x".repeat(KB_SECTION_NUDGE_CHARS + 1);
    const w = writer({
      entry: entry({ body: long }),
      outline: { sections: [], totalChars: long.length },
    });
    const res = await opWriteFile(
      w.client,
      "my-base",
      "r.md",
      long,
      undefined,
      "v1",
      undefined,
      "the rota, and who covers a gap",
    );
    const out = text(res as never);
    expect(out).toContain("reason=UNSECTIONED");
    expect(out).toContain("retry=add");
    expect(w.writeKbFileByPath).not.toHaveBeenCalled();
  });

  // ⚠ **THE `section=` PATH STILL NUDGES**, because `body` there is one
  // section's new content and the merged body is the server's — the first
  // place its length is known is the RESULT.
  it("the same length on a SECTION write lands, with the reason LEADING", async () => {
    const long = "x".repeat(KB_SECTION_NUDGE_CHARS + 1);
    const w = writer({
      entry: entry({ body: long }),
      outline: { sections: [], totalChars: long.length },
      sectionCreated: false,
    });
    const res = await opWriteFile(
      w.client,
      "my-base",
      "r.md",
      long,
      undefined,
      "v1",
      undefined,
      undefined,
      "A",
    );
    expect(res.isError).toBeFalsy();
    const out = text(res as never);
    expect(out.startsWith("reason=UNSECTIONED")).toBe(true);
    expect(out).toContain("retry=none");
    expect(out).toContain("Wrote");
  });

  it("a SHORT unsectioned body is not nudged", async () => {
    const w = writer({ entry: entry({ body: "short" }), outline: { sections: [], totalChars: 5 } });
    const out = text((await opWriteFile(w.client, "my-base", "r.md", "short", undefined, "v1")) as never);
    expect(out).not.toContain("UNSECTIONED");
  });

  it("a long body WITH headings is not nudged", async () => {
    const long = "## A\n" + "x".repeat(KB_SECTION_NUDGE_CHARS);
    const w = writer({
      entry: entry({ body: long }),
      outline: { sections: [{ heading: "A", level: 2, chars: long.length, start: 0, line: 1 }], totalChars: long.length },
    });
    const out = text((await opWriteFile(w.client, "my-base", "r.md", long, undefined, "v1")) as never);
    expect(out).not.toContain("UNSECTIONED");
    expect(out).toContain("_Sections: ## `A`_");
  });
});
