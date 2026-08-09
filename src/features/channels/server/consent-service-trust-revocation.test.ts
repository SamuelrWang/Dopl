/**
 * CONSUME-TIME TRUST RE-VERIFICATION (CHANNELS-AUDIT C-19 / F-174).
 *
 * Split out of `consent-service.test.ts` (§2 cap) because it is its own lane
 * with its own failure mode: not "was this allowed?" but "is the authority
 * that allowed it still there?".
 *
 * The hole this pins: an `auto_allowed` row is born with `expires_at: null`
 * and nothing sweeps it, so trust used to be checked exactly once, at create.
 * The operator could revoke the rule (or the teammate could leave the
 * workspace) and the stored row still came back as an allow the desktop's
 * watcher spawned on.
 *
 * The seam is the SERVER read path, deliberately: the desktop polls
 * `GET /consent/[id]` and spawns the moment it reads an allow, and the row is
 * retired to `expired` — the watcher's existing terminal status — so an OLD
 * desktop build fails closed too, with no client change.
 *
 * Repos are mocked; `service-shared` (loadVisibleChannel + resolvers) runs for
 * real.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-collab");

import * as repo from "./repository";
import * as collab from "./repository-collab";
import {
  createConsentRequest,
  getConsentRequest,
  listConsentRequests,
} from "./consent-service";
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
    is_direct: false,
    direct_key: null,
    archived_at: null,
    deleted_at: null,
    created_at: "2026-07-20T00:00:00Z",
    updated_at: "2026-07-20T00:00:00Z",
  };
}

function memberRow(): ChannelMemberRow {
  return {
    channel_id: CHANNEL,
    user_id: USER,
    workspace_id: WS,
    role: "owner",
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

/** A row a standing trust rule already auto-allowed, waiting to be consumed. */
function autoAllowedRow(overrides: Partial<ConsentRequestRow> = {}) {
  return consentRow({
    id: "auto-1",
    status: "auto_allowed",
    decided_by: "trust",
    decided_at: "2026-07-26T00:00:00Z",
    expires_at: null,
    ...overrides,
  });
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

/** Arm a live standing rule for REQUESTER (rule row + active membership). */
function trustIsLive() {
  vi.mocked(collab.findTrustRule).mockResolvedValue(trustRow());
  vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(true);
}

beforeEach(() => {
  vi.clearAllMocks();
  // `clearAllMocks` clears calls but NOT a queued `mockResolvedValueOnce`, and
  // the CAS case queues two reads on this one — an unconsumed queue entry would
  // leak into the next test.
  vi.mocked(collab.findConsentById).mockReset();
  vi.mocked(repo.findChannelById).mockResolvedValue(channelRow());
  vi.mocked(repo.findMembership).mockResolvedValue(memberRow());
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
  vi.mocked(collab.expireRevokedAutoAllow).mockImplementation(async (id) =>
    consentRow({ id, status: "expired", decided_by: "trust" })
  );
});

describe("auto_allowed rows are re-verified at CONSUMPTION (C-19)", () => {
  // The desktop watcher polls GET /consent/[id] and spawns the moment it reads
  // an allow, so that read is the seam where a revoked rule has to bite. The
  // row is retired to 'expired', which is the watcher's existing terminal path
  // — so an OLD desktop build fails closed too, with no client change.

  it("revoked trust: the stored auto_allowed row no longer authorizes", async () => {
    vi.mocked(collab.findConsentById).mockResolvedValue(autoAllowedRow());
    vi.mocked(collab.findTrustRule).mockResolvedValue(null); // operator revoked
    const out = await getConsentRequest(ctx, "auto-1");
    expect(out.status).toBe("expired");
    expect(collab.expireRevokedAutoAllow).toHaveBeenCalledWith("auto-1");
  });

  it("trust intact: the row is handed back unchanged, nothing is written", async () => {
    vi.mocked(collab.findConsentById).mockResolvedValue(autoAllowedRow());
    trustIsLive();
    const out = await getConsentRequest(ctx, "auto-1");
    expect(out.status).toBe("auto_allowed");
    expect(out.decidedBy).toBe("trust");
    expect(collab.expireRevokedAutoAllow).not.toHaveBeenCalled();
  });

  it("the teammate LEAVING the workspace retires it too — no rule delete needed", async () => {
    // The case no revocation hook could ever catch: the rule row survives, but
    // trust is a statement about a current teammate (trust-service.ts:37-48).
    vi.mocked(collab.findConsentById).mockResolvedValue(autoAllowedRow());
    vi.mocked(collab.findTrustRule).mockResolvedValue(trustRow());
    vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(false);
    const out = await getConsentRequest(ctx, "auto-1");
    expect(out.status).toBe("expired");
  });

  it("a deleted requester account (null requester) fails closed", async () => {
    // ON DELETE SET NULL leaves nobody to re-verify against.
    vi.mocked(collab.findConsentById).mockResolvedValue(
      autoAllowedRow({ requester_user_id: null })
    );
    trustIsLive();
    const out = await getConsentRequest(ctx, "auto-1");
    expect(out.status).toBe("expired");
    expect(collab.findTrustRule).not.toHaveBeenCalled();
  });

  it("re-reads instead of returning the stale allow when the CAS loses", async () => {
    // Another writer moved the row between our read and the sweep. Returning
    // the copy we already refused to honor would be a fail-OPEN.
    vi.mocked(collab.findConsentById)
      .mockResolvedValueOnce(autoAllowedRow()) // requireOperatorRow
      .mockResolvedValueOnce(consentRow({ id: "auto-1", status: "denied" }));
    vi.mocked(collab.findTrustRule).mockResolvedValue(null);
    vi.mocked(collab.expireRevokedAutoAllow).mockResolvedValue(null);
    const out = await getConsentRequest(ctx, "auto-1");
    expect(out.status).toBe("denied");
  });

  it("a lost CAS whose re-read STILL says auto_allowed is refused anyway", async () => {
    // The fail-open this closes. The lost-CAS branch used to return whatever
    // the re-read found, which was only safe because `insertConsentRequest` is
    // the sole writer of `auto_allowed` — an invariant of a DIFFERENT file. If
    // the re-read comes back as an allow (a second writer, a replayed insert,
    // a future path that revives the status), returning it would hand the
    // desktop the exact allow this function refused one line earlier.
    vi.mocked(collab.findConsentById)
      .mockResolvedValueOnce(autoAllowedRow()) // requireOperatorRow
      .mockResolvedValueOnce(autoAllowedRow()); // …and the re-read agrees
    vi.mocked(collab.findTrustRule).mockResolvedValue(null); // trust is gone
    vi.mocked(collab.expireRevokedAutoAllow).mockResolvedValue(null); // CAS lost
    const out = await getConsentRequest(ctx, "auto-1");
    expect(out.status).toBe("expired");
    // Still the same row — this refuses the ALLOW, it does not invent a 404.
    expect(out.id).toBe("auto-1");
  });

  it("the crash-recovery create replay re-verifies the de-duped row", async () => {
    // The desktop replays creates on restart; the de-dupe hands back the
    // stored row. Without this it would hand back a live auto-allow written
    // under a rule the operator has since revoked.
    vi.mocked(collab.findConsentByTrigger).mockResolvedValue(autoAllowedRow());
    vi.mocked(collab.findTrustRule).mockResolvedValue(null);
    const out = await createConsentRequest(ctx, {
      channelId: CHANNEL,
      kind: "inbound",
      messageSeq: 5,
      summary: "s",
      bodyPreview: "b",
    });
    expect(out.status).toBe("expired");
    // IDEMPOTENCY IS PRESERVED: still one row, still the same id, no insert.
    expect(out.id).toBe("auto-1");
    expect(collab.insertConsentRequest).not.toHaveBeenCalled();
  });

  it("the de-dupe replay is unchanged while trust is intact", async () => {
    vi.mocked(collab.findConsentByTrigger).mockResolvedValue(autoAllowedRow());
    trustIsLive();
    const out = await createConsentRequest(ctx, {
      channelId: CHANNEL,
      kind: "inbound",
      messageSeq: 5,
      summary: "s",
      bodyPreview: "b",
    });
    expect(out.id).toBe("auto-1");
    expect(out.status).toBe("auto_allowed");
    expect(collab.expireRevokedAutoAllow).not.toHaveBeenCalled();
    expect(collab.insertConsentRequest).not.toHaveBeenCalled();
  });

  it("the 23505 converge path re-verifies the winner too", async () => {
    vi.mocked(collab.insertConsentRequest).mockRejectedValue({ code: "23505" });
    vi.mocked(repo.pgErrorCode).mockReturnValue("23505");
    vi.mocked(collab.findConsentByTrigger)
      .mockResolvedValueOnce(null) // pre-insert de-dupe read misses
      .mockResolvedValueOnce(autoAllowedRow()); // the stored winner
    vi.mocked(collab.findTrustRule).mockResolvedValue(null);
    const out = await createConsentRequest(ctx, {
      channelId: CHANNEL,
      kind: "inbound",
      messageSeq: 5,
      summary: "s",
      bodyPreview: "b",
    });
    expect(out.id).toBe("auto-1");
    expect(out.status).toBe("expired");
  });

  it("never touches a row that is not auto_allowed", async () => {
    // Only the trust-born status is re-derivable. A human's allow/deny and a
    // pending prompt are decisions this must not rewrite — de-dupe-at-any-
    // status depends on them coming back exactly as stored.
    for (const status of ["pending", "allowed", "denied", "expired"]) {
      vi.mocked(collab.findConsentById).mockResolvedValue(consentRow({ status }));
      const out = await getConsentRequest(ctx, "consent-1");
      expect(out.status).toBe(status);
    }
    expect(collab.expireRevokedAutoAllow).not.toHaveBeenCalled();
    expect(collab.findTrustRule).not.toHaveBeenCalled();
  });

  it("the audit list is NOT swept — history stays as recorded", async () => {
    // `decided`/`all` is the "your agent ran N times without asking you"
    // trail. Nothing authorizes from it (decide CASes on 'pending'), so a
    // revocation must not retroactively relabel work that really ran.
    vi.mocked(collab.listConsentRequests).mockResolvedValue([autoAllowedRow()]);
    vi.mocked(collab.findTrustRule).mockResolvedValue(null);
    const out = await listConsentRequests(ctx, { status: "decided" });
    expect(out[0].status).toBe("auto_allowed");
    expect(collab.expireRevokedAutoAllow).not.toHaveBeenCalled();
  });
});
