/**
 * INVARIANT SUITE — 🔒 THE SHARE WRITE LANE (spec §6 S3).
 *
 * What it pins is the ORDER of the fences, not merely that each exists: the
 * resource before the room, both 404 rather than 403, and the home-container
 * refusal LAST so that a 400 is only ever shown to somebody who has already
 * proved a membership. Reordering any pair turns this route into an oracle,
 * and every case below fails when one is moved.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OntologyContext } from "../types";
import type { OntologyClusterRow } from "./dto";

// ⚠ **THE CHANGELOG CAPTURE IS A REAL WRITE AND IT IS AWAITED**
// (`./service-revisions.ts`, 2026-09-09, part 2): every ontology write now
// records one revision per CHANGED FIELD inside the same request, so a service
// test that leaves it alone reaches `supabaseAdmin()` and fails on a missing
// service-role key. Stubbed here because these suites are about the WRITE, not
// about its audit rows — that the rows are recorded, one per changed field, per
// path, is `service-revisions.test.ts`'s subject.
vi.mock("@/features/revisions/server/repository", () => ({
  appendRevision: vi.fn(async () => ({ id: "rev-1" })),
  replaceRevisionSnapshot: vi.fn(async () => ({ id: "rev-1" })),
  findLatestRevision: vi.fn(async () => null),
  findRevisionById: vi.fn(async () => null),
  listRevisionsForResource: vi.fn(async () => []),
  listRevisionsForResources: vi.fn(async () => []),
}));

vi.mock("./repository", () => ({ findClusterById: vi.fn() }));

vi.mock("./repository-shares", () => ({
  findWorkspaceKind: vi.fn(),
  countActiveWorkspaceMembers: vi.fn(async () => 1),
  listChannelIdsForWorkspace: vi.fn(async () => []),
  listSharesForChannels: vi.fn(async () => []),
  listSharesForCluster: vi.fn(),
  upsertShare: vi.fn(),
  deleteShare: vi.fn(),
  findChannelContainer: vi.fn(),
  findActiveMemberRole: vi.fn(),
}));

vi.mock("@/shared/tenancy/personal-reach", () => ({
  personalShelfContainerIds: vi.fn(async () => []),
}));

import * as repo from "./repository";
import * as shares from "./repository-shares";
import {
  listOntologyShares,
  setOntologyShare,
  unshareOntology,
} from "./service-shares";

const mockRepo = vi.mocked(repo);
const mockShares = vi.mocked(shares);

const OWNER = "user-owner";
const PERSONAL = "ws-personal";
const LINK = "ws-link";
const CLUSTER_ID = "11111111-1111-4111-8111-111111111111";
const CHANNEL_ID = "22222222-2222-4222-8222-222222222222";

const CLUSTER: OntologyClusterRow = {
  id: CLUSTER_ID,
  workspace_id: PERSONAL,
  slug: "sales",
  name: "Sales",
  purpose: "",
  layout: {},
  position: 0,
  created_by: OWNER,
  agents_may_edit: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
};

function ctx(over: Partial<OntologyContext> = {}): OntologyContext {
  return {
    workspaceId: PERSONAL,
    userId: OWNER,
    role: "member",
    source: "user",
    credentialSubjectUserId: OWNER,
    ...over,
  };
}

const WRITE = {
  channelId: CHANNEL_ID,
  membersLevel: "view",
  guestsLevel: "none",
} as const;

function primeOpen() {
  mockShares.findWorkspaceKind.mockImplementation(async (id: string) =>
    id === LINK ? "link" : "personal"
  );
  mockRepo.findClusterById.mockResolvedValue(CLUSTER);
  mockShares.listSharesForCluster.mockResolvedValue([]);
  mockShares.findChannelContainer.mockResolvedValue({
    channelId: CHANNEL_ID,
    workspaceId: LINK,
  });
  mockShares.findActiveMemberRole.mockResolvedValue("member");
  mockShares.upsertShare.mockImplementation(async (input) => ({
    ontology_id: input.ontologyId,
    channel_id: input.channelId,
    workspace_id: input.workspaceId,
    members_level: input.membersLevel,
    guests_level: input.guestsLevel,
    owner_agents_level: input.ownerAgentsLevel,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  primeOpen();
});

describe("fence order — the resource, then the room, both 404", () => {
  it("an ontology that is not the caller's OWN is 404 and never touches the channel", async () => {
    mockRepo.findClusterById.mockResolvedValue({ ...CLUSTER, created_by: "someone-else" });
    await expect(setOntologyShare(ctx(), CLUSTER_ID, WRITE)).rejects.toMatchObject({
      status: 404,
    });
    // 🔒 THE ORDER IS THE POINT: probing the channel first would make this a
    // room oracle for anybody holding a cluster id.
    expect(mockShares.findChannelContainer).not.toHaveBeenCalled();
    expect(mockShares.upsertShare).not.toHaveBeenCalled();
  });

  it("an unknown ontology is the same 404, with the same silence", async () => {
    mockRepo.findClusterById.mockResolvedValue(null);
    await expect(setOntologyShare(ctx(), CLUSTER_ID, WRITE)).rejects.toMatchObject({
      status: 404,
    });
    expect(mockShares.findChannelContainer).not.toHaveBeenCalled();
  });

  it("an unknown channel and a channel the caller cannot reach are the SAME 404", async () => {
    mockShares.findChannelContainer.mockResolvedValue(null);
    const unknown = await setOntologyShare(ctx(), CLUSTER_ID, WRITE).catch((e) => e);
    primeOpen();
    mockShares.findActiveMemberRole.mockResolvedValue(null);
    const unreachable = await setOntologyShare(ctx(), CLUSTER_ID, WRITE).catch((e) => e);
    expect(unknown.status).toBe(404);
    expect(unreachable.status).toBe(404);
    expect(unknown.message).toBe(unreachable.message);
    expect(mockShares.upsertShare).not.toHaveBeenCalled();
  });

  it("Q5 — a reachable channel in a STANDARD workspace is a 400 naming home channels", async () => {
    mockShares.findWorkspaceKind.mockResolvedValue("standard");
    const err = await setOntologyShare(ctx(), CLUSTER_ID, WRITE).catch((e) => e);
    expect(err.status).toBe(400);
    expect(err.message).toMatch(/home channel/i);
    expect(mockShares.upsertShare).not.toHaveBeenCalled();
  });

  it("🔒 an AGENT source is refused outright — it may not widen its operator's audience", async () => {
    const err = await setOntologyShare(ctx({ source: "agent" }), CLUSTER_ID, WRITE).catch(
      (e) => e
    );
    expect(err.status).toBe(403);
    expect(mockRepo.findClusterById).not.toHaveBeenCalled();
    expect(mockShares.upsertShare).not.toHaveBeenCalled();
  });
});

describe("the write itself", () => {
  it("files the row under the ONTOLOGY's container, never the channel's", async () => {
    await setOntologyShare(ctx(), CLUSTER_ID, WRITE);
    expect(mockShares.upsertShare).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: PERSONAL, channelId: CHANNEL_ID })
    );
  });

  it("Q2 — the FIRST share seeds ownerAgentsLevel from agents_may_edit=true → edit", async () => {
    const share = await setOntologyShare(ctx(), CLUSTER_ID, WRITE);
    expect(share.ownerAgentsLevel).toBe("edit");
  });

  it("Q2 — the toggle OFF seeds view, not edit", async () => {
    mockRepo.findClusterById.mockResolvedValue({ ...CLUSTER, agents_may_edit: false });
    const share = await setOntologyShare(ctx(), CLUSTER_ID, WRITE);
    expect(share.ownerAgentsLevel).toBe("view");
  });

  it("Q2 — an EXISTING row keeps its stored ownerAgentsLevel when the write omits it", async () => {
    mockShares.listSharesForCluster.mockResolvedValue([
      {
        ontology_id: CLUSTER_ID,
        channel_id: CHANNEL_ID,
        workspace_id: PERSONAL,
        members_level: "view",
        guests_level: "none",
        owner_agents_level: "none",
      },
    ]);
    const share = await setOntologyShare(ctx(), CLUSTER_ID, WRITE);
    // ⚠ NOT re-seeded from the toggle: a share edit must never silently
    // re-decide what the owner already said about their own agents.
    expect(share.ownerAgentsLevel).toBe("none");
  });

  it("an explicit ownerAgentsLevel always wins", async () => {
    const share = await setOntologyShare(ctx(), CLUSTER_ID, {
      ...WRITE,
      ownerAgentsLevel: "none",
    });
    expect(share.ownerAgentsLevel).toBe("none");
  });
});

describe("unshare", () => {
  it("deletes the row after the same two fences", async () => {
    await unshareOntology(ctx(), CLUSTER_ID, CHANNEL_ID);
    expect(mockShares.deleteShare).toHaveBeenCalledWith(CLUSTER_ID, CHANNEL_ID);
  });

  it("is idempotent — a pair with no row is a success, not a 404", async () => {
    mockShares.deleteShare.mockResolvedValue(undefined);
    await expect(unshareOntology(ctx(), CLUSTER_ID, CHANNEL_ID)).resolves.toBeUndefined();
  });

  it("refuses an agent, and a foreign ontology, before deleting anything", async () => {
    await expect(
      unshareOntology(ctx({ source: "agent" }), CLUSTER_ID, CHANNEL_ID)
    ).rejects.toMatchObject({ status: 403 });
    mockRepo.findClusterById.mockResolvedValue({ ...CLUSTER, created_by: "nope" });
    await expect(
      unshareOntology(ctx(), CLUSTER_ID, CHANNEL_ID)
    ).rejects.toMatchObject({ status: 404 });
    expect(mockShares.deleteShare).not.toHaveBeenCalled();
  });
});

describe("the read", () => {
  it("lists the rows and says canManage off the SERVER, not off the client", async () => {
    mockShares.listSharesForCluster.mockResolvedValue([
      {
        ontology_id: CLUSTER_ID,
        channel_id: CHANNEL_ID,
        workspace_id: PERSONAL,
        members_level: "edit",
        guests_level: "view",
        owner_agents_level: "view",
      },
    ]);
    const view = await listOntologyShares(ctx(), CLUSTER_ID);
    expect(view.canManage).toBe(true);
    expect(view.shares).toEqual([
      {
        channelId: CHANNEL_ID,
        membersLevel: "edit",
        guestsLevel: "view",
        ownerAgentsLevel: "view",
      },
    ]);
  });

  it("an agent reads the list but canManage is false — the dialog cannot offer an editor the write refuses", async () => {
    const view = await listOntologyShares(ctx({ source: "agent" }), CLUSTER_ID);
    expect(view.canManage).toBe(false);
  });

  it("404s a cluster that is not the caller's own", async () => {
    mockRepo.findClusterById.mockResolvedValue({ ...CLUSTER, created_by: "nope" });
    await expect(listOntologyShares(ctx(), CLUSTER_ID)).rejects.toMatchObject({
      status: 404,
    });
  });
});
