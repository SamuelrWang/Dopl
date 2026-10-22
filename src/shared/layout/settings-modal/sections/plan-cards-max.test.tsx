// @vitest-environment jsdom
/**
 * The home space's THREE cards (Free / Pro / Max, 2026-10-22) and what each
 * card's button does in every state of the caller's personal plan.
 *
 * The properties with teeth:
 *   • a FREE home space buys either tier through CHECKOUT (`onUpgrade`);
 *   • a PAID one switches tier IN PLACE (`POST /api/billing/change-plan`),
 *     never a second checkout — "Upgrade" for the bigger tier, "at renewal"
 *     for the smaller one;
 *   • a queued downgrade shows its date and a "Keep …" button, and nothing
 *     offers a switch the route would refuse (ending plan, past due);
 *   • "N% off" replaces "Popular" on Pro and Max while the launch offer is live.
 *
 * Billing status and the queued change are SEEDED into the query cache rather
 * than mocked, so the hooks' own fallbacks stay in the path.
 */

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PERSONAL_MONTHLY_CREDITS } from "@/features/billing/credits";
import { MAX_PLAN_NAME } from "@/features/billing/plans";
import { launchOfferFor } from "@/features/billing/prices";
import {
  BILLING_STATUS_PATH,
  type WorkspaceEntitlementsStatus,
} from "@/features/billing/components/use-workspace-entitlements";
import {
  BILLING_CHANGE_PLAN_PATH,
  type PlanChangeStateDto,
} from "@/features/billing/components/use-personal-plan-change";
import { PlansBillingCore } from "./plans-billing-core";

const HOME_FREE: WorkspaceEntitlementsStatus = {
  plan: "free",
  status: "free",
  containerKind: "home",
  memberCount: 1,
  seatCount: null,
  objectCap: null,
  objectsUsed: 0,
  canCreateObjects: true,
  chatsWindowDays: 90,
  credits: {
    wallet: "personal",
    used: 0,
    limit: PERSONAL_MONTHLY_CREDITS.free,
    remaining: PERSONAL_MONTHLY_CREDITS.free,
    periodStart: "2026-10-01T00:00:00.000Z",
    periodEnd: "2026-11-01T00:00:00.000Z",
    ledgerDrift: 0,
    unmeteredSince: null,
  },
  cancelAtPeriodEnd: false,
  subscription_period_end: null,
  has_stripe_customer: false,
};

const paid = (
  plan: "pro" | "max",
  over: Partial<WorkspaceEntitlementsStatus> = {}
): WorkspaceEntitlementsStatus => ({
  ...HOME_FREE,
  plan,
  status: "active",
  chatsWindowDays: null,
  has_stripe_customer: true,
  subscription_period_end: "2026-11-08T00:00:00.000Z",
  ...over,
});

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  );
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(status: WorkspaceEntitlementsStatus, change?: PlanChangeStateDto) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  qc.setQueryData([BILLING_STATUS_PATH, "ws-1", undefined], status);
  qc.setQueryData(
    [BILLING_CHANGE_PLAN_PATH, "ws-1", undefined],
    change ?? { plan: null, scheduledPlan: null, effectiveAt: null }
  );
  const onUpgrade = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <PlansBillingCore role="owner" workspaceId="ws-1" onUpgrade={onUpgrade} onManage={() => {}} />
    </QueryClientProvider>
  );
  return onUpgrade;
}

function changePlanPosts() {
  return fetchSpy.mock.calls.filter(
    ([url, init]) =>
      String(url).includes(BILLING_CHANGE_PLAN_PATH) && (init as RequestInit)?.method === "POST"
  );
}

describe("a FREE home space", () => {
  it("shows Free, Pro and Max, and buys either tier through checkout", () => {
    const onUpgrade = mount(HOME_FREE);
    expect(screen.getByText(MAX_PLAN_NAME)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: `Upgrade to ${MAX_PLAN_NAME} — $24.99/month` }));
    expect(onUpgrade).toHaveBeenCalledWith("max");
    expect(changePlanPosts()).toHaveLength(0);
  });

  it("badges Pro and Max with the launch offer instead of Popular, while it is live", () => {
    mount(HOME_FREE);
    const offer = launchOfferFor("max");
    if (offer) {
      expect(screen.getAllByText(`${offer.percentOff}% off`)).toHaveLength(2);
      expect(screen.queryByText("Popular")).toBeNull();
      expect(screen.getByText("$49.98")).toBeTruthy();
      expect(screen.getByText("$17.98")).toBeTruthy();
    } else {
      expect(screen.getAllByText("Popular")).toHaveLength(2);
    }
  });
});

describe("a PRO home space", () => {
  it("upgrades to Max IN PLACE — a change-plan POST, never a checkout", async () => {
    const onUpgrade = mount(paid("pro"));
    fireEvent.click(screen.getByRole("button", { name: `Upgrade to ${MAX_PLAN_NAME} — $24.99/month` }));
    await waitFor(() => expect(changePlanPosts()).toHaveLength(1));
    expect(JSON.parse(String((changePlanPosts()[0][1] as RequestInit).body))).toEqual({
      plan: "max",
    });
    expect(onUpgrade).not.toHaveBeenCalled();
  });

  it("marks Pro current and labels the summary with the plan", () => {
    mount(paid("pro"));
    expect(screen.getByText("Current plan")).toBeTruthy();
    expect(screen.getByText("Pro plan")).toBeTruthy();
  });

  it("offers no switch on a plan that is set to end — resume first", () => {
    mount(paid("pro", { cancelAtPeriodEnd: true }));
    expect(screen.getByText("Resume your plan to switch")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Upgrade to Max/ })).toBeNull();
  });

  it("offers no switch while past due — fix the card first", () => {
    mount(paid("pro", { status: "past_due" }));
    expect(screen.getByText("Update your payment to switch")).toBeTruthy();
  });
});

describe("a MAX home space", () => {
  it("offers Pro AT RENEWAL, not now", async () => {
    mount(paid("max"));
    expect(screen.getByText(`${MAX_PLAN_NAME} plan`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Switch to Pro at renewal" }));
    await waitFor(() => expect(changePlanPosts()).toHaveLength(1));
    expect(JSON.parse(String((changePlanPosts()[0][1] as RequestInit).body))).toEqual({
      plan: "pro",
    });
  });

  it("shows a queued downgrade's date, and Keep Max re-chooses Max to cancel it", async () => {
    mount(paid("max"), {
      plan: "max",
      scheduledPlan: "pro",
      effectiveAt: "2026-11-08T00:00:00.000Z",
    });
    expect(screen.getByText(/Switches to Pro on/)).toBeTruthy();
    expect(screen.getByText(/^Starts /)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Switch to Pro at renewal" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: `Keep ${MAX_PLAN_NAME}` }));
    await waitFor(() => expect(changePlanPosts()).toHaveLength(1));
    expect(JSON.parse(String((changePlanPosts()[0][1] as RequestInit).body))).toEqual({
      plan: "max",
    });
  });
});
