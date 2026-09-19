/**
 * **ERRORS THAT TEACH — `dopl_kb`'s refusals name the FIELD, the LIMIT, the
 * REASON and the RETRY** (Round 1 batch B: S52, S41, S43, S40, S53).
 *
 * ⚠ **EVERY ASSERTION HERE IS ABOUT THE CHARACTERS AN AGENT READS**, not about
 * control flow: the whole defect class this batch closes is a refusal that was
 * *correct* and *unusable* — a bare `VALIDATION_FAILED`, a 404 rethrown as a
 * transport error, a 412 whose remedy created a duplicate. So the tests grep
 * the rendered text for the four things a model can act on, and one of them
 * (`retry=`) is checked even where the answer is "no".
 *
 * ⚠ **AND FOR WHAT IS *NOT* SAID**: S52's own shape was a refusal that named
 * `excerpt` and then printed the TITLE rule, so the excerpt case asserts the
 * title sentence is ABSENT. A test that only checks the new words passes over
 * the exact bug.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient, KnowledgeBase, KnowledgeEntry } from "@dopl/client";
import { opOutline, opReadFile } from "./knowledge-ops-read.js";
import { opCreateFolder, opWriteFile } from "./knowledge-ops-write.js";
import { sessionRequired } from "./respond.js";

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
    title: "Entry",
    excerpt: null,
    body: "body",
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

/** An error shaped exactly as `@dopl/client › DoplApiError` reaches these
 *  mappers — duck-typed, because every mapper in the tree duck-types it. */
function apiError(status: number, code: string, details?: unknown, message = "x") {
  return Object.assign(new Error(message), {
    status,
    code,
    apiMessage: message,
    details,
  });
}

/** A zod-issue `details` array naming one field, as the route's 400 carries it. */
const issuesFor = (field: string) => [{ path: [field], message: "too_big" }];

function clientWith(over: Record<string, unknown>): DoplClient {
  return {
    listKbBases: vi.fn().mockResolvedValue([BASE]),
    ...over,
  } as unknown as DoplClient;
}

const textOf = (res: { content: Array<{ text: string }> }) =>
  res.content.map((c) => c.text).join("\n");

// ── S52 — a field over its cap names ITS OWN rule ───────────────────────────
describe("S52: the 300-char fields name the field, the number and their own rule", () => {
  it("a 301-char excerpt says field=excerpt limit=300 — and NOT the title rule", async () => {
    const res = await opWriteFile(
      clientWith({
        writeKbFileByPath: vi
          .fn()
          .mockRejectedValue(apiError(400, "VALIDATION_FAILED", issuesFor("excerpt"))),
      }),
      "my-base",
      "notes.md",
      "body",
      undefined,
      undefined,
      undefined,
      // ⚠ **A REAL SENTENCE, 303 CHARS** (integration, 2026-09-19). The fixture
      // was `"x".repeat(301)` — one word — and the agent-side authoring rule
      // that landed on a sibling branch refuses a one-word excerpt BEFORE the
      // write, so this case stopped reaching the server 400 it is about. The
      // rules run first by design; the fixture has to clear them to test the
      // mapper underneath.
      `${"a summary sentence ".repeat(16)}end`,
    );
    const out = textOf(res);
    expect(res.isError).toBe(true);
    expect(out).toContain("reason=field_too_long");
    expect(out).toContain("field=excerpt");
    expect(out).toContain("limit=300");
    expect(out).toContain("retry=");
    // 🔒 THE DEFECT ITSELF: the old mapper named the field and then printed the
    // TITLE rule, so an agent that shortened its title got the same answer twice.
    expect(out).not.toContain("Titles can't contain");
  });

  it("a 301-char section says field=section, not the excerpt's or the title's rule", async () => {
    const out = textOf(
      await opWriteFile(
        clientWith({
          writeKbFileByPath: vi
            .fn()
            .mockRejectedValue(apiError(400, "VALIDATION_FAILED", issuesFor("section"))),
        }),
        "my-base",
        "notes.md",
        "body",
        undefined,
        undefined,
        undefined,
        undefined,
        "x".repeat(301),
      ),
    );
    expect(out).toContain("field=section");
    expect(out).toContain("limit=300");
    expect(out).not.toContain("field=excerpt");
  });

  it("a 301-char folder description refuses by name instead of rethrowing raw", async () => {
    // ⚠ THE FOLDER HALF HAD NO MAPPER AT ALL — it rethrew, so the agent got
    // "the call failed" over a create that named its own cause.
    const res = await opCreateFolder(
      clientWith({
        createKbFolderByPath: vi
          .fn()
          .mockRejectedValue(
            apiError(400, "VALIDATION_FAILED", issuesFor("description")),
          ),
      }),
      "my-base",
      "projects",
      "x".repeat(301),
    );
    const out = textOf(res);
    expect(res.isError).toBe(true);
    expect(out).toContain("field=description");
    expect(out).toContain("limit=300");
    expect(out).toContain("Nothing was created");
  });
});

// ── S41 — the entry 404 is a refusal, and it says the entry may have moved ──
describe("S41: a missing path refuses with a reason, a retry and the MOVE caveat", () => {
  for (const [label, code] of [
    ["the leaf", "KNOWLEDGE_ENTRY_NOT_FOUND"],
    ["an intermediate folder", "KNOWLEDGE_PATH_NOT_FOUND"],
  ] as const) {
    it(`read_file maps ${label}'s 404`, async () => {
      // ⚠ **`readKbFilePart`, NOT `readKbFileByPath` (integration, 2026-09-19).**
      // The unsectioned lane routes through the part reader since the headings
      // work landed on a sibling branch — that is what lets ONE catch map the
      // 404 for both lanes, which is this case's whole subject.
      const res = await opReadFile(
        clientWith({
          readKbFilePart: vi.fn().mockRejectedValue(apiError(404, code)),
        }),
        "my-base",
        "gone/notes.md",
      );
      const out = textOf(res);
      expect(res.isError).toBe(true);
      expect(out).toContain("reason=entry_not_found");
      expect(out).toContain('retry=op="list_dir"');
      expect(out).toContain("may have moved");
    });
  }

  it("outline maps it too, and both point at the id that survives a move", async () => {
    const out = textOf(
      await opOutline(
        clientWith({
          readKbFilePart: vi
            .fn()
            .mockRejectedValue(apiError(404, "KNOWLEDGE_ENTRY_NOT_FOUND")),
        }),
        "my-base",
        "notes.md",
      ),
    );
    expect(out).toContain("reason=entry_not_found");
    expect(out).toContain("ENTRY ID");
  });

  it("🔒 anything that is not one of the two 404s still RETHROWS", async () => {
    // A catch that swallowed an outage would report it as a missing document.
    await expect(
      opReadFile(
        clientWith({
          readKbFilePart: vi.fn().mockRejectedValue(apiError(503, "UPSTREAM")),
        }),
        "my-base",
        "notes.md",
      ),
    ).rejects.toThrow();
  });
});

// ── S40 — the conflict names the move AND the duplicate risk ────────────────
describe("S40: a conflict warns that force=true at a vacated path DUPLICATES", () => {
  it("the 412 names the move, the upsert and list_dir", async () => {
    const out = textOf(
      await opWriteFile(
        clientWith({
          writeKbFileByPath: vi
            .fn()
            .mockRejectedValue(apiError(412, "KNOWLEDGE_STALE_VERSION")),
        }),
        "my-base",
        "notes.md",
        "body",
      ),
    );
    expect(out).toContain("reason=version_conflict");
    expect(out).toContain('retry=op="read_file"');
    expect(out).toContain("MOVED");
    expect(out).toContain("DUPLICATE");
  });

  it("a forced write at a vanished path refuses, and says NOT to force again", async () => {
    // ⚠ The server now refuses this (409 KNOWLEDGE_TARGET_VANISHED) even with no
    // precondition — `force` used to be the one input that skipped the guard.
    const res = await opWriteFile(
      clientWith({
        writeKbFileByPath: vi
          .fn()
          .mockRejectedValue(apiError(409, "KNOWLEDGE_TARGET_VANISHED")),
      }),
      "my-base",
      "notes.md",
      "body",
      undefined,
      undefined,
      true,
    );
    const out = textOf(res);
    expect(res.isError).toBe(true);
    expect(out).toContain("reason=target_vanished");
    expect(out).toContain("Do NOT re-issue this call with force=true");
    // 🔒 It must NOT be read as the title collision the other 409 means.
    expect(out).not.toContain("already exists in that folder");
  });
});

// ── S43 — an app-only route, answered as a refusal ─────────────────────────
// ⚠ **THE PIN VERBS WERE THIS HELPER'S ONLY CALLER, AND THEY ARE GONE**
// (integration, 2026-09-19 — Samuel's ruling deleted knowledge pinning). The
// helper is kept deliberately: `sessionOnly` is a cross-cutting wrapper option
// that the delete routes, `channel-grants` and the template delete all carry,
// so the next op to grow an arm gets this sentence rather than a second
// wording of it. It is therefore tested DIRECTLY, against the error shape the
// wrapper actually answers — a test that went through a removed op would have
// gone with it, leaving the sentence unasserted.
describe("S43: an app-only route refuses with reason=session_required retry=no", () => {
  it("names the op, says nothing changed, and closes the door", () => {
    const res = sessionRequired(apiError(403, "SESSION_REQUIRED"), "delete_base");
    expect(res).not.toBeNull();
    const out = textOf(res!);
    expect(res!.isError).toBe(true);
    expect(out).toContain("reason=session_required");
    expect(out).toContain("retry=no");
    expect(out).toContain('op="delete_base"');
    expect(out).toContain("NOTHING changed");
  });

  it("is null for any other error, so the caller rethrows", () => {
    expect(sessionRequired(apiError(403, "AGENT_WRITE_DISABLED"), "x")).toBeNull();
    expect(sessionRequired(apiError(409, "SESSION_REQUIRED"), "x")).toBeNull();
  });
});

// ── S53 — a converged write says it wrote nothing, and is not an error ──────
describe("S53: client_write_id converges instead of writing twice", () => {
  it("threads the key into the write input", async () => {
    const write = vi.fn().mockResolvedValue({ entry: entry() });
    await opWriteFile(
      clientWith({ writeKbFileByPath: write }),
      "my-base",
      "notes.md",
      "body",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "key-1",
    );
    expect(write).toHaveBeenCalledWith(
      "base-1",
      "notes.md",
      expect.objectContaining({ clientWriteId: "key-1" }),
      undefined,
    );
  });

  it("a converged result SAYS this call wrote nothing — with retry=none, not an error", async () => {
    const res = await opWriteFile(
      clientWith({
        writeKbFileByPath: vi
          .fn()
          .mockResolvedValue({ entry: entry({ body: "first write" }), converged: true }),
      }),
      "my-base",
      "notes.md",
      "second write",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "key-1",
    );
    const out = textOf(res);
    // ⚠ NOT an error: the write LANDED, just not on this call. An `isError`
    // here would make a retrying client retry a call that can only converge again.
    expect(res.isError).toBeUndefined();
    expect(out).toContain("reason=converged");
    expect(out).toContain("retry=none");
    expect(out).toContain("wrote NOTHING");
  });

  it("⚠ §8 stale payload: no `converged` key reads as 'this call wrote'", async () => {
    // An older server sends no such key. Absent must mean the pre-field
    // behaviour, never "converged" and never a crash.
    const out = textOf(
      await opWriteFile(
        clientWith({
          writeKbFileByPath: vi.fn().mockResolvedValue({ entry: entry() }),
        }),
        "my-base",
        "notes.md",
        "body",
      ),
    );
    expect(out).not.toContain("reason=converged");
    expect(out).toContain("Wrote");
  });
});
