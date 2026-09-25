/**
 * The agent audience ceiling — layer A (plan §4.2/§4.3), the fence half. Two
 * halves: `resolveAgentAudience` as a decision table (the `unrestricted`
 * branches cost the queries they should and no more, an unreadable member count
 * AND an unrecognised kind both fail CLOSED, and the `X-Dopl-Session-Id`
 * narrowing may only pick inside the DB-derived set), and the three foundational
 * lookups in `service-bases.ts` driven for real, so deleting the wiring goes red.
 *
 * ⚠ **THE POLARITY CASES BELOW WERE INVERTED ON 2026-09-18 (F-718).** They used
 * to assert that a member count of `0` and an unknown kind answered
 * `unrestricted`; Samuel ruled both fail closed, and the arms they assert now
 * are the ones the ruling names.
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

  it("a SOLO agent in a STANDARD workspace is unrestricted and costs ONE read", async () => {
    mockKind.mockResolvedValue("standard");
    mockCount.mockResolvedValue(1);

    expect(await resolveAgentAudience(ctx())).toEqual({ kind: "unrestricted" });
    expect(mockKind).toHaveBeenCalledTimes(1);
    // The kind answers it outright — a standard workspace has no channel grant
    // arm to narrow to, so the count is never asked for.
    expect(mockCount).not.toHaveBeenCalled();
  });

  it("🔒 a SHARED standard workspace is unrestricted and NEVER reads the grant arm (F-718)", async () => {
    // Samuel's 2026-09-18 ruling: in a standard workspace the agent audience
    // follows the WORKSPACE-WIDE + TEAMS visibility, so the ceiling adds nothing
    // of its own. Taking the grant arm here would answer `granted` with an
    // EMPTY set — the scope ruling refuses a channel grant in a standard
    // container, so none can exist — and blank every colleague's agent.
    mockKind.mockResolvedValue("standard");
    mockCount.mockResolvedValue(9);

    expect(await resolveAgentAudience(ctx())).toEqual({ kind: "unrestricted" });
    expect(mockChannels).not.toHaveBeenCalled();
    expect(mockGrants).not.toHaveBeenCalled();
  });

  it("a HOME space — one member — is unrestricted", async () => {
    mockKind.mockResolvedValue("home");
    mockCount.mockResolvedValue(1);

    expect(await resolveAgentAudience(ctx())).toEqual({ kind: "unrestricted" });
    expect(mockGrants).not.toHaveBeenCalled();
  });

  it("a workspace row that has VANISHED is unrestricted, not a spurious 404", async () => {
    // `channelScopeAllowedForKind(null)` is `false`, the same reading the write
    // door takes: a row that is gone is not evidence that channel scope applies.
    mockKind.mockResolvedValue(null);

    expect(await resolveAgentAudience(ctx())).toEqual({ kind: "unrestricted" });
    expect(mockCount).not.toHaveBeenCalled();
  });

  it("a SOLO link container is unrestricted — today's behaviour, untouched", async () => {
    mockKind.mockResolvedValue("link");
    mockCount.mockResolvedValue(1);

    expect(await resolveAgentAudience(ctx())).toEqual({ kind: "unrestricted" });
    expect(mockChannels).not.toHaveBeenCalled();
    expect(mockGrants).not.toHaveBeenCalled();
  });
});

describe("resolveAgentAudience — the two unknowns, both fail CLOSED (F-718)", () => {
  it("🔒 an UNRECOGNISED future kind is NARROWED, not admitted", async () => {
    // The retired `kind !== "link"` admitted every kind added to the union
    // after `link` (F-295/F-564). `channelScopeAllowedForKind` asks POSITIVELY:
    // not standard ⇒ channel scope applies ⇒ a shared room is bounded.
    mockKind.mockResolvedValue("archive");
    mockCount.mockResolvedValue(4);
    mockChannels.mockResolvedValue([CHANNEL_A]);
    mockGrants.mockResolvedValue([]);

    const audience = await resolveAgentAudience(ctx());

    expect(audience.kind).toBe("granted");
    expect(audienceAdmits(audience, "kb-anything")).toBe(false);
  });

  it("🔒 a member count of ZERO is NOT solo — the direction that leaked", async () => {
    // A roster race or a `status` flip mid-request reads `0`. The retired
    // `memberCount !== null && memberCount <= 1` took the UNRESTRICTED arm on
    // it; `isSharedRoom` treats only an exact `1` as solo.
    mockKind.mockResolvedValue("link");
    mockCount.mockResolvedValue(0);
    mockChannels.mockResolvedValue([CHANNEL_A]);
    mockGrants.mockResolvedValue([]);

    const audience = await resolveAgentAudience(ctx());

    expect(audience.kind).toBe("granted");
    expect(audienceAdmits(audience, "kb-anything")).toBe(false);
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
    expect(mockGrants).toHaveBeenCalledWith(expect.anything(), [
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

    expect(mockGrants).toHaveBeenCalledWith(expect.anything(), [
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

    expect(mockGrants).toHaveBeenCalledWith(expect.anything(), [
      CHANNEL_B,
    ]);
  });

  it("🔒 IGNORES a session id naming a channel OUTSIDE the set — no widening", async () => {
    // the header is forgeable: a value naming a channel the container does not
    // hold is discarded entirely. No input ADDS a channel.
    mockKind.mockResolvedValue("link");
    mockCount.mockResolvedValue(2);
    mockChannels.mockResolvedValue([CHANNEL_A]);
    mockGrants.mockResolvedValue([]);

    await resolveAgentAudience(ctx({ sessionId: `${CHANNEL_OUTSIDE}:t:a` }));

    expect(mockGrants).toHaveBeenCalledWith(expect.anything(), [
      CHANNEL_A,
    ]);
  });

  it("ignores a session id whose head is not a uuid", async () => {
    mockKind.mockResolvedValue("link");
    mockCount.mockResolvedValue(2);
    mockChannels.mockResolvedValue([CHANNEL_A, CHANNEL_B]);
    mockGrants.mockResolvedValue([]);

    await resolveAgentAudience(ctx({ sessionId: "not-a-uuid:tail" }));

    expect(mockGrants).toHaveBeenCalledWith(expect.anything(), [
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
    // TWO ARGUMENTS SINCE F-662 — the container term is gone from this
    // read: a grant row is filed under the RESOURCE's container.
    const [, narrowedChannels] = mockGrants.mock.calls[0];

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

  it("🔒 an agent in a SHARED standard workspace sees what its MEMBER sees (F-718)", async () => {
    // The ruling's outcome, driven through the real lookup rather than asserted
    // on the audience shape: the set is non-empty and it is the same set the
    // human on the same workspace gets. `base()` is workspace-mode and public,
    // so `canSeeBase` + `filterTeamVisibleBases` admit both rows and whatever
    // survives is the ceiling's doing.
    mockKind.mockResolvedValue("standard");
    mockCount.mockResolvedValue(2);
    mockRepo.listBasesForWorkspace.mockResolvedValue([
      base("kb-one"),
      base("kb-two"),
    ]);

    const agentBases = await listBases(ctx());
    const humanBases = await listBases(ctx({ source: "user" }));

    expect(agentBases.map((b) => b.id)).toEqual(["kb-one", "kb-two"]);
    expect(agentBases.map((b) => b.id)).toEqual(humanBases.map((b) => b.id));
    expect(mockGrants).not.toHaveBeenCalled();
  });
});
