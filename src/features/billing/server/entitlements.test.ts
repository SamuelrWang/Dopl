/**
 * Invariant suite — workspace entitlements (the billing contract). Locks the
 * plan/cap/window matrix with the billing repository mocked. The pro arm carries
 * no member condition (2026-09-08, F-673).
 *
 * The enforcement sites live in `entitlements-gates.test.ts`: this file asks what
 * a container is entitled to, that one what the gates do with the answer.
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
  entitledPlanFor,
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
    currentPeriodStart: "2026-07-01T00:00:00Z",
    currentPeriodEnd: "2026-08-01T00:00:00Z",
    cancelAtPeriodEnd: false,
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

/**
 * The personal Pro tier (2026-09-08). A `kind='home'` container is a real
 * `workspaces` row with a real `workspace_billing` row, so it reaches this function
 * through the same arithmetic — these cases prove the three claims fall out of the
 * existing rules rather than a personal branch.
 */
describe("getWorkspaceEntitlements — pro (the home space)", () => {
  it("pro active is uncapped, full history, and surfaces NO seatCount", async () => {
    setup({ billing: billing({ plan: "pro", seatCount: null }), members: 1, objects: 5_000 });
    const ent = await getWorkspaceEntitlements(WS);
    expect(ent.plan).toBe("pro");
    expect(ent.status).toBe("active");
    expect(ent.objectCap).toBeNull();
    expect(ent.canCreateObjects).toBe(true);
    expect(ent.chatsWindowDays).toBeNull();
    // `seatCount` is team-only: a number here would show a seat row for a
    // container that has no seats to sell.
    expect(ent.seatCount).toBeNull();
  });

  it("pro past_due keeps the entitlement (grace)", async () => {
    setup({
      billing: billing({ plan: "pro", status: "past_due", seatCount: null }),
      members: 1,
      objects: 5_000,
    });
    const ent = await getWorkspaceEntitlements(WS);
    expect(ent.plan).toBe("pro");
    expect(ent.chatsWindowDays).toBeNull();
  });

  it("pro canceled reverts to free — 90 days of history back", async () => {
    setup({
      billing: billing({ plan: "pro", status: "canceled", seatCount: null }),
      members: 1,
      objects: 5,
    });
    const ent = await getWorkspaceEntitlements(WS);
    expect(ent.plan).toBe("free");
    expect(ent.chatsWindowDays).toBe(FREE_CHATS_WINDOW_DAYS);
  });

  it("🔒 pro does NOT degrade at 2 members — unlike solo (F-673)", async () => {
    // Revert detector for "copy the solo arm": solo's `memberCount <= 1` backstops
    // a state the schema permits, but a home space cannot hold a second
    // member at all — so the same clause would guard nothing while letting one
    // stale membership row silently drop a paying customer to free.
    setup({ billing: billing({ plan: "pro", seatCount: null }), members: 2, objects: 5_000 });
    const ent = await getWorkspaceEntitlements(WS);
    expect(ent.plan).toBe("pro");
    expect(ent.objectCap).toBeNull();
    expect(ent.chatsWindowDays).toBeNull();
    // ...and the same row on solo does degrade — a contrast, not a coincidence.
    setup({ billing: billing({ plan: "solo", seatCount: 1 }), members: 2, objects: 5 });
    expect((await getWorkspaceEntitlements(WS)).plan).toBe("free");
  });
});

describe("entitledPlanFor — the lean verdict the credit path uses", () => {
  it("answers pro for a live pro row at any member count", () => {
    expect(entitledPlanFor({ plan: "pro", status: "active" }, 1)).toBe("pro");
    expect(entitledPlanFor({ plan: "pro", status: "past_due" }, 3)).toBe("pro");
  });

  it("answers free for a canceled pro row", () => {
    expect(entitledPlanFor({ plan: "pro", status: "canceled" }, 1)).toBe("free");
  });

  it("🔒 is the SAME verdict `getWorkspaceEntitlements` reaches — not a copy", async () => {
    setup({ billing: billing({ plan: "pro", seatCount: null }), members: 2, objects: 5_000 });
    expect((await getWorkspaceEntitlements(WS)).plan).toBe(
      entitledPlanFor({ plan: "pro", status: "active" }, 2)
    );
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
