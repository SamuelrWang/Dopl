/**
 * INVARIANT SUITE — 🔒 THE ONTOLOGY AUDIENCE CEILING, one case per ROW of the
 * permission matrix (`docs/specs/home-ontology.md` §2) × solo/shared.
 *
 * The ceiling is the WHOLE fence for the home ontology: an agent holds its
 * operator's credential and has Bash, so a hidden control decides nothing and
 * the desktop's prompt framing is a compensating control rather than a gate.
 * Every input is driven through `repository-shares.ts` — the DB facts — so a
 * case here is a case about the server, not about a mock of the decision.
 *
 * ⚠ THE TWO CASES THAT ARE NOT MATRIX ROWS ARE THE ONES THAT MATTER MOST:
 * the UNREADABLE member count (fails CLOSED to the narrower rung) and the ONE
 * RESOLUTION PER REQUEST pin.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OntologyContext, OntologyLevel } from "../types";

vi.mock("./repository-shares", () => ({
  findWorkspaceKind: vi.fn(),
  countActiveWorkspaceMembers: vi.fn(),
  listChannelIdsForWorkspace: vi.fn(),
  listSharesForChannels: vi.fn(),
}));

vi.mock("@/shared/tenancy/personal-reach", () => ({
  personalShelfContainerIds: vi.fn(),
}));

import * as shares from "./repository-shares";
import { personalShelfContainerIds } from "@/shared/tenancy/personal-reach";
import {
  levelForCluster,
  resolveOntologyAudience,
  type AudienceClusterFacts,
} from "./service-audience";

const mockShares = vi.mocked(shares);
const mockPersonal = vi.mocked(personalShelfContainerIds);

const LINK = "ws-link";
const OWNER_CONTAINER = "ws-personal";
const CHANNEL = "ch-1";
const OWNER = "user-owner";
const PEER = "user-peer";
const OWN_CLUSTER = "c-own";
const PEER_CLUSTER = "c-peer";

function cluster(over: Partial<AudienceClusterFacts> = {}): AudienceClusterFacts {
  return {
    id: OWN_CLUSTER,
    // ⚠ The ONTOLOGY's container, and NOT the calling one: every case below is
    // the cross-container shape the lend actually has.
    workspace_id: OWNER_CONTAINER,
    created_by: OWNER,
    agents_may_edit: true,
    ...over,
  };
}

function shareRow(over: {
  ontology?: string;
  members?: OntologyLevel;
  guests?: OntologyLevel;
  ownerAgents?: OntologyLevel;
  container?: string;
}) {
  return {
    ontology_id: over.ontology ?? OWN_CLUSTER,
    channel_id: CHANNEL,
    workspace_id: over.container ?? OWNER_CONTAINER,
    members_level: over.members ?? "none",
    guests_level: over.guests ?? "none",
    owner_agents_level: over.ownerAgents ?? "none",
  } as const;
}

/** One caller. ⚠ A FRESH OBJECT every time: the ceiling is memoised against the
 *  context's identity, so reusing one across cases would reuse its answer. */
function ctx(over: Partial<OntologyContext> = {}): OntologyContext {
  return {
    workspaceId: LINK,
    userId: OWNER,
    role: "member",
    source: "user",
    credentialSubjectUserId: OWNER,
    ...over,
  };
}

function prime(opts: {
  kind?: string;
  members?: number | null;
  shares?: ReturnType<typeof shareRow>[];
  personal?: string[];
} = {}) {
  mockShares.findWorkspaceKind.mockResolvedValue(opts.kind ?? "link");
  mockShares.countActiveWorkspaceMembers.mockResolvedValue(
    opts.members === undefined ? 1 : opts.members
  );
  mockShares.listChannelIdsForWorkspace.mockResolvedValue([CHANNEL]);
  mockShares.listSharesForChannels.mockResolvedValue([...(opts.shares ?? [])]);
  mockPersonal.mockResolvedValue(opts.personal ?? [OWNER_CONTAINER]);
}

async function levelOf(
  c: OntologyContext,
  facts: AudienceClusterFacts
): Promise<OntologyLevel> {
  return levelForCluster(c, await resolveOntologyAudience(c), facts);
}

beforeEach(() => {
  vi.clearAllMocks();
  prime();
});

describe("matrix — the OWNER, in person", () => {
  it("solo and unshared: edit", async () => {
    expect(await levelOf(ctx(), cluster())).toBe("edit");
  });

  it("shared into a channel at members none: STILL edit — a share never narrows the owner", async () => {
    prime({ members: 4, shares: [shareRow({ members: "none", ownerAgents: "none" })] });
    expect(await levelOf(ctx(), cluster())).toBe("edit");
  });
});

describe("matrix — a MEMBER of the channel, and their agent", () => {
  const peerCluster = cluster({ id: PEER_CLUSTER, created_by: PEER });

  for (const level of ["view", "edit", "none"] as const) {
    it(`reads members_level="${level}" verbatim`, async () => {
      prime({
        members: 2,
        shares: [shareRow({ ontology: PEER_CLUSTER, members: level, guests: "edit" })],
      });
      expect(await levelOf(ctx({ userId: "user-me" }), peerCluster)).toBe(level);
    });

    it(`a member's AGENT inherits EXACTLY that: "${level}" (Q1, no second control)`, async () => {
      prime({
        members: 2,
        shares: [shareRow({ ontology: PEER_CLUSTER, members: level, guests: "edit" })],
      });
      expect(
        await levelOf(ctx({ userId: "user-me", source: "agent" }), peerCluster)
      ).toBe(level);
    });
  }

  it("no share row at all: none — I3, unshared means owner only", async () => {
    prime({ members: 2, shares: [] });
    expect(await levelOf(ctx({ userId: "user-me" }), peerCluster)).toBe("none");
  });
});

describe("matrix — a GUEST of the channel, and their agent", () => {
  const peerCluster = cluster({ id: PEER_CLUSTER, created_by: PEER });

  for (const level of ["view", "edit", "none"] as const) {
    it(`reads guests_level="${level}", never members_level`, async () => {
      prime({
        members: 2,
        shares: [shareRow({ ontology: PEER_CLUSTER, members: "edit", guests: level })],
      });
      expect(
        await levelOf(ctx({ userId: "user-me", role: "guest" }), peerCluster)
      ).toBe(level);
    });

    it(`a guest's AGENT inherits EXACTLY that: "${level}"`, async () => {
      prime({
        members: 2,
        shares: [shareRow({ ontology: PEER_CLUSTER, members: "edit", guests: level })],
      });
      expect(
        await levelOf(
          ctx({ userId: "user-me", role: "guest", source: "agent" }),
          peerCluster
        )
      ).toBe(level);
    });
  }
});

describe("matrix — the OWNER'S OWN AGENT (Samuel's solo toggle, Q2)", () => {
  const agent = () => ctx({ source: "agent" });

  it("solo room, toggle ON: edit", async () => {
    prime({ members: 1 });
    expect(await levelOf(agent(), cluster({ agents_may_edit: true }))).toBe("edit");
  });

  it("solo room, toggle OFF: view — 'they can toggle it so their agents can only view'", async () => {
    prime({ members: 1 });
    expect(await levelOf(agent(), cluster({ agents_may_edit: false }))).toBe("view");
  });

  it("SHARED room, unshared ontology, toggle ON: drops to view until the owner sets it (Q2)", async () => {
    prime({ members: 2 });
    expect(await levelOf(agent(), cluster({ agents_may_edit: true }))).toBe("view");
  });

  it("a share row OVERRIDES the toggle with owner_agents_level", async () => {
    prime({ members: 2, shares: [shareRow({ ownerAgents: "edit" })] });
    expect(await levelOf(agent(), cluster({ agents_may_edit: false }))).toBe("edit");
  });

  it("owner_agents_level='none' fences the owner's own agent out entirely", async () => {
    prime({ members: 2, shares: [shareRow({ ownerAgents: "none" })] });
    expect(await levelOf(agent(), cluster())).toBe("none");
  });

  it("🔒 AN UNREADABLE MEMBER COUNT FAILS CLOSED — null is 'not solo', so view not edit", async () => {
    prime({ members: null });
    expect(await levelOf(agent(), cluster({ agents_may_edit: true }))).toBe("view");
  });
});

describe("the arms that are not matrix rows", () => {
  it("a STANDARD workspace is unrestricted — today's behaviour, verbatim (Q5)", async () => {
    prime({ kind: "standard" });
    const audience = await resolveOntologyAudience(ctx({ userId: "user-me" }));
    expect(audience.kind).toBe("unrestricted");
    expect(
      levelForCluster(ctx({ userId: "user-me" }), audience, cluster({ created_by: PEER }))
    ).toBe("edit");
    // ⚠ And it costs ONE probe: no channels, no members, no shares.
    expect(mockShares.listChannelIdsForWorkspace).not.toHaveBeenCalled();
    expect(mockShares.listSharesForChannels).not.toHaveBeenCalled();
  });

  it("a standard workspace's scope stays its own container — the personal shelf is NOT folded in", async () => {
    prime({ kind: "standard" });
    const audience = await resolveOntologyAudience(ctx());
    expect(audience.workspaceIds).toEqual([LINK]);
  });

  it("🔒 a SHARED CREDENTIAL reaches nothing — not even its holder's own cluster (M-10)", async () => {
    prime({ members: 1 });
    const shared = ctx({ credentialSubjectUserId: null, source: "agent" });
    const audience = await resolveOntologyAudience(shared);
    expect(levelForCluster(shared, audience, cluster())).toBe("none");
    expect(audience.workspaceIds).toEqual([LINK]);
  });

  it("the read SCOPE folds in the personal shelf and every LENDER's container", async () => {
    prime({
      members: 2,
      personal: [OWNER_CONTAINER],
      shares: [shareRow({ members: "view", container: "ws-lender" })],
    });
    const audience = await resolveOntologyAudience(ctx({ userId: "user-me" }));
    expect([...audience.workspaceIds].sort()).toEqual(
      [LINK, OWNER_CONTAINER, "ws-lender"].sort()
    );
  });

  it("⚠ ONE RESOLUTION PER REQUEST — two calls on one context probe the DB once", async () => {
    const request = ctx();
    await Promise.all([
      resolveOntologyAudience(request),
      resolveOntologyAudience(request),
    ]);
    await resolveOntologyAudience(request);
    expect(mockShares.findWorkspaceKind).toHaveBeenCalledTimes(1);
    expect(mockShares.listSharesForChannels).toHaveBeenCalledTimes(1);
  });

  it("a SECOND context resolves again — the memo is per request, never module-wide", async () => {
    await resolveOntologyAudience(ctx());
    await resolveOntologyAudience(ctx());
    expect(mockShares.findWorkspaceKind).toHaveBeenCalledTimes(2);
  });

  /**
   * 🔒 THE OWNER ARM — `created_by === userId`, which restores ROW 2 of
   * `./service-shared.ts`'s truth table (the caller's own personal shelf,
   * reached from a room) and nothing else.
   *
   * ⚠ IT ASKS NOTHING ABOUT MEMBERSHIP, so its soundness is the READ SCOPE's:
   * a row from a container the caller was removed from would answer `edit` and
   * simply never arrives. The second case states that in as many words, so the
   * next reader knows what the arm does and does NOT check.
   */
  it("the owner arm — `created_by`, restoring the personal shelf and nothing more", async () => {
    prime({ members: 2, personal: [OWNER_CONTAINER] });
    const me = ctx({ userId: OWNER });
    // Row 2: the shelf is not the calling container, and there is no share row.
    expect(await levelOf(me, cluster({ workspace_id: OWNER_CONTAINER }))).toBe("edit");
    // …and it is the CREATOR, never "somebody in that container": a peer's
    // cluster sitting in the same container is still refused.
    expect(
      await levelOf(ctx({ userId: PEER }), cluster({ workspace_id: OWNER_CONTAINER }))
    ).toBe("none");
  });

  it("⚠ the owner arm checks NO membership — the read scope is what contains it", async () => {
    prime({ members: 2, personal: [OWNER_CONTAINER] });
    const me = ctx({ userId: OWNER });
    const audience = await resolveOntologyAudience(me);
    const left = cluster({ id: "c-left", workspace_id: "ws-i-was-removed-from" });
    // A row from a container this request never reached would answer `edit`…
    expect(levelForCluster(me, audience, left)).toBe("edit");
    // …which is safe ONLY because no query can return it: that container is not
    // in the scope, and `service-gates.ts` reads every row through the scope.
    expect(audience.workspaceIds).not.toContain(left.workspace_id);
  });
});
