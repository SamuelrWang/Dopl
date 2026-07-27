/**
 * Unit tests for the consent service — the human-in-the-loop gate. Repos are
 * mocked; `service-shared` (loadVisibleChannel + resolvers) runs for real.
 *
 * Security-load-bearing invariants:
 *   - operator is ALWAYS the caller; a foreign / missing id is one not-found
 *     (no id probing across operators), including a cross-workspace id.
 *   - a standing trust rule auto-allows an inbound request (status
 *     'auto_allowed', decided_by 'trust') so the desktop can spawn — but only
 *     while the trusted teammate is still an active workspace member.
 *   - a decided request can't be re-decided, and the decision is a
 *     compare-and-swap so a late Allow can't clobber a human's Deny.
 *   - a trigger de-dupes at ANY status, both kinds: a DENIED trigger must
 *     never be re-raised, and an outbound retry must not stack review rows.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-collab");

import * as repo from "./repository";
import * as collab from "./repository-collab";
import {
  createConsentRequest,
  decideConsentRequest,
  getConsentRequest,
  listConsentRequests,
} from "./consent-service";
import { ChannelForbiddenError } from "./errors";
import {
  ConsentAlreadyDecidedError,
  ConsentNotFoundError,
} from "./errors";
import type { ChannelContext } from "./service-shared";
import type { ChannelRow, ChannelMemberRow } from "./dto";
import type { ConsentRequestRow } from "./collab-dto";

const WS = "ws-1";
const USER = "user-1";
const REQUESTER = "user-2";
const CHANNEL = "550e8400-e29b-41d4-a716-446655440000";

const ctx: ChannelContext = { workspaceId: WS, userId: USER, source: "user", role: "member" };

function channelRow(): ChannelRow {
  return {
    id: CHANNEL,
    workspace_id: WS,
    created_by: USER,
    slug: "general",
    name: "General",
    topic: "",
    visibility: "private",
    archived_at: null,
    deleted_at: null,
    created_at: "2026-07-20T00:00:00Z",
    updated_at: "2026-07-20T00:00:00Z",
  };
}

function memberRow(userId: string): ChannelMemberRow {
  return {
    channel_id: CHANNEL,
    user_id: userId,
    workspace_id: WS,
    role: userId === USER ? "owner" : "member",
    last_read_at: null,
    notify_scope: "all",
    agent_tool_profile: "full",
    added_by: USER,
    joined_at: "2026-07-20T00:00:00Z",
  };
}

function consentRow(overrides: Partial<ConsentRequestRow> = {}): ConsentRequestRow {
  return {
    id: "consent-1",
    channel_id: CHANNEL,
    workspace_id: WS,
    operator_user_id: USER,
    requester_user_id: REQUESTER,
    kind: "inbound",
    message_seq: 5,
    summary: "Pull the Q3 numbers",
    body_preview: "Can your agent pull the Q3 numbers?",
    proposed_reply: null,
    status: "pending",
    decided_by: null,
    decided_at: null,
    created_at: "2026-07-26T00:00:00Z",
    expires_at: "2026-07-26T00:30:00Z",
    ...overrides,
  };
}

function trustRow() {
  return {
    id: "t1",
    operator_user_id: USER,
    trusted_user_id: REQUESTER,
    workspace_id: WS,
    created_at: "2026-07-20T00:00:00Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findChannelById).mockResolvedValue(channelRow());
  vi.mocked(repo.findMembership).mockResolvedValue(memberRow(USER));
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(true);
  vi.mocked(collab.expireStalePending).mockResolvedValue(undefined);
  vi.mocked(collab.listConsentRequests).mockResolvedValue([]);
  vi.mocked(collab.findConsentByTrigger).mockResolvedValue(null);
  vi.mocked(collab.findTrustRule).mockResolvedValue(null);
  vi.mocked(collab.findMessageAuthorBySeq).mockResolvedValue(REQUESTER);
  vi.mocked(collab.insertConsentRequest).mockImplementation(
    async (row) => ({ ...consentRow(), ...row, id: "new-1" }) as ConsentRequestRow
  );
});

describe("createConsentRequest", () => {
  it("inbound: derives the requester from the message author, born pending", async () => {
    await createConsentRequest(ctx, { channelId: CHANNEL, kind: "inbound", messageSeq: 5, summary: "s", bodyPreview: "b" });
    const inserted = vi.mocked(collab.insertConsentRequest).mock.calls[0][0];
    expect(inserted.operator_user_id).toBe(USER);
    expect(inserted.requester_user_id).toBe(REQUESTER);
    expect(inserted.status).toBe("pending");
    expect(inserted.expires_at).not.toBeNull();
  });

  it("outbound: stores the proposed reply, no requester derivation", async () => {
    const out = await createConsentRequest(ctx, {
      channelId: CHANNEL,
      kind: "outbound",
      messageSeq: 5,
      summary: "Reply from your agent",
      bodyPreview: "here you go",
      proposedReply: "here you go",
    });
    const inserted = vi.mocked(collab.insertConsentRequest).mock.calls[0][0];
    expect(inserted.kind).toBe("outbound");
    expect(inserted.operator_user_id).toBe(USER);
    expect(inserted.proposed_reply).toBe("here you go");
    expect(inserted.status).toBe("pending");
    // Outbound is the operator's OWN agent — there is no requester to derive,
    // and trust must never short-circuit the approve-out gate.
    expect(inserted.requester_user_id).toBeNull();
    expect(collab.findMessageAuthorBySeq).not.toHaveBeenCalled();
    expect(out.kind).toBe("outbound");
  });

  it("inbound + trust rule → auto_allowed / decided_by=trust (desktop spawns)", async () => {
    vi.mocked(collab.findTrustRule).mockResolvedValue(trustRow());
    await createConsentRequest(ctx, { channelId: CHANNEL, kind: "inbound", messageSeq: 5, summary: "s", bodyPreview: "b" });
    const inserted = vi.mocked(collab.insertConsentRequest).mock.calls[0][0];
    expect(inserted.status).toBe("auto_allowed");
    expect(inserted.decided_by).toBe("trust");
    expect(inserted.expires_at).toBeNull();
  });

  it("trust does NOT survive the trusted user leaving the workspace (L-10)", async () => {
    // The rule row outlives the membership (nothing sweeps agent_trust_rules
    // on removal), so trust is re-validated at CONSUMPTION, not creation.
    vi.mocked(collab.findTrustRule).mockResolvedValue(trustRow());
    vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(false);
    await createConsentRequest(ctx, { channelId: CHANNEL, kind: "inbound", messageSeq: 5, summary: "s", bodyPreview: "b" });
    const inserted = vi.mocked(collab.insertConsentRequest).mock.calls[0][0];
    expect(inserted.status).toBe("pending");
    expect(inserted.decided_by).toBeNull();
  });

  it("inbound: de-dupes a retry for the same (channel, kind, messageSeq)", async () => {
    vi.mocked(collab.findConsentByTrigger).mockResolvedValue(consentRow({ id: "existing" }));
    const out = await createConsentRequest(ctx, { channelId: CHANNEL, kind: "inbound", messageSeq: 5, summary: "s", bodyPreview: "b" });
    expect(out.id).toBe("existing");
    expect(collab.insertConsentRequest).not.toHaveBeenCalled();
  });

  it("a DENIED trigger is NOT re-raised — the stored decision comes back (M-1)", async () => {
    // The desktop replays creates on crash-recovery. If a denied trigger could
    // be re-raised, a trust rule added in the meantime would auto-allow work
    // the human explicitly refused.
    vi.mocked(collab.findConsentByTrigger).mockResolvedValue(
      consentRow({ id: "denied-1", status: "denied", decided_by: "web" })
    );
    vi.mocked(collab.findTrustRule).mockResolvedValue(trustRow());
    const out = await createConsentRequest(ctx, { channelId: CHANNEL, kind: "inbound", messageSeq: 5, summary: "s", bodyPreview: "b" });
    expect(out.id).toBe("denied-1");
    expect(out.status).toBe("denied");
    expect(collab.insertConsentRequest).not.toHaveBeenCalled();
  });

  it("outbound de-dupes too — approving a retry can't double-post (M-2)", async () => {
    vi.mocked(collab.findConsentByTrigger).mockResolvedValue(
      consentRow({ id: "outbound-1", kind: "outbound", proposed_reply: "hi" })
    );
    const out = await createConsentRequest(ctx, {
      channelId: CHANNEL,
      kind: "outbound",
      messageSeq: 5,
      summary: "s",
      bodyPreview: "hi",
      proposedReply: "hi",
    });
    expect(out.id).toBe("outbound-1");
    expect(collab.insertConsentRequest).not.toHaveBeenCalled();
  });

  it("sweeps elapsed rows BEFORE the de-dupe read (L-11)", async () => {
    // Otherwise a past-TTL row is handed back as a live 'pending' prompt the
    // desktop then waits on until its own poll deadline.
    await createConsentRequest(ctx, { channelId: CHANNEL, kind: "inbound", messageSeq: 5, summary: "s", bodyPreview: "b" });
    expect(collab.expireStalePending).toHaveBeenCalledWith(USER);
    const sweepOrder = vi.mocked(collab.expireStalePending).mock.invocationCallOrder[0];
    const lookupOrder = vi.mocked(collab.findConsentByTrigger).mock.invocationCallOrder[0];
    expect(sweepOrder).toBeLessThan(lookupOrder);
  });

  it("converges on the stored row when a concurrent create wins the unique key", async () => {
    const raced = consentRow({ id: "raced" });
    vi.mocked(collab.insertConsentRequest).mockRejectedValue({ code: "23505" });
    vi.mocked(repo.pgErrorCode).mockReturnValue("23505");
    vi.mocked(collab.findConsentByTrigger)
      .mockResolvedValueOnce(null) // the pre-insert de-dupe read misses
      .mockResolvedValueOnce(raced); // the loser re-reads the winner
    const out = await createConsentRequest(ctx, { channelId: CHANNEL, kind: "inbound", messageSeq: 5, summary: "s", bodyPreview: "b" });
    expect(out.id).toBe("raced");
  });

  it("refuses a non-member raising a request (public channel, forbidden)", async () => {
    // A private-channel non-member 404s (existence must not leak); the
    // forbidden branch needs a visible-but-not-joined public channel.
    vi.mocked(repo.findChannelById).mockResolvedValue({ ...channelRow(), visibility: "public" });
    vi.mocked(repo.findMembership).mockResolvedValue(null);
    await expect(
      createConsentRequest(ctx, { channelId: CHANNEL, kind: "outbound", summary: "s", bodyPreview: "" })
    ).rejects.toBeInstanceOf(ChannelForbiddenError);
  });
});

describe("listConsentRequests — status filter (M-4)", () => {
  it("defaults to pending", async () => {
    await listConsentRequests(ctx);
    expect(vi.mocked(collab.listConsentRequests).mock.calls[0][1]).toMatchObject({
      statuses: ["pending"],
    });
  });

  it("'decided' opens the auto_allowed audit trail", async () => {
    // These rows are the ONLY record of "your agent ran N times without
    // asking you" — the stated justification for writing them.
    await listConsentRequests(ctx, { status: "decided" });
    expect(vi.mocked(collab.listConsentRequests).mock.calls[0][1]?.statuses).toContain(
      "auto_allowed"
    );
  });

  it("'all' applies no status predicate", async () => {
    await listConsentRequests(ctx, { status: "all" });
    expect(vi.mocked(collab.listConsentRequests).mock.calls[0][1]?.statuses).toBeUndefined();
  });
});

describe("getConsentRequest / decideConsentRequest — operator-only", () => {
  it("404s a request owned by a different operator (no id probing)", async () => {
    vi.mocked(collab.findConsentById).mockResolvedValue(
      consentRow({ operator_user_id: "someone-else" })
    );
    await expect(getConsentRequest(ctx, "consent-1")).rejects.toBeInstanceOf(
      ConsentNotFoundError
    );
  });

  it("404s a request from another WORKSPACE, even for the same operator", async () => {
    // The id is the caller's own, but reached with a different X-Workspace-Id.
    // Both fences must hold — operator AND workspace — or a request could be
    // read / decided from outside the workspace it belongs to.
    vi.mocked(collab.findConsentById).mockResolvedValue(
      consentRow({ workspace_id: "ws-other" })
    );
    await expect(getConsentRequest(ctx, "consent-1")).rejects.toBeInstanceOf(
      ConsentNotFoundError
    );
    await expect(
      decideConsentRequest(ctx, "consent-1", "allow")
    ).rejects.toBeInstanceOf(ConsentNotFoundError);
    expect(collab.updateConsentDecision).not.toHaveBeenCalled();
  });

  it("404s a missing row", async () => {
    vi.mocked(collab.findConsentById).mockResolvedValue(null);
    await expect(getConsentRequest(ctx, "consent-1")).rejects.toBeInstanceOf(
      ConsentNotFoundError
    );
  });

  it("allow → status allowed, decided_by web by default", async () => {
    vi.mocked(collab.findConsentById).mockResolvedValue(consentRow());
    vi.mocked(collab.updateConsentDecision).mockResolvedValue(
      consentRow({ status: "allowed", decided_by: "web" })
    );
    const out = await decideConsentRequest(ctx, "consent-1", "allow");
    expect(out.status).toBe("allowed");
    const patch = vi.mocked(collab.updateConsentDecision).mock.calls[0][1];
    expect(patch.status).toBe("allowed");
    expect(patch.decided_by).toBe("web");
  });

  it("records the deciding surface when the desktop dialog wins (M-6)", async () => {
    vi.mocked(collab.findConsentById).mockResolvedValue(consentRow());
    vi.mocked(collab.updateConsentDecision).mockResolvedValue(
      consentRow({ status: "denied", decided_by: "desktop" })
    );
    const out = await decideConsentRequest(ctx, "consent-1", "deny", "desktop");
    expect(vi.mocked(collab.updateConsentDecision).mock.calls[0][1].decided_by).toBe(
      "desktop"
    );
    expect(out.decidedBy).toBe("desktop");
  });

  it("refuses to re-decide an already-decided request", async () => {
    vi.mocked(collab.findConsentById).mockResolvedValue(consentRow({ status: "allowed" }));
    await expect(decideConsentRequest(ctx, "consent-1", "deny")).rejects.toBeInstanceOf(
      ConsentAlreadyDecidedError
    );
  });

  it("CAS: a decision that lost the race 409s instead of clobbering (H-2)", async () => {
    // The desktop dialog and the web card are concurrent writers by design.
    // Both read 'pending'; the loser's UPDATE matches no row (status is no
    // longer pending) and must NOT overwrite the winner's decision — a
    // human's Deny being replaced by a late Allow is the failure that
    // defeats the whole gate.
    vi.mocked(collab.findConsentById)
      .mockResolvedValueOnce(consentRow({ status: "pending" })) // authz pre-read
      .mockResolvedValueOnce(consentRow({ status: "denied" })); // re-read: who won
    vi.mocked(collab.updateConsentDecision).mockResolvedValue(null);

    const err = await decideConsentRequest(ctx, "consent-1", "allow").catch((e) => e);
    expect(err).toBeInstanceOf(ConsentAlreadyDecidedError);
    // The 409 names the status that actually won, not the stale pre-read.
    expect((err as ConsentAlreadyDecidedError).status).toBe("denied");
  });
});
