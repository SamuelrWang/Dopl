/**
 * F-668 (2026-09-14, closed): the paid figure the MCP refusal quotes is read from
 * `../credits.ts` on this side of the wire.
 * `packages/mcp-server/src/tools/respond.ts › creditsExhausted` is a separate build
 * kept external by `next.config.ts › serverExternalPackages` and cannot import
 * `src/`, so both figures used to be literals and no test could see them drift.
 *
 * Two halves: the figure rides the consume response
 * (`credits-service.ts › upgradeCreditsFor`), and
 * `packages/mcp-server/src/tools/respond.test.ts` pins that the sentence renders
 * whatever it is handed.
 *
 * Every expectation here names the constant, never `5_000` — a literal would be a
 * third copy of the number the finding is about. `upgradeCredits` tracks
 * `upgradeUrl` on every arm (same `(wallet, plan)` pair), so each case asserts the
 * pair rather than one half of it.
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
    // Mutate `SEAT_MONTHLY_CREDITS.team` and this moves — the refusal's figure is
    // no longer a second copy.
    expect(res.upgradeCredits).toBe(SEAT_MONTHLY_CREDITS.team);
    // Not `limit` — that is the 100 they just exhausted; an upgrade buys the
    // other number.
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

    // Team is the best allowance a seat has, and an upsell to nowhere is worse
    // than no upsell.
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
    // `?plan=pro` — a bare `/billing` link resolves a standard workspace and would
    // land a home-space upsell on a workspace the caller may not have.
    expect(res.upgradeUrl).toContain("plan=pro");
    expect(res.upgradeCredits).toBe(PERSONAL_MONTHLY_CREDITS.pro);
  });

  /**
   * The two paid figures are equal today and are not one number (2026-09-08), so
   * this case makes the day they diverge a red test rather than a refusal quoting
   * the wrong wallet's allowance.
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
    // The container is the billing row on this arm (`personal-wallet.ts ›
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
