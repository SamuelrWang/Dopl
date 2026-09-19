/**
 * The `dopl_kb` write rules at the AGENT SURFACE — split out of
 * `knowledge-ops.test.ts` for the 500-line cap (2026-09-18).
 *
 * ⚠ What is proved here is what an AGENT SEES: which saves are REFUSED before
 * anything is written, which land with a nudge, and — the case that is easiest
 * to get wrong — which are left alone because the rule could not be measured.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient, KnowledgeBase, KnowledgeEntry } from "@dopl/client";
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

/**
 * 🔒 **THE WRITE RULES, AS SAMUEL RULED THEM** (2026-09-18, option A on the fix
 * list's Q1: *"are you saying that saves should be blocked if there's no
 * description? I think I agree with A"*). Two REFUSE an agent's save; two nudge
 * a write that landed. A human typing in the app is never blocked, and nothing
 * in this package can reach a person — which is why the refusals live here.
 */
describe("write_file REFUSES a save with no real summary", () => {
  function refusingClient(write = vi.fn()) {
    return {
      listKbBases: vi.fn().mockResolvedValue([BASE]),
      writeKbFileByPath: write,
      // 404 = the entry does not exist, so there is no stored excerpt to
      // inherit and the refusal stands.
      readKbFileByPath: vi.fn().mockRejectedValue({ status: 404 }),
    } as unknown as DoplClient;
  }

  it("refuses a one-word excerpt and writes NOTHING", async () => {
    const write = vi.fn();
    const out = textOf(
      await opWriteFile(
        refusingClient(write),
        "my-base",
        "Fuel",
        "body",
        undefined,
        undefined,
        undefined,
        "Fuel.",
      ),
    );
    expect(out).toContain("reason=EXCERPT_TOO_THIN");
    expect(out).toContain("retry=");
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses an excerpt that only restates the title", async () => {
    const write = vi.fn();
    const out = textOf(
      await opWriteFile(
        refusingClient(write),
        "my-base",
        "Customer Tier Definitions",
        "body",
        undefined,
        undefined,
        undefined,
        "customer tier definitions",
      ),
    );
    expect(out).toContain("reason=EXCERPT_RESTATES_TITLE");
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses a create with no excerpt at all", async () => {
    const write = vi.fn();
    const out = textOf(
      await opWriteFile(refusingClient(write), "my-base", "Rates", "body"),
    );
    expect(out).toContain("reason=EXCERPT_REQUIRED");
    expect(write).not.toHaveBeenCalled();
  });

  // ⚠ **AN OMITTED `excerpt` PRESERVES THE STORED ONE**, so refusing every
  // omission would refuse the ordinary update of an entry that is already
  // summarised — including every `section=` write.
  it("allows an omitted excerpt when the stored one is real", async () => {
    const write = vi.fn().mockResolvedValue({
      entry: entry({ id: "e1", title: "Rates", body: "new body" }),
    });
    const client = {
      listKbBases: vi.fn().mockResolvedValue([BASE]),
      writeKbFileByPath: write,
      readKbFileByPath: vi
        .fn()
        .mockResolvedValue(
          entry({ id: "e1", title: "Rates", excerpt: "$3.18/gal base peg" }),
        ),
    } as unknown as DoplClient;

    await opWriteFile(client, "my-base", "Rates", "new body");
    expect(write).toHaveBeenCalled();
  });

  // ⚠ **THE PROBE FAILS OPEN, DELIBERATELY.** A rule this process could not
  // measure is not a rule it may assert — blocking a user's content on our own
  // transport error would be the worse error by far.
  it("does not block when the probe fails for any other reason", async () => {
    const write = vi.fn().mockResolvedValue({
      entry: entry({ id: "e1", title: "Rates", body: "b" }),
    });
    const client = {
      listKbBases: vi.fn().mockResolvedValue([BASE]),
      writeKbFileByPath: write,
      readKbFileByPath: vi.fn().mockRejectedValue({ status: 503 }),
    } as unknown as DoplClient;

    await opWriteFile(client, "my-base", "Rates", "b");
    expect(write).toHaveBeenCalled();
  });
});

describe("write_file REFUSES a long body with no headings", () => {
  it("refuses past ~1.5k chars, names the length, and writes NOTHING", async () => {
    const write = vi.fn();
    const client = {
      listKbBases: vi.fn().mockResolvedValue([BASE]),
      writeKbFileByPath: write,
    } as unknown as DoplClient;

    const out = textOf(
      await opWriteFile(
        client,
        "my-base",
        "Policy",
        "prose ".repeat(400),
        undefined,
        undefined,
        undefined,
        "the refund ladder, stated in full",
      ),
    );
    expect(out).toContain("reason=UNSECTIONED");
    expect(out).toContain("retry=");
    expect(write).not.toHaveBeenCalled();
  });

  it("passes the same length once it carries ## headings", async () => {
    const write = vi.fn().mockResolvedValue({
      entry: entry({ id: "e1", title: "Policy", body: "x" }),
      outline: { sections: [{ heading: "Ladder", level: 2, chars: 10, start: 0, line: 1 }], totalChars: 10 },
    });
    const client = {
      listKbBases: vi.fn().mockResolvedValue([BASE]),
      writeKbFileByPath: write,
    } as unknown as DoplClient;

    await opWriteFile(
      client,
      "my-base",
      "Policy",
      `## Ladder\n${"prose ".repeat(400)}`,
      undefined,
      undefined,
      undefined,
      "the refund ladder, stated in full",
    );
    expect(write).toHaveBeenCalled();
  });

  // ⚠ **NOT ON THE `section=` PATH**: `body` there is one section's new
  // content and the real body is the server's merge of it, so a length test
  // here would measure the wrong document. That path keeps the post-write
  // nudge, which measures what actually landed.
  it("does not refuse a sectioned write, which is nudged after the fact", async () => {
    const write = vi.fn().mockResolvedValue({
      entry: entry({ id: "e1", title: "Policy", body: "y".repeat(2000) }),
      outline: { sections: [], totalChars: 2000 },
    });
    const client = {
      listKbBases: vi.fn().mockResolvedValue([BASE]),
      writeKbFileByPath: write,
    } as unknown as DoplClient;

    const out = textOf(
      await opWriteFile(
        client,
        "my-base",
        "Policy",
        "prose ".repeat(400),
        undefined,
        "v1",
        undefined,
        "the refund ladder, stated in full",
        "Ladder",
      ),
    );
    expect(write).toHaveBeenCalled();
    expect(out).toContain("reason=UNSECTIONED");
    expect(out).toContain("retry=none");
  });
});

describe("write_file NUDGES pointers and supersession", () => {
  function landing(body: string) {
    const write = vi.fn().mockResolvedValue({
      entry: entry({ id: "e1", title: "Refunds", body }),
      outline: { sections: [{ heading: "A", level: 2, chars: 5, start: 0, line: 1 }], totalChars: 5 },
    });
    return {
      client: {
        listKbBases: vi.fn().mockResolvedValue([BASE]),
        writeKbFileByPath: write,
      } as unknown as DoplClient,
      write,
    };
  }

  // ⚠ Wave 4 b4 — hit all FOUR runs on N11. One agent's note: *"I had to guess
  // … I got lucky."*
  it("nudges a pointer that names no destination, and the write still lands", async () => {
    const { client, write } = landing("x");
    const out = textOf(
      await opWriteFile(
        client,
        "my-base",
        "Refunds",
        "The ladder follows the company approval ladder for non-travel spend.",
        undefined,
        undefined,
        undefined,
        "the refund ladder and who signs it off",
      ),
    );
    expect(out).toContain("reason=POINTER_WITHOUT_TARGET");
    expect(out).toContain("retry=none, the write landed");
    expect(write).toHaveBeenCalled();
  });

  it("stays silent once the body names a base/path anywhere", async () => {
    const { client } = landing("x");
    const out = textOf(
      await opWriteFile(
        client,
        "my-base",
        "Refunds",
        "See the ladder in people/Expense Policy.",
        undefined,
        undefined,
        undefined,
        "the refund ladder and who signs it off",
      ),
    );
    expect(out).not.toContain("POINTER_WITHOUT_TARGET");
  });

  // ⚠ Wave 4 b5 — the rule the trial proves ALREADY WORKS. Both Poor agents
  // skipped the 2024 decoy on the opening sentence alone. Position is the rule.
  it("passes a body that OPENS with the supersession marker", async () => {
    const { client } = landing("x");
    const out = textOf(
      await opWriteFile(
        client,
        "my-base",
        "Contract vs Spot Pricing Guidelines",
        "This replaces the 2024 Rate Policy in full.\n\n## Detail\nSee rates/2025 Rates.",
        undefined,
        undefined,
        undefined,
        "contract vs spot pricing, 2025 rules",
      ),
    );
    expect(out).not.toContain("SUPERSESSION_BURIED");
  });

  it("nudges a supersession marker buried below the first line", async () => {
    const { client } = landing("x");
    const out = textOf(
      await opWriteFile(
        client,
        "my-base",
        "Contract vs Spot Pricing Guidelines",
        "## Detail\nRates are set quarterly at rates/2025 Rates.\nThis supersedes the 2024 Rate Policy.",
        undefined,
        undefined,
        undefined,
        "contract vs spot pricing, 2025 rules",
      ),
    );
    expect(out).toContain("reason=SUPERSESSION_BURIED");
    expect(out).toContain("superseded entry's excerpt");
  });
});
