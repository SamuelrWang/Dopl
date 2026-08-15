/**
 * `/billing/{segment}` — the three properties that silently cost a payment:
 *   1. a signed-out visit bounces to /login and comes back WITH ITS QUERY;
 *   2. an unreachable workspace 404s like a nonexistent one;
 *   3. `?billing=success` reaches the pane as the poll signal and `?billing=upgrade&plan=…`
 *      opens that plan's checkout — nothing else does.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import type { BillingPageScreenProps } from "@/features/billing/components/billing-page-screen";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  resolveWorkspaceSegmentForUser: vi.fn(),
  resolveMembershipOrThrow: vi.fn(),
}));

vi.mock("@/shared/supabase/server", () => ({ getUser: mocks.getUser }));
vi.mock("@/features/workspaces/server/segment", () => ({
  resolveWorkspaceSegmentForUser: mocks.resolveWorkspaceSegmentForUser,
}));
vi.mock("@/features/workspaces/server/service", () => ({
  resolveMembershipOrThrow: mocks.resolveMembershipOrThrow,
}));
// Stubbed so the page's decisions are observable as props, without Stripe or browser-only panes.
vi.mock("@/features/billing/components/billing-page-screen", () => ({
  BillingPageScreen: () => null,
}));

import BillingPage from "./page";

const SEGMENT = "acme-ab12cd34ef56";
const WORKSPACE = {
  id: "ws-1",
  name: "Acme",
  slug: "acme",
  publicId: "ab12cd34ef56",
};

function signedIn() {
  mocks.getUser.mockResolvedValue({ id: "user-1" });
  mocks.resolveWorkspaceSegmentForUser.mockResolvedValue({
    workspace: WORKSPACE,
    canonical: SEGMENT,
    needsRedirect: false,
  });
  mocks.resolveMembershipOrThrow.mockResolvedValue({
    workspace: WORKSPACE,
    membership: { role: "owner" },
  });
}

async function render(
  query: Record<string, string | string[] | undefined> = {},
  segment: string = SEGMENT
): Promise<BillingPageScreenProps> {
  const element = (await BillingPage({
    params: Promise.resolve({ segment }),
    searchParams: Promise.resolve(query),
  })) as ReactElement<BillingPageScreenProps>;
  return element.props;
}

/** Thrown control-flow marker (`redirect()` / `notFound()`). */
async function outcome(
  query: Record<string, string | string[] | undefined> = {},
  segment: string = SEGMENT
): Promise<string> {
  try {
    await render(query, segment);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return "RENDERED";
}

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
});

describe("the auth gate", () => {
  it("bounces a signed-out visitor to /login and back here", async () => {
    mocks.getUser.mockResolvedValue(null);
    expect(await outcome()).toBe(
      `REDIRECT:/login?redirectTo=${encodeURIComponent(`/billing/${SEGMENT}`)}`
    );
  });

  it("carries the QUERY through the bounce — the first-time-payer case", async () => {
    // Without the query in `redirectTo`, a new payer lands on the plan list and the checkout
    // they already chose never opens.
    mocks.getUser.mockResolvedValue(null);
    expect(await outcome({ billing: "upgrade", plan: "solo" })).toBe(
      `REDIRECT:/login?redirectTo=${encodeURIComponent(
        `/billing/${SEGMENT}?billing=upgrade&plan=solo`
      )}`
    );
  });

  it("bounces before it ever looks the workspace up", async () => {
    mocks.getUser.mockResolvedValue(null);
    await outcome();
    expect(mocks.resolveWorkspaceSegmentForUser).not.toHaveBeenCalled();
  });
});

describe("segment resolution", () => {
  it("404s an unreachable segment — the same answer as a nonexistent one", async () => {
    // Non-member and nonexistent must be indistinguishable, or the page is an existence oracle.
    mocks.resolveWorkspaceSegmentForUser.mockResolvedValue(null);
    expect(await outcome({}, "someone-elses-ws-000000000000")).toBe("NOT_FOUND");
  });

  it("301s a legacy/stale segment to the canonical one, query intact", async () => {
    mocks.resolveWorkspaceSegmentForUser.mockResolvedValue({
      workspace: WORKSPACE,
      canonical: SEGMENT,
      needsRedirect: true,
    });
    expect(await outcome({ billing: "success", session_id: "cs_1" }, "acme")).toBe(
      `REDIRECT:/billing/${SEGMENT}?billing=success&session_id=cs_1`
    );
  });

  it("hands the resolved workspace and the caller's role to the pane", async () => {
    mocks.resolveMembershipOrThrow.mockResolvedValue({
      workspace: WORKSPACE,
      membership: { role: "viewer" },
    });
    const props = await render();
    expect(props.workspaceId).toBe("ws-1");
    expect(props.workspaceName).toBe("Acme");
    // Role is server-resolved so a viewer never sees a purchase button flash before a fetch.
    expect(props.role).toBe("viewer");
  });
});

describe("what the URL is allowed to do", () => {
  it("arms the post-checkout poll on ?billing=success", async () => {
    // ⚠ `plans-billing-core` runs its 20×1s status poll only on a non-null `billingReturn`.
    expect((await render({ billing: "success", session_id: "cs_1" })).billingReturn).toBe(
      "success"
    );
  });

  it("polls quietly on the portal return", async () => {
    expect((await render({ billing: "return" })).billingReturn).toBe("return");
  });

  it("does not arm the poll for an upgrade arrival — nothing has been bought", async () => {
    expect((await render({ billing: "upgrade" })).billingReturn).toBeNull();
    expect((await render({})).billingReturn).toBeNull();
  });

  it("opens checkout on the plan the caller already chose", async () => {
    expect(
      (await render({ billing: "upgrade", plan: "solo" })).initialCheckoutPlan
    ).toBe("solo");
    expect(
      (await render({ billing: "upgrade", plan: "team" })).initialCheckoutPlan
    ).toBe("team");
  });

  it("shows the plan list when the arrival names no plan (the 402 envelopes)", async () => {
    expect((await render({ billing: "upgrade" })).initialCheckoutPlan).toBeNull();
  });

  it("refuses to auto-open checkout on a junk or unpurchasable plan", async () => {
    for (const plan of ["free", "enterprise", "../evil"]) {
      expect(
        (await render({ billing: "upgrade", plan })).initialCheckoutPlan
      ).toBeNull();
    }
  });

  it("ignores a bare ?plan= with no upgrade intent", async () => {
    // A stray param on a success return must not drop the payer back into checkout.
    expect((await render({ plan: "solo" })).initialCheckoutPlan).toBeNull();
    expect(
      (await render({ billing: "success", plan: "solo" })).initialCheckoutPlan
    ).toBeNull();
  });

  it("opens on Usage for a bare visit and on Billing mid-transaction", async () => {
    // Resolved server-side so `?tab=` and a Stripe return decide the FIRST paint, not a flash.
    expect((await render({})).initialTab).toBe("usage");
    expect((await render({ billing: "upgrade" })).initialTab).toBe("billing");
    expect((await render({ billing: "success" })).initialTab).toBe("billing");
    expect((await render({ billing: "return" })).initialTab).toBe("billing");
  });

  it("lets ?tab= decide when there is no intent, and ignores junk", async () => {
    expect((await render({ tab: "billing" })).initialTab).toBe("billing");
    expect((await render({ tab: "invoices" })).initialTab).toBe("usage");
  });

  it("keeps a payment intent on Billing even when ?tab= says otherwise", async () => {
    // ⚠ `?billing=success&tab=usage` is what a checkout return BECOMES once the shell writes
    // `?tab=`. Resolving it to Usage strands the payer — the poll lives in the Billing pane.
    expect(
      (await render({ tab: "usage", billing: "success" })).initialTab
    ).toBe("billing");
    expect((await render({ tab: "usage", billing: "return" })).initialTab).toBe(
      "billing"
    );
  });
});
