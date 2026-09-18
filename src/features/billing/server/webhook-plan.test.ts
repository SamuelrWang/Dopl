/**
 * Which PLAN a Stripe subscription is, and whether it belongs on the container
 * it is about to be written to.
 *
 * The property with teeth (2026-09-08, spec §11): `$8.99` is now TWO prices —
 * a per-seat Team price and a flat personal Pro price — and the old two-arm
 * derivation would have called both of them `team`, silently giving a personal
 * subscriber a workspace plan (and a seat count) they never bought.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Stripe from "stripe";

vi.mock("@/features/workspaces/server/repository", () => ({
  findWorkspaceById: vi.fn(),
}));

import { findWorkspaceById } from "@/features/workspaces/server/repository";
import { derivePlan, reportPlanContainerMismatch } from "./webhook-plan";

const findWorkspace = vi.mocked(findWorkspaceById);

function sub(
  priceIds: string[],
  metadata: Record<string, string> = {}
): Stripe.Subscription {
  return {
    id: "sub_1",
    metadata,
    items: { data: priceIds.map((id, i) => ({ id: `si_${i}`, price: { id } })) },
  } as unknown as Stripe.Subscription;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_PRO_SEAT_PRICE_ID", "price_seat");
  vi.stubEnv("STRIPE_LEGACY_SEAT_PRICE_ID", "price_legacy_seat");
  vi.stubEnv("STRIPE_PERSONAL_PRO_PRICE_ID", "price_personal_pro");
  vi.stubEnv("STRIPE_SOLO_PRICE_ID", "price_solo");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("derivePlan — the price is authoritative", () => {
  it.each([
    ["the current per-seat price", "price_seat", "team"],
    ["the LEGACY $7.99 seat price", "price_legacy_seat", "team"],
    ["the personal Pro price", "price_personal_pro", "pro"],
    ["the flat legacy Solo price", "price_solo", "solo"],
  ] as const)("maps %s to %s", (_label, priceId, plan) => {
    expect(derivePlan(sub([priceId]))).toBe(plan);
  });

  it("calls a LEGACY seat subscription `team`, not whatever the metadata says", () => {
    // The price moved on 2026-09-08; the plan did not. One live sub is on it and
    // it is a Team workspace.
    expect(derivePlan(sub(["price_legacy_seat"], { plan: "pro" }))).toBe("team");
  });

  it("never calls a personal Pro subscription `team` — the $8.99 collision", () => {
    // Both prices are $8.99 and both are live. Reading Pro as Team would hand
    // a personal container a per-seat plan and a workspace's entitlements.
    expect(derivePlan(sub(["price_personal_pro"]))).toBe("pro");
  });

  it("prefers the seat price when a subscription somehow carries both", () => {
    expect(derivePlan(sub(["price_personal_pro", "price_seat"]))).toBe("team");
  });

  it("falls back to metadata when the price is unknown to this environment", () => {
    expect(derivePlan(sub(["price_unknown"], { plan: "pro" }))).toBe("pro");
    expect(derivePlan(sub(["price_unknown"], { plan: "solo" }))).toBe("solo");
    expect(derivePlan(sub(["price_unknown"], { plan: "team" }))).toBe("team");
  });

  it("ignores metadata that names no plan we sell", () => {
    expect(derivePlan(sub(["price_unknown"], { plan: "enterprise" }))).toBe("team");
  });

  it("defaults to `team`, NOT `pro`, on an unstamped unknown price", () => {
    // Deliberate: every subscription that can reach this arm predates `pro`.
    expect(derivePlan(sub(["price_20_legacy"]))).toBe("team");
    expect(derivePlan(sub([]))).toBe("team");
  });

  it("reads the price envs LIVE — an unset env recognizes nothing", () => {
    vi.stubEnv("STRIPE_PERSONAL_PRO_PRICE_ID", "");
    expect(derivePlan(sub(["price_personal_pro"]))).toBe("team");
  });
});

describe("🔒 reportPlanContainerMismatch — reports, never refuses", () => {
  function workspace(kind?: string) {
    return { id: "ws-1", name: "W", slug: "w", publicId: "p", kind } as never;
  }

  it("says nothing when Team lands on a standard workspace", async () => {
    findWorkspace.mockResolvedValue(workspace("standard"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await reportPlanContainerMismatch("ws-1", "team");
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("says nothing when Pro lands on a personal container", async () => {
    findWorkspace.mockResolvedValue(workspace("personal"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await reportPlanContainerMismatch("ws-1", "pro");
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("ERRORS when Pro lands on a standard workspace", async () => {
    findWorkspace.mockResolvedValue(workspace("standard"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await reportPlanContainerMismatch("ws-1", "pro");
    expect(err).toHaveBeenCalledWith(expect.stringContaining("ws-1"));
    expect(err.mock.calls[0][0]).toContain("'pro'");
    err.mockRestore();
  });

  it("ERRORS when Team lands on a personal container", async () => {
    findWorkspace.mockResolvedValue(workspace("personal"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await reportPlanContainerMismatch("ws-1", "team");
    expect(err).toHaveBeenCalledWith(expect.stringContaining("personal"));
    err.mockRestore();
  });

  it("ERRORS when Team lands on a LINK container — the positive predicate", async () => {
    // Not `kind !== "personal"`: a home-channel container carries no plan either,
    // and a fourth kind must not become sellable by being named.
    findWorkspace.mockResolvedValue(workspace("link"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await reportPlanContainerMismatch("ws-1", "team");
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("treats an ABSENT kind as standard — a narrowed row is not a mismatch", async () => {
    findWorkspace.mockResolvedValue(workspace(undefined));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await reportPlanContainerMismatch("ws-1", "team");
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("checks nothing for `solo` or `free` — neither constrains a kind", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await reportPlanContainerMismatch("ws-1", "solo");
    await reportPlanContainerMismatch("ws-1", "free");
    expect(findWorkspace).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("stays quiet on a workspace the read cannot find", async () => {
    // Already mapped by the resolver, so a miss is a deleted workspace — the
    // deletion handlers own that, and a second alarm here helps nobody.
    findWorkspace.mockResolvedValue(null);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await reportPlanContainerMismatch("ws-1", "pro");
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });
});
