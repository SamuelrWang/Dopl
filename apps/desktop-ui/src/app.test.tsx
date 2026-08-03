import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthState } from "#/lib/dopl-bridge";
import { App } from "./app";

/**
 * The two MAIN→renderer pushes the provider stack subscribes to, both of them
 * fleet-audit fixes (2026-08-03):
 *
 *   • `onAuthState` — sign-out (tray or settings modal) and main's forced
 *     signed-out after a 401 that survived a refresh had NO effect outside
 *     BootPage, because `useAuthPhase` is mounted only there. And the reverse:
 *     the shell renders the signed-out screen on a 401 but owns no phase, so a
 *     successful re-sign-in never swapped it back.
 *   • `onNavigate` — a clicked channel notification (journey-audit GAP-16).
 *     Main sends a router PATH; nothing in the SPA listened for it.
 *
 * The REAL route table is replaced with markers: this asserts the wiring above
 * the router, not what any page renders. `fetch` is a never-resolving tripwire
 * (`connect-src 'none'` in the packaged renderer).
 */

vi.mock("#/routes", () => ({
  routes: [
    { path: "/", element: <div>BOOT ROUTE</div> },
    { path: "/:workspaceSegment/members", element: <div>MEMBERS ROUTE</div> },
    { path: "/:workspaceSegment/channels", element: <div>CHANNELS ROUTE</div> },
  ],
}));

const apiRequest = vi.hoisted(() => vi.fn());
const getAuthState = vi.hoisted(() => vi.fn());

/** Handlers main pushes into, captured from the bridge subscriptions. */
let authListeners: ((state: AuthState) => void)[] = [];
let navListeners: ((payload: { path: string }) => void)[] = [];

const onAuthState = vi.fn((cb: (state: AuthState) => void) => {
  authListeners.push(cb);
  return () => {
    authListeners = authListeners.filter((fn) => fn !== cb);
  };
});
const onNavigate = vi.fn((cb: (payload: { path: string }) => void) => {
  navListeners.push(cb);
  return () => {
    navListeners = navListeners.filter((fn) => fn !== cb);
  };
});

function pushAuth(state: AuthState) {
  for (const fn of [...authListeners]) fn(state);
}
function pushNavigate(path: string) {
  for (const fn of [...navListeners]) fn({ path });
}

const SIGNED_IN: AuthState = { signedIn: true, userId: "user-1" };
const SIGNED_OUT: AuthState = { signedIn: false, userId: null };

/** Render, and wait for the launch session to seed the transition baseline. */
async function renderApp(hash = "#/acme-ab12cd/members") {
  window.location.hash = hash;
  const result = render(<App />);
  await screen.findByText(/ROUTE$/);
  await waitFor(() => expect(getAuthState).toHaveBeenCalled());
  return result;
}

describe("App — main's auth and navigation pushes", () => {
  beforeEach(() => {
    authListeners = [];
    navListeners = [];
    getAuthState.mockResolvedValue(SIGNED_IN);
    Object.defineProperty(window, "dopl", {
      configurable: true,
      writable: true,
      value: { apiRequest, getAuthState, onAuthState, onNavigate },
    });
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  });

  it("swaps ANY route to the sign-in screen when main pushes signed-out", async () => {
    await renderApp();
    expect(screen.getByText("MEMBERS ROUTE")).toBeInTheDocument();

    pushAuth(SIGNED_OUT);

    // Boot is the one surface that owns the auth phase, so it renders the
    // signed-out screen — the workspace route no longer sits on a dead session.
    expect(await screen.findByText("BOOT ROUTE")).toBeInTheDocument();
  });

  it("recovers to boot when the next sign-in lands (the dead-end fix)", async () => {
    await renderApp();

    pushAuth(SIGNED_OUT);
    await screen.findByText("BOOT ROUTE");

    // Re-sign-in: main pushes signed-in and nothing else. Boot must be
    // re-entered so it re-resolves the workspace instead of stranding on the
    // login form the user just completed.
    const clear = vi.spyOn(QueryClient.prototype, "clear");
    pushAuth(SIGNED_IN);

    await waitFor(() => expect(clear).toHaveBeenCalled());
    expect(screen.getByText("BOOT ROUTE")).toBeInTheDocument();
  });

  it("clears the cache on an account switch, but not on a token refresh", async () => {
    await renderApp();

    const clear = vi.spyOn(QueryClient.prototype, "clear");

    // Main re-emits the CURRENT state on every proactive refresh (~48 min).
    pushAuth(SIGNED_IN);
    pushAuth(SIGNED_IN);
    expect(clear).not.toHaveBeenCalled();
    expect(screen.getByText("MEMBERS ROUTE")).toBeInTheDocument();

    // A different user IS a transition: the previous credential's answers die.
    pushAuth({ signedIn: true, userId: "user-2" });
    await waitFor(() => expect(clear).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("BOOT ROUTE")).toBeInTheDocument();
  });

  it("routes a notification click to the pushed path (GAP-16)", async () => {
    await renderApp("#/acme-ab12cd/members");
    expect(screen.getByText("MEMBERS ROUTE")).toBeInTheDocument();

    pushNavigate("/acme-ab12cd/channels");

    expect(await screen.findByText("CHANNELS ROUTE")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("tolerates an older main that exposes neither push", async () => {
    Object.defineProperty(window, "dopl", {
      configurable: true,
      writable: true,
      value: { apiRequest },
    });

    window.location.hash = "#/acme-ab12cd/members";
    render(<App />);

    expect(await screen.findByText("MEMBERS ROUTE")).toBeInTheDocument();
  });
});
