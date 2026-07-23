/**
 * INVARIANT SUITE — workspace entitlements (the billing contract).
 *
 * Locks the plan/cap/window matrix other agents build against, with the
 * billing repository mocked (no Supabase, no network). Rules under test:
 *   - 1-member free -> uncapped (Notion-style), 90-day chats window
 *   - 2+ free       -> object cap 100, freeze-don't-delete create gate
 *   - solo active/1 -> entitled: uncapped, full history, no seatCount
 *   - solo + 2 mbrs -> DEGRADED to free multi-member rules (backstop)
 *   - solo canceled -> free rules
 *   - team active   -> uncapped, full history, seatCount surfaced
 *   - past_due      -> paid-with-warning: entitlements stay, status shows
 *   - canceled      -> reverts to free rules, status surfaces "canceled"
 *   - assertCanAddMember -> 402 only on a live solo workspace
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceBillingRow } from "./workspace-billing";
import { HttpError } from "@/shared/lib/http-error";

vi.mock("./workspace-billing", () => ({
  getWorkspaceBilling: vi.fn(),
  countActiveMembers: vi.fn(),
  countOntologyObjects: vi.fn(),
}));

import * as repo from "./workspace-billing";
import {
  getWorkspaceEntitlements,
  assertCanCreateObject,
  assertCanAddMember,
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
    plan: "team",
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
  it("1-member free is uncapped (no billing row, 1 member)", async () => {
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

  it("2-member free is capped at 100, create allowed below the cap", async () => {
    setup({ billing: null, members: 2, objects: 50 });
    const e = await getWorkspaceEntitlements(WS);
    expect(e.objectCap).toBe(FREE_MULTI_MEMBER_OBJECT_CAP);
    expect(e.canCreateObjects).toBe(true);
  });

  it("2-member free AT the cap blocks creates (freeze-don't-delete)", async () => {
    setup({ billing: null, members: 2, objects: FREE_MULTI_MEMBER_OBJECT_CAP });
    const e = await getWorkspaceEntitlements(WS);
    expect(e.objectCap).toBe(100);
    expect(e.canCreateObjects).toBe(false);
  });

  it("2-member free OVER the cap still blocks creates", async () => {
    setup({ billing: null, members: 5, objects: 4000 });
    const e = await getWorkspaceEntitlements(WS);
    expect(e.canCreateObjects).toBe(false);
  });
});

describe("getWorkspaceEntitlements — solo", () => {
  it("solo active with a single member is entitled (uncapped, full history, no seatCount)", async () => {
    setup({
      billing: billing({ plan: "solo", status: "active", seatCount: 1 }),
      members: 1,
      objects: 5000,
    });
    const e = await getWorkspaceEntitlements(WS);
    expect(e.plan).toBe("solo");
    expect(e.status).toBe("active");
    expect(e.objectCap).toBeNull();
    expect(e.canCreateObjects).toBe(true);
    expect(e.chatsWindowDays).toBeNull();
    // Solo is flat — no per-seat concept.
    expect(e.seatCount).toBeNull();
  });

  it("solo past_due with a single member keeps the entitlement (grace)", async () => {
    setup({
      billing: billing({ plan: "solo", status: "past_due", seatCount: 1 }),
      members: 1,
      objects: 5000,
    });
    const e = await getWorkspaceEntitlements(WS);
    expect(e.plan).toBe("solo");
    expect(e.status).toBe("past_due");
    expect(e.objectCap).toBeNull();
    expect(e.canCreateObjects).toBe(true);
    expect(e.chatsWindowDays).toBeNull();
  });

  it("solo DEGRADES at 2 members: free multi-member rules apply (backstop)", async () => {
    setup({
      billing: billing({ plan: "solo", status: "active", seatCount: 1 }),
      members: 2,
      objects: 1200,
    });
    const e = await getWorkspaceEntitlements(WS);
    expect(e.plan).toBe("free");
    expect(e.status).toBe("active");
    expect(e.objectCap).toBe(FREE_MULTI_MEMBER_OBJECT_CAP);
    expect(e.canCreateObjects).toBe(false);
    expect(e.chatsWindowDays).toBe(FREE_CHATS_WINDOW_DAYS);
    expect(e.seatCount).toBeNull();
  });

  it("solo canceled reverts to free (single-member => uncapped)", async () => {
    setup({
      billing: billing({ plan: "solo", status: "canceled", seatCount: null }),
      members: 1,
      objects: 5000,
    });
    const e = await getWorkspaceEntitlements(WS);
    expect(e.plan).toBe("free");
    expect(e.status).toBe("canceled");
    expect(e.objectCap).toBeNull();
    expect(e.canCreateObjects).toBe(true);
  });
});

describe("getWorkspaceEntitlements — team", () => {
  it("team active is uncapped with full history and surfaces seatCount", async () => {
    setup({
      billing: billing({ plan: "team", status: "active", seatCount: 3 }),
      members: 5,
      objects: 5000,
    });
    const e = await getWorkspaceEntitlements(WS);
    expect(e.plan).toBe("team");
    expect(e.status).toBe("active");
    expect(e.objectCap).toBeNull();
    expect(e.canCreateObjects).toBe(true);
    expect(e.chatsWindowDays).toBeNull();
    expect(e.seatCount).toBe(3);
  });

  it("team past_due keeps entitlements while surfacing the status", async () => {
    setup({
      billing: billing({ plan: "team", status: "past_due", seatCount: 4 }),
      members: 4,
      objects: 9000,
    });
    const e = await getWorkspaceEntitlements(WS);
    expect(e.plan).toBe("team");
    expect(e.status).toBe("past_due");
    expect(e.objectCap).toBeNull();
    expect(e.canCreateObjects).toBe(true);
    expect(e.chatsWindowDays).toBeNull();
    expect(e.seatCount).toBe(4);
  });
});

describe("getWorkspaceEntitlements — canceled team reverts to free", () => {
  it("canceled multi-member falls back to the free cap + window", async () => {
    setup({
      billing: billing({ plan: "team", status: "canceled", seatCount: 3 }),
      members: 3,
      objects: 1200,
    });
    const e = await getWorkspaceEntitlements(WS);
    expect(e.plan).toBe("free");
    expect(e.status).toBe("canceled");
    expect(e.objectCap).toBe(100);
    expect(e.canCreateObjects).toBe(false);
    expect(e.chatsWindowDays).toBe(FREE_CHATS_WINDOW_DAYS);
    expect(e.seatCount).toBeNull();
  });

  it("canceled single-member is uncapped again (free 1-member rules)", async () => {
    setup({
      billing: billing({ plan: "team", status: "canceled" }),
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
    setup({ billing: null, members: 2, objects: FREE_MULTI_MEMBER_OBJECT_CAP });
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

  it("never blocks a team workspace", async () => {
    setup({
      billing: billing({ plan: "team", status: "active" }),
      members: 9,
      objects: 999999,
    });
    await expect(assertCanCreateObject(WS)).resolves.toBeUndefined();
  });

  it("never blocks an entitled solo workspace", async () => {
    setup({
      billing: billing({ plan: "solo", status: "active" }),
      members: 1,
      objects: 999999,
    });
    await expect(assertCanCreateObject(WS)).resolves.toBeUndefined();
  });
});

describe("assertCanAddMember", () => {
  it("throws 402 SOLO_MEMBER_LIMIT for a live solo workspace (active)", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ plan: "solo", status: "active" })
    );
    mockRepo.countActiveMembers.mockResolvedValue(1);
    await expect(assertCanAddMember(WS)).rejects.toBeInstanceOf(HttpError);
    try {
      await assertCanAddMember(WS);
    } catch (err) {
      const e = err as HttpError;
      expect(e.status).toBe(402);
      expect(e.code).toBe("SOLO_MEMBER_LIMIT");
      expect((e.details as { upgrade_url: string }).upgrade_url).toMatch(
        /\/pricing$/
      );
    }
  });

  it("throws for a solo workspace in past_due grace too", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ plan: "solo", status: "past_due" })
    );
    mockRepo.countActiveMembers.mockResolvedValue(1);
    await expect(assertCanAddMember(WS)).rejects.toBeInstanceOf(HttpError);
  });

  it("no-ops for a canceled solo workspace (not a live sub)", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ plan: "solo", status: "canceled" })
    );
    mockRepo.countActiveMembers.mockResolvedValue(1);
    await expect(assertCanAddMember(WS)).resolves.toBeUndefined();
  });

  it("no-ops for a team workspace", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ plan: "team", status: "active" })
    );
    mockRepo.countActiveMembers.mockResolvedValue(3);
    await expect(assertCanAddMember(WS)).resolves.toBeUndefined();
  });

  it("no-ops for a free workspace (no billing row)", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(null);
    mockRepo.countActiveMembers.mockResolvedValue(1);
    await expect(assertCanAddMember(WS)).resolves.toBeUndefined();
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
