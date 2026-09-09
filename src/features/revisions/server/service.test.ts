/**
 * THE HISTORY PRIMITIVE'S THREE LOAD-BEARING RULES.
 *
 *   1. **THE APPEND IS AWAITED AND ITS FAILURE SURFACES.** A lost revision is a
 *      lost audit, so a write whose revision could not be recorded is reported
 *      as failed — never `void`-ed, never swallowed.
 *   2. **THE HUMAN COALESCING WINDOW.** Consecutive human `edit`s inside five
 *      minutes REPLACE one row; the window closes on time, on a different
 *      person, on a different op, and on an agent write.
 *   3. **RESTORE IS A NEW ROW.** Nothing here rewrites the source revision or
 *      anything between it and now, and the write goes through the RESOURCE's
 *      own service rather than a repository.
 *
 * ⚠ **MUTATION-VERIFIED — five reverts, five failures**, each named at the test
 * it turns red:
 *   • `await repo.appendRevision(...)` → `void repo.appendRevision(...)`
 *     ("surfaces the repository's failure to the caller").
 *   • the `actor.kind === "user"` guard dropped
 *     ("🔒 an AGENT write never coalesces — with a human's open row").
 *   • `age < COALESCE_WINDOW_MS` → `<=` on a stale row, i.e. the window measured
 *     from `updatedAt` ("seals at the window and starts a new row").
 *   • the `latest.actor.userId !== actor.userId` guard dropped
 *     ("a SECOND PERSON never joins the first's open row").
 *   • `restoreRevision` writing through the repository instead of the injected
 *     writer ("writes THROUGH the resource's own service, never a repository").
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Revision } from "../types";

vi.mock("./repository", () => ({
  appendRevision: vi.fn(),
  replaceRevisionSnapshot: vi.fn(),
  findLatestRevision: vi.fn(),
  findRevisionById: vi.fn(),
  listRevisionsForResource: vi.fn(),
  listRevisionsForResources: vi.fn(),
}));

import * as repo from "./repository";
import { RevisionNotFoundError, RevisionNotRestorableError } from "./errors";
import {
  COALESCE_WINDOW_MS,
  contentHashOf,
  deriveActor,
  encodeCursor,
  listRevisions,
  recordRevision,
  restoreRevision,
  restoreSummary,
} from "./service";
import { revisionReach } from "./service-shared";

const mockRepo = vi.mocked(repo);

const RESOURCE = {
  resourceType: "knowledge_entry" as const,
  resourceId: "e-1",
  workspaceId: "ws-1",
};

function rev(over: Partial<Revision> = {}): Revision {
  return {
    id: "rev-1",
    resourceType: "knowledge_entry",
    resourceId: "e-1",
    workspaceId: "ws-1",
    actor: { userId: "u-me", kind: "user", agentSessionId: null },
    op: "edit",
    summary: null,
    payload: { body: "one" },
    contentHash: "h",
    createdAt: "2026-09-09T12:00:00.000Z",
    updatedAt: "2026-09-09T12:00:00.000Z",
    ...over,
  };
}

const REACH = revisionReach([
  { resourceType: "knowledge_entry", resourceId: "e-1" },
]);

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.findLatestRevision.mockResolvedValue(null);
  mockRepo.appendRevision.mockImplementation(async (args) => rev({ ...args } as never));
  mockRepo.replaceRevisionSnapshot.mockImplementation(async (id) => rev({ id }));
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── 1. The append ──────────────────────────────────────────────────

describe("recordRevision — the append", () => {
  it("surfaces the repository's failure to the caller", async () => {
    // ⚠ THE MUTATION: `void repo.appendRevision(...)` makes this resolve, and
    // the write it was recording is reported as a success with no audit row.
    mockRepo.appendRevision.mockRejectedValue(new Error("insert failed"));
    await expect(
      recordRevision({ userId: "u-me" }, { ...RESOURCE, op: "create", payload: {} })
    ).rejects.toThrow("insert failed");
  });

  it("files the row under the RESOURCE's container and hashes the snapshot", async () => {
    await recordRevision(
      { userId: "u-me" },
      { ...RESOURCE, op: "create", payload: { body: "hi", title: "T" } }
    );
    const args = mockRepo.appendRevision.mock.calls[0][0];
    expect(args.workspaceId).toBe("ws-1");
    expect(args.actorKind).toBe("user");
    expect(args.contentHash).toBe(contentHashOf({ body: "hi", title: "T" }));
  });

  it("hashes by VALUE — key order in the literal is not part of the snapshot", () => {
    expect(contentHashOf({ body: "a", title: "b" })).toBe(
      contentHashOf({ title: "b", body: "a" })
    );
    expect(contentHashOf({ body: "a" })).not.toBe(contentHashOf({ body: "b" }));
  });
});

describe("deriveActor", () => {
  it("reads `source` when present — the derivation made one layer up wins", () => {
    expect(deriveActor({ userId: "u", source: "agent", sessionId: "s" })).toEqual({
      userId: "u",
      kind: "agent",
      agentSessionId: "s",
    });
  });

  it("falls back to `agentTokenId` for a raw auth context", () => {
    expect(deriveActor({ userId: "u", agentTokenId: "t", sessionId: "s" }).kind).toBe(
      "agent"
    );
  });

  it("🔒 never stamps a HUMAN's desktop session into `agent_session_id`", () => {
    // A person on the desktop sends the same header; labelling their edit with
    // it would make every renderer that groups by session read it as an agent's.
    expect(deriveActor({ userId: "u", source: "user", sessionId: "s" })).toEqual({
      userId: "u",
      kind: "user",
      agentSessionId: null,
    });
  });
});

// ─── 2. The coalescing window ───────────────────────────────────────

describe("recordRevision — the human coalescing window", () => {
  const OPENED_AT = new Date("2026-09-09T12:00:00.000Z");

  function openRow(over: Partial<Revision> = {}) {
    mockRepo.findLatestRevision.mockResolvedValue(
      rev({ createdAt: OPENED_AT.toISOString(), ...over })
    );
  }

  async function edit(ctx: Parameters<typeof recordRevision>[0], body: string) {
    return recordRevision(ctx, { ...RESOURCE, op: "edit", payload: { body } });
  }

  it("two human edits four minutes apart are ONE row", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(OPENED_AT.getTime() + 4 * 60_000));
    openRow();
    await edit({ userId: "u-me", source: "user" }, "two");
    expect(mockRepo.replaceRevisionSnapshot).toHaveBeenCalledTimes(1);
    expect(mockRepo.appendRevision).not.toHaveBeenCalled();
  });

  it("the replace keeps `created_at` — only the snapshot and `updated_at` move", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(OPENED_AT.getTime() + 60_000));
    openRow();
    await edit({ userId: "u-me", source: "user" }, "two");
    const [id, patch] = mockRepo.replaceRevisionSnapshot.mock.calls[0];
    expect(id).toBe("rev-1");
    expect(patch.payload).toEqual({ body: "two" });
    expect(Object.keys(patch)).not.toContain("createdAt");
  });

  it("seals at the window and starts a new row six minutes later", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(OPENED_AT.getTime() + 6 * 60_000));
    openRow();
    await edit({ userId: "u-me", source: "user" }, "two");
    expect(mockRepo.appendRevision).toHaveBeenCalledTimes(1);
    expect(mockRepo.replaceRevisionSnapshot).not.toHaveBeenCalled();
  });

  it("the boundary has ONE reading — exactly at the window a new row starts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(OPENED_AT.getTime() + COALESCE_WINDOW_MS));
    openRow();
    await edit({ userId: "u-me", source: "user" }, "two");
    expect(mockRepo.appendRevision).toHaveBeenCalledTimes(1);
  });

  it("🔒 an AGENT write never coalesces — with a human's open row", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(OPENED_AT.getTime() + 60_000));
    openRow();
    await edit({ userId: "u-me", source: "agent", sessionId: "sess-1" }, "agent body");
    expect(mockRepo.appendRevision).toHaveBeenCalledTimes(1);
    expect(mockRepo.replaceRevisionSnapshot).not.toHaveBeenCalled();
  });

  it("🔒 an AGENT write never coalesces — with its OWN open row either", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(OPENED_AT.getTime() + 60_000));
    openRow({ actor: { userId: "u-me", kind: "agent", agentSessionId: "sess-1" } });
    await edit({ userId: "u-me", source: "agent", sessionId: "sess-1" }, "again");
    expect(mockRepo.appendRevision).toHaveBeenCalledTimes(1);
  });

  it("🔒 a SECOND PERSON never joins the first's open row", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(OPENED_AT.getTime() + 60_000));
    openRow();
    await edit({ userId: "u-other", source: "user" }, "mine");
    expect(mockRepo.appendRevision).toHaveBeenCalledTimes(1);
  });

  it("a DIFFERENT op inside the window starts a new row", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(OPENED_AT.getTime() + 60_000));
    openRow();
    await recordRevision(
      { userId: "u-me", source: "user" },
      { ...RESOURCE, op: "rename", payload: { title: "New" } }
    );
    expect(mockRepo.appendRevision).toHaveBeenCalledTimes(1);
  });

  it("an open row of a DIFFERENT op is not joined by an edit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(OPENED_AT.getTime() + 60_000));
    openRow({ op: "rename" });
    await edit({ userId: "u-me", source: "user" }, "two");
    expect(mockRepo.appendRevision).toHaveBeenCalledTimes(1);
  });

  it("the three-write sequence Samuel asked for: human, agent, human ⇒ 3 rows", async () => {
    vi.useFakeTimers();
    // ⚠ The agent write in the middle CLOSES the person's window, so the human
    // edit after it opens a third row rather than re-joining the first.
    vi.setSystemTime(OPENED_AT);
    mockRepo.findLatestRevision.mockResolvedValue(null);
    await edit({ userId: "u-me", source: "user" }, "one");

    vi.setSystemTime(new Date(OPENED_AT.getTime() + 60_000));
    mockRepo.findLatestRevision.mockResolvedValue(
      rev({ createdAt: OPENED_AT.toISOString() })
    );
    await edit({ userId: "u-me", source: "agent", sessionId: "s" }, "agent");

    vi.setSystemTime(new Date(OPENED_AT.getTime() + 120_000));
    mockRepo.findLatestRevision.mockResolvedValue(
      rev({
        id: "rev-2",
        createdAt: new Date(OPENED_AT.getTime() + 60_000).toISOString(),
        actor: { userId: "u-me", kind: "agent", agentSessionId: "s" },
      })
    );
    await edit({ userId: "u-me", source: "user" }, "three");

    expect(mockRepo.appendRevision).toHaveBeenCalledTimes(3);
    expect(mockRepo.replaceRevisionSnapshot).not.toHaveBeenCalled();
  });
});

// ─── 3. Paging ──────────────────────────────────────────────────────

describe("listRevisions — keyset paging", () => {
  function page(n: number): Revision[] {
    return Array.from({ length: n }, (_, i) =>
      rev({ id: `rev-${i}`, createdAt: `2026-09-0${9 - (i % 9)}T12:00:00.000Z` })
    );
  }

  it("asks for one MORE than the limit, so 'is there another page' is knowable", async () => {
    mockRepo.listRevisionsForResource.mockResolvedValue(page(3));
    await listRevisions(RESOURCE, REACH, { limit: 3 });
    expect(mockRepo.listRevisionsForResource.mock.calls[0][2].limit).toBe(4);
  });

  it("trims the probe row and mints a cursor when more exist", async () => {
    const rows = page(4);
    mockRepo.listRevisionsForResource.mockResolvedValue(rows);
    const result = await listRevisions(RESOURCE, REACH, { limit: 3 });
    expect(result.revisions).toHaveLength(3);
    expect(result.nextCursor).toBe(encodeCursor(rows[2]));
  });

  it("an exhausted read carries a NULL cursor, never an empty string", async () => {
    mockRepo.listRevisionsForResource.mockResolvedValue(page(2));
    const result = await listRevisions(RESOURCE, REACH, { limit: 3 });
    expect(result.nextCursor).toBeNull();
  });

  it("the cursor round-trips through the repository as a (createdAt, id) PAIR", async () => {
    const rows = page(4);
    mockRepo.listRevisionsForResource.mockResolvedValue(rows);
    const first = await listRevisions(RESOURCE, REACH, { limit: 3 });
    mockRepo.listRevisionsForResource.mockResolvedValue([]);
    await listRevisions(RESOURCE, REACH, { limit: 3, cursor: first.nextCursor });
    expect(mockRepo.listRevisionsForResource.mock.calls[1][2].before).toEqual({
      createdAt: rows[2].createdAt,
      id: rows[2].id,
    });
  });

  it("🔒 the cursor is minted BEFORE the reach filter — a fully-invisible page still pages", async () => {
    // A page that filters to nothing out of a full read is still a page that did
    // not reach the end. Minting from the filtered list would stall paging here.
    const rows = page(4);
    mockRepo.listRevisionsForResource.mockResolvedValue(rows);
    const result = await listRevisions(RESOURCE, revisionReach([]), { limit: 3 });
    expect(result.revisions).toEqual([]);
    expect(result.nextCursor).toBe(encodeCursor(rows[2]));
  });

  it("🔒 drops a row naming a resource outside the caller's reach", async () => {
    mockRepo.listRevisionsForResource.mockResolvedValue([
      rev({ id: "mine" }),
      rev({ id: "theirs", resourceId: "e-other" }),
    ]);
    const result = await listRevisions(RESOURCE, REACH, { limit: 10 });
    expect(result.revisions.map((r) => r.id)).toEqual(["mine"]);
  });
});

// ─── 4. Restore ─────────────────────────────────────────────────────

describe("restoreRevision", () => {
  it("writes THROUGH the resource's own service, never a repository", async () => {
    // ⚠ THE MUTATION: replacing the injected writer with a repository call makes
    // this assertion unreachable — and, in production, skips the resource's
    // gates, its storage accounting and its own revision.
    const source = rev({ payload: { body: "old body" } });
    mockRepo.findRevisionById.mockResolvedValue(source);
    const write = vi.fn(async () => {});
    await restoreRevision("rev-1", REACH, write);
    expect(write).toHaveBeenCalledWith(source);
  });

  it("🔒 never mutates history — no append, no replace, from this function", async () => {
    mockRepo.findRevisionById.mockResolvedValue(rev({ payload: { body: "old" } }));
    await restoreRevision("rev-1", REACH, async () => {});
    expect(mockRepo.appendRevision).not.toHaveBeenCalled();
    expect(mockRepo.replaceRevisionSnapshot).not.toHaveBeenCalled();
  });

  it("🔒 a revision outside the caller's reach is the same 404 an unknown id gets", async () => {
    mockRepo.findRevisionById.mockResolvedValue(
      rev({ resourceId: "e-somebody-elses" })
    );
    await expect(restoreRevision("rev-1", REACH, async () => {})).rejects.toBeInstanceOf(
      RevisionNotFoundError
    );
  });

  it("an unknown id is a 404 and never reaches the writer", async () => {
    mockRepo.findRevisionById.mockResolvedValue(null);
    const write = vi.fn();
    await expect(restoreRevision("nope", REACH, write)).rejects.toBeInstanceOf(
      RevisionNotFoundError
    );
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses a BODYLESS snapshot rather than writing a silent no-op", async () => {
    mockRepo.findRevisionById.mockResolvedValue(rev({ op: "move", payload: { path: "a/b" } }));
    await expect(restoreRevision("rev-1", REACH, async () => {})).rejects.toBeInstanceOf(
      RevisionNotRestorableError
    );
  });

  it("the summary names the SOURCE's date, not today's", () => {
    expect(restoreSummary(rev({ createdAt: "2026-09-08T23:00:00.000Z" }))).toBe(
      "Restored the version from 2026-09-08"
    );
  });
});
