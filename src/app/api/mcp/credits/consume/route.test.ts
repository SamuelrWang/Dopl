/**
 * INVARIANT SUITE — POST /api/mcp/credits/consume:
 *   - the plan is the ENTITLEMENT VERDICT, so a degraded solo is charged against FREE (abuse path);
 *   - a refused spend returns the counter with the refusal;
 *   - it FAILS OPEN on an unexpected error.
 * Auth + billing repo are mocked; the service is real, so plan → limit → period → RPC is end to end.
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
  consumeWorkspaceCredits: vi.fn(),
  getWorkspaceCreditsUsed: vi.fn(),
}));

import { POST } from "./route";
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
  mockRepo.consumeWorkspaceCredits.mockResolvedValue({ allowed: true, used: 1 });
});

describe("POST /api/mcp/credits/consume", () => {
  it("spends one credit against the free allowance and reports what is left", async () => {
    const res = await POST(request(), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ allowed: true, used: 1, limit: 500, remaining: 499 });
    expect(mockRepo.consumeWorkspaceCredits).toHaveBeenCalledWith(
      "ws-1",
      expect.any(String),
      1,
      500
    );
  });

  it("charges a live solo workspace against the SOLO allowance", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ plan: "solo", status: "active" })
    );
    mockRepo.consumeWorkspaceCredits.mockResolvedValue({ allowed: true, used: 7 });

    const body = await (await POST(request(), { params: Promise.resolve({}) })).json();
    expect(body).toMatchObject({ allowed: true, limit: 10_000, remaining: 9_993 });
  });

  it("charges a DEGRADED solo (2 members) against the FREE allowance", async () => {
    // ⚠ Reading `workspace_billing.plan` directly instead of the entitlement verdict hands this
    // workspace 10,000 credits.
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ plan: "solo", status: "active" })
    );
    mockRepo.countActiveMembers.mockResolvedValue(2);

    const body = await (await POST(request(), { params: Promise.resolve({}) })).json();
    expect(body.limit).toBe(500);
    expect(mockRepo.consumeWorkspaceCredits).toHaveBeenCalledWith(
      "ws-1",
      expect.any(String),
      1,
      500
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
    expect(mockRepo.consumeWorkspaceCredits).toHaveBeenCalledWith(
      "ws-1",
      "2099-01-10T00:00:00.000Z",
      1,
      25_000
    );
  });

  it("refuses when the counter is exhausted, still 200, and names the upgrade url", async () => {
    mockRepo.consumeWorkspaceCredits.mockResolvedValue({ allowed: false, used: 500 });

    const res = await POST(request(), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ allowed: false, used: 500, limit: 500, remaining: 0 });
    expect(body.upgradeUrl).toMatch(/billing=upgrade$/);
  });

  it("FAILS OPEN on an RPC error — allowed, degraded, counters not invented", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRepo.consumeWorkspaceCredits.mockRejectedValue(new Error("connection reset"));

    const res = await POST(request(), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowed).toBe(true);
    expect(body.degraded).toBe(true);
    expect(body).toMatchObject({ used: 0, limit: 0, remaining: 0 });
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
