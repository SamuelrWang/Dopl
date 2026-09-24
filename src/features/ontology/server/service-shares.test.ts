/**
 * Invariant suite — the share write lane (spec §6 S3).
 *
 * What it pins is the ORDER of the fences, not merely that each exists: the
 * resource before the room, both 404 rather than 403, and the home-container
 * refusal LAST so that a 400 is only ever shown to somebody who has already
 * proved a membership. Reordering any pair turns this route into an oracle.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ontologyContextFactory } from "./test-fixtures";
import type { OntologyRow } from "./dto";

// The changelog capture is a real awaited write (`./service-revisions.ts`), so
// an unstubbed service test reaches `supabaseAdmin()` and fails on a missing
// service-role key. That the rows are recorded is `service-revisions.test.ts`'s subject.
vi.mock("@/features/revisions/server/repository", () => ({
  appendRevision: vi.fn(async () => ({ id: "rev-1" })),
  replaceRevisionSnapshot: vi.fn(async () => ({ id: "rev-1" })),
  findLatestRevision: vi.fn(async () => null),
  findRevisionById: vi.fn(async () => null),
  listRevisionsForResource: vi.fn(async () => []),
  listRevisionsForResources: vi.fn(async () => []),
}));

vi.mock("./repository", () => ({ findOntologyById: vi.fn() }));

vi.mock("./repository-shares", () => ({
  findWorkspaceKind: vi.fn(),
  countActiveWorkspaceMembers: vi.fn(async () => 1),
  listChannelIdsForWorkspace: vi.fn(async () => []),
  listSharesForChannels: vi.fn(async () => []),
  listSharesForOntology: vi.fn(),
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
const ONTOLOGY_ID = "11111111-1111-4111-8111-111111111111";
const CHANNEL_ID = "22222222-2222-4222-8222-222222222222";

const ONTOLOGY: OntologyRow = {
  id: ONTOLOGY_ID,
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

const ctx = ontologyContextFactory({
  workspaceId: PERSONAL,
  userId: OWNER,
  credentialSubjectUserId: OWNER,
});

const WRITE = {
  channelId: CHANNEL_ID,
  membersLevel: "view",
  guestsLevel: "none",
} as const;

function primeOpen() {
  mockShares.findWorkspaceKind.mockImplementation(async (id: string) =>
    id === LINK ? "link" : "personal"
  );
  mockRepo.findOntologyById.mockResolvedValue(ONTOLOGY);
  mockShares.listSharesForOntology.mockResolvedValue([]);
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
    mockRepo.findOntologyById.mockResolvedValue({ ...ONTOLOGY, created_by: "someone-else" });
    await expect(setOntologyShare(ctx(), ONTOLOGY_ID, WRITE)).rejects.toMatchObject({
      status: 404,
    });
    // The order is the point: probing the channel first would make this a
    // room oracle for anybody holding an ontology id.
    expect(mockShares.findChannelContainer).not.toHaveBeenCalled();
    expect(mockShares.upsertShare).not.toHaveBeenCalled();
  });

  it("an unknown ontology is the same 404, with the same silence", async () => {
    mockRepo.findOntologyById.mockResolvedValue(null);
    await expect(setOntologyShare(ctx(), ONTOLOGY_ID, WRITE)).rejects.toMatchObject({
      status: 404,
    });
    expect(mockShares.findChannelContainer).not.toHaveBeenCalled();
  });

  it("an unknown channel and a channel the caller cannot reach are the SAME 404", async () => {
    mockShares.findChannelContainer.mockResolvedValue(null);
    const unknown = await setOntologyShare(ctx(), ONTOLOGY_ID, WRITE).catch((e) => e);
    primeOpen();
    mockShares.findActiveMemberRole.mockResolvedValue(null);
    const unreachable = await setOntologyShare(ctx(), ONTOLOGY_ID, WRITE).catch((e) => e);
    expect(unknown.status).toBe(404);
    expect(unreachable.status).toBe(404);
    expect(unknown.message).toBe(unreachable.message);
    expect(mockShares.upsertShare).not.toHaveBeenCalled();
  });

  it("Q5 — a reachable channel in a STANDARD workspace is a 400 naming home channels", async () => {
    mockShares.findWorkspaceKind.mockResolvedValue("standard");
    const err = await setOntologyShare(ctx(), ONTOLOGY_ID, WRITE).catch((e) => e);
    expect(err.status).toBe(400);
    expect(err.message).toMatch(/home channel/i);
    expect(mockShares.upsertShare).not.toHaveBeenCalled();
  });

  it("🔒 an AGENT source is refused outright — it may not widen its operator's audience", async () => {
    const err = await setOntologyShare(ctx({ source: "agent" }), ONTOLOGY_ID, WRITE).catch(
      (e) => e
    );
    expect(err.status).toBe(403);
    expect(mockRepo.findOntologyById).not.toHaveBeenCalled();
    expect(mockShares.upsertShare).not.toHaveBeenCalled();
  });
});

describe("the write itself", () => {
  it("files the row under the ONTOLOGY's container, never the channel's", async () => {
    await setOntologyShare(ctx(), ONTOLOGY_ID, WRITE);
    expect(mockShares.upsertShare).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: PERSONAL, channelId: CHANNEL_ID })
    );
  });

  it("Q2 — the FIRST share seeds ownerAgentsLevel from agents_may_edit=true → edit", async () => {
    const share = await setOntologyShare(ctx(), ONTOLOGY_ID, WRITE);
    expect(share.ownerAgentsLevel).toBe("edit");
  });

  it("Q2 — the toggle OFF seeds view, not edit", async () => {
    mockRepo.findOntologyById.mockResolvedValue({ ...ONTOLOGY, agents_may_edit: false });
    const share = await setOntologyShare(ctx(), ONTOLOGY_ID, WRITE);
    expect(share.ownerAgentsLevel).toBe("view");
  });

  it("Q2 — an EXISTING row keeps its stored ownerAgentsLevel when the write omits it", async () => {
    mockShares.listSharesForOntology.mockResolvedValue([
      {
        ontology_id: ONTOLOGY_ID,
        channel_id: CHANNEL_ID,
        workspace_id: PERSONAL,
        members_level: "view",
        guests_level: "none",
        owner_agents_level: "none",
      },
    ]);
    const share = await setOntologyShare(ctx(), ONTOLOGY_ID, WRITE);
    // NOT re-seeded from the toggle: a share edit must never silently
    // re-decide what the owner already said about their own agents.
    expect(share.ownerAgentsLevel).toBe("none");
  });

  it("an explicit ownerAgentsLevel always wins", async () => {
    const share = await setOntologyShare(ctx(), ONTOLOGY_ID, {
      ...WRITE,
      ownerAgentsLevel: "none",
    });
    expect(share.ownerAgentsLevel).toBe("none");
  });
});

describe("unshare", () => {
  it("deletes the row after the same two fences", async () => {
    await unshareOntology(ctx(), ONTOLOGY_ID, CHANNEL_ID);
    expect(mockShares.deleteShare).toHaveBeenCalledWith(ONTOLOGY_ID, CHANNEL_ID);
  });

  it("is idempotent — a pair with no row is a success, not a 404", async () => {
    mockShares.deleteShare.mockResolvedValue(undefined);
    await expect(unshareOntology(ctx(), ONTOLOGY_ID, CHANNEL_ID)).resolves.toBeUndefined();
  });

  it("refuses an agent, and a foreign ontology, before deleting anything", async () => {
    await expect(
      unshareOntology(ctx({ source: "agent" }), ONTOLOGY_ID, CHANNEL_ID)
    ).rejects.toMatchObject({ status: 403 });
    mockRepo.findOntologyById.mockResolvedValue({ ...ONTOLOGY, created_by: "nope" });
    await expect(
      unshareOntology(ctx(), ONTOLOGY_ID, CHANNEL_ID)
    ).rejects.toMatchObject({ status: 404 });
    expect(mockShares.deleteShare).not.toHaveBeenCalled();
  });
});

describe("the read", () => {
  it("lists the rows and says canManage off the SERVER, not off the client", async () => {
    mockShares.listSharesForOntology.mockResolvedValue([
      {
        ontology_id: ONTOLOGY_ID,
        channel_id: CHANNEL_ID,
        workspace_id: PERSONAL,
        members_level: "edit",
        guests_level: "view",
        owner_agents_level: "view",
      },
    ]);
    const view = await listOntologyShares(ctx(), ONTOLOGY_ID);
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
    const view = await listOntologyShares(ctx({ source: "agent" }), ONTOLOGY_ID);
    expect(view.canManage).toBe(false);
  });

  it("404s an ontology that is not the caller's own", async () => {
    mockRepo.findOntologyById.mockResolvedValue({ ...ONTOLOGY, created_by: "nope" });
    await expect(listOntologyShares(ctx(), ONTOLOGY_ID)).rejects.toMatchObject({
      status: 404,
    });
  });
});
