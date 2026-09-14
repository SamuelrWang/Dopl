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
import { SEAT_MONTHLY_CREDITS } from "@/features/billing/credits";

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
import {
  resetUnmeteredForTests,
  unmeteredSince,
} from "@/features/billing/server/credits-unmetered";

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
  // ⚠ THE FAIL-OPEN LOG IS ONCE PER PROCESS, so the second case in this file
  // would be silent without a reset — and the sticky `unmeteredSince` would
  // leak out of whichever case set it.
  resetUnmeteredForTests();
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

/**
 * 🔒 **A FAIL-OPEN IS A STATE, NOT AN EVENT (2026-09-14).** This branch
 * answers `allowed: true` on a dead RPC by decision — the `PGRST202` a web
 * deploy gets before its migration applies is the case it exists for — so the
 * estate can run UNMETERED for a whole deploy window. Two things had to change:
 * the log had to stop being one line PER CALL (it buried itself and everything
 * near it), and the condition had to become READABLE web-side, because both
 * meters print the same `0` for "nothing spent" and "nothing measured".
 */
describe("the fail-open is stated once and stays readable", () => {
  it("🔒 logs ONE line however many calls fail open", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mockWallets.consumeMemberCredits.mockRejectedValue(new Error("PGRST202"));

    for (let i = 0; i < 5; i++) {
      await POST(request(), { params: Promise.resolve({}) });
    }

    // ⚠ FIVE FREE TOOL CALLS, ONE LINE. The superseded `console.error` here
    // printed five, and under a real outage that is one per tool call per agent.
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("🔒 publishes the fail-open so a surface can say so, and NOT before", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(unmeteredSince()).toBeNull();

    mockWallets.consumeMemberCredits.mockRejectedValue(new Error("PGRST202"));
    await POST(request(), { params: Promise.resolve({}) });

    // `GET /api/billing/status` reads exactly this and publishes it as
    // `credits.unmeteredSince`; the /home bar and the Settings meter print one
    // muted word off it.
    expect(unmeteredSince()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    error.mockRestore();
  });

  it("🔒 a MEASURED call clears it — the recovery edge is the answer, not a timer", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mockWallets.consumeMemberCredits.mockRejectedValue(new Error("PGRST202"));
    await POST(request(), { params: Promise.resolve({}) });
    expect(unmeteredSince()).not.toBeNull();

    mockWallets.consumeMemberCredits.mockResolvedValue({ allowed: true, used: 1 });
    await POST(request(), { params: Promise.resolve({}) });

    expect(unmeteredSince()).toBeNull();
    error.mockRestore();
  });

  it("🔒 a REFUSAL is a measurement and clears it too", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mockWallets.consumeMemberCredits.mockRejectedValue(new Error("PGRST202"));
    await POST(request(), { params: Promise.resolve({}) });

    // ⚠ `allowed: false` is the counter WORKING. Treating a refusal as still-
    // unmetered would leave the word up for every workspace that ran out.
    mockWallets.consumeMemberCredits.mockResolvedValue({ allowed: false, used: 100 });
    await POST(request(), { params: Promise.resolve({}) });

    expect(unmeteredSince()).toBeNull();
    error.mockRestore();
  });
});

/**
 * 🔒 **F-668 — THE PAID FIGURE THE MCP REFUSAL QUOTES RIDES THE RESPONSE
 * (2026-09-14).** `packages/mcp-server/src/tools/respond.ts › creditsExhausted`
 * renders *"Upgrade to Team for 5,000 credits per member"* and cannot import
 * `billing/credits.ts`. This is the WIRE half of the pin; the COPY half is
 * `packages/mcp-server/src/tools/respond.test.ts`.
 */
describe("the upgrade offer carries what it buys (F-668)", () => {
  it("a free SEAT is offered the TEAM seat allowance, read off the constant", async () => {
    mockWallets.consumeMemberCredits.mockResolvedValue({ allowed: false, used: 100 });

    const body = await (await POST(request(), { params: Promise.resolve({}) })).json();
    expect(body.upgradeUrl).not.toBe("");
    // ⚠ AGAINST THE CONSTANT, NOT AGAINST `5_000`. A literal here would be the
    // third copy of the number this finding is about.
    expect(body.upgradeCredits).toBe(SEAT_MONTHLY_CREDITS.team);
  });

  it("🔒 no offer, no figure — a PAID seat gets `0`, not its own limit", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ plan: "team", status: "active" })
    );
    mockWallets.consumeMemberCredits.mockResolvedValue({ allowed: false, used: 5_000 });

    const body = await (await POST(request(), { params: Promise.resolve({}) })).json();
    expect(body.upgradeUrl).toBe("");
    expect(body.upgradeCredits).toBe(0);
  });

  it("🔒 the FAIL-OPEN answer sizes no offer either", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mockWallets.consumeMemberCredits.mockRejectedValue(new Error("connection reset"));

    const body = await (await POST(request(), { params: Promise.resolve({}) })).json();
    expect(body).toMatchObject({ degraded: true, upgradeUrl: "", upgradeCredits: 0 });
    error.mockRestore();
  });
});
