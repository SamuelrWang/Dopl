/**
 * POST /api/billing/cancel — the one route on this page that spends nothing and
 * can still cost the most.
 *
 * FOUR PROPERTIES:
 *   - the gates: admin AND `sessionOnly`. An MCP agent holding a `dopl.write`
 *     token must never be able to end its operator's subscription, and there is
 *     no dialog on that surface to stop it (INVARIANTS §3).
 *   - it sets Stripe's `cancel_at_period_end` — never `subscriptions.cancel`.
 *     An immediate cancel would revoke access the customer has paid for.
 *   - the LOCAL row is written in the same request, not left to the webhook,
 *     so the person who just clicked is told when their access ends.
 *   - no live subscription is a 409 with a named code, never a silent 200.
 *
 * The Stripe SDK is faked at the module boundary. Nothing touches the network.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import type { WorkspaceBillingRow } from "@/features/billing/server/workspace-billing";

const AUTH: WorkspaceAuthContext = {
  userId: "user-1",
  workspaceId: "ws-1",
  workspaceSlug: "acme",
  workspacePublicId: "pub-1",
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
    handler: (req: Request, ctx: WorkspaceAuthContext) => Promise<Response>,
    opts?: GateOptions
  ) => {
    gate.opts = opts;
    return (req: Request) => handler(req, AUTH);
  },
}));

const stripeCalls = vi.hoisted(() => ({
  updated: null as { id: string; params: Record<string, unknown> } | null,
  canceledImmediately: false,
}));

vi.mock("stripe", () => ({
  default: class FakeStripe {
    subscriptions = {
      update: async (id: string, params: Record<string, unknown>) => {
        stripeCalls.updated = { id, params };
        return { id, cancel_at_period_end: params.cancel_at_period_end };
      },
      cancel: async () => {
        stripeCalls.canceledImmediately = true;
        return {};
      },
    };
  },
}));

vi.mock("@/features/billing/server/workspace-billing", () => ({
  getWorkspaceBilling: vi.fn(),
  upsertWorkspaceBilling: vi.fn(),
}));

import { POST } from "./route";
import * as repo from "@/features/billing/server/workspace-billing";

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

function request(body: unknown = {}) {
  return new NextRequest("http://localhost/api/billing/cancel", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
  stripeCalls.updated = null;
  stripeCalls.canceledImmediately = false;
  mockRepo.getWorkspaceBilling.mockResolvedValue(billing());
});

describe("the gates", () => {
  it("is admin AND sessionOnly — an agent token may never cancel a plan", () => {
    expect(gate.opts).toEqual({ minRole: "admin", sessionOnly: true });
  });
});

describe("cancelling", () => {
  it("flags the subscription not to renew — it does NOT cancel it now", async () => {
    const res = await POST(request({}));
    expect(res.status).toBe(200);
    expect(stripeCalls.updated).toEqual({
      id: "sub_123",
      params: { cancel_at_period_end: true },
    });
    // An immediate cancel would revoke access already paid for.
    expect(stripeCalls.canceledImmediately).toBe(false);
  });

  it("writes the local row IMMEDIATELY rather than waiting for the webhook", async () => {
    await POST(request({}));
    expect(mockRepo.upsertWorkspaceBilling).toHaveBeenCalledWith("ws-1", {
      cancelAtPeriodEnd: true,
    });
    // NOT the event watermark: stamping it here would make Stripe's own
    // `customer.subscription.updated` look stale and get dropped.
    const patch = mockRepo.upsertWorkspaceBilling.mock.calls[0][1];
    expect(patch).not.toHaveProperty("lastStripeEventCreated");
  });

  it("answers with the date access actually ends", async () => {
    const body = await (await POST(request({}))).json();
    expect(body).toEqual({
      cancelAtPeriodEnd: true,
      currentPeriodEnd: "2026-09-04T00:00:00.000Z",
    });
  });
});

describe("resuming", () => {
  it("clears the same flag — no new checkout", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ cancelAtPeriodEnd: true })
    );
    const body = await (await POST(request({ resume: true }))).json();
    expect(stripeCalls.updated?.params).toEqual({
      cancel_at_period_end: false,
    });
    expect(mockRepo.upsertWorkspaceBilling).toHaveBeenCalledWith("ws-1", {
      cancelAtPeriodEnd: false,
    });
    expect(body.cancelAtPeriodEnd).toBe(false);
  });

  it("treats `resume: false` as a cancel, like an absent flag", async () => {
    await POST(request({ resume: false }));
    expect(stripeCalls.updated?.params).toEqual({ cancel_at_period_end: true });
  });
});

describe("when there is nothing to cancel", () => {
  it("409s a workspace with no subscription — never a silent 200", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(null);
    const res = await POST(request({}));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NO_ACTIVE_SUBSCRIPTION");
    expect(stripeCalls.updated).toBeNull();
    expect(mockRepo.upsertWorkspaceBilling).not.toHaveBeenCalled();
  });

  it("409s an already-canceled subscription", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ status: "canceled" })
    );
    const res = await POST(request({}));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NO_ACTIVE_SUBSCRIPTION");
  });

  it("still cancels a PAST_DUE workspace — it is entitled, so it is live", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ status: "past_due" })
    );
    expect((await POST(request({}))).status).toBe(200);
  });

  it("409s with a named code when Stripe is not configured", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const res = await POST(request({}));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("STRIPE_NOT_CONFIGURED");
    expect(mockRepo.upsertWorkspaceBilling).not.toHaveBeenCalled();
  });
});

describe("the body", () => {
  it("400s a body that is not JSON, in the nested envelope", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/billing/cancel", {
        method: "POST",
        body: "not json",
        headers: { "content-type": "application/json" },
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_JSON");
  });

  it("400s a non-boolean `resume`", async () => {
    const res = await POST(request({ resume: "yes" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_FAILED");
    expect(stripeCalls.updated).toBeNull();
  });
});
