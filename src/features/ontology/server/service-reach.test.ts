/**
 * Invariant suite — the reach read (`service-reach.ts › getReach`), the
 * producer the desktop's framing block had none of (F-681).
 *
 * What it must never do is over-promise. The one consumer is a
 * COMPENSATING CONTROL (INVARIANTS §4A): it tells an agent what it may open so
 * it stops discovering its level by being refused. A rung wider than the server
 * will enforce turns that control into a lie, so every case below asks whether
 * this read's answer IS `levelForOntology`'s — the same function the gates ask —
 * rather than whether it looks plausible.
 *
 * The guest rows of the matrix are in `./guest-lane.test.ts`, beside the
 * behaviour they bound.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ontologyContextFactory } from "./test-fixtures";

vi.mock("./repository-shares", () => ({
  findWorkspaceKind: vi.fn(),
  countActiveWorkspaceMembers: vi.fn(),
  listChannelIdsForWorkspace: vi.fn(),
  listSharesForChannels: vi.fn(),
}));

vi.mock("./repository-projections", () => ({
  listOntologySummaries: vi.fn(async () => []),
}));

vi.mock("@/shared/tenancy/home-space-reach", () => ({
  homeSpaceShelfContainerIds: vi.fn(async () => []),
}));

import * as narrowRepo from "./repository-projections";
import * as shareRepo from "./repository-shares";
import { getReach } from "./service-reach";

const mockNarrow = vi.mocked(narrowRepo);
const mockShares = vi.mocked(shareRepo);

const LINK = "ws-link";
const OWNER_WS = "ws-owner";
const MINE = "c-mine";
const THEIRS = "c-theirs";
const OWNER = "user-owner";

function summary(id: string, name: string, over: Partial<{ createdBy: string | null; agentsMayEdit: boolean }> = {}) {
  return {
    id,
    workspace_id: OWNER_WS,
    slug: name.toLowerCase(),
    name,
    purpose: "",
    created_by: over.createdBy === undefined ? OWNER : over.createdBy,
    agents_may_edit: over.agentsMayEdit ?? true,
  };
}

const ctx = ontologyContextFactory({
  workspaceId: LINK,
  userId: OWNER,
  credentialSubjectUserId: OWNER,
});

function prime(opts: {
  kind?: string;
  members?: number | null;
  shares?: Array<{ ontology: string; members?: string; ownerAgents?: string }>;
  ontologies?: ReturnType<typeof summary>[];
} = {}) {
  mockShares.findWorkspaceKind.mockResolvedValue(opts.kind ?? "link");
  mockShares.countActiveWorkspaceMembers.mockResolvedValue(
    opts.members === undefined ? 1 : opts.members
  );
  mockShares.listChannelIdsForWorkspace.mockResolvedValue(["ch-1"]);
  mockShares.listSharesForChannels.mockResolvedValue(
    (opts.shares ?? []).map((s) => ({
      ontology_id: s.ontology,
      channel_id: "ch-1",
      workspace_id: OWNER_WS,
      members_level: s.members ?? "none",
      guests_level: "none",
      owner_agents_level: s.ownerAgents ?? "none",
    })) as never
  );
  mockNarrow.listOntologySummaries.mockResolvedValue(
    (opts.ontologies ?? [summary(MINE, "Mine")]) as never
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("what a session is told it reaches", () => {
  it("names the ontology, its LENDER's container, and the rung", async () => {
    prime({ members: 2, shares: [{ ontology: MINE, members: "view" }] });
    expect(await getReach(ctx({ userId: "somebody-else" }))).toEqual([
      { id: MINE, name: "Mine", workspaceId: OWNER_WS, level: "view" },
    ]);
  });

  it("🔒 DROPS `none` rather than reporting it — an unreachable ontology is not this agent's business", async () => {
    prime({
      members: 2,
      shares: [{ ontology: MINE, members: "view" }],
      ontologies: [summary(MINE, "Mine"), summary(THEIRS, "Theirs", { createdBy: "someone" })],
    });
    const reach = await getReach(ctx({ userId: "somebody-else" }));
    expect(reach.map((r) => r.id)).toEqual([MINE]);
  });

  it("🔒 THE OWNER'S OWN AGENT gets `agents_may_edit`, not the owner's `edit`", async () => {
    // Samuel's solo toggle — the one matrix row that is not simply its human's,
    // and the reason this read must present the AGENT credential.
    prime({ members: 1, ontologies: [summary(MINE, "Mine", { agentsMayEdit: false })] });
    expect(await getReach(ctx({ source: "agent" }))).toEqual([
      { id: MINE, name: "Mine", workspaceId: OWNER_WS, level: "view" },
    ]);
    // …and the HUMAN in the same room still edits it.
    prime({ members: 1, ontologies: [summary(MINE, "Mine", { agentsMayEdit: false })] });
    expect((await getReach(ctx()))[0].level).toBe("edit");
  });

  it("a share row's `owner_agents_level` overrides the toggle for the owner's agent", async () => {
    prime({
      members: 2,
      shares: [{ ontology: MINE, ownerAgents: "edit" }],
      ontologies: [summary(MINE, "Mine", { agentsMayEdit: false })],
    });
    expect((await getReach(ctx({ source: "agent" })))[0].level).toBe("edit");
  });

  it("a STANDARD workspace answers `edit` on everything and costs no share fan (Q5)", async () => {
    prime({ kind: "standard" });
    expect((await getReach(ctx()))[0].level).toBe("edit");
    expect(mockShares.listSharesForChannels).not.toHaveBeenCalled();
  });

  it("🔒 an UNKNOWN container kind reaches NOTHING — F-683's arm, seen from the read", async () => {
    prime({ kind: "some-future-kind" });
    expect(await getReach(ctx())).toEqual([]);
    // The read scope is empty, so the ontology read is short-circuited too.
    expect(mockNarrow.listOntologySummaries).toHaveBeenCalledWith([]);
  });

  it("ONE read — no objects, no memberships, no relationships", async () => {
    prime({ members: 1 });
    await getReach(ctx());
    expect(mockNarrow.listOntologySummaries).toHaveBeenCalledTimes(1);
  });
});
