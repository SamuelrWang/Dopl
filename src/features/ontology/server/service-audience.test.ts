/**
 * Invariant suite — the ontology audience ceiling, one case per ROW of the
 * permission matrix (`docs/specs/home-ontology.md` §2) × solo/shared.
 *
 * The ceiling is the WHOLE fence for the home ontology: an agent holds its
 * operator's credential and has Bash, so a hidden control decides nothing.
 * Every input is driven through `repository-shares.ts` — the DB facts — so a
 * case here is about the server, not about a mock of the decision.
 *
 * The two cases that are not matrix rows matter most: the UNREADABLE member
 * count (fails CLOSED to the narrower rung) and the ONE RESOLUTION PER REQUEST
 * pin.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OntologyContext, OntologyLevel } from "../types";
import { ontologyContextFactory } from "./test-fixtures";

vi.mock("./repository-shares", () => ({
  findWorkspaceKind: vi.fn(),
  countActiveWorkspaceMembers: vi.fn(),
  listChannelIdsForWorkspace: vi.fn(),
  listSharesForChannels: vi.fn(),
}));

vi.mock("@/shared/tenancy/home-space-reach", () => ({
  homeSpaceShelfContainerIds: vi.fn(),
}));

import * as shares from "./repository-shares";
import { homeSpaceShelfContainerIds } from "@/shared/tenancy/home-space-reach";
import {
  levelForOntology,
  resolveOntologyAudience,
  type AudienceOntologyFacts,
} from "./service-audience";

const mockShares = vi.mocked(shares);
const mockHomeSpace = vi.mocked(homeSpaceShelfContainerIds);

const LINK = "ws-link";
const OWNER_CONTAINER = "ws-personal";
const CHANNEL = "ch-1";
const OWNER = "user-owner";
const PEER = "user-peer";
const OWN_ONTOLOGY = "c-own";
const PEER_ONTOLOGY = "c-peer";

function ontology(over: Partial<AudienceOntologyFacts> = {}): AudienceOntologyFacts {
  return {
    id: OWN_ONTOLOGY,
    // The ONTOLOGY's container, and NOT the calling one: every case below is
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
    ontology_id: over.ontology ?? OWN_ONTOLOGY,
    channel_id: CHANNEL,
    workspace_id: over.container ?? OWNER_CONTAINER,
    members_level: over.members ?? "none",
    guests_level: over.guests ?? "none",
    owner_agents_level: over.ownerAgents ?? "none",
  } as const;
}

const ctx = ontologyContextFactory({
  workspaceId: LINK,
  userId: OWNER,
  credentialSubjectUserId: OWNER,
});

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
  mockHomeSpace.mockResolvedValue(opts.personal ?? [OWNER_CONTAINER]);
}

async function levelOf(
  c: OntologyContext,
  facts: AudienceOntologyFacts
): Promise<OntologyLevel> {
  return levelForOntology(c, await resolveOntologyAudience(c), facts);
}

beforeEach(() => {
  vi.clearAllMocks();
  prime();
});

describe("matrix — the OWNER, in person", () => {
  it("solo and unshared: edit", async () => {
    expect(await levelOf(ctx(), ontology())).toBe("edit");
  });

  it("shared into a channel at members none: STILL edit — a share never narrows the owner", async () => {
    prime({ members: 4, shares: [shareRow({ members: "none", ownerAgents: "none" })] });
    expect(await levelOf(ctx(), ontology())).toBe("edit");
  });
});

describe("matrix — a MEMBER of the channel, and their agent", () => {
  const peerOntology = ontology({ id: PEER_ONTOLOGY, created_by: PEER });

  for (const level of ["view", "edit", "none"] as const) {
    it(`reads members_level="${level}" verbatim`, async () => {
      prime({
        members: 2,
        shares: [shareRow({ ontology: PEER_ONTOLOGY, members: level, guests: "edit" })],
      });
      expect(await levelOf(ctx({ userId: "user-me" }), peerOntology)).toBe(level);
    });

    it(`a member's AGENT inherits EXACTLY that: "${level}" (Q1, no second control)`, async () => {
      prime({
        members: 2,
        shares: [shareRow({ ontology: PEER_ONTOLOGY, members: level, guests: "edit" })],
      });
      expect(
        await levelOf(ctx({ userId: "user-me", source: "agent" }), peerOntology)
      ).toBe(level);
    });
  }

  it("no share row at all: none — I3, unshared means owner only", async () => {
    prime({ members: 2, shares: [] });
    expect(await levelOf(ctx({ userId: "user-me" }), peerOntology)).toBe("none");
  });
});

describe("matrix — a GUEST of the channel, and their agent", () => {
  const peerOntology = ontology({ id: PEER_ONTOLOGY, created_by: PEER });

  for (const level of ["view", "edit", "none"] as const) {
    it(`reads guests_level="${level}", never members_level`, async () => {
      prime({
        members: 2,
        shares: [shareRow({ ontology: PEER_ONTOLOGY, members: "edit", guests: level })],
      });
      expect(
        await levelOf(ctx({ userId: "user-me", role: "guest" }), peerOntology)
      ).toBe(level);
    });

    it(`a guest's AGENT inherits EXACTLY that: "${level}"`, async () => {
      prime({
        members: 2,
        shares: [shareRow({ ontology: PEER_ONTOLOGY, members: "edit", guests: level })],
      });
      expect(
        await levelOf(
          ctx({ userId: "user-me", role: "guest", source: "agent" }),
          peerOntology
        )
      ).toBe(level);
    });
  }
});

describe("matrix — the OWNER'S OWN AGENT (Samuel's solo toggle, Q2)", () => {
  const agent = () => ctx({ source: "agent" });

  it("solo room, toggle ON: edit", async () => {
    prime({ members: 1 });
    expect(await levelOf(agent(), ontology({ agents_may_edit: true }))).toBe("edit");
  });

  it("solo room, toggle OFF: view — 'they can toggle it so their agents can only view'", async () => {
    prime({ members: 1 });
    expect(await levelOf(agent(), ontology({ agents_may_edit: false }))).toBe("view");
  });

  it("SHARED room, unshared ontology, toggle ON: drops to view until the owner sets it (Q2)", async () => {
    prime({ members: 2 });
    expect(await levelOf(agent(), ontology({ agents_may_edit: true }))).toBe("view");
  });

  it("a share row OVERRIDES the toggle with owner_agents_level", async () => {
    prime({ members: 2, shares: [shareRow({ ownerAgents: "edit" })] });
    expect(await levelOf(agent(), ontology({ agents_may_edit: false }))).toBe("edit");
  });

  it("owner_agents_level='none' fences the owner's own agent out entirely", async () => {
    prime({ members: 2, shares: [shareRow({ ownerAgents: "none" })] });
    expect(await levelOf(agent(), ontology())).toBe("none");
  });

  it("🔒 AN UNREADABLE MEMBER COUNT FAILS CLOSED — null is 'not solo', so view not edit", async () => {
    prime({ members: null });
    expect(await levelOf(agent(), ontology({ agents_may_edit: true }))).toBe("view");
  });

  it("🔒 A COUNT OF ZERO IS NOT SOLO EITHER — F-718, the direction that leaked", async () => {
    // The hand-spelled `memberCount !== null && memberCount <= 1` answered SOLO
    // to a real `0` (a roster race, a `status` flip mid-request) and handed the
    // toggle back. `shared-room.ts › isSharedRoom` treats only an exact `1` as
    // solo, so the drop to `view` holds.
    prime({ members: 0 });
    expect(await levelOf(agent(), ontology({ agents_may_edit: true }))).toBe("view");
  });
});

describe("the arms that are not matrix rows", () => {
  it("a STANDARD workspace is unrestricted — today's behaviour, verbatim (Q5)", async () => {
    prime({ kind: "standard" });
    const audience = await resolveOntologyAudience(ctx({ userId: "user-me" }));
    expect(audience.kind).toBe("unrestricted");
    expect(
      levelForOntology(ctx({ userId: "user-me" }), audience, ontology({ created_by: PEER }))
    ).toBe("edit");
    // And it costs ONE probe: no channels, no members, no shares.
    expect(mockShares.listChannelIdsForWorkspace).not.toHaveBeenCalled();
    expect(mockShares.listSharesForChannels).not.toHaveBeenCalled();
  });

  /**
   * F-683 — THE FALLBACK IS `resolved, reaches nothing`, NOT `unrestricted`.
   * Both directions are pinned: the STANDARD arm still answers `unrestricted`
   * (the case above), and everything else answers nothing.
   */
  for (const [label, kind] of [
    ["an UNKNOWN kind", "some-future-kind"],
    ["a MISSING workspace row", null],
  ] as const) {
    it(`🔒 ${label} reaches NOTHING — the ceiling fails closed (F-683)`, async () => {
      prime({ members: 1 });
      mockShares.findWorkspaceKind.mockResolvedValue(kind);
      const me = ctx();
      const audience = await resolveOntologyAudience(me);
      expect(audience.kind).toBe("resolved");
      // The READ SCOPE is empty, so no query this service makes can return a row…
      expect(audience.workspaceIds).toEqual([]);
      // …and the level answers `none` even for the caller's OWN container, which
      // `inOwnContainer` would otherwise admit at `view`/`edit`.
      expect(levelForOntology(me, audience, ontology({ workspace_id: LINK }))).toBe("none");
      expect(levelForOntology(me, audience, ontology())).toBe("none");
      // And it costs ONE probe: an unreadable kind must not buy a share fan.
      expect(mockShares.listSharesForChannels).not.toHaveBeenCalled();
    });
  }

  it("a standard workspace's scope stays its own container — the home shelf is NOT folded in", async () => {
    prime({ kind: "standard" });
    const audience = await resolveOntologyAudience(ctx());
    expect(audience.workspaceIds).toEqual([LINK]);
  });

  it("🔒 a SHARED CREDENTIAL reaches nothing — not even its holder's own ontology (M-10)", async () => {
    prime({ members: 1 });
    const shared = ctx({ credentialSubjectUserId: null, source: "agent" });
    const audience = await resolveOntologyAudience(shared);
    expect(levelForOntology(shared, audience, ontology())).toBe("none");
    expect(audience.workspaceIds).toEqual([LINK]);
  });

  it("the read SCOPE folds in the home shelf and every LENDER's container", async () => {
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

  /**
   * 🔒 **S29c — THE SHELF'S OWN IDS SURVIVE THE UNION.** The scope above is a
   * set, so a reader downstream cannot tell which of its members came from the
   * shelf — which is why a brand-new channel listed ontologies nobody had put
   * there with nothing able to say so. The label is carried separately, never
   * re-derived.
   */
  it("🔒 the shelf's ids are kept BESIDE the scope, not merged away", async () => {
    prime({
      members: 2,
      personal: [OWNER_CONTAINER],
      shares: [shareRow({ members: "view", container: "ws-lender" })],
    });
    const audience = await resolveOntologyAudience(ctx({ userId: "user-me" }));
    if (audience.kind !== "resolved") throw new Error("unreachable");
    expect([...audience.homeSpaceWorkspaceIds]).toEqual([OWNER_CONTAINER]);
    // ⚠ A LENDER'S CONTAINER IS IN THE SCOPE AND IS NOT THE SHELF — somebody
    // else's ontology lent into this room is not the caller's own.
    expect(audience.homeSpaceWorkspaceIds).not.toContain("ws-lender");
    // ⚠ …and it is not the CALLING container either, which is what the label
    // distinguishes rows FROM.
    expect(audience.homeSpaceWorkspaceIds).not.toContain(LINK);
  });

  it("no shelf resolved ⇒ an empty label, never a guessed one", async () => {
    prime({ members: 2, personal: [] });
    const audience = await resolveOntologyAudience(ctx({ userId: "user-me" }));
    if (audience.kind !== "resolved") throw new Error("unreachable");
    expect([...audience.homeSpaceWorkspaceIds]).toEqual([]);
  });

  it("🔒 a SHARED CREDENTIAL has no shelf to label (M-10)", async () => {
    prime({ members: 1 });
    const audience = await resolveOntologyAudience(
      ctx({ credentialSubjectUserId: null, source: "agent" })
    );
    if (audience.kind !== "resolved") throw new Error("unreachable");
    expect([...audience.homeSpaceWorkspaceIds]).toEqual([]);
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
   * The OWNER arm — `created_by === userId`, which restores ROW 2 of
   * `./service-shared.ts`'s truth table (the caller's own home shelf,
   * reached from a room) and nothing else.
   *
   * It asks NOTHING about membership, so its soundness is the READ SCOPE's:
   * a row from a container the caller was removed from would answer `edit` and
   * simply never arrives. The second case states that in as many words.
   */
  it("the owner arm — `created_by`, restoring the home shelf and nothing more", async () => {
    prime({ members: 2, personal: [OWNER_CONTAINER] });
    const me = ctx({ userId: OWNER });
    // Row 2: the shelf is not the calling container, and there is no share row.
    expect(await levelOf(me, ontology({ workspace_id: OWNER_CONTAINER }))).toBe("edit");
    // …and it is the CREATOR, never "somebody in that container": a peer's
    // ontology sitting in the same container is still refused.
    expect(
      await levelOf(ctx({ userId: PEER }), ontology({ workspace_id: OWNER_CONTAINER }))
    ).toBe("none");
  });

  it("⚠ the owner arm checks NO membership — the read scope is what contains it", async () => {
    prime({ members: 2, personal: [OWNER_CONTAINER] });
    const me = ctx({ userId: OWNER });
    const audience = await resolveOntologyAudience(me);
    const left = ontology({ id: "c-left", workspace_id: "ws-i-was-removed-from" });
    // A row from a container this request never reached would answer `edit`…
    expect(levelForOntology(me, audience, left)).toBe("edit");
    // …which is safe ONLY because no query can return it: that container is not
    // in the scope, and `service-gates.ts` reads every row through the scope.
    expect(audience.workspaceIds).not.toContain(left.workspace_id);
  });
});
