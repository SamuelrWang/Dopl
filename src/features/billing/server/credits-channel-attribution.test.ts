/**
 * Rule B: the calling channel's container pays (Samuel, 2026-09-13 — "the wallet
 * needs to match the histogram"). The channel-less fallback lives in
 * `credits-service.test.ts` and `credits-link-reroute.test.ts`. Pinned here:
 *   1. The five arms: home-channel agent → the channel owner's personal wallet +
 *      the channel id; workspace-channel agent → the caller's seat there + the
 *      channel id; Desktop (channel-less) → the resource's container, channel
 *      `null`; sub-agent → the channel its own session names.
 *   2. The fence: the channel arrives on the forgeable `X-Dopl-Session-Id`, so a
 *      channel in a container the caller is not an active member of is ignored
 *      (and logged) — never billed, never refused.
 *   3. The ledger's `channel_id`: every metered burn files the channel it was
 *      attributed to, or `null` for Desktop.
 *   4. Round-trip cost by mock call count — 0 extra with no channel, 1 when the
 *      channel is in the addressed container, 2 across containers.
 *
 * Repositories mocked; `channel-attribution.ts`, `containerTarget` and
 * `personal-wallet.ts` are real.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WorkspaceBillingRow } from "./workspace-billing";

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
import { consumeMcpCredits, resolveBillingTarget } from "./credits-service";

const mockRepo = vi.mocked(repo);
const mockWallets = vi.mocked(wallets);
const mockChannel = vi.mocked(findChannelContainer);
const mockOwner = vi.mocked(findActiveOwnerUserId);
const mockMember = vi.mocked(findMembership);

/**
 * The ledger attribution each wallet RPC was handed — the object
 * `credit-ledger.ts › CreditLedgerAttribution` describes, in the trailing
 * argument position of each consume signature (5th for the personal wallet, 6th
 * for the seat). Read by position on purpose: an argument inserted in the middle
 * then fails loudly instead of asserting against whatever landed last.
 */
const personalAttribution = () =>
  mockWallets.consumeUserCredits.mock.calls[0]?.[4];
const seatAttribution = () =>
  mockWallets.consumeMemberCredits.mock.calls[0]?.[5];

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
  // An active membership row: `findMembership` filters `status='active'`, so the
  // fence reads the row's presence, not its fields.
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
    // The addressed container is a standard workspace, but rule B charges the
    // calling channel's container — the operator's home channel, i.e. their
    // personal wallet.
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
      500,
      // The attribution the RPC writes: the ADDRESSED workspace, the GUEST who
      // called, and the HOME channel rule B billed.
      { originWorkspaceId: TEAM_WS, callerUserId: GUEST, channelId: HOME_CHANNEL }
    );
    expect(mockWallets.consumeMemberCredits).not.toHaveBeenCalled();
  });
});

describe("🔒 rule B, arm 2 — a WORKSPACE-CHANNEL agent pays the CALLER's SEAT, whatever it touches", () => {
  it("reading the caller's OWN PERSONAL KB charges their seat, filed under the workspace channel", async () => {
    // Accepted by Samuel: a member burning their own fixed seat allocation on a
    // personal resource is bounded and harms nobody else.
    mockChannel.mockResolvedValue(teamChannel());
    mockRepo.getWorkspaceBilling.mockResolvedValue(billing());
    const res = await consumeMcpCredits(PERSONAL, {
      userId: GUEST,
      workspaceKind: "home",
      channelId: TEAM_CHANNEL,
    });
    expect(res).toMatchObject({ wallet: "seat", allowed: true, limit: 5_000 });
    expect(mockWallets.consumeMemberCredits).toHaveBeenCalledWith(
      TEAM_WS,
      GUEST,
      expect.any(String),
      1,
      5_000,
      // The addressed container is the caller's own shelf while the charged one
      // is the workspace — the pair rule B exists to keep apart.
      { originWorkspaceId: PERSONAL, callerUserId: GUEST, channelId: TEAM_CHANNEL }
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
    // THE SEAT RPC, which is the only one that writes a `wallet='seat'` row, with
    // no channel on its attribution.
    expect(mockWallets.consumeUserCredits).not.toHaveBeenCalled();
    expect(seatAttribution()).toEqual({
      originWorkspaceId: TEAM_WS,
      callerUserId: GUEST,
      channelId: null,
    });
  });

  it("a desktop call on a HOME resource is the owner's PERSONAL wallet with channel_id null", async () => {
    await consumeMcpCredits(HOME_CONTAINER, {
      userId: GUEST,
      workspaceKind: "link",
      // Explicit `null`, as the route sends with no session key — an absent field
      // and a null one must not differ.
      channelId: null,
    });
    expect(mockChannel).not.toHaveBeenCalled();
    // The PERSONAL RPC writes `wallet='personal'`; the OWNER is its counter key
    // (the payer) and the GUEST is on the attribution (the caller).
    expect(mockWallets.consumeUserCredits.mock.calls[0]?.[0]).toBe(OWNER);
    expect(personalAttribution()).toEqual({
      originWorkspaceId: HOME_CONTAINER,
      callerUserId: GUEST,
      channelId: null,
    });
  });
});

describe("🔒 rule B, arm 5 — a SUB-AGENT is filed under ITS OWN session's channel", () => {
  it("needs no rule of its own: the sub-agent's session key IS the input", async () => {
    // A sub-agent sends its own channel's slot key, so the one rule files it
    // there; nothing in the credit path knows about sub-agents.
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
    // Security case: without the fence, any account could drain a stranger's
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
    // The common case (an agent in its own channel): `withWorkspaceAuth` already
    // proved the membership and its kind is on the auth context.
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

/**
 * **THE LEDGER ROW IS WRITTEN BY THE WALLET RPC ITSELF SINCE 2026-09-13**
 * (Samuel: *"the histogram must equal the wallet, always"*; F-693,
 * `20261004120000_credit_consume_with_ledger.sql`). **SO THESE CASES ASSERT THE
 * RPC's ATTRIBUTION ARGUMENT, NOT A WRITER'S CALL** — the superseded shape mocked
 * `recordCreditUsageEvent` and proved it was fired, which is a weaker claim than
 * it looked: the real writer ran AFTER the counter had committed and swallowed its
 * own failures.
 */
describe("🔒 the ledger row is what makes the histogram the wallet's own breakdown", () => {
  it("files the CALLING CHANNEL beside the addressed container, not instead of it", async () => {
    // Both dimensions ride: `origin_workspace_id` is where the call was addressed,
    // `channel_id` whose channel was billed. Collapsing either into the other
    // stops the by-channel rail summing to the wallet.
    mockChannel.mockResolvedValue(homeChannel());
    await consumeMcpCredits(TEAM_WS, {
      userId: OWNER,
      workspaceKind: "standard",
      channelId: HOME_CHANNEL,
    });
    // The PERSONAL RPC (rule B arm 1: the home channel's wallet pays), keyed on
    // the OWNER, carrying the addressed workspace AND the calling channel.
    expect(mockWallets.consumeUserCredits.mock.calls[0]?.[0]).toBe(OWNER);
    expect(personalAttribution()).toEqual({
      originWorkspaceId: TEAM_WS,
      callerUserId: OWNER,
      channelId: HOME_CHANNEL,
    });
  });

  /**
   * "A refused consume writes nothing" is pinned in SQL by
   * `credit-consume-with-ledger-schema.test.ts`. What is provable here is that the
   * refusal is not a second code path: one RPC call carries both outcomes.
   */
  it("takes ONE RPC call whether the consume is allowed or refused", async () => {
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
    expect(mockWallets.consumeUserCredits).toHaveBeenCalledTimes(1);
    expect(personalAttribution()).toEqual({
      originWorkspaceId: TEAM_WS,
      callerUserId: OWNER,
      channelId: HOME_CHANNEL,
    });
  });
});
