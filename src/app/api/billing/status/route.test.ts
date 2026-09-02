/**
 * INVARIANT SUITE — GET /api/billing/status. Feeds every billing surface, so the pins are about
 * the wire shape: `credits` present for EVERY plan (not just capped free ones); computed from the
 * SAME plan verdict and period helpers the consume path uses, so the meter cannot disagree with
 * enforcement; no usage row reads 0, not an error; `cancelAtPeriodEnd` rides the same payload.
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
  getWorkspaceCreditsUsed: vi.fn(),
}));

import { GET } from "./route";
import * as repo from "@/features/billing/server/workspace-billing";

const mockRepo = vi.mocked(repo);

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
  mockRepo.getWorkspaceCreditsUsed.mockResolvedValue(0);
});

describe("GET /api/billing/status — credits", () => {
  it("carries a credits meter on a FREE workspace", async () => {
    mockRepo.getWorkspaceCreditsUsed.mockResolvedValue(42);
    const body = await (await GET(request(), { params: Promise.resolve({}) })).json();
    expect(body.credits).toMatchObject({ used: 42, limit: 500, remaining: 458 });
    expect(body.credits.periodStart).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
  });

  it("carries one on a TEAM workspace too — every plan is metered", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ plan: "team", status: "active", seatCount: 4 })
    );
    const body = await (await GET(request(), { params: Promise.resolve({}) })).json();
    expect(body.plan).toBe("team");
    expect(body.credits).toMatchObject({ used: 0, limit: 25_000, remaining: 25_000 });
  });

  it("reads a DEGRADED solo against the free allowance, like the consume path", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ plan: "solo", status: "active" })
    );
    mockRepo.countActiveMembers.mockResolvedValue(2);
    const body = await (await GET(request(), { params: Promise.resolve({}) })).json();
    expect(body.credits.limit).toBe(500);
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
    expect(mockRepo.getWorkspaceCreditsUsed).toHaveBeenCalledWith(
      "ws-1",
      "2099-03-04T00:00:00.000Z"
    );
    expect(body.credits.periodEnd).toBe("2099-04-04T00:00:00.000Z");
  });

  it("never reports negative remaining, even if usage overshot the limit", async () => {
    mockRepo.getWorkspaceCreditsUsed.mockResolvedValue(600);
    const body = await (await GET(request(), { params: Promise.resolve({}) })).json();
    expect(body.credits.remaining).toBe(0);
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
