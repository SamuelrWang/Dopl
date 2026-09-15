/**
 * 🔒 **A SLUG THAT NAMES TWO CONTAINERS IS REFUSED, NOT PICKED (F-701).**
 *
 * ⚠ **THE DEFECT THIS PINS, AND IT COST TEN DAYS OF WRITES.**
 * `knowledge-shared.ts › resolveBase` took `Array.find` over `listKbBases()`,
 * which answers for the bound container PLUS the caller's own personal shelf.
 * `knowledge_bases` is unique on `(workspace_id, slug)` — PER CONTAINER — so one
 * slug legitimately names several rows, and FIRST WON, silently. On 2026-09-05
 * three live bases shared `dopl-development`; the row `.find` reached was an
 * empty shell in the personal container, and `get_tree` answered "0 folders, 0
 * entries" for ten days while the real base filled up elsewhere
 * (`KB-LOSS-TRACE.md`). Nothing was ever deleted.
 *
 * ⚠ **WHY A SILENT PICK IS THE WORST OF THE OPTIONS.** It cannot be diagnosed
 * from its own answer: an empty tree is exactly what an empty base looks like.
 * Every tie-break is wrong in the same way — "newest wins" picks the same empty
 * shell, "bound container wins" is the rule a caller holding a personal-shelf
 * slug is already violating — so the resolver lists and refuses, the shape
 * `agent-shared.ts › ambiguousTemplate` already uses for template names.
 *
 * ⚠ **THE BY-ID LANE IS THE ESCAPE HATCH AND IT IS ASSERTED UNCHANGED HERE.**
 * An id is unique workspace-wide, so it can never be ambiguous; the F-470 suite
 * (`knowledge-base-id-lane.test.ts`) owns the rest of that lane and the two must
 * move together.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient, KnowledgeBase, KnowledgeEntry } from "@dopl/client";
import { opReadFile, opGetTree } from "./knowledge-ops-read.js";
import { opWriteFile } from "./knowledge-ops-write.js";

const SLUG = "dopl-development";

function base(over: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    workspaceId: "ws-1",
    name: "Dopl Development",
    slug: SLUG,
    publicId: "pub-1",
    description: null,
    agentWriteEnabled: true,
    visibility: "private",
    createdBy: "u1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: null,
    ...over,
  } as KnowledgeBase;
}

/** The empty shell in the caller's PERSONAL container — the row that won. */
const SHELL = base({
  id: "7f943a28-ecc3-4e66-bc15-1e4d55d453b6",
  workspaceId: "ws-personal",
});

/** The real base, in a home channel's container, where the writes went. */
const REAL = base({
  id: "6e77d236-a594-4b30-96b6-63b8dbbfcb09",
  workspaceId: "ws-mcc",
});

const ENTRY: KnowledgeEntry = {
  id: "e1",
  workspaceId: "ws-mcc",
  knowledgeBaseId: REAL.id,
  folderId: null,
  title: "Dopl change log",
  excerpt: null,
  body: "the log",
  entryType: "note",
  position: 0,
  createdBy: "u1",
  lastEditedBy: null,
  lastEditedSource: "agent",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  deletedAt: null,
};

const textOf = (res: { content: Array<{ text: string }> }) =>
  res.content.map((c) => c.text).join("\n");

/** Entry totals keyed by base id, so a count in the refusal is a real read. */
const TOTALS: Record<string, number> = { [SHELL.id]: 0, [REAL.id]: 4 };

function clientFor(over: Partial<Record<string, unknown>> = {}) {
  return {
    listKbBases: vi.fn(async () => [SHELL, REAL]),
    listKbBasesPayload: vi.fn(async () => ({
      bases: [SHELL, REAL],
      homeScopedBaseIds: [SHELL.id],
    })),
    getKbBase: vi.fn(async (id: string) =>
      [SHELL, REAL].find((b) => b.id === id)
    ),
    getKbTree: vi.fn(async (id: string) => ({
      base: [SHELL, REAL].find((b) => b.id === id) ?? REAL,
      folders: [],
      entries: id === REAL.id ? [ENTRY] : [],
      entryTotal: TOTALS[id] ?? 0,
    })),
    readKbFileByPath: vi.fn(async () => ENTRY),
    writeKbFileByPath: vi.fn(async () => ({ entry: ENTRY, created: false })),
    ...over,
  } as unknown as DoplClient;
}

describe("🔒 an ambiguous slug is refused rather than resolved", () => {
  it("refuses with the named code and reads NOTHING", async () => {
    // ⚠ MUTATION CHECK. Restore `Array.find` and this call succeeds against the
    // empty shell — which is the whole incident.
    const client = clientFor();
    const res = await opReadFile(client, SLUG, "change-log.md");
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("reason=ambiguous_slug");
    expect(client.readKbFileByPath).not.toHaveBeenCalled();
  });

  it("LISTS every match with its id, container and entry count", async () => {
    // ⚠ The list is the whole value of the refusal: "ambiguous" alone sends the
    // agent back to list_bases for ids it was already holding. The COUNT is
    // what says, in one line, which of the two is the empty one.
    const client = clientFor();
    const text = textOf(await opGetTree(client, SLUG));
    expect(text).toContain(SHELL.id);
    expect(text).toContain(REAL.id);
    expect(text).toContain("ws-personal");
    expect(text).toContain("ws-mcc");
    expect(text).toContain("0 entries");
    expect(text).toContain("4 entries");
  });

  it("labels the caller's own personal container", async () => {
    const client = clientFor();
    expect(textOf(await opGetTree(client, SLUG))).toContain(
      "your personal container"
    );
  });

  it("refuses a WRITE too, before anything is written", async () => {
    const client = clientFor();
    const res = await opWriteFile(client, SLUG, "change-log.md", "new body");
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("reason=ambiguous_slug");
    expect(client.writeKbFileByPath).not.toHaveBeenCalled();
  });

  it("🔒 an ID still resolves, even while its slug is ambiguous", async () => {
    // The escape hatch the refusal points at. An id is unique workspace-wide,
    // so this arm can never be ambiguous — and a refusal that left the caller
    // no way through would just be the outage it replaced.
    const client = clientFor();
    const res = await opReadFile(client, REAL.id, "change-log.md");
    expect(res.isError).toBeFalsy();
    expect(client.readKbFileByPath).toHaveBeenCalledWith(REAL.id, "change-log.md");
  });

  it("🔒 matches an id whatever its SHAPE, not just a UUID", async () => {
    // ⚠ REGRESSION PIN, and it caught a real one during this change: gating the
    // id arm on UUID_RE made every non-UUID id unresolvable, which broke the
    // `set_visibility` confirm flow wholesale (`acknowledge-shared.test.ts`).
    // What makes the arm safe is UNIQUENESS, not shape.
    const odd = base({ id: "kb-1", workspaceId: "ws-1", slug: "other" });
    const client = clientFor({ listKbBases: vi.fn(async () => [odd, REAL]) });
    const res = await opReadFile(client, "kb-1", "x.md");
    expect(res.isError).toBeFalsy();
    expect(client.readKbFileByPath).toHaveBeenCalledWith("kb-1", "x.md");
  });

  it("resolves normally when the slug names exactly ONE base", async () => {
    // ⚠ The happy path is untouched: one match is an answer, not an ambiguity.
    const client = clientFor({ listKbBases: vi.fn(async () => [REAL]) });
    const res = await opReadFile(client, SLUG, "change-log.md");
    expect(res.isError).toBeFalsy();
  });

  it("still answers base_not_found when the slug names NOTHING", async () => {
    const client = clientFor({ listKbBases: vi.fn(async () => []) });
    const res = await opReadFile(client, "no-such-base", "x.md");
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("base_not_found");
  });
});

describe("the refusal degrades rather than failing", () => {
  it("omits a count it cannot read, and never throws", async () => {
    // ⚠ This is already the error path. An exception here would replace a
    // precise refusal with a stack trace, which is strictly worse than a
    // refusal missing one number.
    const client = clientFor({
      getKbTree: vi.fn(async () => {
        throw new Error("socket hang up");
      }),
    });
    const res = await opGetTree(client, SLUG);
    expect(res.isError).toBe(true);
    const text = textOf(res);
    expect(text).toContain("reason=ambiguous_slug");
    expect(text).toContain("entry count unavailable");
    expect(text).toContain(SHELL.id);
  });

  it("refuses without the shelf label when the sibling key is absent", async () => {
    // ⚠ INVARIANTS §8: an older server sends no `homeScopedBaseIds`, and absent
    // is NO LABEL — never "not personal", never "personal".
    const client = clientFor({
      listKbBasesPayload: vi.fn(async () => ({ bases: [SHELL, REAL] })),
    });
    const text = textOf(await opGetTree(client, SLUG));
    expect(text).toContain("reason=ambiguous_slug");
    expect(text).not.toContain("your personal container");
    expect(text).toContain("container `ws-personal`");
  });

  it("caps the list and says how many it did not print", async () => {
    const many = Array.from({ length: 13 }, (_, i) =>
      base({ id: `id-${i}`, workspaceId: `ws-${i}` })
    );
    const client = clientFor({ listKbBases: vi.fn(async () => many) });
    const text = textOf(await opGetTree(client, SLUG));
    expect(text).toContain("…and 3 more");
  });
});
