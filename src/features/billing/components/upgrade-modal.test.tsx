// @vitest-environment jsdom
/**
 * THE PAYWALL, AND WHICH PLAN IT SELLS. `UpgradeModal` is mounted from four
 * places (`ontology-view`, `invite-dialog`, `members-v2-view`,
 * `chats/list-pane`) and since 2026-09-08 it can be shown a `kind='personal'`
 * container as well as a standard workspace — so what it offers has to follow
 * the container, not the call site. A modal that sold Team on a personal
 * container would open a checkout that answers 400 `PLAN_NOT_FOR_CONTAINER`.
 *
 * ⚠ jsdom, and a real render: `ModalShell` is a PORTAL that mounts on a
 * `requestAnimationFrame`, so its first server paint is empty and only a DOM
 * render can see the contents at all.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mounting the real form pulls the Stripe script + a client-secret fetch.
vi.mock("./embedded-checkout", () => ({
  EmbeddedCheckoutForm: () => <div data-testid="embedded-checkout" />,
}));

const { UpgradeModal } = await import("./upgrade-modal");
const { PERSONAL_MONTHLY_CREDITS, SEAT_MONTHLY_CREDITS } = await import(
  "../credits"
);
const { planNumber } = await import("../plans");
const { formatMoney, PRO_PRICE, TEAM_SEAT_PRICE } = await import("../prices");
const { BILLING_STATUS_PATH } = await import("./use-workspace-entitlements");
type Status = import("./use-workspace-entitlements").WorkspaceEntitlementsStatus;

afterEach(cleanup);

const STANDARD_FREE: Status = {
  plan: "free",
  status: "free",
  containerKind: "standard",
  memberCount: 3,
  seatCount: null,
  objectCap: 100,
  objectsUsed: 4,
  canCreateObjects: true,
  chatsWindowDays: 90,
  credits: {
    wallet: "seat" as const,
    used: 0,
    limit: SEAT_MONTHLY_CREDITS.free,
    remaining: SEAT_MONTHLY_CREDITS.free,
    periodStart: "2026-09-01T00:00:00.000Z",
    periodEnd: "2026-10-01T12:00:00.000Z",
    ledgerDrift: 0,
  },
  cancelAtPeriodEnd: false,
  subscription_period_end: null,
  has_stripe_customer: false,
};

const PERSONAL_FREE: Status = {
  ...STANDARD_FREE,
  containerKind: "personal",
  memberCount: 1,
  objectCap: null,
  credits: {
    ...STANDARD_FREE.credits,
    wallet: "personal" as const,
    limit: PERSONAL_MONTHLY_CREDITS.free,
    remaining: PERSONAL_MONTHLY_CREDITS.free,
  },
};

async function open(
  status: Status,
  variant: "generic" | "add-member" = "generic"
): Promise<string> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData([BILLING_STATUS_PATH, "ws-1", undefined], status);
  render(
    <QueryClientProvider client={client}>
      <UpgradeModal
        open
        onOpenChange={() => {}}
        workspaceId="ws-1"
        variant={variant}
      />
    </QueryClientProvider>
  );
  // The portal mounts a frame later; the heading is the first thing in it.
  const dialog = await screen.findByRole("dialog");
  return dialog.innerHTML;
}

describe("on a personal container", () => {
  it("sells Pro, flat, and never Team", async () => {
    const html = await open(PERSONAL_FREE);
    expect(html).toContain("Upgrade to Pro");
    expect(html).toContain(formatMoney(PRO_PRICE));
    expect(html).toContain("/ month");
    // 🔒 The wrong plan here is a 400 at checkout, not a cosmetic slip.
    expect(html).not.toContain("Team");
    expect(html).not.toContain("/ seat / month");
    expect(html).not.toContain("Upgrade your workspace");
  });

  it("quotes the PERSONAL allowance, per month and never per member", async () => {
    const html = await open(PERSONAL_FREE);
    expect(html).toContain(
      `${planNumber(PERSONAL_MONTHLY_CREDITS.pro)} credits a month`
    );
    // ⚠ The seat figure happens to be the same number, so the assertion is on
    // the WORDING that distinguishes them.
    expect(html).not.toContain("credits per member");
  });

  it("promises no unlock the container already has", async () => {
    // The ontology cap is a MULTI-member free rule and a personal container has
    // one member — so "uncapped objects" would be selling nothing.
    const html = await open(PERSONAL_FREE);
    expect(html).not.toContain("Uncapped ontology objects");
    expect(html).toContain("Full chat history");
    expect(html).toContain("Priority support");
  });

  /**
   * 🔒 **THE add-member VARIANT IS STANDARD-ONLY.** Its whole pitch is seats,
   * "invite your team" and the legacy single-member limit; a personal container
   * has no roster to add anyone to, so the caller falls back to the generic
   * upsell rather than describing something the reader cannot do.
   */
  it("falls back to the generic upsell when asked for the add-member variant", async () => {
    const html = await open(PERSONAL_FREE, "add-member");
    expect(html).toContain("Upgrade to Pro");
    expect(html).not.toContain("Upgrade to add members");
    expect(html).not.toContain("limited to one member");
  });
});

describe("on a standard workspace", () => {
  it("still sells Team, per seat, and never Pro", async () => {
    const html = await open(STANDARD_FREE);
    expect(html).toContain("Upgrade your workspace");
    expect(html).toContain("Team");
    expect(html).toContain(formatMoney(TEAM_SEAT_PRICE));
    expect(html).toContain("/ seat / month");
    expect(html).not.toContain("Upgrade to Pro");
  });

  it("keeps the per-member wording on its credits line", async () => {
    const html = await open(STANDARD_FREE);
    expect(html).toContain(
      `${planNumber(SEAT_MONTHLY_CREDITS.team)} credits per member every month`
    );
  });

  it("still has an add-member variant, because it still has a roster", async () => {
    const html = await open(STANDARD_FREE, "add-member");
    expect(html).toContain("Upgrade to add members");
  });
});
