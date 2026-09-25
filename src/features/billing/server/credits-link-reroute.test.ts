/**
 * Home-space billing: the operator pays, from their personal wallet (Samuel,
 * 2026-08-26; wallet moved 2026-09-07 with the per-seat ruling, and the personal
 * wallet gained a plan 2026-09-08 — a home burn's limit and window come off the
 * OWNER's own `kind='home'` container's billing row). A `kind='link'` or
 * `kind='home'` container never has a `workspace_billing` row of its own.
 *
 * Five claims, each red under a different single revert:
 *   1. standard target → the caller's own seat (also the migration-unapplied
 *      case, `workspaceKind` absent).
 *   2. link target → the owner's personal wallet, never the caller's.
 *   3. personal target → the caller's own wallet, with no owner lookup.
 *   4. container with no active owner → unmetered, allowed, logged.
 *   5. the meter is the caller's own wallet: the owner reads a real reading, a
 *      peer reads the unmetered posture and the owner's wallet is not read.
 *
 * The caller is deliberately not the owner in most cases: a test whose guest and
 * owner are the same user passes against a version that bills the caller.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WorkspaceBillingRow } from "./workspace-billing";

vi.mock("./workspace-billing", () => ({
  getWorkspaceBilling: vi.fn(),
  // The personal wallet's own read (2026-09-08). `personal-wallet.ts` is real
  // here, so tier, window and limit are computed from the row this mock returns.
  getPersonalBilling: vi.fn(),
  countActiveMembers: vi.fn(),
  countOntologyObjects: vi.fn(),
}));
vi.mock("./credit-wallets", () => ({
  consumeUserCredits: vi.fn(),
  consumeMemberCredits: vi.fn(),
  getUserCreditsUsed: vi.fn(),
  getMemberCreditsUsed: vi.fn(),
}));
vi.mock("@/features/workspaces/server/repository", () => ({
  findActiveOwnerUserId: vi.fn(),
}));

import * as repo from "./workspace-billing";
import * as wallets from "./credit-wallets";
import { findActiveOwnerUserId } from "@/features/workspaces/server/repository";
import { consumeMcpCredits, resolveBillingTarget } from "./credits-service";
import {
  ledgerAttribution,
  homeSpaceTarget,
  seatTarget,
  teamBillingRow,
  unmeteredTarget,
} from "./credits-target-fixtures";
import { getWorkspaceBillingStatus } from "./status-service";

const mockRepo = vi.mocked(repo);
const mockWallets = vi.mocked(wallets);
const mockFindOwner = vi.mocked(findActiveOwnerUserId);

const LINK_WS = "ws-link";
const HOME_SPACE_WS = "ws-personal";
const OWNER_WS = "ws-owner";
const OWNER = "user-operator";
const GUEST = "user-guest";

/** The OWNER's own home space — where their home-space plan lives. */
const HOME_SPACE_OF_OWNER = "ws-personal-of-owner";

/** The shared live-Team row, on the OWNER's standard workspace
 *  (`credits-target-fixtures.ts › teamBillingRow`). */
const billing = (): WorkspaceBillingRow => teamBillingRow({ workspaceId: OWNER_WS });

/** The guest addressing the container. */
const guestCaller = { userId: GUEST, workspaceKind: "link" as const };
/** The owner addressing their own container. */
const ownerCaller = { userId: OWNER, workspaceKind: "link" as const };

const attrib = ledgerAttribution;

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-07T12:00:00.000Z"));
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  mockFindOwner.mockResolvedValue(OWNER);
  mockRepo.getWorkspaceBilling.mockResolvedValue(billing());
  // The owner's home space is free by default while the standard-workspace
  // fixture above is a live Team row: the difference is what lets each case tell
  // "read the payer's personal row" from "read whatever row was lying around".
  mockRepo.getPersonalBilling.mockResolvedValue({
    containerId: HOME_SPACE_OF_OWNER,
    billing: null,
  });
  mockRepo.countActiveMembers.mockResolvedValue(1);
  mockRepo.countOntologyObjects.mockResolvedValue(0);
  mockWallets.consumeUserCredits.mockResolvedValue({ allowed: true, used: 7 });
  mockWallets.consumeMemberCredits.mockResolvedValue({ allowed: true, used: 7 });
  mockWallets.getUserCreditsUsed.mockResolvedValue(0);
  mockWallets.getMemberCreditsUsed.mockResolvedValue(0);
});

afterEach(() => {
  warn.mockRestore();
  vi.useRealTimers();
});

describe("resolveBillingTarget", () => {
  it("1. standard target (and a kind-less one) is the CALLER's seat, asking nobody who owns it", async () => {
    // No calling channel — rule B's fallback arm (`credits-channel-attribution.test.ts`).
    const seat = seatTarget({ workspaceId: OWNER_WS, payerUserId: GUEST });
    expect(await resolveBillingTarget(OWNER_WS, { userId: GUEST })).toEqual(seat);
    expect(
      await resolveBillingTarget(OWNER_WS, {
        userId: GUEST,
        workspaceKind: "standard",
      })
    ).toEqual(seat);
    expect(mockFindOwner).not.toHaveBeenCalled();
  });

  it("2. link target is the CONTAINER OWNER's PERSONAL wallet, not the caller's", async () => {
    expect(await resolveBillingTarget(LINK_WS, guestCaller)).toEqual(
      homeSpaceTarget({ workspaceId: LINK_WS, payerUserId: OWNER })
    );
    expect(mockFindOwner).toHaveBeenCalledWith(LINK_WS);
  });

  it("3. personal target is the caller's OWN wallet, with NO owner lookup", async () => {
    expect(
      await resolveBillingTarget(HOME_SPACE_WS, {
        userId: OWNER,
        workspaceKind: "home",
      })
    ).toEqual(
      homeSpaceTarget({
        workspaceId: HOME_SPACE_WS,
        payerUserId: OWNER,
        personalBillingContainerId: HOME_SPACE_WS,
      })
    );
    expect(mockFindOwner).not.toHaveBeenCalled();
  });

  it("4. container with no active owner → wallet null, with the ONLY reason left", async () => {
    mockFindOwner.mockResolvedValue(null);
    expect(await resolveBillingTarget(LINK_WS, guestCaller)).toEqual(
      unmeteredTarget(LINK_WS)
    );
  });

  it("🔒 an owner who owns NO standard workspace is billed normally now", async () => {
    // Deleted branch: this used to answer
    // `container-owner-has-no-billing-workspace` and charge nothing.
    const target = await resolveBillingTarget(LINK_WS, guestCaller);
    expect(target.wallet).toBe("personal");
    expect(target.payerUserId).toBe(OWNER);
  });

  it("🔒 an owner who owns TWO standard workspaces has nothing to disambiguate", async () => {
    // The other deleted branch (`…-ambiguous-billing-workspace`): there is
    // exactly one personal wallet per user, so the question cannot be asked.
    await consumeMcpCredits(LINK_WS, guestCaller);
    expect(mockWallets.consumeUserCredits).toHaveBeenCalledWith(
      OWNER,
      expect.any(String),
      1,
      500,
      attrib(LINK_WS, GUEST)
    );
  });
});

describe("consumeMcpCredits — home containers", () => {
  it("1. standard target is the caller's seat: billing, members and the RPC all name it", async () => {
    const res = await consumeMcpCredits(OWNER_WS, { userId: GUEST });
    expect(mockRepo.getWorkspaceBilling).toHaveBeenCalledWith(OWNER_WS);
    expect(mockRepo.countActiveMembers).toHaveBeenCalledWith(OWNER_WS);
    expect(mockWallets.consumeMemberCredits).toHaveBeenCalledWith(
      OWNER_WS,
      GUEST,
      expect.any(String),
      1,
      5_000,
      attrib(OWNER_WS, GUEST)
    );
    expect(res).toMatchObject({ allowed: true, used: 7, wallet: "seat" });
  });

  it("2. a GUEST's burn spends the OWNER's personal wallet — the guest's is never touched", async () => {
    const res = await consumeMcpCredits(LINK_WS, guestCaller);

    expect(mockWallets.consumeUserCredits).toHaveBeenCalledWith(
      OWNER,
      expect.any(String),
      1,
      500,
      attrib(LINK_WS, GUEST)
    );
    // Revert detector: a version that bills the caller passes every assertion above.
    expect(mockWallets.consumeUserCredits).not.toHaveBeenCalledWith(
      GUEST,
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
    // Nothing seat-shaped happens: a container has no plan to read.
    expect(mockWallets.consumeMemberCredits).not.toHaveBeenCalled();
    expect(mockRepo.getWorkspaceBilling).not.toHaveBeenCalled();
    expect(res).toMatchObject({ allowed: true, limit: 500, wallet: "personal" });
  });

  it("2c. the limit comes off the OWNER's PERSONAL row, not the addressed container's", async () => {
    // The addressed link container has no billing row and the `beforeEach` Team
    // fixture belongs to neither: reading either charges this Pro operator 500.
    mockRepo.getPersonalBilling.mockResolvedValue({
      containerId: HOME_SPACE_OF_OWNER,
      billing: { ...billing(), workspaceId: HOME_SPACE_OF_OWNER, plan: "pro" },
    });

    const res = await consumeMcpCredits(LINK_WS, guestCaller);

    expect(mockRepo.getPersonalBilling).toHaveBeenCalledWith(OWNER);
    expect(mockWallets.consumeUserCredits).toHaveBeenCalledWith(
      OWNER,
      expect.any(String),
      1,
      5_000,
      attrib(LINK_WS, GUEST)
    );
    expect(res).toMatchObject({ wallet: "personal", limit: 5_000 });
  });

  it("2b. the OWNER's own burn in their own container spends the same wallet", async () => {
    const res = await consumeMcpCredits(LINK_WS, ownerCaller);
    expect(mockWallets.consumeUserCredits).toHaveBeenCalledWith(
      OWNER,
      expect.any(String),
      1,
      500,
      attrib(LINK_WS, OWNER)
    );
    expect(res.degraded).toBeUndefined();
  });

  // The home-only user (2026-09-10): a person who has never made a workspace
  // burns inside their own `kind='home'` shelf — the container
  // `POST /api/boot` hands the SPA with no segment. `resolveBillingTarget`'s only
  // remaining `wallet: null` is `container-has-no-active-owner`.
  it("🔒 3b. a HOME-ONLY user's burn in their own home shelf IS metered", async () => {
    // No billing row at all — the state a brand-new account is in. Leaving the
    // `beforeEach` Team row (a different workspace) in place would let a version
    // reading "whatever row was lying around" answer 500 by accident.
    mockRepo.getWorkspaceBilling.mockResolvedValue(null);

    const res = await consumeMcpCredits(HOME_SPACE_WS, {
      userId: OWNER,
      workspaceKind: "home",
    });

    expect(res.allowed).toBe(true);
    // `degraded` is the assertion that matters: `unmetered()` also answers
    // `allowed: true`, so a leak here passes on `allowed` alone. The stamp
    // separates "nothing measured" from "nothing spent".
    expect(res.degraded).toBeUndefined();
    expect(res).toMatchObject({ wallet: "personal", limit: 500 });
    expect(mockWallets.consumeUserCredits).toHaveBeenCalledWith(
      OWNER,
      expect.any(String),
      1,
      500,
      attrib(HOME_SPACE_WS, OWNER)
    );
    // THE ADDRESSED CONTAINER IS ITSELF THE BILLING ROW HERE — the one shape
    // where it is (`credits-service.ts › consumeMcpCredits`'s `workspaceKind ===
    // "home" ? target.workspaceId : null`), so the row is read STRAIGHT off
    // the addressed id and the payer→container lookup is skipped entirely.
    expect(mockRepo.getWorkspaceBilling).toHaveBeenCalledWith(HOME_SPACE_WS);
    expect(mockRepo.getPersonalBilling).not.toHaveBeenCalled();
    // Nothing seat- or owner-shaped: a shelf has one member and it is the caller.
    expect(mockFindOwner).not.toHaveBeenCalled();
    expect(mockWallets.consumeMemberCredits).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("🔒 3c. …and the same user's PRO shelf meters at 5,000, off that same row", async () => {
    // The pair is the claim: 3b alone passes against a version that hardcodes the
    // free allowance for every personal burn.
    mockRepo.getWorkspaceBilling.mockResolvedValue({
      ...billing(),
      workspaceId: HOME_SPACE_WS,
      plan: "pro",
    });

    const res = await consumeMcpCredits(HOME_SPACE_WS, {
      userId: OWNER,
      workspaceKind: "home",
    });

    expect(res).toMatchObject({ wallet: "personal", limit: 5_000 });
    expect(mockWallets.consumeUserCredits).toHaveBeenCalledWith(
      OWNER,
      expect.any(String),
      1,
      5_000,
      attrib(HOME_SPACE_WS, OWNER)
    );
  });

  it("4. no active owner → UNMETERED and allowed, nothing charged anywhere", async () => {
    mockFindOwner.mockResolvedValue(null);

    const res = await consumeMcpCredits(LINK_WS, guestCaller);

    expect(res.allowed).toBe(true);
    expect(res).toMatchObject({ used: 0, limit: 0, remaining: 0, wallet: null });
    // The zeroes are not a reading, and `degraded` is the only thing that says
    // so — the same flag the route's `failOpen()` puts on its own zeroes.
    expect(res.degraded).toBe(true);
    expect(mockWallets.consumeUserCredits).not.toHaveBeenCalled();
    expect(mockWallets.consumeMemberCredits).not.toHaveBeenCalled();
  });

  it("4b. ...and SAYS SO — the fail-open is logged, never silent", async () => {
    mockFindOwner.mockResolvedValue(null);
    await consumeMcpCredits(LINK_WS, guestCaller);
    const line = warn.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(line).toContain("container-has-no-active-owner");
    expect(line).toContain(LINK_WS);
    expect(line).toContain(GUEST);
  });

  it("a real reading carries NO degraded stamp and logs nothing", async () => {
    const res = await consumeMcpCredits(LINK_WS, guestCaller);
    expect(res.degraded).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });
});

/**
 * 5. The meter is the caller's own wallet. A personal wallet spans its owner's
 * whole home space, so showing it to a peer inside one link container would
 * print the operator's total home spend to somebody who sees one channel of it.
 */
describe("getWorkspaceBillingStatus — the caller's own meter", () => {
  it("the OWNER reads a real, unstamped reading of their own personal wallet", async () => {
    mockWallets.getUserCreditsUsed.mockResolvedValue(42);

    const status = await getWorkspaceBillingStatus(LINK_WS, ownerCaller);

    expect(mockWallets.getUserCreditsUsed).toHaveBeenCalledWith(
      OWNER,
      expect.any(String)
    );
    expect(status.credits).toMatchObject({
      wallet: "personal",
      used: 42,
      limit: 500,
      remaining: 458,
    });
    expect(status.credits.degraded).toBeUndefined();
  });

  it("the OWNER's PRO home space meters at 5,000, read off their personal row", async () => {
    // The meter's own copy of the 2c claim: enforcement and the meter resolve the
    // row through the same helper, or the settings pane shows 500 for a wallet
    // being charged against 5,000.
    mockRepo.getPersonalBilling.mockResolvedValue({
      containerId: HOME_SPACE_OF_OWNER,
      billing: { ...billing(), workspaceId: HOME_SPACE_OF_OWNER, plan: "pro" },
    });
    mockWallets.getUserCreditsUsed.mockResolvedValue(1_000);

    const status = await getWorkspaceBillingStatus(LINK_WS, ownerCaller);

    expect(status.credits).toMatchObject({
      wallet: "personal",
      used: 1_000,
      limit: 5_000,
      remaining: 4_000,
    });
  });

  it("stamps the addressed container's KIND on the payload", async () => {
    // No renderer can pick a plan list from `plan` alone — `free` is a value
    // on both taxonomies (`plans.ts › plansForKind`).
    expect((await getWorkspaceBillingStatus(LINK_WS, ownerCaller)).containerKind).toBe(
      "link"
    );
    expect(
      (await getWorkspaceBillingStatus(OWNER_WS, { userId: GUEST })).containerKind
    ).toBe("standard");
    expect(
      (
        await getWorkspaceBillingStatus(HOME_SPACE_WS, {
          userId: OWNER,
          workspaceKind: "home",
        })
      ).containerKind
    ).toBe("home");
  });

  it("a PEER gets the unmetered posture — the owner's wallet is never read", async () => {
    mockWallets.getUserCreditsUsed.mockResolvedValue(42);

    const status = await getWorkspaceBillingStatus(LINK_WS, guestCaller);

    expect(status.credits).toMatchObject({
      wallet: null,
      used: 0,
      limit: 0,
      remaining: 0,
      degraded: true,
    });
    // The whole point: no reading of the operator's allowance reaches the peer.
    expect(mockWallets.getUserCreditsUsed).not.toHaveBeenCalled();
    expect(mockWallets.getMemberCreditsUsed).not.toHaveBeenCalled();
  });

  it("a container with no active owner reports the consume path's zeroes, stamped", async () => {
    mockFindOwner.mockResolvedValue(null);
    const status = await getWorkspaceBillingStatus(LINK_WS, ownerCaller);

    expect(status.credits).toMatchObject({
      wallet: null,
      used: 0,
      limit: 0,
      remaining: 0,
      degraded: true,
    });
    expect(mockWallets.getUserCreditsUsed).not.toHaveBeenCalled();
  });

  it("a member in a standard workspace reads their OWN seat, not the workspace's total", async () => {
    mockWallets.getMemberCreditsUsed.mockResolvedValue(11);
    mockRepo.countActiveMembers.mockResolvedValue(4);

    const status = await getWorkspaceBillingStatus(OWNER_WS, {
      userId: GUEST,
      workspaceKind: "standard",
    });

    expect(mockWallets.getMemberCreditsUsed).toHaveBeenCalledWith(
      OWNER_WS,
      GUEST,
      expect.any(String)
    );
    expect(status.credits).toMatchObject({
      wallet: "seat",
      used: 11,
      limit: 5_000,
      remaining: 4_989,
    });
  });
});
