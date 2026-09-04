/**
 * **HEADINGS AS ADDRESSES, AT THE AGENT SURFACE** (2026-09-03).
 *
 * ⚠ What is proved here is what an AGENT SEES, not what the parser does — the
 * split has its own suite in `src/shared/knowledge/markdown-sections.test.ts`
 * and does not run in this package at all. Every assertion below is about a
 * rendered string: does the miss carry the outline (so the retry is free), does
 * the nudge LEAD (so it is read), does the pin state its per-launch cost, and
 * does a refused pin leave nothing behind.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient, KnowledgeBase, KnowledgeEntry } from "@dopl/client";
import { opOutline, opReadFile } from "./knowledge-ops-read.js";
import { opWriteFile } from "./knowledge-ops-write.js";
import { opPin } from "./knowledge-ops-pin.js";
import { KB_PIN_MAX_CHARS, KB_SECTION_NUDGE_CHARS } from "./knowledge-sections.js";

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

  it("an ambiguous heading names both lines and refuses to guess", async () => {
    const readKbFilePart = vi.fn().mockResolvedValue({
      entry: entry({ body: "" }),
      outline: OUTLINE,
      section: {
        ok: false,
        reason: "SECTION_AMBIGUOUS",
        matches: [
          { heading: "Notes", level: 2, chars: 10, start: 0, line: 1 },
          { heading: "Notes", level: 2, chars: 10, start: 90, line: 12 },
        ],
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
    expect(out).toContain("reason=SECTION_AMBIGUOUS");
    expect(out).toContain("line 1");
    expect(out).toContain("line 12");
  });

  it("no section argument makes the plain whole-entry read, untouched", async () => {
    const readKbFileByPath = vi.fn().mockResolvedValue(entry({ body: "plain" }));
    const readKbFilePart = vi.fn();
    const out = text(
      (await opReadFile(
        client({ readKbFileByPath, readKbFilePart }),
        "my-base",
        "runbook.md",
        "u1",
      )) as never,
    );
    expect(readKbFilePart).not.toHaveBeenCalled();
    expect(out).toContain("plain");
    expect(out).not.toContain("Section:");
  });

  it("offset renders a WINDOW that says so and names the resume point", async () => {
    const readKbFileByPath = vi.fn().mockResolvedValue(entry({ body: "0123456789" }));
    const out = text(
      (await opReadFile(
        client({ readKbFileByPath }),
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

  it("a LONG unsectioned body lands, and the reason LEADS the result", async () => {
    const long = "x".repeat(KB_SECTION_NUDGE_CHARS + 1);
    const w = writer({
      entry: entry({ body: long }),
      outline: { sections: [], totalChars: long.length },
    });
    const res = await opWriteFile(w.client, "my-base", "r.md", long, undefined, "v1");
    // ⚠ LANDS. Never refuses (Samuel's ruling) — the entry it would refuse is
    // the entry the user wanted.
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

describe("the pin ceiling", () => {
  function pinClient(pinnedChars: number[], over: Record<string, unknown> = {}) {
    const seq = [...pinnedChars];
    return client({
      getKbStartupContext: vi.fn(async () => ({
        items: [],
        omitted: [],
        chars: 0,
        pinnedChars: seq.shift() ?? 0,
        truncated: false,
      })),
      setKbBasePinned: vi.fn().mockResolvedValue(undefined),
      setKbEntryPinned: vi.fn().mockResolvedValue(undefined),
      readKbFilePart: vi.fn().mockResolvedValue({ entry: entry(), outline: OUTLINE }),
      ...over,
    });
  }

  it("a small pin says nothing about size", async () => {
    const out = text((await opPin(pinClient([100, 900]), "my-base", undefined, true)) as never);
    expect(out).not.toContain("PIN_LARGE");
    expect(out).toContain("Pinned knowledge base");
  });

  it("past the warn cap the pin LANDS and states the per-launch cost", async () => {
    const res = await opPin(pinClient([3_000, 5_500]), "my-base", undefined, true);
    expect(res.isError).toBeFalsy();
    const out = text(res as never);
    expect(out.startsWith("reason=PIN_LARGE")).toBe(true);
    expect(out).toContain("EVERY agent session launched in this workspace");
    expect(out).toContain("retry=none, the pin landed");
    expect(out).toContain("Pinned knowledge base");
  });

  it("past the max cap the pin is REVERTED and refused", async () => {
    const setKbBasePinned = vi.fn().mockResolvedValue(undefined);
    const c = pinClient([5_000, KB_PIN_MAX_CHARS + 1], { setKbBasePinned });
    const res = await opPin(c, "my-base", undefined, true);
    expect(res.isError).toBe(true);
    expect(setKbBasePinned).toHaveBeenNthCalledWith(1, "base-1", true);
    expect(setKbBasePinned).toHaveBeenNthCalledWith(2, "base-1", false);
    const out = text(res as never);
    expect(out).toContain("REFUSED and REVERTED");
    expect(out).toContain("Pin ONE entry instead");
  });

  it("an over-cap ENTRY pin is refused with that entry's outline", async () => {
    const res = await opPin(
      pinClient([5_000, KB_PIN_MAX_CHARS + 1]),
      "my-base",
      "runbook.md",
      true,
    );
    expect(res.isError).toBe(true);
    const out = text(res as never);
    expect(out).toContain("## `Setup` · 812");
    expect(out).toContain("no way to pin ONE section");
  });

  it("re-pinning something already pinned is never reverted", async () => {
    // ⚠ `after <= before` means the write changed nothing, so undoing it would
    // UN-pin what the caller asked to pin.
    const setKbBasePinned = vi.fn().mockResolvedValue(undefined);
    const c = pinClient([KB_PIN_MAX_CHARS + 5, KB_PIN_MAX_CHARS + 5], { setKbBasePinned });
    const res = await opPin(c, "my-base", undefined, true);
    expect(res.isError).toBeFalsy();
    expect(setKbBasePinned).toHaveBeenCalledTimes(1);
    expect(text(res as never)).toContain("PIN_LARGE");
  });

  it("an UNPIN is never measured — it can only shrink the payload", async () => {
    const getKbStartupContext = vi.fn();
    const c = pinClient([], { getKbStartupContext });
    const out = text((await opPin(c, "my-base", undefined, false)) as never);
    expect(getKbStartupContext).not.toHaveBeenCalled();
    expect(out).toContain("Unpinned knowledge base");
  });

  it("a measurement that THROWS never fails the pin", async () => {
    const c = pinClient([], {
      getKbStartupContext: vi.fn().mockRejectedValue(new Error("offline")),
    });
    const res = await opPin(c, "my-base", undefined, true);
    expect(res.isError).toBeFalsy();
    expect(text(res as never)).toContain("Pinned knowledge base");
  });
});
