/**
 * LINK-CONTAINER BILLING REROUTE — **THE OPERATOR PAYS** (Samuel, 2026-08-26:
 * "charge MCP calls from a guest to the user"). Supersedes the 2026-08-23
 * PROVISIONAL wiring, which billed each CALLER's own plan.
 *
 * A `kind='link'` home-channel container is a relationship, not a tenant: it has
 * no `workspace_billing` row and never will. The person who minted the link is
 * the one who invited the traffic, so a burn inside the container lands on the
 * CONTAINER OWNER's SOLE owned standard workspace — whoever made the call.
 * Pins the five things that makes true, because each wrong answer is a
 * different bug:
 *   1. STANDARD target → charged to itself, byte-identical to before, and it
 *      asks nobody who owns it. This is also the migration-unapplied case
 *      (`workspaceKind` absent).
 *   2. LINK target → every read and the RPC hit the OWNER's billing workspace.
 *      Asserting the id passed to each mock is the only way to state "the
 *      counter that moved was the right one".
 *   3. LINK target, OWNER owns no standard workspace → UNMETERED and ALLOWED,
 *      with a LOGGED reason. Fail-open by ruling; a guest doing invited work
 *      must not read "out of credits" for a plan that is not theirs.
 *   3b. LINK target, OWNER owns TWO → the SAME unmetered answer under its own
 *      reason (B10, spec §7 (a)). ⚠ This case used to CHARGE, picking the
 *      oldest and calling it the default; a refusal replaces a silent guess.
 *   4. The METER is narrowed to the PAYER. `GET /api/billing/status` carries the
 *      whole entitlements payload, so handing a peer the owner's target would
 *      print the operator's private workspace inside the relationship.
 *
 * ⚠ THE CALLER IS DELIBERATELY NOT THE OWNER IN MOST CASES BELOW. A test whose
 * guest and owner are the same user passes against the pre-fix code.
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
  findActiveOwnerUserId: vi.fn(),
  findSoleOwnedStandardWorkspace: vi.fn(),
}));

import * as repo from "./workspace-billing";
import {
  findActiveOwnerUserId,
  findSoleOwnedStandardWorkspace,
} from "@/features/workspaces/server/repository";
import {
  consumeMcpCredits,
  resolveBillingTarget,
  resolveBillingWorkspaceId,
} from "./credits-service";
import { getWorkspaceBillingStatus } from "./status-service";

const mockRepo = vi.mocked(repo);
const mockFindSole = vi.mocked(findSoleOwnedStandardWorkspace);
const mockFindOwner = vi.mocked(findActiveOwnerUserId);

const LINK_WS = "ws-link";
const OWNER_WS = "ws-owner";
const GUEST_WS = "ws-guest";
const OWNER = "user-operator";
const GUEST = "user-guest";

function standardWorkspace(id: string, ownerId: string): Workspace {
  return {
    id,
    ownerId,
    name: id,
    slug: id,
    publicId: `pub-${id}`,
    description: null,
    iconUrl: null,
    kind: "standard",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function billing(): WorkspaceBillingRow {
  return {
    workspaceId: OWNER_WS,
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

/** The guest addressing the container. */
const guestCaller = { userId: GUEST, workspaceKind: "link" as const };

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-26T12:00:00.000Z"));
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  mockFindOwner.mockResolvedValue(OWNER);
  // Both users own a standard workspace, so "picked the caller's" and "picked
  // the owner's" are two DIFFERENT ids rather than one id and a null.
  mockFindSole.mockImplementation(async (userId: string) => ({
    workspace:
      userId === OWNER
        ? standardWorkspace(OWNER_WS, OWNER)
        : standardWorkspace(GUEST_WS, GUEST),
    count: 1,
  }));
  mockRepo.getWorkspaceBilling.mockResolvedValue(billing());
  mockRepo.countActiveMembers.mockResolvedValue(1);
  mockRepo.consumeWorkspaceCredits.mockResolvedValue({ allowed: true, used: 7 });
});

afterEach(() => {
  warn.mockRestore();
  vi.useRealTimers();
});

describe("resolveBillingTarget", () => {
  it("standard target (and a kind-less one) bills itself, asking nobody who owns it", async () => {
    expect(await resolveBillingTarget(OWNER_WS)).toEqual({
      workspaceId: OWNER_WS,
      payerUserId: null,
    });
    expect(await resolveBillingTarget(OWNER_WS, { userId: GUEST })).toEqual({
      workspaceId: OWNER_WS,
      payerUserId: null,
    });
    expect(
      await resolveBillingTarget(OWNER_WS, {
        userId: GUEST,
        workspaceKind: "standard",
      })
    ).toEqual({ workspaceId: OWNER_WS, payerUserId: null });
    expect(mockFindOwner).not.toHaveBeenCalled();
    expect(mockFindSole).not.toHaveBeenCalled();
  });

  it("link target bills the CONTAINER OWNER's workspace, not the caller's", async () => {
    expect(await resolveBillingTarget(LINK_WS, guestCaller)).toEqual({
      workspaceId: OWNER_WS,
      payerUserId: OWNER,
    });
    expect(mockFindOwner).toHaveBeenCalledWith(LINK_WS);
    expect(mockFindSole).toHaveBeenCalledWith(OWNER);
    // ⚠ THE REVERT DETECTOR. The pre-2026-08-26 code asked for the caller's own
    // workspace; without this line that version passes the assertion above only
    // when the guest happens to own nothing.
    expect(mockFindSole).not.toHaveBeenCalledWith(GUEST);
  });

  it("owner with no standard workspace → null, with a reason", async () => {
    mockFindSole.mockResolvedValue({ workspace: null, count: 0 });
    expect(await resolveBillingTarget(LINK_WS, guestCaller)).toEqual({
      workspaceId: null,
      payerUserId: OWNER,
      reason: "container-owner-has-no-billing-workspace",
    });
  });

  it("🔒 owner with TWO standard workspaces REFUSES rather than picking one", async () => {
    // ⚠ THE REVERT DETECTOR FOR B10. The lookup this replaced answered the
    // OLDEST owned workspace here and warned; that is a real charge against a
    // workspace nobody named, and the only trace was a log line.
    mockFindSole.mockResolvedValue({ workspace: null, count: 2 });
    expect(await resolveBillingTarget(LINK_WS, guestCaller)).toEqual({
      workspaceId: null,
      payerUserId: OWNER,
      reason: "container-owner-has-ambiguous-billing-workspace",
    });
  });

  it("container with no active owner → null, with its OWN reason", async () => {
    mockFindOwner.mockResolvedValue(null);
    expect(await resolveBillingTarget(LINK_WS, guestCaller)).toEqual({
      workspaceId: null,
      payerUserId: null,
      reason: "container-has-no-active-owner",
    });
    // Nothing to look up once there is no owner to look it up for.
    expect(mockFindSole).not.toHaveBeenCalled();
  });

  it("resolveBillingWorkspaceId is the same answer, narrowed", async () => {
    expect(await resolveBillingWorkspaceId(LINK_WS, guestCaller)).toBe(OWNER_WS);
    mockFindSole.mockResolvedValue({ workspace: null, count: 0 });
    expect(await resolveBillingWorkspaceId(LINK_WS, guestCaller)).toBeNull();
  });
});

describe("consumeMcpCredits — link containers", () => {
  it("standard target is unchanged: every read and the RPC hit that workspace", async () => {
    const res = await consumeMcpCredits(OWNER_WS, { userId: OWNER });
    expect(mockRepo.getWorkspaceBilling).toHaveBeenCalledWith(OWNER_WS);
    expect(mockRepo.countActiveMembers).toHaveBeenCalledWith(OWNER_WS);
    expect(mockRepo.consumeWorkspaceCredits).toHaveBeenCalledWith(
      OWNER_WS,
      expect.any(String),
      1,
      10_000
    );
    expect(res.allowed).toBe(true);
    expect(res.used).toBe(7);
  });

  it("a GUEST's burn charges the OWNER — the container and the guest are never read", async () => {
    const res = await consumeMcpCredits(LINK_WS, guestCaller);

    expect(mockRepo.getWorkspaceBilling).toHaveBeenCalledWith(OWNER_WS);
    expect(mockRepo.countActiveMembers).toHaveBeenCalledWith(OWNER_WS);
    expect(mockRepo.consumeWorkspaceCredits).toHaveBeenCalledWith(
      OWNER_WS,
      expect.any(String),
      1,
      10_000
    );
    expect(mockRepo.getWorkspaceBilling).not.toHaveBeenCalledWith(LINK_WS);
    expect(mockRepo.getWorkspaceBilling).not.toHaveBeenCalledWith(GUEST_WS);
    expect(res.allowed).toBe(true);
    expect(res.limit).toBe(10_000);
  });

  it("the OWNER's own burn in their own solo container is byte-identical", async () => {
    const res = await consumeMcpCredits(LINK_WS, {
      userId: OWNER,
      workspaceKind: "link",
    });
    expect(mockRepo.consumeWorkspaceCredits).toHaveBeenCalledWith(
      OWNER_WS,
      expect.any(String),
      1,
      10_000
    );
    expect(res.degraded).toBeUndefined();
  });

  it("owner with no billable workspace runs UNMETERED and allowed — nothing charged", async () => {
    mockFindSole.mockResolvedValue({ workspace: null, count: 0 });

    const res = await consumeMcpCredits(LINK_WS, guestCaller);

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

  it("...and SAYS SO — the fail-open is logged, never silent", async () => {
    mockFindSole.mockResolvedValue({ workspace: null, count: 0 });
    await consumeMcpCredits(LINK_WS, guestCaller);
    const line = warn.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(line).toContain("container-owner-has-no-billing-workspace");
    expect(line).toContain(LINK_WS);
    expect(line).toContain(GUEST);
    expect(line).toContain(OWNER);
  });

  it("a real reading carries NO degraded stamp and logs nothing", async () => {
    const res = await consumeMcpCredits(OWNER_WS, { userId: OWNER });
    expect(res.degraded).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });
});

/**
 * THE METER MUST AGREE WITH ENFORCEMENT — FOR THE PAYER. `GET /api/billing/status`
 * reroutes through the same resolver, and it carries far more than a credit
 * count: plan, member count, seat count, object cap and `objectsUsed` all come
 * from whichever workspace the target names. So the narrowing is a fence, not a
 * nicety: a peer at `viewer`+ inside a container must not read the operator's
 * private standard workspace through it.
 */
describe("getWorkspaceBillingStatus — payer-only meter", () => {
  it("the OWNER reads a real, unstamped reading of their own workspace", async () => {
    mockRepo.getWorkspaceCreditsUsed.mockResolvedValue(42);

    const status = await getWorkspaceBillingStatus(LINK_WS, {
      userId: OWNER,
      workspaceKind: "link",
    });

    expect(mockRepo.getWorkspaceCreditsUsed).toHaveBeenCalledWith(
      OWNER_WS,
      expect.any(String)
    );
    expect(status.credits.used).toBe(42);
    expect(status.credits.degraded).toBeUndefined();
  });

  it("a PEER gets the unmetered posture — the owner's workspace is never read", async () => {
    mockRepo.getWorkspaceCreditsUsed.mockResolvedValue(42);

    const status = await getWorkspaceBillingStatus(LINK_WS, guestCaller);

    expect(status.credits).toMatchObject({
      used: 0,
      limit: 0,
      remaining: 0,
      degraded: true,
    });
    // 🔒 The whole point: no read of the operator's workspace reaches the peer.
    expect(mockRepo.getWorkspaceCreditsUsed).not.toHaveBeenCalled();
    expect(mockRepo.getWorkspaceBilling).not.toHaveBeenCalledWith(OWNER_WS);
    // ...and the container's own counter is not read either — that read WAS the
    // original divergence this suite was written for.
    expect(mockRepo.getWorkspaceCreditsUsed).not.toHaveBeenCalledWith(
      LINK_WS,
      expect.anything()
    );
  });

  it("unresolvable target reports the consume path's zeroes, stamped", async () => {
    mockFindSole.mockResolvedValue({ workspace: null, count: 0 });
    const status = await getWorkspaceBillingStatus(LINK_WS, {
      userId: OWNER,
      workspaceKind: "link",
    });

    expect(status.credits).toMatchObject({
      used: 0,
      limit: 0,
      remaining: 0,
      degraded: true,
    });
    expect(mockRepo.getWorkspaceCreditsUsed).not.toHaveBeenCalled();
  });
});
