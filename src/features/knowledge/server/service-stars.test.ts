/**
 * PER-USER knowledge-base stars — `service-stars.ts`.
 *
 * Three properties, and every one of them is a thing the layer below cannot
 * hold on its own (the repository runs as service role, which bypasses RLS
 * entirely — so on the path this table is actually used, its own-row policy
 * evaluates for nobody):
 *
 *   1. **Only the CALLER'S OWN rows.** The user id comes off the context and
 *      nothing takes it as an argument, so the assertions here are on what
 *      reaches the repository.
 *   2. **Only VISIBLE bases.** `starredBaseIds` is narrowed to the same
 *      post-visibility list the response carries, so a star cannot surface a
 *      base the private/teams gate hid — and `starBase` refuses to create one
 *      for a base the caller cannot see.
 *   3. **UNSTAR IS NOT GATED, deliberately.** A visibility change must never
 *      strand a star its owner can no longer remove.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KnowledgeBase, KnowledgeContext } from "../types";

vi.mock("./repository", () => ({
  listStarredBaseIds: vi.fn(),
  insertBaseStar: vi.fn(),
  deleteBaseStar: vi.fn(),
}));

vi.mock("./service-bases", () => ({
  getBaseById: vi.fn(),
}));

import * as repo from "./repository";
import { getBaseById } from "./service-bases";
import { listStarredBaseIds, starBase, unstarBase } from "./service-stars";

const mockRepo = vi.mocked(repo);
const mockGetBase = vi.mocked(getBaseById);

const CTX = { workspaceId: "ws-1", userId: "u-me" } as KnowledgeContext;

function base(id: string): KnowledgeBase {
  return { id, workspaceId: "ws-1" } as KnowledgeBase;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.listStarredBaseIds.mockResolvedValue([]);
});

describe("listStarredBaseIds", () => {
  it("asks for the CALLER'S rows, over exactly the visible bases", async () => {
    mockRepo.listStarredBaseIds.mockResolvedValue(["kb-2"]);

    const starred = await listStarredBaseIds(CTX, [base("kb-1"), base("kb-2")]);

    expect(mockRepo.listStarredBaseIds).toHaveBeenCalledTimes(1);
    expect(mockRepo.listStarredBaseIds).toHaveBeenCalledWith("u-me", [
      "kb-1",
      "kb-2",
    ]);
    expect(starred).toEqual(["kb-2"]);
  });

  it("drops a star for a base outside the visible set", async () => {
    // The id set is the fence, and this is what stops a star row that survived
    // a base being locked down from re-announcing the base's existence.
    mockRepo.listStarredBaseIds.mockResolvedValue(["kb-1", "kb-hidden"]);

    expect(await listStarredBaseIds(CTX, [base("kb-1")])).toEqual(["kb-1"]);
  });

  it("never queries for an empty base list", async () => {
    expect(await listStarredBaseIds(CTX, [])).toEqual([]);
    expect(mockRepo.listStarredBaseIds).not.toHaveBeenCalled();
  });

  it("answers [] when nothing is starred — a real value, not a gap", async () => {
    expect(await listStarredBaseIds(CTX, [base("kb-1")])).toEqual([]);
  });
});

describe("starBase", () => {
  it("gates on visibility, THEN writes the caller's own row", async () => {
    mockGetBase.mockResolvedValue(base("kb-1"));

    await starBase(CTX, "kb-1");

    expect(mockGetBase).toHaveBeenCalledWith(CTX, "kb-1");
    expect(mockRepo.insertBaseStar).toHaveBeenCalledWith("u-me", "kb-1");
  });

  it("writes NOTHING when the base is not visible to the caller", async () => {
    // `getBaseById` 404s for another workspace's base and for one the
    // private/teams gate hides, which is what stops a star being used to probe
    // whether an id exists.
    mockGetBase.mockRejectedValue(new Error("KnowledgeBaseNotFound"));

    await expect(starBase(CTX, "kb-hidden")).rejects.toThrow();
    expect(mockRepo.insertBaseStar).not.toHaveBeenCalled();
  });
});

describe("unstarBase", () => {
  it("deletes the caller's own row and gates on NOTHING", async () => {
    // Deliberately not visibility-gated: a member must always be able to drop
    // their own row, or a base that turns private strands a star that only the
    // sort order shows is still there. It leaks nothing — a delete matching
    // zero rows is indistinguishable from one matching a row.
    await unstarBase(CTX, "kb-anything");

    expect(mockGetBase).not.toHaveBeenCalled();
    expect(mockRepo.deleteBaseStar).toHaveBeenCalledWith("u-me", "kb-anything");
  });
});
