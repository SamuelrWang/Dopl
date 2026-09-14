/**
 * 🔒 **F-668 — THE PAID FIGURE THE MCP REFUSAL QUOTES IS READ FROM
 * `../credits.ts`, ON THIS SIDE OF THE WIRE (2026-09-14, CLOSED).**
 *
 * ⚠ **THE FINDING WAS THAT NO TEST COULD SEE THE DRIFT.**
 * `packages/mcp-server/src/tools/respond.ts › creditsExhausted` writes
 * *"Upgrade to Team for 5,000 credits per member"* and *"Upgrade to Pro for
 * 5,000 credits a month"*. That package is a separate build kept external by
 * `next.config.ts › serverExternalPackages` and **cannot import `src/`**, so
 * both figures were literals: retuning `SEAT_MONTHLY_CREDITS.team` or
 * `PERSONAL_MONTHLY_CREDITS.pro` left the refusal advertising the old number to
 * the exact caller who had just hit the limit, and the package's own pin
 * asserted the literal AGAINST ITSELF while the app-side pin read the constant
 * — both green while they disagreed.
 *
 * **The chain is two halves and this file is the first**: the figure rides the
 * consume response (`credits-service.ts › upgradeCreditsFor`, read off the
 * constants), and `packages/mcp-server/src/tools/respond.test.ts` pins that the
 * SENTENCE renders whatever it is handed. Neither half alone closes the finding.
 *
 * ⚠ **EVERY EXPECTATION HERE NAMES THE CONSTANT, NEVER `5_000`.** A literal in
 * this file would be the third copy of the number the finding is about — and it
 * is what the MUTATION check moves: retune either constant and the figure on
 * the wire moves with it, in the same run.
 *
 * ⚠ **`upgradeCredits` TRACKS `upgradeUrl` ON EVERY ARM.** A figure beside no
 * link is a promise with nowhere to buy it; a link with no figure drops the
 * fact that makes it persuasive. Both are decided by the same `(wallet, plan)`
 * pair, so every case below asserts the pair and not one half of it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WorkspaceBillingRow } from "./workspace-billing";

vi.mock("./workspace-billing", () => ({
  getWorkspaceBilling: vi.fn(),
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
import { consumeMcpCredits } from "./credits-service";
import { teamBillingRow } from "./credits-target-fixtures";
import {
  PERSONAL_MONTHLY_CREDITS,
  SEAT_MONTHLY_CREDITS,
} from "../credits";

const mockRepo = vi.mocked(repo);
const mockWallets = vi.mocked(wallets);
const mockFindOwner = vi.mocked(findActiveOwnerUserId);

const USER = "user-1";
const STANDARD_WS = "ws-standard";
const PERSONAL_WS = "ws-personal";

/** Out of credits — the only state that renders a refusal at all. */
const EXHAUSTED = { allowed: false, used: 999_999 };

beforeEach(() => {
  vi.clearAllMocks();
  mockFindOwner.mockResolvedValue(USER);
  mockRepo.getWorkspaceBilling.mockResolvedValue(null);
  mockRepo.getPersonalBilling.mockResolvedValue(null);
  mockRepo.countActiveMembers.mockResolvedValue(1);
  mockWallets.consumeMemberCredits.mockResolvedValue(EXHAUSTED);
  mockWallets.consumeUserCredits.mockResolvedValue(EXHAUSTED);
});

afterEach(() => vi.clearAllMocks());

describe("the SEAT offer", () => {
  it("🔒 a FREE seat is offered the TEAM per-member allowance, off the constant", async () => {
    const res = await consumeMcpCredits(STANDARD_WS, {
      userId: USER,
      workspaceKind: "standard",
    });

    expect(res.allowed).toBe(false);
    expect(res.upgradeUrl).not.toBe("");
    // ⚠ **MUTATE `SEAT_MONTHLY_CREDITS.team` AND THIS MOVES**, which is the
    // whole of F-668: the refusal's figure is no longer a second copy.
    expect(res.upgradeCredits).toBe(SEAT_MONTHLY_CREDITS.team);
    // ⚠ NOT `limit`. That is the 100 they just exhausted; an upgrade buys the
    // other number, and rendering the first as the second was the cheap option
    // the finding explicitly rejected.
    expect(res.limit).toBe(SEAT_MONTHLY_CREDITS.free);
  });

  it("🔒 a PAID seat is offered nothing, and nothing is sized", async () => {
    mockRepo.getWorkspaceBilling.mockResolvedValue(
      teamBillingRow({ workspaceId: STANDARD_WS }) as WorkspaceBillingRow
    );

    const res = await consumeMcpCredits(STANDARD_WS, {
      userId: USER,
      workspaceKind: "standard",
    });

    // Team is the best allowance a seat has; an upsell to nowhere with a number
    // attached is worse than no upsell.
    expect(res.upgradeUrl).toBe("");
    expect(res.upgradeCredits).toBe(0);
  });
});

describe("the PERSONAL offer", () => {
  it("🔒 a FREE home space is offered the PRO allowance, off the constant", async () => {
    const res = await consumeMcpCredits(PERSONAL_WS, {
      userId: USER,
      workspaceKind: "personal",
    });

    expect(res.wallet).toBe("personal");
    // ⚠ `?plan=pro` — a bare `/billing` link resolves a STANDARD workspace and
    // would land a home-space upsell on a workspace the caller may not have.
    expect(res.upgradeUrl).toContain("plan=pro");
    expect(res.upgradeCredits).toBe(PERSONAL_MONTHLY_CREDITS.pro);
  });

  /**
   * ⚠ **THE TWO PAID FIGURES ARE EQUAL TODAY AND ARE NOT ONE NUMBER** (Samuel,
   * 2026-09-08: "pro individual is 5,000, and team individual is also 5,000").
   * This case exists so the day they diverge is a red test rather than a
   * refusal quoting the wrong wallet's allowance.
   */
  it("🔒 reads the PERSONAL constant on the personal arm, never the seat one", async () => {
    const res = await consumeMcpCredits(PERSONAL_WS, {
      userId: USER,
      workspaceKind: "personal",
    });
    expect(res.upgradeCredits).toBe(PERSONAL_MONTHLY_CREDITS.pro);
    expect(res.upgradeCredits).not.toBe(SEAT_MONTHLY_CREDITS.free);
  });

  it("🔒 a PRO home space is offered nothing, and nothing is sized", async () => {
    // ⚠ THE CONTAINER *IS* THE BILLING ROW on this arm (`personal-wallet.ts ›
    // readPersonalBilling`), so the Pro row comes back off `getWorkspaceBilling`
    // and never through the owner → container hop.
    mockRepo.getWorkspaceBilling.mockResolvedValue({
      ...teamBillingRow({ workspaceId: PERSONAL_WS }),
      plan: "pro",
    } as WorkspaceBillingRow);

    const res = await consumeMcpCredits(PERSONAL_WS, {
      userId: USER,
      workspaceKind: "personal",
    });

    expect(res.upgradeUrl).toBe("");
    expect(res.upgradeCredits).toBe(0);
  });
});
