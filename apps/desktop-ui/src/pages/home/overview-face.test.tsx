import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts } from "#/lib/dopl-bridge";
import { USER_ID, bridgeCalls, installBridge, ok } from "#/test-utils/bridge";
import { monthKey, shiftMonthKey } from "@/features/home/overview-period";
import { BILLING_STATUS, isAccountChannels, renderHome, routes } from "./home-test-harness";
import { CHANNEL_ID } from "./home-test-ids";

/** /home → Overview mounted in the page: its reads, its controls' reads, and Settings. The face's
 *  states and copy are pinned in `src/features/home/components/overview/`. */

const apiRequest = vi.hoisted(() => vi.fn());

vi.mock("@/features/channels/components/channel-surface-standalone", () => ({
  StandaloneChannelSurface: () => <div data-testid="channel-surface" />,
}));

const paths = (prefix: string) =>
  bridgeCalls(apiRequest)
    .map((call) => call.path)
    .filter((path) => path.startsWith(prefix));

const credits = () => screen.findByRole("region", { name: "Credits" });

function answer(override: (path: string) => Promise<unknown> | null = () => null) {
  apiRequest.mockImplementation(
    (path: string, opts: BridgeRequestOpts = {}) =>
      override(path) ?? routes(path, opts) ?? Promise.reject(new Error(`unexpected request: ${path}`))
  );
}

beforeEach(() => {
  apiRequest.mockReset();
  answer();
  installBridge({
    apiRequest: (path: string, opts: BridgeRequestOpts = {}) => apiRequest(path, opts),
    getAuthState: () => Promise.resolve({ signedIn: true, userId: USER_ID }),
    onAuthState: () => () => {},
    openExternal: () => Promise.resolve({ ok: true }),
  });
});

describe("/home Overview in the page", () => {
  it("reads the account-wide month, never a workspace-scoped payload", async () => {
    renderHome();
    await within(await credits()).findByText("320");
    expect(paths("/api/home/overview?")).toContain("/api/home/overview?range=month");
    expect(paths("/api/home/overview?").every((path) => !path.includes("workspaceId="))).toBe(true);
    expect(paths("/api/home/overview-series")).toEqual([
      "/api/home/overview-series?range=month&metric=credits",
    ]);
  });

  it("does not re-read when the left list's selection moves", async () => {
    renderHome();
    await credits();
    await waitFor(() => expect(paths("/api/home/overview?")).toHaveLength(1));
    fireEvent.click(await screen.findByText("Link out"));
    await waitFor(() => expect(paths("/api/home/overview?")).toHaveLength(1));
  });

  it("scopes by the left pane's own channels read, adding no request", async () => {
    renderHome();
    const card = await credits();
    const before = bridgeCalls(apiRequest).filter((call) => isAccountChannels(call.path)).length;
    fireEvent.click(within(card).getByRole("button", { name: "Usage scope" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Priya Shah" }));
    await waitFor(() =>
      expect(paths("/api/home/overview-series")).toContain(
        `/api/home/overview-series?range=month&metric=credits&channel=${CHANNEL_ID}`
      )
    );
    expect(bridgeCalls(apiRequest).filter((call) => isAccountChannels(call.path)).length).toBe(before);
  });

  it("steps the month without re-reading billing", async () => {
    renderHome();
    const card = await credits();
    await within(card).findByText("320");
    const billing = paths("/api/billing/status").length;
    fireEvent.click(within(card).getByRole("button", { name: "Previous month" }));
    await waitFor(() =>
      expect(paths("/api/home/overview-series")).toContain(
        `/api/home/overview-series?range=month&metric=credits&month=${shiftMonthKey(monthKey(), -1)}`
      )
    );
    expect(paths("/api/billing/status")).toHaveLength(billing);
    expect(within(card).getByText("320")).toBeInTheDocument();
  });

  it("opens Settings on Plans & Billing from Get more credits", async () => {
    renderHome();
    const card = await credits();
    fireEvent.click(await within(card).findByRole("button", { name: "Get more credits" }));
    expect(await screen.findByText("Plans and Billing")).toBeInTheDocument();
  });

  it("offers no second checkout to a paying home container", async () => {
    answer((path) =>
      path.split("?")[0] === "/api/billing/status"
        ? Promise.resolve(ok({ ...BILLING_STATUS, plan: "pro", status: "active" }))
        : null
    );
    renderHome();
    const card = await credits();
    await within(card).findByText("320");
    expect(within(card).queryByRole("button", { name: "Get more credits" })).toBeNull();
  });
});
