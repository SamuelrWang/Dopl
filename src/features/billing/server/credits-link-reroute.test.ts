/**
 * HOME-SPACE BILLING — **THE OPERATOR PAYS, FROM THEIR PERSONAL WALLET**
 * (Samuel, 2026-08-26: "charge MCP calls from a guest to the user"; wallet moved
 * 2026-09-07 with the per-seat + personal-wallet ruling).
 *
 * A `kind='link'` home-channel container is a relationship and a
 * `kind='personal'` container is a shelf: neither has a `workspace_billing` row
 * and neither ever will. The person who minted the container invited the
 * traffic, so a burn inside it spends the CONTAINER OWNER's PERSONAL wallet —
 * whoever made the call.
 *
 * ⚠ **THE "REROUTE" IN THIS FILE'S NAME IS HISTORY, AND THE HISTORY IS THE
 * POINT.** Until 2026-09-07 a container burn was rerouted onto the owner's SOLE
 * owned STANDARD workspace, and REFUSED (unmetered + logged) when they owned
 * none — `container-owner-has-no-billing-workspace` — or owned two —
 * `container-owner-has-ambiguous-billing-workspace`. Home spend is its own
 * wallet now, so there is no second workspace to route to and **both of those
 * branches are DELETED**: every user has exactly one personal wallet, so nothing
 * can be missing and nothing can be ambiguous.
 *
 * ⚠ **AND THE PERSONAL WALLET GAINED A PLAN ON 2026-09-08** (Samuel's $8.99
 * ruling): a home burn's limit and window come off the OWNER's own
 * `kind='personal'` container's billing row, so "which row" is now as
 * load-bearing as "whose wallet". The claims below are unchanged; two cases are
 * added for the row.
 *
 * Five claims, each red under a different single revert:
 *   1. STANDARD target → the CALLER's own seat, asking nobody who owns it. This
 *      is also the migration-unapplied case (`workspaceKind` absent).
 *   2. LINK target → the OWNER's personal wallet, never the caller's.
 *   3. PERSONAL target → the caller's own wallet, with NO owner lookup at all.
 *   4. Container with no active owner → unmetered, allowed, LOGGED.
 *   5. The METER is the caller's OWN wallet: an owner reads a real reading, a
 *      PEER reads the unmetered posture and no read of the owner's wallet
 *      happens at all.
 *
 * ⚠ THE CALLER IS DELIBERATELY NOT THE OWNER IN MOST CASES BELOW. A test whose
 * guest and owner are the same user passes against a version that bills the
 * caller.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WorkspaceBillingRow } from "./workspace-billing";

vi.mock("./workspace-billing", () => ({
  getWorkspaceBilling: vi.fn(),
  // ⚠ THE PERSONAL WALLET'S OWN READ (2026-09-08). `personal-wallet.ts` is
  // REAL in this suite — only the repository is mocked — so the tier, the
  // window and the limit are computed by the code under test from the row this
  // mock hands back, exactly as they are in production.
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
  personalTarget,
  seatTarget,
  teamBillingRow,
  unmeteredTarget,
} from "./credits-target-fixtures";
import { getWorkspaceBillingStatus } from "./status-service";

const mockRepo = vi.mocked(repo);
const mockWallets = vi.mocked(wallets);
const mockFindOwner = vi.mocked(findActiveOwnerUserId);

const LINK_WS = "ws-link";
const PERSONAL_WS = "ws-personal";
const OWNER_WS = "ws-owner";
const OWNER = "user-operator";
const GUEST = "user-guest";

/** The OWNER's own personal container — where their home-space plan lives. */
const PERSONAL_OF_OWNER = "ws-personal-of-owner";

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
  // ⚠ THE OWNER'S HOME SPACE IS FREE BY DEFAULT HERE, WHILE THE STANDARD
  // WORKSPACE FIXTURE ABOVE IS A LIVE TEAM ROW. The two being different is what
  // makes every case below able to tell "read the payer's personal row" from
  // "read whatever billing row was lying around".
  mockRepo.getPersonalBilling.mockResolvedValue({
    containerId: PERSONAL_OF_OWNER,
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
    // ⚠ NO CALLING CHANNEL — rule B's fallback arm (`credits-channel-attribution.test.ts`).
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
      personalTarget({ workspaceId: LINK_WS, payerUserId: OWNER })
    );
    expect(mockFindOwner).toHaveBeenCalledWith(LINK_WS);
  });

  it("3. personal target is the caller's OWN wallet, with NO owner lookup", async () => {
    expect(
      await resolveBillingTarget(PERSONAL_WS, {
        userId: OWNER,
        workspaceKind: "personal",
      })
    ).toEqual(
      personalTarget({
        workspaceId: PERSONAL_WS,
        payerUserId: OWNER,
        personalBillingContainerId: PERSONAL_WS,
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
    // ⚠ THE BRANCH THAT WAS DELETED. This used to answer
    // `container-owner-has-no-billing-workspace` and charge nothing — a whole
    // population running free because they had never made a workspace. The
    // personal wallet does not need one.
    const target = await resolveBillingTarget(LINK_WS, guestCaller);
    expect(target.wallet).toBe("personal");
    expect(target.payerUserId).toBe(OWNER);
  });

  it("🔒 an owner who owns TWO standard workspaces has nothing to disambiguate", async () => {
    // ⚠ THE OTHER DELETED BRANCH (`…-ambiguous-billing-workspace`). There is
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
    // ⚠ THE REVERT DETECTOR. A version that bills the caller passes every
    // assertion above.
    expect(mockWallets.consumeUserCredits).not.toHaveBeenCalledWith(
      GUEST,
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
    // ⚠ AND NOTHING SEAT-SHAPED HAPPENS AT ALL: no billing row, no member count,
    // no member RPC. A container has no plan to read.
    expect(mockWallets.consumeMemberCredits).not.toHaveBeenCalled();
    expect(mockRepo.getWorkspaceBilling).not.toHaveBeenCalled();
    expect(res).toMatchObject({ allowed: true, limit: 500, wallet: "personal" });
  });

  it("2c. the limit comes off the OWNER's PERSONAL row, not the addressed container's", async () => {
    // 🔒 The addressed link container has NO billing row; the standard-workspace
    // fixture in `beforeEach` is a live TEAM plan that belongs to neither. A
    // version reading either one charges this Pro operator 500.
    mockRepo.getPersonalBilling.mockResolvedValue({
      containerId: PERSONAL_OF_OWNER,
      billing: { ...billing(), workspaceId: PERSONAL_OF_OWNER, plan: "pro" },
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

  // ⚠ **THE HOME-ONLY USER, AND THIS IS THE CASE THE OLD MODEL LET RUN FREE**
  // (2026-09-10, the new-user flow). A person who has never made a workspace
  // burns inside their OWN `kind='personal'` shelf — the container `POST /api/boot`
  // hands the SPA with no segment. Under the reroute that was
  // `container-owner-has-no-billing-workspace`: unmetered, allowed, logged, and a
  // whole population of exactly these accounts spending nothing. There is no
  // `wallet: null` on this path any more, and `resolveBillingTarget`'s only
  // remaining one is `container-has-no-active-owner`.
  it("🔒 3b. a HOME-ONLY user's burn in their own personal shelf IS metered", async () => {
    // ⚠ NO BILLING ROW AT ALL — a shelf nobody has paid on, i.e. the state a
    // brand-new account is in. The `beforeEach` fixture is a live TEAM row on a
    // DIFFERENT workspace, so leaving it in place would let a version that reads
    // "whatever row was lying around" answer 500 by accident.
    mockRepo.getWorkspaceBilling.mockResolvedValue(null);

    const res = await consumeMcpCredits(PERSONAL_WS, {
      userId: OWNER,
      workspaceKind: "personal",
    });

    expect(res.allowed).toBe(true);
    // 🔒 **CHARGED, AND `degraded` IS THE ASSERTION THAT MATTERS.** `unmetered()`
    // also answers `allowed: true` with zeroed counters, so a version that leaked
    // here would pass on `allowed` alone — the stamp is what separates "nothing
    // measured" from "nothing spent" (`CreditsSummary.degraded`).
    expect(res.degraded).toBeUndefined();
    expect(res).toMatchObject({ wallet: "personal", limit: 500 });
    expect(mockWallets.consumeUserCredits).toHaveBeenCalledWith(
      OWNER,
      expect.any(String),
      1,
      500,
      attrib(PERSONAL_WS, OWNER)
    );
    // ⚠ THE ADDRESSED CONTAINER IS ITSELF THE BILLING ROW HERE — the one shape
    // where it is (`credits-service.ts › consumeMcpCredits`'s `workspaceKind ===
    // "personal" ? target.workspaceId : null`), so the row is read STRAIGHT off
    // the addressed id and the payer→container lookup is skipped entirely.
    expect(mockRepo.getWorkspaceBilling).toHaveBeenCalledWith(PERSONAL_WS);
    expect(mockRepo.getPersonalBilling).not.toHaveBeenCalled();
    // ⚠ AND NOTHING SEAT-SHAPED OR OWNER-SHAPED HAPPENS: a shelf has one member
    // and its owner is the caller, so neither question is asked.
    expect(mockFindOwner).not.toHaveBeenCalled();
    expect(mockWallets.consumeMemberCredits).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("🔒 3c. …and the same user's PRO shelf meters at 5,000, off that same row", async () => {
    // 🔒 The pair is the claim: 3b alone passes against a version that hardcodes
    // the free allowance for every personal burn, which is the other way to make
    // "metered" meaningless.
    mockRepo.getWorkspaceBilling.mockResolvedValue({
      ...billing(),
      workspaceId: PERSONAL_WS,
      plan: "pro",
    });

    const res = await consumeMcpCredits(PERSONAL_WS, {
      userId: OWNER,
      workspaceKind: "personal",
    });

    expect(res).toMatchObject({ wallet: "personal", limit: 5_000 });
    expect(mockWallets.consumeUserCredits).toHaveBeenCalledWith(
      OWNER,
      expect.any(String),
      1,
      5_000,
      attrib(PERSONAL_WS, OWNER)
    );
  });

  it("4. no active owner → UNMETERED and allowed, nothing charged anywhere", async () => {
    mockFindOwner.mockResolvedValue(null);

    const res = await consumeMcpCredits(LINK_WS, guestCaller);

    expect(res.allowed).toBe(true);
    expect(res).toMatchObject({ used: 0, limit: 0, remaining: 0, wallet: null });
    // ⚠ STAMPED. The zeroes are not a reading, and `degraded` is the only thing
    // that says so — the same flag the route's `failOpen()` puts on its own
    // zeroes, so one reader recognises both.
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
 * 5. THE METER IS THE CALLER'S OWN WALLET.
 *
 * 🔒 A personal wallet spans its owner's WHOLE home space — every link container
 * they hold, plus their personal shelf. Showing it to a peer inside ONE of those
 * relationships would print the operator's total home spend to somebody who can
 * see one channel of it. The peer gets the same stamped zeroes the consume path
 * reports for a reading it did not take.
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
    // ⚠ THE METER'S OWN COPY OF THE 2c CLAIM. Enforcement and the meter resolve
    // the row through the same helper; if only one of them did, the settings
    // pane would show 500 for a wallet the agent is being charged 5,000
    // against.
    mockRepo.getPersonalBilling.mockResolvedValue({
      containerId: PERSONAL_OF_OWNER,
      billing: { ...billing(), workspaceId: PERSONAL_OF_OWNER, plan: "pro" },
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
    // ⚠ NO RENDERER CAN PICK A PLAN LIST FROM `plan` ALONE — `free` is a value
    // on both taxonomies (`plans.ts › plansForKind`).
    expect((await getWorkspaceBillingStatus(LINK_WS, ownerCaller)).containerKind).toBe(
      "link"
    );
    expect(
      (await getWorkspaceBillingStatus(OWNER_WS, { userId: GUEST })).containerKind
    ).toBe("standard");
    expect(
      (
        await getWorkspaceBillingStatus(PERSONAL_WS, {
          userId: OWNER,
          workspaceKind: "personal",
        })
      ).containerKind
    ).toBe("personal");
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
    // 🔒 The whole point: no reading of the operator's allowance reaches the peer.
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
