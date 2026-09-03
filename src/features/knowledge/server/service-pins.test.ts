/**
 * WORKSPACE-WIDE pins (T81). ⚠ The repository runs as service role and bypasses
 * RLS, so `knowledge_bases_member_select` evaluates for nobody on this path and
 * these four properties have no lower layer holding them:
 *   1. a pin is gated on `getBaseById` — visibility + teams + the audience
 *      ceiling, as ONE 404;
 *   2. an UNPIN is gated identically, unlike `unstarBase`, because it writes the
 *      workspace's row rather than the caller's own;
 *   3. an ENTRY pin chases the row UP to its base through `getEntry`, so the
 *      entry route's viewer-reachable id is not a way past the base's gate;
 *   4. `listPinnedBaseIds` re-filters to the id set it was handed — the id set
 *      IS the fence.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KnowledgeBase, KnowledgeContext, KnowledgeEntry } from "../types";

vi.mock("./repository", () => ({
  listPinnedBaseIds: vi.fn(),
  setBasePinned: vi.fn(),
  setEntryPinned: vi.fn(),
}));

vi.mock("./service-bases", () => ({
  getBaseById: vi.fn(),
}));

vi.mock("./service-entries", () => ({
  getEntry: vi.fn(),
}));

import * as repo from "./repository";
import { getBaseById } from "./service-bases";
import { getEntry } from "./service-entries";
import { listPinnedBaseIds, pinBase, pinEntry } from "./service-pins";

const mockRepo = vi.mocked(repo);
const mockGetBase = vi.mocked(getBaseById);
const mockGetEntry = vi.mocked(getEntry);

const CTX = { workspaceId: "ws-1", userId: "u-me" } as KnowledgeContext;

function base(id: string): KnowledgeBase {
  return { id, workspaceId: "ws-1" } as KnowledgeBase;
}

function entry(id: string, baseId: string): KnowledgeEntry {
  return { id, knowledgeBaseId: baseId, workspaceId: "ws-1" } as KnowledgeEntry;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.listPinnedBaseIds.mockResolvedValue([]);
});

describe("listPinnedBaseIds", () => {
  it("asks over exactly the visible bases, scoped to the caller's workspace", async () => {
    mockRepo.listPinnedBaseIds.mockResolvedValue(["kb-2"]);

    const pinned = await listPinnedBaseIds(CTX, [base("kb-1"), base("kb-2")]);

    expect(mockRepo.listPinnedBaseIds).toHaveBeenCalledTimes(1);
    expect(mockRepo.listPinnedBaseIds).toHaveBeenCalledWith("ws-1", [
      "kb-1",
      "kb-2",
    ]);
    expect(pinned).toEqual(["kb-2"]);
  });

  it("drops a pinned id outside the visible set — the id set IS the fence", async () => {
    // A pin surviving a lockdown must not re-announce the base's existence on a
    // list response that has no card for it.
    mockRepo.listPinnedBaseIds.mockResolvedValue(["kb-1", "kb-hidden"]);

    expect(await listPinnedBaseIds(CTX, [base("kb-1")])).toEqual(["kb-1"]);
  });

  it("never queries for an empty base list", async () => {
    expect(await listPinnedBaseIds(CTX, [])).toEqual([]);
    expect(mockRepo.listPinnedBaseIds).not.toHaveBeenCalled();
  });

  it("takes NO user id — a pin is the workspace's fact, not a member's", () => {
    // Structural, and it is the whole difference from `service-stars.ts`: the
    // signature has no second place a subject could come from.
    expect(listPinnedBaseIds.length).toBe(2);
  });
});

describe("pinBase", () => {
  it("gates on visibility, THEN writes the workspace's row", async () => {
    mockGetBase.mockResolvedValue(base("kb-1"));

    await pinBase(CTX, "kb-1", true);

    expect(mockGetBase).toHaveBeenCalledWith(CTX, "kb-1");
    expect(mockRepo.setBasePinned).toHaveBeenCalledWith("ws-1", "kb-1", true);
  });

  it("writes NOTHING when the base is not visible to the caller", async () => {
    // `getBaseById` 404s a foreign base, one the private/teams gate hides, and
    // one outside a locked agent's audience ceiling — one answer, so a pin
    // cannot probe whether an id is real.
    mockGetBase.mockRejectedValue(new Error("KnowledgeBaseNotFound"));

    await expect(pinBase(CTX, "kb-hidden", true)).rejects.toThrow();
    expect(mockRepo.setBasePinned).not.toHaveBeenCalled();
  });

  it("UNPINS through the same gate — the asymmetry with unstarBase is deliberate", async () => {
    // `unstarBase` is ungated because a member must always be able to drop their
    // OWN row. A pin is not the caller's row, so removing one is as much a write
    // to shared state as adding one.
    mockGetBase.mockRejectedValue(new Error("KnowledgeBaseNotFound"));

    await expect(pinBase(CTX, "kb-hidden", false)).rejects.toThrow();
    expect(mockGetBase).toHaveBeenCalledWith(CTX, "kb-hidden");
    expect(mockRepo.setBasePinned).not.toHaveBeenCalled();
  });

  it("is reachable in both directions and states the END STATE, never a delta", async () => {
    mockGetBase.mockResolvedValue(base("kb-1"));

    await pinBase(CTX, "kb-1", true);
    await pinBase(CTX, "kb-1", false);
    await pinBase(CTX, "kb-1", false);

    expect(mockRepo.setBasePinned.mock.calls.map((c) => c[2])).toEqual([
      true,
      false,
      false,
    ]);
  });
});

describe("pinEntry", () => {
  it("chases the entry up to its base, THEN writes", async () => {
    mockGetEntry.mockResolvedValue(entry("e-1", "kb-1"));

    await pinEntry(CTX, "e-1", true);

    expect(mockGetEntry).toHaveBeenCalledWith(CTX, "e-1");
    expect(mockRepo.setEntryPinned).toHaveBeenCalledWith("ws-1", "e-1", true);
  });

  it("writes NOTHING when the entry's BASE is unreachable", async () => {
    // `getEntry` answers `getBaseById`'s gates as a 404 about the entry, so the
    // entry route's cheaply-obtained id is not a way past the base's gate.
    mockGetEntry.mockRejectedValue(new Error("EntryNotFound"));

    await expect(pinEntry(CTX, "e-hidden", true)).rejects.toThrow();
    expect(mockRepo.setEntryPinned).not.toHaveBeenCalled();
  });

  it("gates the UNPIN identically", async () => {
    mockGetEntry.mockRejectedValue(new Error("EntryNotFound"));

    await expect(pinEntry(CTX, "e-hidden", false)).rejects.toThrow();
    expect(mockRepo.setEntryPinned).not.toHaveBeenCalled();
  });

  it("writes the id the SERVER resolved, never the caller's string", async () => {
    // The gate returns the row; trusting it rather than the argument is what
    // keeps a resolver change from re-opening a path around the gate.
    mockGetEntry.mockResolvedValue(entry("e-canonical", "kb-1"));

    await pinEntry(CTX, "e-1", true);

    expect(mockRepo.setEntryPinned).toHaveBeenCalledWith(
      "ws-1",
      "e-canonical",
      true
    );
  });
});
