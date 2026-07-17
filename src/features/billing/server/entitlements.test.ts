/**
 * INVARIANT SUITE — workspace entitlements (the billing contract).
 *
 * Locks the plan/cap/window matrix other agents build against, with the
 * billing repository mocked (no Supabase, no network). Rules under test:
 *   - solo free  -> uncapped (Notion-style), 90-day chats window
 *   - 2+ free    -> object cap 1000, freeze-don't-delete create gate
 *   - pro active -> uncapped, full history, seatCount surfaced
 *   - past_due   -> pro-with-warning: entitlements stay pro, status shows
 *   - canceled   -> reverts to free rules, status surfaces "canceled"
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceBillingRow } from "./workspace-billing";

vi.mock("./workspace-billing", () => ({
  getWorkspaceBilling: vi.fn(),
  countActiveMembers: vi.fn(),
  countOntologyObjects: vi.fn(),
}));

import * as repo from "./workspace-billing";
import {
  getWorkspaceEntitlements,
  assertCanCreateObject,
  entitlementDeniedBody,
  EntitlementError,
  FREE_MULTI_MEMBER_OBJECT_CAP,
  FREE_CHATS_WINDOW_DAYS,
} from "./entitlements";

const mockRepo = vi.mocked(repo);
const WS = "ws-1";

function billing(overrides: Partial<WorkspaceBillingRow>): WorkspaceBillingRow {
  return {
    workspaceId: WS,
    plan: "pro",
    status: "active",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    stripePriceId: "price_seat",
    seatCount: 3,
    currentPeriodEnd: "2026-08-01T00:00:00Z",
    lastStripeEventCreated: null,
    ...overrides,
  };
}

function setup(opts: {
  billing: WorkspaceBillingRow | null;
  members: number;
  objects: number;
}) {
  mockRepo.getWorkspaceBilling.mockResolvedValue(opts.billing);
  mockRepo.countActiveMembers.mockResolvedValue(opts.members);
  mockRepo.countOntologyObjects.mockResolvedValue(opts.objects);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getWorkspaceEntitlements — free plans", () => {
  it("solo free is uncapped (no billing row, 1 member)", async () => {
    setup({ billing: null, members: 1, objects: 5000 });
    const e = await getWorkspaceEntitlements(WS);
    expect(e.plan).toBe("free");
    expect(e.status).toBe("free");
    expect(e.memberCount).toBe(1);
    expect(e.seatCount).toBeNull();
    expect(e.objectCap).toBeNull();
    expect(e.objectsUsed).toBe(5000);
    expect(e.canCreateObjects).toBe(true);
    expect(e.chatsWindowDays).toBe(FREE_CHATS_WINDOW_DAYS);
  });

  it("2-member free is capped at 1000, create allowed below the cap", async () => {
    setup({ billing: null, members: 2, objects: 999 });
    const e = await getWorkspaceEntitlements(WS);
    expect(e.objectCap).toBe(FREE_MULTI_MEMBER_OBJECT_CAP);
    expect(e.canCreateObjects).toBe(true);
  });

  it("2-member free AT the cap blocks creates (freeze-don't-delete)", async () => {
    setup({ billing: null, members: 2, objects: FREE_MULTI_MEMBER_OBJECT_CAP });
    const e = await getWorkspaceEntitlements(WS);
    expect(e.objectCap).toBe(1000);
    expect(e.canCreateObjects).toBe(false);
  });

  it("2-member free OVER the cap still blocks creates", async () => {
    setup({ billing: null, members: 5, objects: 4000 });
    const e = await getWorkspaceEntitlements(WS);
    expect(e.canCreateObjects).toBe(false);
  });
});

describe("getWorkspaceEntitlements — pro", () => {
  it("pro active is uncapped with full history and surfaces seatCount", async () => {
    setup({
      billing: billing({ plan: "pro", status: "active", seatCount: 3 }),
      members: 5,
      objects: 5000,
    });
    const e = await getWorkspaceEntitlements(WS);
    expect(e.plan).toBe("pro");
    expect(e.status).toBe("active");
    expect(e.objectCap).toBeNull();
    expect(e.canCreateObjects).toBe(true);
    expect(e.chatsWindowDays).toBeNull();
    expect(e.seatCount).toBe(3);
  });

  it("past_due keeps pro entitlements while surfacing the status", async () => {
    setup({
      billing: billing({ plan: "pro", status: "past_due", seatCount: 4 }),
      members: 4,
      objects: 9000,
    });
    const e = await getWorkspaceEntitlements(WS);
    expect(e.plan).toBe("pro");
    expect(e.status).toBe("past_due");
    expect(e.objectCap).toBeNull();
    expect(e.canCreateObjects).toBe(true);
    expect(e.chatsWindowDays).toBeNull();
    expect(e.seatCount).toBe(4);
  });
});

describe("getWorkspaceEntitlements — canceled reverts to free", () => {
  it("canceled multi-member falls back to the free cap + window", async () => {
    setup({
      billing: billing({ plan: "pro", status: "canceled", seatCount: 3 }),
      members: 3,
      objects: 1200,
    });
    const e = await getWorkspaceEntitlements(WS);
    expect(e.plan).toBe("free");
    expect(e.status).toBe("canceled");
    expect(e.objectCap).toBe(1000);
    expect(e.canCreateObjects).toBe(false);
    expect(e.chatsWindowDays).toBe(FREE_CHATS_WINDOW_DAYS);
    expect(e.seatCount).toBeNull();
  });

  it("canceled solo is uncapped again (free solo rules)", async () => {
    setup({
      billing: billing({ plan: "pro", status: "canceled" }),
      members: 1,
      objects: 1200,
    });
    const e = await getWorkspaceEntitlements(WS);
    expect(e.plan).toBe("free");
    expect(e.objectCap).toBeNull();
    expect(e.canCreateObjects).toBe(true);
  });
});

describe("assertCanCreateObject", () => {
  it("resolves when under the cap", async () => {
    setup({ billing: null, members: 2, objects: 10 });
    await expect(assertCanCreateObject(WS)).resolves.toBeUndefined();
  });

  it("throws EntitlementError(over_free_cap) at the cap", async () => {
    setup({ billing: null, members: 2, objects: 1000 });
    await expect(assertCanCreateObject(WS)).rejects.toBeInstanceOf(
      EntitlementError
    );
    try {
      await assertCanCreateObject(WS);
    } catch (err) {
      expect((err as EntitlementError).code).toBe("over_free_cap");
      expect((err as EntitlementError).workspaceId).toBe(WS);
    }
  });

  it("never blocks a pro workspace", async () => {
    setup({
      billing: billing({ plan: "pro", status: "active" }),
      members: 9,
      objects: 999999,
    });
    await expect(assertCanCreateObject(WS)).resolves.toBeUndefined();
  });
});

describe("entitlementDeniedBody", () => {
  it("returns the over_free_cap envelope; message notes nothing is deleted", () => {
    const body = entitlementDeniedBody();
    expect(body.error).toBe("over_free_cap");
    expect(body.message.toLowerCase()).toContain("nothing");
    expect(body.message.toLowerCase()).toContain("upgrade");
    expect(body.upgrade_url).toMatch(/\/pricing$/);
  });

  it("always points at /pricing (the per-workspace billing route is a 404)", () => {
    const body = entitlementDeniedBody();
    expect(body.upgrade_url).toMatch(/\/pricing$/);
    expect(body.upgrade_url).not.toContain("/settings/billing");
  });
});
