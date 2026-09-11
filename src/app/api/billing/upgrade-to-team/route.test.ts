/**
 * POST /api/billing/upgrade-to-team — the legacy Solo → Team in-place switch.
 *
 * The property with teeth (2026-09-08, spec §11): **a container is refused
 * before the plan is read, with its own code.** Team is a standard workspace's
 * plan; a `kind='personal'` container's paid plan is `pro`. Falling through
 * would have answered 409 `NOT_ON_SOLO` — a sentence about a plan the caller
 * never had — and, on a row that DID satisfy the solo check, would have swapped
 * a personal subscription onto the per-seat price.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import type { WorkspaceBillingRow } from "@/features/billing/server/workspace-billing";

/** ⚠ Mutated in place per case, restored in `beforeEach`. */
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
}));

vi.mock("stripe", () => ({
  default: class FakeStripe {
    subscriptions = {
      retrieve: async () => ({
        id: "sub_123",
        metadata: { workspace_id: "ws-1" },
        items: { data: [{ id: "si_1", price: { id: "price_solo" } }] },
      }),
      update: async (id: string, params: Record<string, unknown>) => {
        stripeCalls.updated = { id, params };
        return { id };
      },
    };
  },
}));

vi.mock("@/features/billing/server/workspace-billing", () => ({
  getWorkspaceBilling: vi.fn(),
  upsertWorkspaceBilling: vi.fn(),
  countActiveMembers: vi.fn(),
}));

import { POST } from "./route";
import * as repo from "@/features/billing/server/workspace-billing";

const mockRepo = vi.mocked(repo);

function billing(overrides: Partial<WorkspaceBillingRow> = {}): WorkspaceBillingRow {
  return {
    workspaceId: "ws-1",
    plan: "solo",
    status: "active",
    stripeCustomerId: "cus_123",
    stripeSubscriptionId: "sub_123",
    stripePriceId: "price_solo",
    seatCount: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    lastStripeEventCreated: null,
    ...overrides,
  };
}

const call = () =>
  POST(
    new NextRequest("http://localhost/api/billing/upgrade-to-team", {
      method: "POST",
    }),
    { params: Promise.resolve({}) }
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
  vi.stubEnv("STRIPE_PRO_SEAT_PRICE_ID", "price_seat");
  stripeCalls.updated = null;
  mockRepo.getWorkspaceBilling.mockResolvedValue(billing());
  mockRepo.countActiveMembers.mockResolvedValue(4);
  AUTH.workspaceId = "ws-1";
  AUTH.workspaceKind = "standard";
});

describe("the gates", () => {
  it("is admin AND sessionOnly — an agent must never re-plan a subscription", () => {
    expect(gate.opts).toEqual({ minRole: "admin", sessionOnly: true });
  });
});

describe("the legacy switch", () => {
  it("swaps a live Solo workspace to the per-seat price at the member count", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, seatCount: 4 });
    expect(stripeCalls.updated!.params).toMatchObject({
      items: [{ id: "si_1", price: "price_seat", quantity: 4 }],
      metadata: { plan: "team" },
    });
  });

  it("409s NOT_ON_SOLO for a workspace that is not on Solo", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(billing({ plan: "team" }));
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("NOT_ON_SOLO");
    expect(stripeCalls.updated).toBeNull();
  });
});

describe("🔒 a CONTAINER is refused, and not as NOT_ON_SOLO", () => {
  it("409s NOT_A_WORKSPACE on a personal container, before the billing row is even read", async () => {
    AUTH.workspaceId = "personal-1";
    AUTH.workspaceKind = "personal";
    const res = await call();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("NOT_A_WORKSPACE");
    expect(body.message).toContain("Pro");
    expect(mockRepo.getWorkspaceBilling).not.toHaveBeenCalled();
    expect(stripeCalls.updated).toBeNull();
  });

  it("refuses a personal container even when its row WOULD satisfy the Solo check", async () => {
    // ⚠ The dangerous case: without the kind arm this row swaps a personal
    // subscription onto the per-seat price and grows a seat count.
    AUTH.workspaceId = "personal-1";
    AUTH.workspaceKind = "personal";
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ workspaceId: "personal-1" })
    );
    expect((await call()).status).toBe(409);
    expect(stripeCalls.updated).toBeNull();
  });

  it("refuses a LINK container too — the POSITIVE predicate", async () => {
    AUTH.workspaceId = "link-1";
    AUTH.workspaceKind = "link";
    expect((await call()).status).toBe(409);
    expect((await (await call()).json()).error).toBe("NOT_A_WORKSPACE");
  });

  /**
   * 🔒 **THE PREDICATE IS KIND-AGNOSTIC; THE SENTENCE IS NOT** — the F-564
   * `FENCE_SITES` contract (`features/workspaces/home-channel-derivation.test.ts`).
   * One refusal covering three kinds needs three-kinds-worth of honesty: a home
   * CHANNEL is not "your personal space" and has no Pro plan to be sent to, so
   * the shared sentence pointed its owner at the wrong container and offered
   * them a plan it cannot hold.
   */
  it("names the CONTAINER it is refusing — a home channel is not the personal space", async () => {
    AUTH.workspaceKind = "link";
    const linkMessage = (await (await call()).json()).message;
    expect(linkMessage).toContain("home channel");
    expect(linkMessage).not.toContain("personal space");

    AUTH.workspaceKind = "personal";
    const personalMessage = (await (await call()).json()).message;
    expect(personalMessage).toContain("personal space");
    expect(personalMessage).not.toContain("home channel");
  });
});
