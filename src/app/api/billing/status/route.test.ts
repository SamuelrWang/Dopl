/**
 * INVARIANT SUITE — GET /api/billing/status. Feeds every billing surface, so the pins are about
 * the wire shape: `credits` present for EVERY plan (not just capped free ones); it is THE CALLER'S
 * OWN meter, computed from the SAME plan verdict and period helpers the consume path uses, so the
 * meter cannot disagree with enforcement; no usage row reads 0, not an error; `cancelAtPeriodEnd`
 * rides the same payload.
 *
 * ⚠ **THE METER IS PER MEMBER SINCE 2026-09-07** (Samuel's per-seat + personal-wallet ruling). It
 * read one POOLED workspace counter against 500/10,000/25,000; it now reads the CALLER'S OWN SEAT
 * against 100/5,000, and the payload carries `credits.wallet` saying which counter that was.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import type { WorkspaceBillingRow } from "@/features/billing/server/workspace-billing";

const AUTH: WorkspaceAuthContext = {
  userId: "user-1",
  credentialSubjectUserId: "user-1",
  workspaceId: "ws-1",
  workspaceSlug: "acme",
  workspacePublicId: "pub-1",
  role: "member",
  apiKeyWorkspaceId: null,
};

vi.mock("@/shared/auth/with-workspace-auth", () => ({
  withWorkspaceAuth:
    (handler: (req: Request, ctx: WorkspaceAuthContext) => Promise<Response>) =>
    (req: Request) =>
      handler(req, AUTH),
}));

vi.mock("@/features/billing/server/workspace-billing", () => ({
  getWorkspaceBilling: vi.fn(),
  countActiveMembers: vi.fn(),
  countOntologyObjects: vi.fn(),
}));

vi.mock("@/features/billing/server/credit-wallets", () => ({
  consumeUserCredits: vi.fn(),
  consumeMemberCredits: vi.fn(),
  getUserCreditsUsed: vi.fn(),
  getMemberCreditsUsed: vi.fn(),
  // ⚠ THE RECONCILIATION GUARD'S TWO READS (2026-09-13, F-693). They must be on
  // this mock or `credits-audit.ts › ledgerDriftFor` degrades to 0 with a warn on
  // every case here — which would pass, and would prove nothing about the field.
  sumMemberCreditsUsed: vi.fn(),
  sumCreditLedger: vi.fn(),
}));

import { GET } from "./route";
import * as repo from "@/features/billing/server/workspace-billing";
import * as wallets from "@/features/billing/server/credit-wallets";

const mockRepo = vi.mocked(repo);
const mockWallets = vi.mocked(wallets);

function billing(overrides: Partial<WorkspaceBillingRow>): WorkspaceBillingRow {
  return {
    workspaceId: "ws-1",
    plan: "free",
    status: "free",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripePriceId: null,
    seatCount: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    lastStripeEventCreated: null,
    ...overrides,
  };
}

const request = () => new NextRequest("http://localhost/api/billing/status");

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.getWorkspaceBilling.mockResolvedValue(null);
  mockRepo.countActiveMembers.mockResolvedValue(1);
  mockRepo.countOntologyObjects.mockResolvedValue(3);
  mockWallets.getMemberCreditsUsed.mockResolvedValue(0);
  mockWallets.getUserCreditsUsed.mockResolvedValue(0);
  mockWallets.sumMemberCreditsUsed.mockResolvedValue(0);
  mockWallets.sumCreditLedger.mockResolvedValue(0);
});

describe("GET /api/billing/status — credits", () => {
  it("carries the CALLER'S OWN seat meter on a FREE workspace", async () => {
    mockWallets.getMemberCreditsUsed.mockResolvedValue(42);
    const body = await (await GET(request(), { params: Promise.resolve({}) })).json();
    expect(body.credits).toMatchObject({
      wallet: "seat",
      used: 42,
      limit: 100,
      remaining: 58,
    });
    expect(body.credits.periodStart).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
    // ⚠ THE READ IS KEYED ON THE MEMBER. A pooled `(workspace, period)` read is
    // what this wave replaced, and it would report the whole roster's spend as
    // the caller's own.
    expect(mockWallets.getMemberCreditsUsed).toHaveBeenCalledWith(
      "ws-1",
      "user-1",
      expect.any(String)
    );
  });

  it("carries one on a TEAM workspace too — every plan is metered", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ plan: "team", status: "active", seatCount: 4 })
    );
    mockRepo.countActiveMembers.mockResolvedValue(4);
    const body = await (await GET(request(), { params: Promise.resolve({}) })).json();
    expect(body.plan).toBe("team");
    // ⚠ NOT 4 × 5,000. The allocation is fixed per member and is not pooled.
    expect(body.credits).toMatchObject({ used: 0, limit: 5_000, remaining: 5_000 });
  });

  it("reads a DEGRADED solo against the free allowance, like the consume path", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ plan: "solo", status: "active" })
    );
    mockRepo.countActiveMembers.mockResolvedValue(2);
    const body = await (await GET(request(), { params: Promise.resolve({}) })).json();
    expect(body.credits.limit).toBe(100);
  });

  it("reads the usage row for the SUBSCRIPTION period when one is live", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({
        plan: "solo",
        status: "active",
        currentPeriodStart: "2099-03-04T00:00:00.000Z",
        currentPeriodEnd: "2099-04-04T00:00:00.000Z",
      })
    );
    const body = await (await GET(request(), { params: Promise.resolve({}) })).json();
    expect(mockWallets.getMemberCreditsUsed).toHaveBeenCalledWith(
      "ws-1",
      "user-1",
      "2099-03-04T00:00:00.000Z"
    );
    expect(body.credits.periodEnd).toBe("2099-04-04T00:00:00.000Z");
  });

  it("never reports negative remaining, even if usage overshot the limit", async () => {
    mockWallets.getMemberCreditsUsed.mockResolvedValue(600);
    const body = await (await GET(request(), { params: Promise.resolve({}) })).json();
    expect(body.credits.remaining).toBe(0);
  });

  it("🔒 never reads the PERSONAL wallet for a standard workspace", async () => {
    // The two wallets are separate counters; reading the wrong one puts a
    // number on the meter that no refusal in this workspace can explain.
    await GET(request(), { params: Promise.resolve({}) });
    expect(mockWallets.getUserCreditsUsed).not.toHaveBeenCalled();
  });

  it("surfaces cancelAtPeriodEnd, defaulting to false with no billing row", async () => {
    expect((await (await GET(request(), { params: Promise.resolve({}) })).json()).cancelAtPeriodEnd).toBe(false);
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ plan: "team", status: "active", cancelAtPeriodEnd: true })
    );
    expect((await (await GET(request(), { params: Promise.resolve({}) })).json()).cancelAtPeriodEnd).toBe(true);
  });

  it("keeps the pre-existing entitlement fields on the payload", async () => {
    const body = await (await GET(request(), { params: Promise.resolve({}) })).json();
    expect(body).toMatchObject({
      plan: "free",
      status: "free",
      memberCount: 1,
      objectsUsed: 3,
      canCreateObjects: true,
      has_stripe_customer: false,
      subscription_period_end: null,
    });
  });
});

/**
 * 🔒 **THE RECONCILIATION FIELD (Samuel, 2026-09-13: the histogram must equal the
 * wallet, always; F-693).** `20261004120000_credit_consume_with_ledger.sql` makes
 * the counter and the ledger agree by construction; this field is how anyone finds
 * out whether they actually DO, for the rows written before it.
 *
 * ⚠ **IT IS ON THIS PAYLOAD AND NOT ON THE CONSUME RESPONSE.** `CreditsSummary` is
 * shared with `CreditConsumeResult`, which is the body the MCP server reads on the
 * hottest path in the product; `status-service.ts › StatusCredits` extends it here
 * so that wire shape stays byte-identical.
 */
describe("GET /api/billing/status — credits.ledgerDrift", () => {
  it("is 0 when the counter and the ledger agree", async () => {
    mockWallets.getMemberCreditsUsed.mockResolvedValue(12);
    mockWallets.sumMemberCreditsUsed.mockResolvedValue(12);
    mockWallets.sumCreditLedger.mockResolvedValue(12);
    const body = await (await GET(request(), { params: Promise.resolve({}) })).json();
    expect(body.credits.ledgerDrift).toBe(0);
  });

  it("🔒 reports the difference when they do not — the incident's own shape", async () => {
    // Counter 8, ledger 5: the three attribution rows Samuel's wallet lost to a
    // `42703` after the counter had already moved.
    mockWallets.getMemberCreditsUsed.mockResolvedValue(8);
    mockWallets.sumMemberCreditsUsed.mockResolvedValue(8);
    mockWallets.sumCreditLedger.mockResolvedValue(5);
    const body = await (await GET(request(), { params: Promise.resolve({}) })).json();
    expect(body.credits.ledgerDrift).toBe(3);
    // ⚠ AND THE METER IS UNTOUCHED BY IT. A drift figure that moved `used` would
    // make the bar disagree with Settings to report that two things disagree.
    expect(body.credits.used).toBe(8);
  });

  it("reconciles on the METER'S OWN period, not a fresh calendar month", async () => {
    // A paid workspace's window is anchored to its subscription date, and the
    // counter and the ledger are both keyed on it.
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({
        plan: "team",
        status: "active",
        seatCount: 4,
        currentPeriodStart: "2099-03-04T00:00:00.000Z",
        currentPeriodEnd: "2099-04-04T00:00:00.000Z",
      })
    );
    mockRepo.countActiveMembers.mockResolvedValue(4);
    await GET(request(), { params: Promise.resolve({}) });
    expect(mockWallets.sumCreditLedger).toHaveBeenCalledWith(
      "user-1",
      "seat",
      "2099-03-04T00:00:00.000Z"
    );
  });

  /**
   * ⚠ **THE MIGRATION LAG.** `credit_ledger_sum` ships unapplied, so between
   * deploy and apply the RPC does not exist. This endpoint is the SINGLE billing
   * read every surface makes; 500ing it over a diagnostic is the wrong trade.
   */
  it("🔒 still answers 200 with 0 when the reconciliation cannot be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockWallets.sumCreditLedger.mockRejectedValue(
      new Error("Could not find the function public.credit_ledger_sum")
    );
    const res = await GET(request(), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect((await res.json()).credits.ledgerDrift).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
