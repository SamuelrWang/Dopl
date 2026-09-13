/**
 * INVARIANT SUITE — **RULE B: THE CALLING CHANNEL'S CONTAINER PAYS** (Samuel,
 * 2026-09-13: *"The wallet needs to match the histogram. That's the whole
 * point."*). The arms `credits-service.test.ts` and `credits-link-reroute.test.ts`
 * cannot hold, because every case there is the CHANNEL-LESS fallback.
 *
 * What is pinned:
 *   1. **THE FIVE ARMS Samuel named.** Home-channel agent → the channel owner's
 *      PERSONAL wallet + the channel id, whatever it touches. Workspace-channel
 *      agent → the CALLER'S SEAT in that workspace + the channel id, whatever it
 *      touches. Desktop (channel-less) call → the RESOURCE's container, channel
 *      `null`, on both a workspace and a home resource. Sub-agent → the channel
 *      ITS OWN session names.
 *   2. 🔒 **THE FENCE.** The channel arrives on `X-Dopl-Session-Id`, which any
 *      device-token holder can forge, and under rule B it decides WHOSE WALLET
 *      MOVES. A channel in a container the caller is not an active member of is
 *      IGNORED (and logged) — never billed, never refused.
 *   3. **THE LEDGER's `channel_id`**, which is what makes the /home histogram the
 *      wallet's own breakdown: every metered burn files the channel it was
 *      attributed to, or `null` for Desktop agent.
 *   4. **THE ROUND-TRIP COST, by mock call count** — 0 extra with no channel, 1
 *      when the channel is in the addressed container, 2 across containers.
 *
 * ⚠ Repositories mocked; `channel-attribution.ts`, `containerTarget` and
 * `personal-wallet.ts` are REAL, so the rule is proven end to end from a caller's
 * session key to the wallet RPC and the ledger row.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WorkspaceBillingRow } from "./workspace-billing";

vi.mock("./credit-ledger", () => ({ recordCreditUsageEvent: vi.fn() }));

vi.mock("./workspace-billing", () => ({
  getWorkspaceBilling: vi.fn(),
  getPersonalBilling: vi.fn(),
  countActiveMembers: vi.fn(),
  countOntologyObjects: vi.fn(),
}));

vi.mock("./credit-wallets", () => ({
  consumeUserCredits: vi.fn(),
  consumeMemberCredits: vi.fn(),
  getUserCreditsUsed: vi.fn(),
  getMemberCreditsUsed: vi.fn(),
}));

vi.mock("./channel-container", () => ({ findChannelContainer: vi.fn() }));

vi.mock("@/features/workspaces/server/repository", () => ({
  findActiveOwnerUserId: vi.fn(),
  findMembership: vi.fn(),
}));

import * as repo from "./workspace-billing";
import * as wallets from "./credit-wallets";
import { findChannelContainer } from "./channel-container";
import {
  findActiveOwnerUserId,
  findMembership,
} from "@/features/workspaces/server/repository";
import { recordCreditUsageEvent } from "./credit-ledger";
import { consumeMcpCredits, resolveBillingTarget } from "./credits-service";

const mockRepo = vi.mocked(repo);
const mockWallets = vi.mocked(wallets);
const mockChannel = vi.mocked(findChannelContainer);
const mockOwner = vi.mocked(findActiveOwnerUserId);
const mockMember = vi.mocked(findMembership);
const mockLedger = vi.mocked(recordCreditUsageEvent);

/** The operator's home channel: a `kind='link'` container they own. */
const HOME_CHANNEL = "chan-home";
const HOME_CONTAINER = "ws-link-1";
/** A standard workspace, and a channel inside it. */
const TEAM_CHANNEL = "chan-team";
const TEAM_WS = "ws-standard-1";
/** The operator's own shelf. */
const PERSONAL = "ws-personal-1";

const OWNER = "user-operator";
const GUEST = "user-guest";

function billing(over: Partial<WorkspaceBillingRow> = {}): WorkspaceBillingRow {
  return {
    workspaceId: TEAM_WS,
    plan: "team",
    status: "active",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    stripePriceId: "price_seat",
    seatCount: 3,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    lastStripeEventCreated: null,
    ...over,
  };
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  mockRepo.getWorkspaceBilling.mockResolvedValue(null);
  mockRepo.getPersonalBilling.mockResolvedValue({
    containerId: PERSONAL,
    billing: null,
  });
  mockRepo.countActiveMembers.mockResolvedValue(3);
  mockOwner.mockResolvedValue(OWNER);
  // An active membership row. ⚠ `findMembership` filters `status='active'`, so a
  // row IS the active answer — the fence reads its presence, not its fields.
  mockMember.mockResolvedValue({
    workspaceId: TEAM_WS,
    userId: GUEST,
    role: "member",
    status: "active",
    joinedAt: "2026-09-01T00:00:00.000Z",
    lastSeenAt: null,
  } as unknown as Awaited<ReturnType<typeof findMembership>>);
  mockWallets.consumeUserCredits.mockResolvedValue({ allowed: true, used: 1 });
  mockWallets.consumeMemberCredits.mockResolvedValue({ allowed: true, used: 1 });
});

afterEach(() => {
  warn.mockRestore();
});

/** The channel's row, as `findChannelContainer` answers it. */
function homeChannel() {
  return {
    channelId: HOME_CHANNEL,
    workspaceId: HOME_CONTAINER,
    kind: "link",
  };
}
function teamChannel() {
  return { channelId: TEAM_CHANNEL, workspaceId: TEAM_WS, kind: "standard" };
}

describe("🔒 rule B, arm 1 — a HOME-CHANNEL agent pays the owner's PERSONAL wallet, whatever it touches", () => {
  it("reading a WORKSPACE KB charges the personal wallet, filed under the home channel", async () => {
    // ⚠ THE CASE THE WHOLE WAVE EXISTS FOR. The ADDRESSED container is a
    // standard workspace, so the superseded rule charged a SEAT there; rule B
    // charges the calling channel's container, which is the operator's home
    // channel, which is their personal wallet.
    mockChannel.mockResolvedValue(homeChannel());
    const target = await resolveBillingTarget(TEAM_WS, {
      userId: OWNER,
      workspaceKind: "standard",
      channelId: HOME_CHANNEL,
    });
    expect(target).toEqual({
      wallet: "personal",
      workspaceId: HOME_CONTAINER,
      payerUserId: OWNER,
      channelId: HOME_CHANNEL,
      personalBillingContainerId: null,
    });
  });

  it("OWNER-PAYS: a GUEST in the operator's home channel spends the OPERATOR's wallet", async () => {
    // Samuel's 2026-08-26 ruling, widened by rule B rather than touched: the
    // person who minted the channel invited the traffic, wherever it lands.
    mockChannel.mockResolvedValue(homeChannel());
    const res = await consumeMcpCredits(TEAM_WS, {
      userId: GUEST,
      workspaceKind: "standard",
      channelId: HOME_CHANNEL,
    });
    expect(res).toMatchObject({ wallet: "personal", allowed: true, limit: 500 });
    expect(mockWallets.consumeUserCredits).toHaveBeenCalledWith(
      OWNER,
      expect.any(String),
      1,
      500
    );
    expect(mockWallets.consumeMemberCredits).not.toHaveBeenCalled();
  });
});

describe("🔒 rule B, arm 2 — a WORKSPACE-CHANNEL agent pays the CALLER's SEAT, whatever it touches", () => {
  it("reading the caller's OWN PERSONAL KB charges their seat, filed under the workspace channel", async () => {
    // ⚠ ACCEPTED BY SAMUEL EXPLICITLY: a member burning their own FIXED seat
    // allocation on a personal resource is bounded and harms nobody else. The
    // addressed container is the caller's own shelf, which the superseded rule
    // billed to their personal wallet.
    mockChannel.mockResolvedValue(teamChannel());
    mockRepo.getWorkspaceBilling.mockResolvedValue(billing());
    const res = await consumeMcpCredits(PERSONAL, {
      userId: GUEST,
      workspaceKind: "personal",
      channelId: TEAM_CHANNEL,
    });
    expect(res).toMatchObject({ wallet: "seat", allowed: true, limit: 5_000 });
    expect(mockWallets.consumeMemberCredits).toHaveBeenCalledWith(
      TEAM_WS,
      GUEST,
      expect.any(String),
      1,
      5_000
    );
    expect(mockWallets.consumeUserCredits).not.toHaveBeenCalled();
  });
});

describe("🔒 rule B, arms 3 and 4 — a CHANNEL-LESS call pays the RESOURCE's container", () => {
  it("a desktop call on a WORKSPACE resource is a SEAT with channel_id null", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(billing());
    await consumeMcpCredits(TEAM_WS, {
      userId: GUEST,
      workspaceKind: "standard",
    });
    expect(mockChannel).not.toHaveBeenCalled();
    expect(mockLedger).toHaveBeenCalledWith(
      expect.objectContaining({ wallet: "seat", channelId: null })
    );
  });

  it("a desktop call on a HOME resource is the owner's PERSONAL wallet with channel_id null", async () => {
    await consumeMcpCredits(HOME_CONTAINER, {
      userId: GUEST,
      workspaceKind: "link",
      // ⚠ EXPLICIT `null`, the shape the route sends when the request carried no
      // session key — an absent field and a null one must not differ.
      channelId: null,
    });
    expect(mockChannel).not.toHaveBeenCalled();
    expect(mockLedger).toHaveBeenCalledWith(
      expect.objectContaining({
        wallet: "personal",
        payerUserId: OWNER,
        channelId: null,
      })
    );
  });
});

describe("🔒 rule B, arm 5 — a SUB-AGENT is filed under ITS OWN session's channel", () => {
  it("needs no rule of its own: the sub-agent's session key IS the input", async () => {
    // A sub-agent launched into a different channel sends that channel's slot
    // key, so the same one rule files it there. Nothing in the credit path knows
    // or needs to know that a call came from a sub-agent.
    mockChannel.mockResolvedValue({
      channelId: "chan-sub",
      workspaceId: "ws-link-2",
      kind: "link",
    });
    const target = await resolveBillingTarget(HOME_CONTAINER, {
      userId: OWNER,
      workspaceKind: "link",
      channelId: "chan-sub",
    });
    expect(target).toMatchObject({
      workspaceId: "ws-link-2",
      channelId: "chan-sub",
    });
    expect(mockOwner).toHaveBeenCalledWith("ws-link-2");
  });
});

describe("🔒 THE FENCE — a forgeable header may not move a stranger's wallet", () => {
  it("a channel in a container the caller is NOT a member of is IGNORED, and logged", async () => {
    // ⚠ THE SECURITY CASE. Without this, any account could drain a stranger's
    // personal wallet by naming their channel in `X-Dopl-Session-Id`.
    mockChannel.mockResolvedValue(homeChannel());
    mockMember.mockResolvedValue(null);
    mockRepo.getWorkspaceBilling.mockResolvedValue(billing());
    const target = await resolveBillingTarget(TEAM_WS, {
      userId: GUEST,
      workspaceKind: "standard",
      channelId: HOME_CHANNEL,
    });
    // Falls back to the addressed container — the caller's own seat, not the
    // victim's wallet — and files no channel.
    expect(target).toEqual({
      wallet: "seat",
      workspaceId: TEAM_WS,
      payerUserId: GUEST,
      channelId: null,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("not an active member of")
    );
  });

  it("a channel id that resolves to NO channel is ignored, and logged", async () => {
    mockChannel.mockResolvedValue(null);
    const target = await resolveBillingTarget(HOME_CONTAINER, {
      userId: OWNER,
      workspaceKind: "link",
      channelId: "chan-gone",
    });
    expect(target).toMatchObject({
      workspaceId: HOME_CONTAINER,
      channelId: null,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("resolves to no channel")
    );
  });

  it("🔒 NO MEMBERSHIP READ when the channel is in the ADDRESSED container", async () => {
    // ⚠ THE ROUND TRIP THIS SAVES IS THE COMMON CASE — an agent working in its
    // own channel. `withWorkspaceAuth` already proved that membership, and its
    // KIND is already on the auth context, so asking again buys answers we hold.
    mockChannel.mockResolvedValue(homeChannel());
    await resolveBillingTarget(HOME_CONTAINER, {
      userId: OWNER,
      workspaceKind: "link",
      channelId: HOME_CHANNEL,
    });
    expect(mockChannel).toHaveBeenCalledTimes(1);
    expect(mockMember).not.toHaveBeenCalled();
  });

  it("the CROSS-CONTAINER arm costs exactly ONE membership read", async () => {
    mockChannel.mockResolvedValue(homeChannel());
    await resolveBillingTarget(TEAM_WS, {
      userId: GUEST,
      workspaceKind: "standard",
      channelId: HOME_CHANNEL,
    });
    expect(mockChannel).toHaveBeenCalledTimes(1);
    expect(mockMember).toHaveBeenCalledTimes(1);
    expect(mockMember).toHaveBeenCalledWith(HOME_CONTAINER, GUEST);
  });
});

describe("🔒 the ledger row is what makes the histogram the wallet's own breakdown", () => {
  it("files the CALLING CHANNEL beside the addressed container, not instead of it", async () => {
    // ⚠ BOTH DIMENSIONS RIDE. `origin_workspace_id` stays WHERE the call was
    // addressed; `channel_id` is WHOSE CHANNEL was billed. Collapsing either into
    // the other is how the by-channel rail stopped summing to the wallet.
    mockChannel.mockResolvedValue(homeChannel());
    await consumeMcpCredits(TEAM_WS, {
      userId: OWNER,
      workspaceKind: "standard",
      channelId: HOME_CHANNEL,
    });
    expect(mockLedger).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: TEAM_WS,
        originWorkspaceId: TEAM_WS,
        channelId: HOME_CHANNEL,
        wallet: "personal",
        payerUserId: OWNER,
        userId: OWNER,
      })
    );
  });

  it("writes NOTHING when the consume was refused, channel or no channel", async () => {
    mockChannel.mockResolvedValue(homeChannel());
    mockWallets.consumeUserCredits.mockResolvedValue({
      allowed: false,
      used: 500,
    });
    const res = await consumeMcpCredits(TEAM_WS, {
      userId: OWNER,
      workspaceKind: "standard",
      channelId: HOME_CHANNEL,
    });
    expect(res.allowed).toBe(false);
    expect(mockLedger).not.toHaveBeenCalled();
  });
});
