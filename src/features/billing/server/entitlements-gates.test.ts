/**
 * Invariant suite — the entitlement gates: what the enforcement sites do with a
 * verdict. `entitlements.test.ts` owns the verdict itself. Billing repository
 * mocked; no Supabase, no network.
 *
 * Two single-member refusals, two codes, two offers: `SOLO_MEMBER_LIMIT` means the
 * workspace's plan is too small (invite/join surfaces key on that string to offer
 * the in-place upgrade), `PERSONAL_SINGLE_MEMBER` means it is a home space and has
 * nothing to sell. Collapsing them shows a Team checkout inside a personal container.
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
  assertCanCreateObject,
  assertCanAddMember,
  entitlementDeniedBody,
  EntitlementError,
  upgradeUrl,
  FREE_MULTI_MEMBER_OBJECT_CAP,
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

describe("upgradeUrl", () => {
  it("is the bare billing link with no plan — the Team default", () => {
    expect(upgradeUrl()).toMatch(/\/billing\?billing=upgrade$/);
  });

  it("appends `plan=pro` when the caller is being sold the PERSONAL tier", () => {
    // Load-bearing: segment-less `/billing` forwards to a standard workspace by
    // default, so a home-space upsell without this param lands on a workspace the
    // caller may not have (`url.ts › billingPath`).
    expect(upgradeUrl("pro")).toMatch(/\/billing\?billing=upgrade&plan=pro$/);
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
        /\/billing\?billing=upgrade$/
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

  /**
   * A live pro container is single-member by construction; this is the belt on top
   * of the upstream braces (`workspaces/server/link-container-guard`).
   */
  it("throws 402 PERSONAL_SINGLE_MEMBER for a live pro container", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ plan: "pro", status: "active", seatCount: null })
    );
    mockRepo.countActiveMembers.mockResolvedValue(1);
    await expect(assertCanAddMember(WS)).rejects.toBeInstanceOf(HttpError);
    try {
      await assertCanAddMember(WS);
    } catch (err) {
      const e = err as HttpError;
      expect(e.status).toBe(402);
      // Not `SOLO_MEMBER_LIMIT`: invite/join surfaces key on that string to offer
      // an in-place Team upgrade, which is the wrong answer in a home space.
      expect(e.code).toBe("PERSONAL_SINGLE_MEMBER");
      expect(e.message).toBe(
        "This is a personal space. Create a workspace to add members."
      );
      // Nothing to buy, so the empty string — the same posture
      // `credits-service.ts › upgradeUrlFor` takes for a wallet with no offer.
      expect((e.details as { upgrade_url: string }).upgrade_url).toBe("");
    }
  });

  it("throws for a pro container in past_due grace too", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ plan: "pro", status: "past_due", seatCount: null })
    );
    mockRepo.countActiveMembers.mockResolvedValue(1);
    await expect(assertCanAddMember(WS)).rejects.toBeInstanceOf(HttpError);
  });

  it("no-ops for a CANCELED pro container — not a live sub", async () => {
    // The gate protects a subscription, not the container: a lapsed row has
    // nothing left to protect and the upstream container guards still apply.
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      billing({ plan: "pro", status: "canceled", seatCount: null })
    );
    mockRepo.countActiveMembers.mockResolvedValue(1);
    await expect(assertCanAddMember(WS)).resolves.toBeUndefined();
  });

  it("🔒 the two refusals carry DIFFERENT codes and DIFFERENT offers", async () => {
    // One shared code passes every "throws 402" assertion above and shows a Team
    // checkout inside somebody's home space.
    const codes: string[] = [];
    const urls: string[] = [];
    for (const plan of ["solo", "pro"] as const) {
      mockRepo.getWorkspaceBilling.mockResolvedValue(
        billing({ plan, status: "active", seatCount: null })
      );
      mockRepo.countActiveMembers.mockResolvedValue(1);
      try {
        await assertCanAddMember(WS);
      } catch (err) {
        const e = err as HttpError;
        codes.push(e.code);
        urls.push((e.details as { upgrade_url: string }).upgrade_url);
      }
    }
    expect(codes).toEqual(["SOLO_MEMBER_LIMIT", "PERSONAL_SINGLE_MEMBER"]);
    expect(urls[0]).not.toBe("");
    expect(urls[1]).toBe("");
  });
});

describe("entitlementDeniedBody", () => {
  it("returns the over_free_cap envelope; message notes nothing is deleted", () => {
    const body = entitlementDeniedBody();
    expect(body.error).toBe("over_free_cap");
    expect(body.message.toLowerCase()).toContain("nothing");
    expect(body.message.toLowerCase()).toContain("upgrade");
    expect(body.upgrade_url).toMatch(/\/billing\?billing=upgrade$/);
  });

  // GAP-11 / D1: API-first clients follow this URL literally, so it must name a
  // page that survives retirement and can take money.
  it("points at the standalone billing page, never /canvas, /pricing or the 404 billing route", () => {
    const body = entitlementDeniedBody();
    expect(body.upgrade_url).toMatch(/\/billing\?billing=upgrade$/);
    expect(body.upgrade_url).not.toContain("/canvas");
    expect(body.upgrade_url).not.toContain("/pricing");
    expect(body.upgrade_url).not.toContain("/settings/billing");
  });
});
