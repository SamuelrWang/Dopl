/**
 * `/billing/{segment}` — the gate, the resolution, and what the URL is allowed
 * to make the page do.
 *
 * This is the page money flows through after the website retires, and it is
 * reached by people who are frequently NOT signed in (a first-time payer's
 * browser has never seen Dopl) and by URLs minted days earlier by Stripe. So
 * the three things pinned here are the three that silently cost a payment:
 *   1. a signed-out visit bounces to /login and comes back WITH ITS QUERY;
 *   2. a workspace the caller cannot reach 404s like one that does not exist;
 *   3. `?billing=success` reaches the pane as the poll signal, and
 *      `?billing=upgrade&plan=…` opens that plan's checkout — nothing else does.
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
// Stubbed so the page's own decisions are observable as props, without pulling
// Stripe and the browser-only panes into a node test.
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

/** The thrown control-flow marker (`redirect()` / `notFound()`). */
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
    // A brand-new payer follows `?billing=upgrade&plan=solo` out of the desktop
    // app in a browser that has never signed in. If the query does not ride
    // along in `redirectTo`, they land on a plan list after signing in and the
    // checkout they already chose never opens.
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
    // Membership-scoped resolution: a workspace the caller is not a member of
    // and a workspace that does not exist must be indistinguishable, or the
    // page is a workspace-existence oracle.
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
    // Gating (who may buy / manage) is the pane's, from a server-resolved role
    // — so a viewer never sees a purchase button flash before a fetch lands.
    expect(props.role).toBe("viewer");
  });
});

describe("what the URL is allowed to do", () => {
  it("arms the post-checkout poll on ?billing=success", async () => {
    // `plans-billing-core` only runs its 20×1s status poll when it is handed a
    // non-null `billingReturn`. Drop this and somebody who just paid stares at
    // a Starter plan until they reload.
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
    // Only an explicit "sell me this" opens a payment form. A stray param on a
    // success return must not drop the payer back into checkout.
    expect((await render({ plan: "solo" })).initialCheckoutPlan).toBeNull();
    expect(
      (await render({ billing: "success", plan: "solo" })).initialCheckoutPlan
    ).toBeNull();
  });

  it("opens on Usage for a bare visit and on Billing mid-transaction", async () => {
    // The tab is resolved HERE, on the server, so a shared `?tab=` link and a
    // Stripe return both decide the FIRST paint rather than a flash of the
    // wrong pane. `?billing=` in any of its three values means the visitor was
    // sent here by a payment flow.
    expect((await render({})).initialTab).toBe("usage");
    expect((await render({ billing: "upgrade" })).initialTab).toBe("billing");
    expect((await render({ billing: "success" })).initialTab).toBe("billing");
    expect((await render({ billing: "return" })).initialTab).toBe("billing");
  });

  it("lets an explicit ?tab= override the intent, and ignores junk", async () => {
    expect((await render({ tab: "billing" })).initialTab).toBe("billing");
    expect(
      (await render({ tab: "usage", billing: "success" })).initialTab
    ).toBe("usage");
    expect((await render({ tab: "invoices" })).initialTab).toBe("usage");
  });
});
