/**
 * THE AGENT AUDIENCE CEILING — layer A (plan §4.2/§4.3), the fence half of the
 * ceiling. Two halves to this suite:
 *
 *  1. `resolveAgentAudience` as a decision table: the three `unrestricted`
 *     branches (human caller, standard workspace, SOLO container) cost the
 *     queries they are supposed to cost and no more; the fourth narrows; an
 *     UNREADABLE member count fails CLOSED; an unknown future workspace kind is
 *     NOT narrowed; and the `X-Dopl-Session-Id` narrowing may only pick inside
 *     the DB-derived set.
 *  2. The three foundational lookups in `service-bases.ts` driven for real, so
 *     deleting the wiring — not just the module — goes red.
 *
 * ⚠ MUTATION-VERIFIED. Counts are in the report for this milestone; each
 * `it()` below whose title names a fence was confirmed to fail with that fence
 * removed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KnowledgeBase, KnowledgeContext } from "../types";

vi.mock("@/shared/supabase/admin", () => ({
  supabaseAdmin: () => ({ __marker: "admin-client" }),
}));

vi.mock("./repository-audience", () => ({
  findWorkspaceKind: vi.fn(),
  countActiveWorkspaceMembers: vi.fn(),
  listChannelIdsForWorkspace: vi.fn(),
  listGrantedBaseIdsForChannels: vi.fn(),
}));

vi.mock("./repository", () => ({
  listBasesForWorkspace: vi.fn(),
  findBaseById: vi.fn(),
  findBaseBySlug: vi.fn(),
}));

import {
  countActiveWorkspaceMembers,
  findWorkspaceKind,
  listChannelIdsForWorkspace,
  listGrantedBaseIdsForChannels,
} from "./repository-audience";
import * as repo from "./repository";
import { audienceAdmits, resolveAgentAudience } from "./service-audience";
import { getBaseById, getBaseBySlug, listBases } from "./service-bases";
import { KnowledgeBaseNotFoundError } from "./errors";

const mockKind = vi.mocked(findWorkspaceKind);
const mockCount = vi.mocked(countActiveWorkspaceMembers);
const mockChannels = vi.mocked(listChannelIdsForWorkspace);
const mockGrants = vi.mocked(listGrantedBaseIdsForChannels);
const mockRepo = vi.mocked(repo);

const CHANNEL_A = "aaaaaaaa-0000-4000-8000-000000000001";
const CHANNEL_B = "bbbbbbbb-0000-4000-8000-000000000002";
const CHANNEL_OUTSIDE = "cccccccc-0000-4000-8000-000000000003";

function ctx(over: Partial<KnowledgeContext> = {}): KnowledgeContext {
  return {
    workspaceId: "ws-container",
    userId: "u-operator",
    role: "owner",
    source: "agent",
    apiKeyWorkspaceId: null,
    credentialSubjectUserId: "u-operator",
    sessionId: null,
    ...over,
  };
}

/** Public + workspace-mode, so the WORKSPACE gates all pass and whatever the
 *  assertions see is the ceiling and nothing else. */
function base(id: string): KnowledgeBase {
  return {
    id,
    workspaceId: "ws-container",
    visibility: "public",
    accessMode: "workspace",
    createdBy: "u-operator",
    agentWriteEnabled: true,
  } as KnowledgeBase;
}

/** The shared container: link kind, two active members, one channel, one grant. */
function sharedContainer(grantedBaseIds: string[] = ["kb-granted"]) {
  mockKind.mockResolvedValue("link");
  mockCount.mockResolvedValue(2);
  mockChannels.mockResolvedValue([CHANNEL_A]);
  mockGrants.mockResolvedValue(grantedBaseIds);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveAgentAudience — the three unrestricted branches", () => {
  it("a HUMAN caller is unrestricted and costs ZERO reads", async () => {
    const audience = await resolveAgentAudience(ctx({ source: "user" }));

    expect(audience).toEqual({ kind: "unrestricted" });
    expect(mockKind).not.toHaveBeenCalled();
    expect(mockCount).not.toHaveBeenCalled();
    expect(mockChannels).not.toHaveBeenCalled();
    expect(mockGrants).not.toHaveBeenCalled();
  });

  it("an agent in a STANDARD workspace is unrestricted and costs ONE read", async () => {
    mockKind.mockResolvedValue("standard");

    expect(await resolveAgentAudience(ctx())).toEqual({ kind: "unrestricted" });
    expect(mockKind).toHaveBeenCalledTimes(1);
    expect(mockCount).not.toHaveBeenCalled();
  });

  it("an UNKNOWN future workspace kind is NOT narrowed", async () => {
    // The listing predicate `isStandardWorkspace` is positive on purpose
    // (§4A/F-295); the ceiling asks the opposite question and must answer NO for
    // a kind nobody has designed yet rather than fencing it on a guess.
    mockKind.mockResolvedValue("archive");

    expect(await resolveAgentAudience(ctx())).toEqual({ kind: "unrestricted" });
    expect(mockCount).not.toHaveBeenCalled();
  });

  it("a workspace row that has VANISHED is unrestricted, not a spurious 404", async () => {
    mockKind.mockResolvedValue(null);

    expect(await resolveAgentAudience(ctx())).toEqual({ kind: "unrestricted" });
  });

  it("a SOLO container is unrestricted — today's behaviour, untouched", async () => {
    mockKind.mockResolvedValue("link");
    mockCount.mockResolvedValue(1);

    expect(await resolveAgentAudience(ctx())).toEqual({ kind: "unrestricted" });
    expect(mockChannels).not.toHaveBeenCalled();
    expect(mockGrants).not.toHaveBeenCalled();
  });
});

describe("resolveAgentAudience — the narrowed branch", () => {
  it("a SHARED container reaches the granted set and nothing else", async () => {
    sharedContainer(["kb-granted", "kb-also-granted"]);

    const audience = await resolveAgentAudience(ctx());

    expect(audience.kind).toBe("granted");
    expect(audienceAdmits(audience, "kb-granted")).toBe(true);
    expect(audienceAdmits(audience, "kb-also-granted")).toBe(true);
    expect(audienceAdmits(audience, "kb-private")).toBe(false);
    expect(mockGrants).toHaveBeenCalledWith(expect.anything(), "ws-container", [
      CHANNEL_A,
    ]);
  });

  it("FAILS CLOSED on an unreadable member count — unknown is not solo", async () => {
    mockKind.mockResolvedValue("link");
    mockCount.mockResolvedValue(null);
    mockChannels.mockResolvedValue([CHANNEL_A]);
    mockGrants.mockResolvedValue([]);

    const audience = await resolveAgentAudience(ctx());

    expect(audience.kind).toBe("granted");
    expect(audienceAdmits(audience, "kb-anything")).toBe(false);
  });

  it("a container with NO channels reaches NO bases", async () => {
    mockKind.mockResolvedValue("link");
    mockCount.mockResolvedValue(2);
    mockChannels.mockResolvedValue([]);
    mockGrants.mockResolvedValue([]);

    const audience = await resolveAgentAudience(ctx());

    expect(audienceAdmits(audience, "kb-granted")).toBe(false);
  });
});

describe("resolveAgentAudience — §4.3, the session-id narrowing", () => {
  it("takes the SET of container channels when no session id is sent (F-327)", async () => {
    mockKind.mockResolvedValue("link");
    mockCount.mockResolvedValue(2);
    mockChannels.mockResolvedValue([CHANNEL_A, CHANNEL_B]);
    mockGrants.mockResolvedValue([]);

    await resolveAgentAudience(ctx({ sessionId: null }));

    expect(mockGrants).toHaveBeenCalledWith(expect.anything(), "ws-container", [
      CHANNEL_A,
      CHANNEL_B,
    ]);
  });

  it("NARROWS to one channel when the session id names one INSIDE the set", async () => {
    mockKind.mockResolvedValue("link");
    mockCount.mockResolvedValue(2);
    mockChannels.mockResolvedValue([CHANNEL_A, CHANNEL_B]);
    mockGrants.mockResolvedValue([]);

    await resolveAgentAudience(ctx({ sessionId: `${CHANNEL_B}:task-1:agent-1` }));

    expect(mockGrants).toHaveBeenCalledWith(expect.anything(), "ws-container", [
      CHANNEL_B,
    ]);
  });

  it("🔒 IGNORES a session id naming a channel OUTSIDE the set — no widening", async () => {
    // The header is forgeable. A value naming a channel the container does not
    // hold is discarded ENTIRELY; the DB-derived set stands. There is no input
    // that ADDS a channel.
    mockKind.mockResolvedValue("link");
    mockCount.mockResolvedValue(2);
    mockChannels.mockResolvedValue([CHANNEL_A]);
    mockGrants.mockResolvedValue([]);

    await resolveAgentAudience(ctx({ sessionId: `${CHANNEL_OUTSIDE}:t:a` }));

    expect(mockGrants).toHaveBeenCalledWith(expect.anything(), "ws-container", [
      CHANNEL_A,
    ]);
  });

  it("ignores a session id whose head is not a uuid", async () => {
    mockKind.mockResolvedValue("link");
    mockCount.mockResolvedValue(2);
    mockChannels.mockResolvedValue([CHANNEL_A, CHANNEL_B]);
    mockGrants.mockResolvedValue([]);

    await resolveAgentAudience(ctx({ sessionId: "not-a-uuid:tail" }));

    expect(mockGrants).toHaveBeenCalledWith(expect.anything(), "ws-container", [
      CHANNEL_A,
      CHANNEL_B,
    ]);
  });

  it("narrowing can only REMOVE reach, never add it", async () => {
    mockKind.mockResolvedValue("link");
    mockCount.mockResolvedValue(2);
    mockChannels.mockResolvedValue([CHANNEL_A, CHANNEL_B]);
    mockGrants.mockResolvedValue(["kb-in-b"]);

    const narrowed = await resolveAgentAudience(
      ctx({ sessionId: `${CHANNEL_B}:t` })
    );
    const [, , narrowedChannels] = mockGrants.mock.calls[0];

    expect(narrowedChannels).toEqual([CHANNEL_B]);
    expect(narrowed.kind === "granted" && narrowed.channelIds).toEqual([
      CHANNEL_B,
    ]);
  });
});

describe("the ceiling is WIRED into the foundational lookups", () => {
  it("listBases drops an ungranted base for an agent in a shared container", async () => {
    sharedContainer(["kb-granted"]);
    mockRepo.listBasesForWorkspace.mockResolvedValue([
      base("kb-granted"),
      base("kb-private"),
    ]);

    const bases = await listBases(ctx());

    expect(bases.map((b) => b.id)).toEqual(["kb-granted"]);
  });

  it("listBases is UNCHANGED for the human on the same workspace", async () => {
    sharedContainer(["kb-granted"]);
    mockRepo.listBasesForWorkspace.mockResolvedValue([
      base("kb-granted"),
      base("kb-private"),
    ]);

    const bases = await listBases(ctx({ source: "user" }));

    expect(bases.map((b) => b.id)).toEqual(["kb-granted", "kb-private"]);
  });

  it("getBaseById 404s an ungranted base — the SAME error an invisible one throws", async () => {
    sharedContainer(["kb-granted"]);
    mockRepo.findBaseById.mockResolvedValue(base("kb-private"));

    await expect(getBaseById(ctx(), "kb-private")).rejects.toBeInstanceOf(
      KnowledgeBaseNotFoundError
    );
  });

  it("getBaseById still returns a GRANTED base", async () => {
    sharedContainer(["kb-granted"]);
    mockRepo.findBaseById.mockResolvedValue(base("kb-granted"));

    expect((await getBaseById(ctx(), "kb-granted")).id).toBe("kb-granted");
  });

  it("getBaseBySlug 404s an ungranted base", async () => {
    sharedContainer(["kb-granted"]);
    mockRepo.findBaseBySlug.mockResolvedValue(base("kb-private"));

    await expect(getBaseBySlug(ctx(), "private")).rejects.toBeInstanceOf(
      KnowledgeBaseNotFoundError
    );
  });

  it("a SOLO container's agent still reaches every base — no regression", async () => {
    mockKind.mockResolvedValue("link");
    mockCount.mockResolvedValue(1);
    mockRepo.listBasesForWorkspace.mockResolvedValue([
      base("kb-granted"),
      base("kb-private"),
    ]);

    const bases = await listBases(ctx());

    expect(bases.map((b) => b.id)).toEqual(["kb-granted", "kb-private"]);
  });
});
