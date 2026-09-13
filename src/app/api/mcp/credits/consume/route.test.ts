/**
 * INVARIANT SUITE — POST /api/mcp/credits/consume:
 *   - the plan is the ENTITLEMENT VERDICT, so a degraded solo is charged against FREE (abuse path);
 *   - the limit is the caller's PER-MEMBER seat allowance, and the RPC key carries the member;
 *   - a refused spend returns the counter with the refusal;
 *   - it FAILS OPEN on an unexpected error, with `wallet: null` on the invented zeroes.
 * Auth + repositories are mocked; the service is real, so kind → wallet → limit → period → RPC is
 * end to end.
 *
 * ⚠ **NUMBERS MOVED 2026-09-07** (Samuel's per-seat + personal-wallet ruling): 500/10,000/25,000
 * POOLED PER WORKSPACE became 100/5,000 PER MEMBER, and the counter gained the member in its key.
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
}));

// The ledger is a `supabaseAdmin()` insert fired and forgotten after the spend;
// this suite is about the answer, never about Supabase being reachable.

import { POST } from "./route";
import * as repo from "@/features/billing/server/workspace-billing";
import * as wallets from "@/features/billing/server/credit-wallets";

const mockRepo = vi.mocked(repo);
const mockWallets = vi.mocked(wallets);

/**
 * The LEDGER ATTRIBUTION the consume RPC writes in the counter's own transaction
 * since 2026-09-13 (`billing/server/credit-ledger.ts › CreditLedgerAttribution`;
 * F-693). ⚠ `channelId` is `null` here because this suite's request carries no
 * `X-Dopl-Session-Id`; `credits-channel-attribution.test.ts` owns rule B's arms.
 */
const ATTRIB = {
  originWorkspaceId: "ws-1",
  callerUserId: "user-1",
  channelId: null,
};

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

function request(): NextRequest {
  return new NextRequest("http://localhost/api/mcp/credits/consume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.getWorkspaceBilling.mockResolvedValue(null);
  mockRepo.countActiveMembers.mockResolvedValue(1);
  mockRepo.countOntologyObjects.mockResolvedValue(0);
  mockWallets.consumeMemberCredits.mockResolvedValue({ allowed: true, used: 1 });
  mockWallets.consumeUserCredits.mockResolvedValue({ allowed: true, used: 1 });
});

describe("POST /api/mcp/credits/consume", () => {
  it("spends one credit against the free PER-MEMBER allowance and reports what is left", async () => {
    const res = await POST(request(), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      allowed: true,
      used: 1,
      limit: 100,
      remaining: 99,
      wallet: "seat",
    });
    // ⚠ THE CALLER IS IN THE KEY. A pooled `(workspace, period)` counter is what
    // this wave replaced; it cannot hold a fixed per-person allocation.
    expect(mockWallets.consumeMemberCredits).toHaveBeenCalledWith(
      "ws-1",
      "user-1",
      expect.any(String),
      1,
      100,
      ATTRIB
    );
  });

  it("charges a live TEAM member against the paid per-member allowance", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ plan: "team", status: "active", seatCount: 4 })
    );
    mockRepo.countActiveMembers.mockResolvedValue(4);
    mockWallets.consumeMemberCredits.mockResolvedValue({ allowed: true, used: 7 });

    const body = await (await POST(request(), { params: Promise.resolve({}) })).json();
    // ⚠ NOT MULTIPLIED BY THE FOUR SEATS. Each member has their own 5,000.
    expect(body).toMatchObject({ allowed: true, limit: 5_000, remaining: 4_993 });
  });

  it("charges a live single-member solo against the LEGACY PAID allowance", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ plan: "solo", status: "active" })
    );
    mockWallets.consumeMemberCredits.mockResolvedValue({ allowed: true, used: 7 });

    const body = await (await POST(request(), { params: Promise.resolve({}) })).json();
    expect(body).toMatchObject({ allowed: true, limit: 5_000, remaining: 4_993 });
  });

  it("charges a DEGRADED solo (2 members) against the FREE allowance", async () => {
    // ⚠ Reading `workspace_billing.plan` directly instead of the entitlement verdict hands every
    // member of this workspace 5,000 credits.
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ plan: "solo", status: "active" })
    );
    mockRepo.countActiveMembers.mockResolvedValue(2);

    const body = await (await POST(request(), { params: Promise.resolve({}) })).json();
    expect(body.limit).toBe(100);
    expect(mockWallets.consumeMemberCredits).toHaveBeenCalledWith(
      "ws-1",
      "user-1",
      expect.any(String),
      1,
      100,
      ATTRIB
    );
  });

  it("anchors the period to the SUBSCRIPTION window when one is live", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({
        plan: "team",
        status: "active",
        currentPeriodStart: "2099-01-10T00:00:00.000Z",
        currentPeriodEnd: "2099-02-10T00:00:00.000Z",
      })
    );

    const body = await (await POST(request(), { params: Promise.resolve({}) })).json();
    expect(body.periodStart).toBe("2099-01-10T00:00:00.000Z");
    expect(mockWallets.consumeMemberCredits).toHaveBeenCalledWith(
      "ws-1",
      "user-1",
      "2099-01-10T00:00:00.000Z",
      1,
      5_000,
      ATTRIB
    );
  });

  it("refuses when the seat is exhausted, still 200, and names the upgrade url", async () => {
    mockWallets.consumeMemberCredits.mockResolvedValue({ allowed: false, used: 100 });

    const res = await POST(request(), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ allowed: false, used: 100, limit: 100, remaining: 0 });
    expect(body.upgradeUrl).toMatch(/billing=upgrade$/);
  });

  it("🔒 offers NO url when there is nothing to buy — a seat on a paid plan", async () => {
    // The MCP layer renders the url literally, so an offer to nowhere sends an
    // exhausted agent to a checkout that cannot help it.
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ plan: "team", status: "active" })
    );
    mockWallets.consumeMemberCredits.mockResolvedValue({ allowed: false, used: 5_000 });

    const body = await (await POST(request(), { params: Promise.resolve({}) })).json();
    expect(body.allowed).toBe(false);
    expect(body.upgradeUrl).toBe("");
  });

  it("FAILS OPEN on an RPC error — allowed, degraded, wallet null, counters not invented", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mockWallets.consumeMemberCredits.mockRejectedValue(new Error("connection reset"));

    const res = await POST(request(), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowed).toBe(true);
    expect(body.degraded).toBe(true);
    // ⚠ NO COUNTER WAS CHOSEN, LET ALONE READ. A wallet name on invented zeroes
    // would tell the client which meter these numbers came off, and none did.
    expect(body.wallet).toBeNull();
    expect(body).toMatchObject({ used: 0, limit: 0, remaining: 0, upgradeUrl: "" });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("FAILS OPEN when the entitlements read itself throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRepo.getWorkspaceBilling.mockRejectedValue(new Error("db down"));

    const body = await (await POST(request(), { params: Promise.resolve({}) })).json();
    expect(body.allowed).toBe(true);
    expect(body.degraded).toBe(true);
    error.mockRestore();
  });
});
