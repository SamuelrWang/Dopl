/**
 * POST /api/billing/portal — the Stripe-hosted handoff. Two properties:
 *   - gates: admin AND `sessionOnly` (INVARIANTS §3, all billing writes);
 *   - it keys on the CONTAINER id and returns to THAT container's billing page,
 *     personal containers included (2026-09-08, spec §11.1 — a Pro subscription
 *     is an ordinary `workspace_billing` row keyed by the container id, so this
 *     route needed no arm for it and must never grow a kind filter).
 * The Stripe SDK is faked at the module boundary; nothing touches the network.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import type { WorkspaceBillingRow } from "@/features/billing/server/workspace-billing";

/** ⚠ Mutated in place by the personal case and restored in `beforeEach` — the
 *  gate mock closes over this object. */
const AUTH: WorkspaceAuthContext = {
  userId: "user-1",
  credentialSubjectUserId: "user-1",
  workspaceId: "ws-1",
  workspaceSlug: "acme",
  workspacePublicId: "ab12cd34ef56",
  role: "admin",
  apiKeyWorkspaceId: null,
  workspaceKind: "standard",
};

const PERSONAL_ID = "personal-1";

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
  portal: null as Record<string, unknown> | null,
}));

vi.mock("stripe", () => ({
  default: class FakeStripe {
    billingPortal = {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          stripeCalls.portal = params;
          return { url: "https://billing.stripe.com/p/session_123" };
        },
      },
    };
  },
}));

vi.mock("@/features/billing/server/workspace-billing", () => ({
  getWorkspaceBilling: vi.fn(),
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
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    lastStripeEventCreated: null,
    ...overrides,
  };
}

const request = () => new NextRequest("http://localhost/api/billing/portal", { method: "POST" });
const call = () => POST(request(), { params: Promise.resolve({}) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://www.usedopl.com");
  stripeCalls.portal = null;
  mockRepo.getWorkspaceBilling.mockResolvedValue(billing());
  AUTH.workspaceId = "ws-1";
  AUTH.workspaceKind = "standard";
  AUTH.workspaceSlug = "acme";
  AUTH.workspacePublicId = "ab12cd34ef56";
});

describe("the gates", () => {
  it("is admin AND sessionOnly", () => {
    expect(gate.opts).toEqual({ minRole: "admin", sessionOnly: true });
  });
});

describe("the handoff", () => {
  it("returns to THIS workspace's billing page", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe("https://billing.stripe.com/p/session_123");
    expect(stripeCalls.portal).toMatchObject({
      customer: "cus_123",
      return_url: "https://www.usedopl.com/billing/acme-ab12cd34ef56?billing=return",
    });
  });

  it("400s a container with no Stripe customer, rather than opening an empty portal", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ stripeCustomerId: null })
    );
    expect((await call()).status).toBe(400);
    expect(stripeCalls.portal).toBeNull();
  });
});

describe("a PERSONAL container passes through unchanged", () => {
  it("opens the portal on the container id and returns to its own billing page", async () => {
    AUTH.workspaceId = PERSONAL_ID;
    AUTH.workspaceKind = "personal";
    AUTH.workspaceSlug = "personal";
    AUTH.workspacePublicId = "ff00ff00ff00";
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ workspaceId: PERSONAL_ID, plan: "pro", seatCount: 1 })
    );
    const res = await call();
    expect(res.status).toBe(200);
    expect(mockRepo.getWorkspaceBilling).toHaveBeenCalledWith(PERSONAL_ID);
    expect(stripeCalls.portal).toMatchObject({
      return_url:
        "https://www.usedopl.com/billing/personal-ff00ff00ff00?billing=return",
    });
  });
});
