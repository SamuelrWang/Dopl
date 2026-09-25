// @vitest-environment jsdom
/**
 * Account → Subscription. Drives the real hooks + transport against a fake,
 * STATEFUL wire (`fetch` stub): the status read answers from `rows`, and the
 * cancel POST flips `cancelAtPeriodEnd` on the row its `x-workspace-id` names
 * (none = the home space), exactly as the route does.
 *
 * Pins: hidden for free users; personal Pro shown with no workspace header;
 * Team shown only to admins of a STANDARD workspace; confirm before POST;
 * after cancel the row reads "Cancels <date>" + Resume with no reload.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AccountSubscription } from "./account-subscription";

/** Same stub contract as `billing-account-panes.test.tsx`: the real dialog
 *  portals via rAF; this keeps `await onConfirm()`, close on resolve. */
vi.mock("@/shared/ui/confirm-dialog", () => ({
  ConfirmDialog: ({
    open,
    onOpenChange,
    title,
    description,
    confirmLabel,
    cancelLabel,
    onConfirm,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void | Promise<void>;
  }) =>
    open ? (
      <div data-testid="confirm-dialog">
        <p>{title}</p>
        <p>{description}</p>
        <button type="button" onClick={() => onOpenChange(false)}>
          {`Dismiss: ${cancelLabel}`}
        </button>
        <button
          type="button"
          onClick={async () => {
            try {
              await onConfirm();
              onOpenChange(false);
            } catch {
              /* stays open */
            }
          }}
        >
          {`Confirm: ${confirmLabel}`}
        </button>
      </div>
    ) : null,
}));

const PERIOD_END = "2026-10-04T12:00:00.000Z";
const PERSONAL = "__personal__";

interface Row {
  plan: "free" | "pro" | "team" | "solo";
  status: "free" | "active" | "past_due" | "canceled";
  containerKind: "home" | "standard";
  cancelAtPeriodEnd: boolean;
}

let rows: Record<string, Row>;
const posts: Array<{ workspace: string; body: unknown }> = [];

function statusBody(row: Row) {
  return {
    plan: row.plan,
    status: row.status,
    containerKind: row.containerKind,
    memberCount: 1,
    seatCount: row.plan === "free" ? null : 1,
    objectCap: null,
    objectsUsed: 0,
    canCreateObjects: true,
    chatsWindowDays: null,
    credits: {
      wallet: "personal",
      used: 0,
      limit: 5000,
      remaining: 5000,
      periodStart: "",
      periodEnd: "",
      ledgerDrift: 0,
      unmeteredSince: null,
    },
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    subscription_period_end: row.plan === "free" ? null : PERIOD_END,
    has_stripe_customer: row.plan !== "free",
  };
}

beforeEach(() => {
  posts.length = 0;
  rows = {
    [PERSONAL]: {
      plan: "free",
      status: "free",
      containerKind: "home",
      cancelAtPeriodEnd: false,
    },
  };
  vi.stubGlobal(
    "fetch",
    async (
      url: unknown,
      init?: { method?: string; headers?: Record<string, string>; body?: string }
    ) => {
      const path = String(url);
      const workspace = init?.headers?.["x-workspace-id"] ?? PERSONAL;
      const row = rows[workspace];
      const respond = (status: number, body: unknown) =>
        ({ status, statusText: "", json: async () => body }) as unknown as Response;

      if (path.startsWith("/api/billing/status")) {
        return respond(200, statusBody(row));
      }
      if (path.startsWith("/api/billing/cancel")) {
        const body = init?.body ? JSON.parse(init.body) : {};
        posts.push({ workspace, body });
        row.cancelAtPeriodEnd = body.resume !== true;
        return respond(200, {
          cancelAtPeriodEnd: row.cancelAtPeriodEnd,
          currentPeriodEnd: PERIOD_END,
        });
      }
      return respond(404, { error: { message: "not found" } });
    }
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function mount(props: Parameters<typeof AccountSubscription>[0]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AccountSubscription {...props} />
    </QueryClientProvider>
  );
}

/** Lets both status reads land. */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("visibility", () => {
  it("renders nothing for a free user", async () => {
    const view = mount({});
    await settle();
    expect(view.queryByRole("region", { name: "Subscription" })).toBeNull();
    expect(view.queryByRole("button", { name: "Cancel subscription" })).toBeNull();
  });

  it("renders nothing for a free user viewing a free workspace as owner", async () => {
    rows["ws-1"] = {
      plan: "free",
      status: "free",
      containerKind: "standard",
      cancelAtPeriodEnd: false,
    };
    const view = mount({ workspaceId: "ws-1", role: "owner" });
    await settle();
    expect(view.queryByRole("button", { name: "Cancel subscription" })).toBeNull();
  });

  it("shows a personal Pro subscription with its renewal date", async () => {
    rows[PERSONAL] = { ...rows[PERSONAL], plan: "pro", status: "active" };
    const view = mount({});
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Cancel subscription" })).toBeTruthy()
    );
    expect(view.getByText("Pro")).toBeTruthy();
    expect(view.getByText(/^Renews /)).toBeTruthy();
  });

  it("shows a PAST_DUE subscription — still live, still cancellable", async () => {
    rows[PERSONAL] = { ...rows[PERSONAL], plan: "pro", status: "past_due" };
    const view = mount({});
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Cancel subscription" })).toBeTruthy()
    );
  });

  it("hides a canceled subscription", async () => {
    rows[PERSONAL] = { ...rows[PERSONAL], plan: "pro", status: "canceled" };
    const view = mount({});
    await settle();
    expect(view.queryByRole("button", { name: "Cancel subscription" })).toBeNull();
  });

  it("shows the open workspace's Team plan to an admin", async () => {
    rows["ws-1"] = {
      plan: "team",
      status: "active",
      containerKind: "standard",
      cancelAtPeriodEnd: false,
    };
    const view = mount({ workspaceId: "ws-1", role: "admin" });
    await waitFor(() => expect(view.getByText("Team")).toBeTruthy());
    expect(view.getAllByRole("button", { name: "Cancel subscription" })).toHaveLength(1);
  });

  it("hides the Team plan from a member — the route's admin floor", async () => {
    rows["ws-1"] = {
      plan: "team",
      status: "active",
      containerKind: "standard",
      cancelAtPeriodEnd: false,
    };
    const view = mount({ workspaceId: "ws-1", role: "member" });
    await settle();
    expect(view.queryByText("Team")).toBeNull();
    expect(view.queryByRole("button", { name: "Cancel subscription" })).toBeNull();
  });

  it("draws the personal subscription ONCE when the open workspace IS the home space", async () => {
    rows[PERSONAL] = { ...rows[PERSONAL], plan: "pro", status: "active" };
    rows["personal-id"] = rows[PERSONAL];
    const view = mount({ workspaceId: "personal-id", role: "owner" });
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Cancel subscription" })).toBeTruthy()
    );
    expect(view.getAllByRole("button", { name: "Cancel subscription" })).toHaveLength(1);
  });
});

describe("the cancel flow", () => {
  beforeEach(() => {
    rows[PERSONAL] = { ...rows[PERSONAL], plan: "pro", status: "active" };
  });

  it("asks first — no POST until confirmed, none on Keep", async () => {
    const view = mount({});
    const button = await view.findByRole("button", { name: "Cancel subscription" });
    fireEvent.click(button);
    expect(view.getByTestId("confirm-dialog")).toBeTruthy();
    expect(view.getByText("Cancel Pro?")).toBeTruthy();
    expect(view.getByText(/^Paid features stay on until /)).toBeTruthy();
    expect(posts).toHaveLength(0);

    fireEvent.click(view.getByRole("button", { name: "Dismiss: Keep" }));
    expect(view.queryByTestId("confirm-dialog")).toBeNull();
    expect(posts).toHaveLength(0);
  });

  it("confirming POSTs ONE cancel to the home space, then shows 'Cancels <date>' + Resume without a reload", async () => {
    const view = mount({});
    fireEvent.click(await view.findByRole("button", { name: "Cancel subscription" }));
    await act(async () => {
      fireEvent.click(
        view.getByRole("button", { name: "Confirm: Cancel subscription" })
      );
    });

    await waitFor(() =>
      expect(view.getByRole("button", { name: "Resume subscription" })).toBeTruthy()
    );
    expect(view.getByText(/^Cancels /)).toBeTruthy();
    expect(view.queryByRole("button", { name: "Cancel subscription" })).toBeNull();
    expect(posts).toEqual([{ workspace: PERSONAL, body: { resume: false } }]);
  });

  it("Resume clears the flag and puts Cancel back", async () => {
    rows[PERSONAL].cancelAtPeriodEnd = true;
    const view = mount({});
    fireEvent.click(await view.findByRole("button", { name: "Resume subscription" }));
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Cancel subscription" })).toBeTruthy()
    );
    expect(view.getByText(/^Renews /)).toBeTruthy();
    expect(posts).toEqual([{ workspace: PERSONAL, body: { resume: true } }]);
  });

  it("a Team cancel is scoped to that workspace by header", async () => {
    rows[PERSONAL] = { ...rows[PERSONAL], plan: "free", status: "free" };
    rows["ws-1"] = {
      plan: "team",
      status: "active",
      containerKind: "standard",
      cancelAtPeriodEnd: false,
    };
    const view = mount({ workspaceId: "ws-1", role: "owner" });
    fireEvent.click(await view.findByRole("button", { name: "Cancel subscription" }));
    await act(async () => {
      fireEvent.click(
        view.getByRole("button", { name: "Confirm: Cancel subscription" })
      );
    });
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Resume subscription" })).toBeTruthy()
    );
    expect(posts).toEqual([{ workspace: "ws-1", body: { resume: false } }]);
  });

  it("a refused cancel lands on the row and closes the dialog", async () => {
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) =>
      String(url).startsWith("/api/billing/cancel")
        ? ({
            status: 409,
            statusText: "",
            json: async () => ({
              error: {
                code: "NO_ACTIVE_SUBSCRIPTION",
                message: "This workspace has no active subscription to cancel.",
              },
            }),
          } as unknown as Response)
        : realFetch(url as string, init)
    );
    const view = mount({});
    fireEvent.click(await view.findByRole("button", { name: "Cancel subscription" }));
    await act(async () => {
      fireEvent.click(
        view.getByRole("button", { name: "Confirm: Cancel subscription" })
      );
    });
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toContain(
        "no active subscription"
      )
    );
    expect(view.queryByTestId("confirm-dialog")).toBeNull();
  });
});
