/**
 * The consent service — human-in-the-loop gate, OUTBOUND ONLY since 2026-08-22.
 * Repos mocked; `service-shared` runs for real. Security-load-bearing
 * invariants:
 *   - ⚠ operator is ALWAYS the caller; a foreign / missing / cross-workspace id
 *     is ONE not-found, so ids cannot be probed across operators;
 *   - a decided request can't be re-decided; the decision is a
 *     compare-and-swap so a late Allow can't clobber a human's Deny;
 *   - a trigger de-dupes at ANY status.
 *
 * ⚠ THREE FAMILIES OF CASE LEFT THIS FILE WITH THE INBOUND LANE (Samuel:
 * "remove all the stuff about declining and approving of threads"): the
 * requester-derivation cases (inbound-only), the standing-trust birth cases
 * (`auto_allowed` / `decided_by='trust'`), and the whole of
 * `consent-service-trust-revocation.test.ts`, which pinned the consume-time
 * re-derivation of a rule that can no longer be stored. What replaces them is
 * ONE case: an inbound create is refused, and refused at the SCHEMA rather than
 * here — see `schema.test.ts › kind: OUTBOUND only`.
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
/** ⚠ Only STORED (historical) inbound rows carry one — nothing derives a
 *  requester any more. Kept because the audit read still hydrates them. */
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
    is_direct: false,
    direct_key: null,
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
    favorited_at: null,
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

beforeEach(() => {
  vi.clearAllMocks();
  // ⚠ `clearAllMocks` clears calls but NOT a queued `mockResolvedValueOnce`,
  // and the CAS case queues two reads here. Reset the queue explicitly.
  vi.mocked(collab.findConsentById).mockReset();
  vi.mocked(repo.findChannelById).mockResolvedValue(channelRow());
  vi.mocked(repo.findMembership).mockResolvedValue(memberRow(USER));
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(true);
  vi.mocked(collab.expireStalePending).mockResolvedValue(undefined);
  vi.mocked(collab.listConsentRequests).mockResolvedValue([]);
  vi.mocked(collab.findConsentByTrigger).mockResolvedValue(null);
  vi.mocked(collab.insertConsentRequest).mockImplementation(
    async (row) => ({ ...consentRow(), ...row, id: "new-1" }) as ConsentRequestRow
  );
});

describe("createConsentRequest", () => {
  const outbound = (over: Record<string, unknown> = {}) => ({
    channelId: CHANNEL,
    kind: "outbound" as const,
    messageSeq: 5,
    summary: "Reply from your agent",
    bodyPreview: "here you go",
    proposedReply: "here you go",
    ...over,
  });

  it("outbound: stores the proposed reply, born pending with a TTL", async () => {
    const out = await createConsentRequest(ctx, outbound());
    const inserted = vi.mocked(collab.insertConsentRequest).mock.calls[0][0];
    expect(inserted.kind).toBe("outbound");
    expect(inserted.operator_user_id).toBe(USER);
    expect(inserted.proposed_reply).toBe("here you go");
    expect(inserted.status).toBe("pending");
    expect(inserted.expires_at).not.toBeNull();
    expect(out.kind).toBe("outbound");
  });

  it("derives NO requester (2026-08-22)", async () => {
    // ⚠ An outbound review is about the operator's OWN draft. The lookup that
    // filled `requester_user_id` was inbound-only, and it is DELETED rather than
    // left unused — `repository-messages.ts › findMessageAuthorBySeq` no longer
    // exists, which is a stronger guarantee than a `not.toHaveBeenCalled()`:
    // there is nothing left to call. This module no longer touches
    // `repository-messages` at all, which is why it is not even mocked here.
    await createConsentRequest(ctx, outbound());
    const inserted = vi.mocked(collab.insertConsentRequest).mock.calls[0][0];
    expect(inserted.requester_user_id).toBeNull();
  });

  it("NEVER births an auto-allow — the standing-trust branch is gone", async () => {
    // ⚠ THE SHARP ONE. `auto_allowed` / `decided_by='trust'` skipped the human
    // entirely, and `agent_trust_rules` is dropped. A row born with either would
    // be an outbound reply leaving the machine with nobody having pressed Send —
    // exactly what approve-out exists to prevent.
    await createConsentRequest(ctx, outbound());
    const inserted = vi.mocked(collab.insertConsentRequest).mock.calls[0][0];
    expect(inserted.status).toBe("pending");
    expect(inserted.decided_by).toBeNull();
    expect(inserted.decided_at).toBeNull();
  });

  it("de-dupes a retry for the same (channel, kind, messageSeq)", async () => {
    // ⚠ Approving each copy of a retried review posts the agent's reply twice.
    vi.mocked(collab.findConsentByTrigger).mockResolvedValue(
      consentRow({ id: "outbound-1", kind: "outbound", proposed_reply: "hi" })
    );
    const out = await createConsentRequest(ctx, outbound());
    expect(out.id).toBe("outbound-1");
    expect(collab.insertConsentRequest).not.toHaveBeenCalled();
  });

  it("a DENIED trigger is NOT re-raised — the stored decision comes back (M-1)", async () => {
    // ⚠ Desktop replays creates on crash-recovery, so a review the human
    // CANCELLED must come back cancelled rather than re-raised.
    vi.mocked(collab.findConsentByTrigger).mockResolvedValue(
      consentRow({ id: "denied-1", kind: "outbound", status: "denied", decided_by: "web" })
    );
    const out = await createConsentRequest(ctx, outbound());
    expect(out.id).toBe("denied-1");
    expect(out.status).toBe("denied");
    expect(collab.insertConsentRequest).not.toHaveBeenCalled();
  });

  it("hands back a de-duped row as it stands, with no re-derivation (2026-08-22)", async () => {
    // ⚠ Both converge paths ran `revalidateAutoAllow` before the retirement. The
    // status it re-derived can no longer be written, so the row is returned as
    // stored — including a row that IS `auto_allowed` from before the change,
    // which is history and not something this path may rewrite.
    vi.mocked(collab.findConsentByTrigger).mockResolvedValue(
      consentRow({ id: "old-1", kind: "outbound", status: "allowed", decided_by: "desktop" })
    );
    const out = await createConsentRequest(ctx, outbound());
    expect(out.status).toBe("allowed");
    expect(collab.updateConsentDecision).not.toHaveBeenCalled();
  });

  it("sweeps elapsed rows BEFORE the de-dupe read (L-11)", async () => {
    // Otherwise a past-TTL row is handed back as a live 'pending' prompt.
    await createConsentRequest(ctx, outbound());
    expect(collab.expireStalePending).toHaveBeenCalledWith(USER);
    const sweepOrder = vi.mocked(collab.expireStalePending).mock.invocationCallOrder[0];
    const lookupOrder = vi.mocked(collab.findConsentByTrigger).mock.invocationCallOrder[0];
    expect(sweepOrder).toBeLessThan(lookupOrder);
  });

  it("converges on the stored row when a concurrent create wins the unique key", async () => {
    const raced = consentRow({ id: "raced", kind: "outbound" });
    vi.mocked(collab.insertConsentRequest).mockRejectedValue({ code: "23505" });
    vi.mocked(repo.pgErrorCode).mockReturnValue("23505");
    vi.mocked(collab.findConsentByTrigger)
      .mockResolvedValueOnce(null) // the pre-insert de-dupe read misses
      .mockResolvedValueOnce(raced); // the loser re-reads the winner
    const out = await createConsentRequest(ctx, outbound());
    expect(out.id).toBe("raced");
  });

  it("refuses a non-member raising a request (public channel, forbidden)", async () => {
    // ⚠ Private-channel non-member 404s (existence must not leak), so the
    // forbidden branch needs a visible-but-not-joined public channel.
    vi.mocked(repo.findChannelById).mockResolvedValue({ ...channelRow(), visibility: "public" });
    vi.mocked(repo.findMembership).mockResolvedValue(null);
    await expect(
      createConsentRequest(ctx, outbound({ messageSeq: undefined }))
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

  it("'decided' still opens the FULL audit trail, retired statuses included", async () => {
    // ⚠ THE RETIREMENT MAY NOT REWRITE HISTORY (2026-08-22). `auto_allowed` has
    // no writer left, and decided INBOUND rows have no lane left — this filter
    // is the only way a human reads either back, so narrowing it to the statuses
    // that are still producible would delete the record rather than the feature.
    await listConsentRequests(ctx, { status: "decided" });
    const statuses = vi.mocked(collab.listConsentRequests).mock.calls[0][1]?.statuses;
    expect(statuses).toContain("auto_allowed");
    expect(statuses).toEqual(
      expect.arrayContaining(["allowed", "denied", "expired", "auto_allowed"])
    );
  });

  it("hydrates a stored INBOUND row's requester — the audit read still renders it", async () => {
    // ⚠ `requester_user_id` has no writer any more and is still READ. Same rule
    // as the reserved metadata keys that are stripped but never re-stamped: a
    // column something renders is not dead.
    vi.mocked(collab.listConsentRequests).mockResolvedValue([
      consentRow({ kind: "inbound", status: "denied", decided_by: "desktop" }),
    ]);
    vi.mocked(repo.fetchProfiles).mockResolvedValue([
      { id: REQUESTER, display_name: "Diana", email: "diana@example.com", avatar_url: null },
    ]);
    const [row] = await listConsentRequests(ctx, { status: "decided" });
    expect(row.kind).toBe("inbound");
    expect(row.requesterName).toBe("Diana");
  });

  it("'all' applies no status predicate", async () => {
    await listConsentRequests(ctx, { status: "all" });
    expect(vi.mocked(collab.listConsentRequests).mock.calls[0][1]?.statuses).toBeUndefined();
  });

  // ⚠ A consent row carries `operator_user_id` and nothing else naming its
  // workspace, and the read runs under the service-role client (no RLS), so an
  // operator-only filter shows every workspace's requests at once. The
  // workspace bound must travel with the query.
  it("scopes the read to the ACTIVE workspace, not just the operator", async () => {
    await listConsentRequests(ctx);
    expect(vi.mocked(collab.listConsentRequests).mock.calls[0][0]).toBe(USER);
    expect(vi.mocked(collab.listConsentRequests).mock.calls[0][1]).toMatchObject({
      workspaceId: WS,
    });
  });

  it("carries the workspace on every status filter, not only the default", async () => {
    for (const status of ["pending", "decided", "all"] as const) {
      vi.mocked(collab.listConsentRequests).mockClear();
      await listConsentRequests(ctx, { status });
      expect(vi.mocked(collab.listConsentRequests).mock.calls[0][1]?.workspaceId).toBe(WS);
    }
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
    // ⚠ Caller's own id reached with a different X-Workspace-Id. BOTH fences
    // must hold, or a request is readable/decidable from outside its workspace.
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

  it("returns a row as STORED — no re-derivation on the consume read (2026-08-22)", async () => {
    // ⚠ `getConsentRequest` ran `revalidateAutoAllow` here. Its subject status
    // has no writer left, so the read hands back what the table holds and never
    // CASes on the way out.
    vi.mocked(collab.findConsentById).mockResolvedValue(
      consentRow({ kind: "outbound", status: "allowed", decided_by: "web" })
    );
    const out = await getConsentRequest(ctx, "consent-1");
    expect(out.status).toBe("allowed");
    expect(collab.updateConsentDecision).not.toHaveBeenCalled();
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
    // ⚠ Desktop dialog and web card are concurrent writers by design. Both read
    // 'pending'; the loser's UPDATE matches no row and must NOT overwrite the
    // winner — a Deny replaced by a late Allow defeats the whole gate.
    vi.mocked(collab.findConsentById)
      .mockResolvedValueOnce(consentRow({ status: "pending" })) // authz pre-read
      .mockResolvedValueOnce(consentRow({ status: "denied" })); // re-read: who won
    vi.mocked(collab.updateConsentDecision).mockResolvedValue(null);

    const err = await decideConsentRequest(ctx, "consent-1", "allow").catch((e) => e);
    expect(err).toBeInstanceOf(ConsentAlreadyDecidedError);
    // ⚠ The 409 names the status that WON, not the stale pre-read.
    expect((err as ConsentAlreadyDecidedError).status).toBe("denied");
  });
});
