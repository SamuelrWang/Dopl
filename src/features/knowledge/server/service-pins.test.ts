/**
 * Workspace-wide pins (T81). The repository runs as service role and bypasses
 * RLS, so these four properties have no lower layer holding them:
 *   1. a pin is gated on `getBaseById` — visibility + teams + the audience
 *      ceiling, as one 404;
 *   2. an unpin is gated identically, unlike `unstarBase`, because it writes the
 *      workspace's row rather than the caller's own;
 *   3. an entry pin chases the row up to its base through `getEntry`;
 *   4. `listPinnedBaseIds` re-filters to the id set it was handed.
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
    // A surviving pin must not re-announce a base the list has no card for.
    mockRepo.listPinnedBaseIds.mockResolvedValue(["kb-1", "kb-hidden"]);

    expect(await listPinnedBaseIds(CTX, [base("kb-1")])).toEqual(["kb-1"]);
  });

  it("never queries for an empty base list", async () => {
    expect(await listPinnedBaseIds(CTX, [])).toEqual([]);
    expect(mockRepo.listPinnedBaseIds).not.toHaveBeenCalled();
  });

  it("takes NO user id — a pin is the workspace's fact, not a member's", () => {
    // The difference from `service-stars.ts`: the signature has no second place
    // a subject could come from.
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
    // `getBaseById` answers one 404 for all three refusals, so a pin cannot
    // probe whether an id is real.
    mockGetBase.mockRejectedValue(new Error("KnowledgeBaseNotFound"));

    await expect(pinBase(CTX, "kb-hidden", true)).rejects.toThrow();
    expect(mockRepo.setBasePinned).not.toHaveBeenCalled();
  });

  it("UNPINS through the same gate — the asymmetry with unstarBase is deliberate", async () => {
    // `unstarBase` is ungated because a member must be able to drop their own
    // row. A pin is not the caller's row, so removing one is a shared write.
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
    // `getEntry` answers `getBaseById`'s gates as a 404 about the entry, so a
    // cheaply-obtained entry id is not a way past the base's gate.
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
    // Trusting the row the gate returned, not the argument, keeps a resolver
    // change from re-opening a path around the gate.
    mockGetEntry.mockResolvedValue(entry("e-canonical", "kb-1"));

    await pinEntry(CTX, "e-1", true);

    expect(mockRepo.setEntryPinned).toHaveBeenCalledWith(
      "ws-1",
      "e-canonical",
      true
    );
  });
});
