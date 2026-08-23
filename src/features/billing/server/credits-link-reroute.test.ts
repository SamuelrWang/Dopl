/**
 * LINK-CONTAINER BILLING REROUTE (PROVISIONAL — Samuel, 2026-08-23: "bill
 * workspace plans separately; MCP burns bill each side's own plan").
 *
 * A `kind='link'` home-channel container is a relationship, not a tenant: it has
 * no `workspace_billing` row and never will. Pins the three things that makes
 * true, because each wrong answer is a different bug:
 *   1. STANDARD target → charged to itself, byte-identical to today. This is
 *      also the migration-unapplied case (`workspaceKind` absent).
 *   2. LINK target → EVERY read and the RPC hit the CALLER's own billing
 *      workspace, not the container. Asserting the id passed to each mock is the
 *      only way to state "the counter that moved was the right one".
 *   3. LINK target, caller owns no standard workspace → UNMETERED and ALLOWED.
 *      Fail-open matches `POST /api/mcp/credits/consume`; a home-channel agent
 *      must not be bricked because its operator has no workspace of their own.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WorkspaceBillingRow } from "./workspace-billing";
import type { Workspace } from "@/features/workspaces/types";

vi.mock("./workspace-billing", () => ({
  getWorkspaceBilling: vi.fn(),
  countActiveMembers: vi.fn(),
  countOntologyObjects: vi.fn(),
  consumeWorkspaceCredits: vi.fn(),
  getWorkspaceCreditsUsed: vi.fn(),
}));
vi.mock("@/features/workspaces/server/repository", () => ({
  findDefaultWorkspaceForUser: vi.fn(),
}));

import * as repo from "./workspace-billing";
import { findDefaultWorkspaceForUser } from "@/features/workspaces/server/repository";
import { consumeMcpCredits, resolveBillingWorkspaceId } from "./credits-service";
import { getWorkspaceBillingStatus } from "./status-service";

const mockRepo = vi.mocked(repo);
const mockFindDefault = vi.mocked(findDefaultWorkspaceForUser);

const LINK_WS = "ws-link";
const OWN_WS = "ws-own";
const USER = "user-1";

function ownWorkspace(): Workspace {
  return {
    id: OWN_WS,
    ownerId: USER,
    name: "Mine",
    slug: "mine",
    publicId: "pub-own",
    description: null,
    iconUrl: null,
    kind: "standard",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function billing(): WorkspaceBillingRow {
  return {
    workspaceId: OWN_WS,
    plan: "solo",
    status: "active",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    stripePriceId: "price_solo",
    seatCount: 1,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    lastStripeEventCreated: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-23T12:00:00.000Z"));
  mockRepo.getWorkspaceBilling.mockResolvedValue(billing());
  mockRepo.countActiveMembers.mockResolvedValue(1);
  mockRepo.consumeWorkspaceCredits.mockResolvedValue({ allowed: true, used: 7 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("resolveBillingWorkspaceId", () => {
  it("standard target (and a kind-less one) bills itself, without asking who called", async () => {
    expect(await resolveBillingWorkspaceId(OWN_WS)).toBe(OWN_WS);
    expect(
      await resolveBillingWorkspaceId(OWN_WS, { userId: USER })
    ).toBe(OWN_WS);
    expect(
      await resolveBillingWorkspaceId(OWN_WS, {
        userId: USER,
        workspaceKind: "standard",
      })
    ).toBe(OWN_WS);
    expect(mockFindDefault).not.toHaveBeenCalled();
  });

  it("link target bills the caller's own oldest-owned standard workspace", async () => {
    mockFindDefault.mockResolvedValue(ownWorkspace());
    expect(
      await resolveBillingWorkspaceId(LINK_WS, {
        userId: USER,
        workspaceKind: "link",
      })
    ).toBe(OWN_WS);
    expect(mockFindDefault).toHaveBeenCalledWith(USER);
  });

  it("link target + no owned standard workspace → null (nothing to charge)", async () => {
    mockFindDefault.mockResolvedValue(null);
    expect(
      await resolveBillingWorkspaceId(LINK_WS, {
        userId: USER,
        workspaceKind: "link",
      })
    ).toBeNull();
  });
});

describe("consumeMcpCredits — link containers", () => {
  it("standard target is unchanged: every read and the RPC hit that workspace", async () => {
    const res = await consumeMcpCredits(OWN_WS, { userId: USER });
    expect(mockRepo.getWorkspaceBilling).toHaveBeenCalledWith(OWN_WS);
    expect(mockRepo.countActiveMembers).toHaveBeenCalledWith(OWN_WS);
    expect(mockRepo.consumeWorkspaceCredits).toHaveBeenCalledWith(
      OWN_WS,
      expect.any(String),
      1,
      10_000
    );
    expect(res.allowed).toBe(true);
    expect(res.used).toBe(7);
  });

  it("link target charges the CALLER's workspace — the container is never read", async () => {
    mockFindDefault.mockResolvedValue(ownWorkspace());

    const res = await consumeMcpCredits(LINK_WS, {
      userId: USER,
      workspaceKind: "link",
    });

    expect(mockRepo.getWorkspaceBilling).toHaveBeenCalledWith(OWN_WS);
    expect(mockRepo.countActiveMembers).toHaveBeenCalledWith(OWN_WS);
    expect(mockRepo.consumeWorkspaceCredits).toHaveBeenCalledWith(
      OWN_WS,
      expect.any(String),
      1,
      10_000
    );
    expect(mockRepo.getWorkspaceBilling).not.toHaveBeenCalledWith(LINK_WS);
    expect(res.allowed).toBe(true);
    expect(res.limit).toBe(10_000);
  });

  it("link target with no billable workspace runs UNMETERED and allowed — nothing is charged", async () => {
    mockFindDefault.mockResolvedValue(null);

    const res = await consumeMcpCredits(LINK_WS, {
      userId: USER,
      workspaceKind: "link",
    });

    expect(res.allowed).toBe(true);
    expect(res).toMatchObject({ used: 0, limit: 0, remaining: 0 });
    // ⚠ STAMPED. The zeroes are not a reading, and `degraded` is the only thing
    // that says so — the same flag the route's `failOpen()` puts on its own
    // zeroes, so one reader recognises both.
    expect(res.degraded).toBe(true);
    // ⚠ No counter moved anywhere — not on the container, not on a guess.
    expect(mockRepo.consumeWorkspaceCredits).not.toHaveBeenCalled();
    expect(mockRepo.getWorkspaceBilling).not.toHaveBeenCalled();
  });

  it("a real reading carries NO degraded stamp", async () => {
    const res = await consumeMcpCredits(OWN_WS, { userId: USER });
    expect(res.degraded).toBeUndefined();
  });
});

/**
 * THE METER MUST AGREE WITH ENFORCEMENT. `GET /api/billing/status` reroutes
 * through the same resolver, and the case that used to diverge is the
 * unresolvable one: `?? workspaceId` read the CONTAINER's untouched counter and
 * reported a free allowance against it, while the consume path was running
 * unmetered and charging nothing.
 */
describe("getWorkspaceBillingStatus — the unmetered posture", () => {
  it("unresolvable target reports the consume path's zeroes, stamped", async () => {
    mockFindDefault.mockResolvedValue(null);
    const status = await getWorkspaceBillingStatus(LINK_WS, {
      userId: USER,
      workspaceKind: "link",
    });

    expect(status.credits).toMatchObject({
      used: 0,
      limit: 0,
      remaining: 0,
      degraded: true,
    });
    // ⚠ The container's own counter is never read — that read WAS the divergence.
    expect(mockRepo.getWorkspaceCreditsUsed).not.toHaveBeenCalled();
  });

  it("a resolvable target still reports a real, unstamped reading", async () => {
    mockFindDefault.mockResolvedValue(ownWorkspace());
    mockRepo.getWorkspaceCreditsUsed.mockResolvedValue(42);

    const status = await getWorkspaceBillingStatus(LINK_WS, {
      userId: USER,
      workspaceKind: "link",
    });

    expect(mockRepo.getWorkspaceCreditsUsed).toHaveBeenCalledWith(
      OWN_WS,
      expect.any(String)
    );
    expect(status.credits.used).toBe(42);
    expect(status.credits.degraded).toBeUndefined();
  });
});
