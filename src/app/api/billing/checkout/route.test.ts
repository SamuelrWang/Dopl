/**
 * `POST /api/billing/checkout` — what may be BOUGHT, and what the route does
 * when it cannot sell it.
 *
 * The property with teeth since 2026-09-07 (Samuel's per-seat ruling, spec A6):
 * **Solo/"Pro" is retired from sale**, so a body still asking for it is a 400
 * `PLAN_RETIRED` — REFUSED, never quietly upgraded to an $8.00-per-seat Team
 * subscription the caller did not ask for. The `SOLO_REQUIRES_SINGLE_MEMBER`
 * 409 that used to guard the Solo path went with the sale.
 *
 * Everything else here is the pre-existing contract, re-pinned because a
 * retirement is exactly the kind of edit that quietly loosens a gate: the
 * admin + `sessionOnly` pair (INVARIANTS §3 — all four billing writes carry
 * it), the duplicate-subscription 409 with a portal handoff, the cross-instance
 * claim, and the release-on-every-path `finally`.
 *
 * Stripe is faked at OUR module boundary (`server/stripe`), not at the SDK, so
 * nothing constructs a client and nothing reaches the network.
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
  workspacePublicId: "ab12cd34ef56",
  role: "admin",
  apiKeyWorkspaceId: null,
};

interface GateOptions {
  minRole?: string;
  sessionOnly?: boolean;
}

const gate = vi.hoisted(() => ({ opts: undefined as GateOptions | undefined }));

vi.mock("@/shared/auth/with-workspace-auth", () => ({
  withWorkspaceAuth: (
    handler: (req: NextRequest, ctx: WorkspaceAuthContext) => Promise<Response>,
    opts?: GateOptions
  ) => {
    gate.opts = opts;
    return (req: NextRequest) => handler(req, AUTH);
  },
}));

vi.mock("@/features/billing/server/stripe", () => ({
  createWorkspaceCheckoutSession: vi.fn(async () => "cs_test_secret"),
  createPortalSession: vi.fn(async () => "https://billing.stripe.com/p/s_1"),
}));

vi.mock("@/features/billing/server/workspace-billing", () => ({
  claimWorkspaceCheckout: vi.fn(async () => true),
  releaseWorkspaceCheckout: vi.fn(async () => undefined),
  countActiveMembers: vi.fn(async () => 3),
  getWorkspaceBilling: vi.fn(async () => null),
}));

const profile = vi.hoisted(() => ({
  row: { email: "payer@acme.test" } as { email: string | null } | null,
}));

vi.mock("@/shared/supabase/admin", () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: profile.row }) }),
      }),
    }),
  }),
}));

import { POST } from "./route";
import * as stripe from "@/features/billing/server/stripe";
import * as repo from "@/features/billing/server/workspace-billing";

const mockStripe = vi.mocked(stripe);
const mockRepo = vi.mocked(repo);

function billing(overrides: Partial<WorkspaceBillingRow> = {}): WorkspaceBillingRow {
  return {
    workspaceId: "ws-1",
    plan: "team",
    status: "active",
    stripeCustomerId: "cus_123",
    stripeSubscriptionId: "sub_123",
    stripePriceId: "price_seat",
    seatCount: 3,
    currentPeriodStart: "2026-08-04T00:00:00.000Z",
    currentPeriodEnd: "2026-09-04T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    lastStripeEventCreated: 1_700_000_000,
    ...overrides,
  };
}

function request(body?: unknown) {
  return new NextRequest("http://localhost/api/billing/checkout", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function call(body?: unknown) {
  return (POST as unknown as (r: NextRequest) => Promise<Response>)(
    request(body)
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.claimWorkspaceCheckout.mockResolvedValue(true);
  mockRepo.countActiveMembers.mockResolvedValue(3);
  mockRepo.getWorkspaceBilling.mockResolvedValue(null);
  mockStripe.createWorkspaceCheckoutSession.mockResolvedValue("cs_test_secret");
  mockStripe.createPortalSession.mockResolvedValue(
    "https://billing.stripe.com/p/s_1"
  );
  profile.row = { email: "payer@acme.test" };
});

describe("the gates", () => {
  it("is admin AND sessionOnly — an agent token may never open a checkout", () => {
    // INVARIANTS §3: all four billing writes carry `sessionOnly`. Narrowing
    // this is what `shared/auth/write-gate-coverage.test.ts` catches globally;
    // this pins the pair on THIS route so a plan edit cannot loosen it.
    expect(gate.opts).toEqual({ minRole: "admin", sessionOnly: true });
  });
});

describe("which plan may be bought", () => {
  it("sells Team at the active member count", async () => {
    const res = await call({ plan: "team" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ clientSecret: "cs_test_secret" });
    expect(mockStripe.createWorkspaceCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        plan: "team",
        quantity: 3,
        email: "payer@acme.test",
        segment: "acme-ab12cd34ef56",
      })
    );
  });

  it("defaults an absent plan to Team", async () => {
    expect((await call({})).status).toBe(200);
    expect(mockStripe.createWorkspaceCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ plan: "team" })
    );
  });

  it("defaults a body that is not JSON at all to Team", async () => {
    // The parse has always been forgiving here — the desktop Upgrade button
    // POSTs no body. Pinned so the refusal below is read as deliberate.
    expect((await call()).status).toBe(200);
    expect(mockStripe.createWorkspaceCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ plan: "team" })
    );
  });

  it("400s `plan: \"solo\"` with PLAN_RETIRED and the price that replaced it", async () => {
    const res = await call({ plan: "solo" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "PLAN_RETIRED",
      message: "Pro is no longer sold. Team is $8.00 per seat per month.",
    });
  });

  it("MINTS NOTHING on a retired plan — not a Solo session, and not a Team one", async () => {
    // ⚠ The failure this guards is the tempting one: silently coercing `solo`
    // to `team` would charge $8.00 per seat to somebody who clicked a $5.99
    // flat plan on a stale page.
    await call({ plan: "solo" });
    expect(mockStripe.createWorkspaceCheckoutSession).not.toHaveBeenCalled();
  });

  it("still releases the checkout claim after refusing", async () => {
    // The refusal happens inside the claim window; holding it would 409 the
    // same admin's next (valid) Team attempt for up to the 2-min self-expiry.
    await call({ plan: "solo" });
    expect(mockRepo.releaseWorkspaceCheckout).toHaveBeenCalledWith("ws-1");
  });

  it("no longer 409s a multi-member workspace — SOLO_REQUIRES_SINGLE_MEMBER is GONE", async () => {
    // That branch existed only to keep the flat Solo plan single-member. With
    // Solo off sale there is nothing left to guard, and Team is per-seat and
    // unlimited by Samuel's ruling.
    mockRepo.countActiveMembers.mockResolvedValue(7);
    const res = await call({ plan: "team" });
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain(
      "SOLO_REQUIRES_SINGLE_MEMBER"
    );
    expect(mockStripe.createWorkspaceCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 7 })
    );
  });
});

describe("never a second subscription", () => {
  it("409s a workspace Stripe is already billing, with a portal handoff", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(billing());
    const res = await call({ plan: "team" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Workspace already has an active subscription",
      portalUrl: "https://billing.stripe.com/p/s_1",
    });
    expect(mockStripe.createWorkspaceCheckoutSession).not.toHaveBeenCalled();
  });

  it("counts PAST_DUE as still billing — a second session would duplicate the sub", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ status: "past_due" })
    );
    expect((await call({ plan: "team" })).status).toBe(409);
  });

  it("lets a CANCELED workspace buy again", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ status: "canceled" })
    );
    expect((await call({ plan: "team" })).status).toBe(200);
  });

  it("409s the loser of a concurrent claim rather than minting a duplicate", async () => {
    mockRepo.claimWorkspaceCheckout.mockResolvedValue(false);
    const res = await call({ plan: "team" });
    expect(res.status).toBe(409);
    expect(mockStripe.createWorkspaceCheckoutSession).not.toHaveBeenCalled();
    // ⚠ It never took the claim, so it must not release somebody else's.
    expect(mockRepo.releaseWorkspaceCheckout).not.toHaveBeenCalled();
  });

  it("re-reads billing behind the claim — a webhook may have landed mid-flight", async () => {
    mockRepo.getWorkspaceBilling
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(billing());
    expect((await call({ plan: "team" })).status).toBe(409);
    expect(mockStripe.createWorkspaceCheckoutSession).not.toHaveBeenCalled();
  });
});

describe("the claim is always released", () => {
  it("releases on the happy path", async () => {
    await call({ plan: "team" });
    expect(mockRepo.releaseWorkspaceCheckout).toHaveBeenCalledWith("ws-1");
  });

  it("releases when Stripe throws, and does not swallow the error", async () => {
    mockStripe.createWorkspaceCheckoutSession.mockRejectedValue(
      new Error("stripe down")
    );
    await expect(call({ plan: "team" })).rejects.toThrow("stripe down");
    expect(mockRepo.releaseWorkspaceCheckout).toHaveBeenCalledWith("ws-1");
  });

  it("does not mask the response when the RELEASE itself fails", async () => {
    mockRepo.releaseWorkspaceCheckout.mockRejectedValue(new Error("db down"));
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await call({ plan: "team" })).status).toBe(200);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ws-1"));
    warn.mockRestore();
  });
});

describe("the payer's email", () => {
  it("400s when the profile carries none — Stripe needs a customer", async () => {
    profile.row = { email: null };
    const res = await call({ plan: "team" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("User email not found");
    expect(mockStripe.createWorkspaceCheckoutSession).not.toHaveBeenCalled();
    // Still inside the claim window, so it still has to be freed.
    expect(mockRepo.releaseWorkspaceCheckout).toHaveBeenCalledWith("ws-1");
  });
});
