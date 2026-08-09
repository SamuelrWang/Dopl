import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import type { BridgeOpResult, BridgeResponse } from "#/lib/dopl-bridge";
import { SEGMENT, installBridge } from "#/test-utils/bridge";
import { AppShellLayout } from "#/components/app-shell";
import BootPage from "./index";

/**
 * Smoke test for the boot route — the launch decision (journey-audit J1 step 9,
 * GAP-1 and G2). Every branch is asserted through the Electron bridge, because
 * boot is the one page whose inputs are the bridge itself: `getAuthState` for
 * the session and `apiRequest` (over IPC) for the two endpoints.
 *
 * `fetch` is a never-resolving tripwire: nothing here may touch the network
 * (`connect-src 'none'` in the packaged renderer).
 */

const apiRequest = vi.hoisted(() => vi.fn());
const getAuthState = vi.hoisted(() => vi.fn());
const openExternal = vi.hoisted(() => vi.fn(() => Promise.resolve({ ok: true })));
// Typed as the bridge's own result so a test can answer `{ ok: false, error }`.
const beginSignIn = vi.hoisted(() => vi.fn((): Promise<BridgeOpResult> => Promise.resolve({ ok: true })));
const passwordSignIn = vi.hoisted(() => vi.fn((): Promise<BridgeOpResult> => Promise.resolve({ ok: true })));
const sendMagicLink = vi.hoisted(() => vi.fn((): Promise<BridgeOpResult> => Promise.resolve({ ok: true })));

// The crystal panel needs ResizeObserver + a canvas 2D context — neither
// exists in jsdom. Same passthrough the onboarding suite uses.
vi.mock("@/shared/layout/auth-split", () => ({
  AuthSplitLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="auth-split">{children}</div>
  ),
}));


function ok(body: unknown): BridgeResponse {
  return { status: 200, statusText: "OK", hasBody: true, body };
}

function unauthorized(): BridgeResponse {
  return {
    status: 401,
    statusText: "Unauthorized",
    hasBody: true,
    body: { error: { code: "UNAUTHORIZED", message: "Not signed in" } },
  };
}

const WORKSPACE = {
  id: "11111111-2222-3333-4444-555555555555",
  slug: "acme",
  publicId: "ab12cd",
};

/**
 * ONE endpoint (P0-2). `onboarding-state` + `ensure-default` were two serial
 * hops here, and `resolve` + `me` two more after the navigation; `/api/boot`
 * answers all four. An un-onboarded caller still gets NO workspace — the
 * provisioning gate moved server-side, it did not disappear.
 */
function bridgeFor(isOnboarded: boolean) {
  return (path: string): Promise<BridgeResponse> => {
    if (path === "/api/boot") {
      return Promise.resolve(
        ok({
          isOnboarded,
          surveyCompleted: true,
          userId: "user-1",
          workspace: isOnboarded ? WORKSPACE : null,
          segment: isOnboarded ? SEGMENT : null,
          needsRedirect: false,
          role: isOnboarded ? "owner" : null,
          myAccess: isOnboarded ? { defaultLevel: "edit", overrides: [] } : null,
        })
      );
    }
    return Promise.reject(new Error(`unexpected request: ${path}`));
  };
}

function renderBoot(queryClient = createQueryClient()) {
  const router = createMemoryRouter(
    [
      { path: "/", element: <BootPage /> },
      { path: "/onboarding", element: <div>ONBOARDING ROUTE</div> },
      { path: "/:workspaceSegment", element: <div>WORKSPACE ROUTE</div> },
    ],
    { initialEntries: ["/"] }
  );
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

describe("boot page", () => {
  beforeEach(() => {
    // `vi.hoisted` mocks sit outside vitest's restore sweep, so the call log
    // would accumulate across tests and make every count wrong.
    apiRequest.mockReset();
    getAuthState.mockResolvedValue({ signedIn: true, userId: "user-1" });
    apiRequest.mockImplementation((path: string) => bridgeFor(true)(path));
    installBridge({
        apiRequest,
        getAuthState,
        openExternal,
        beginSignIn,
        passwordSignIn,
        sendMagicLink,
        appOrigin: "https://www.usedopl.com",
      });
  });

  it("signed out → the real login form, and reads nothing", async () => {
    getAuthState.mockResolvedValue({ signedIn: false, userId: null });

    renderBoot();

    // The web /login form, not a stand-in card (Samuel's #1 complaint).
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email Address")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Remember me" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Sign up" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Email me a sign-in link instead" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with GitHub" })).toBeInTheDocument();
    expect(screen.getByAltText("Dopl")).toBeInTheDocument();

    // Boot must not read anything for a signed-out caller.
    expect(apiRequest).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("signed in but not onboarded → /onboarding", async () => {
    apiRequest.mockImplementation((path: string) => bridgeFor(false)(path));

    renderBoot();

    expect(await screen.findByText("ONBOARDING ROUTE")).toBeInTheDocument();
    const paths = apiRequest.mock.calls.map((c) => (c as unknown[])[0]);
    expect(paths).toContain("/api/boot");
    // The workspace is not provisioned until onboarding completes — the boot
    // answer carries a null workspace, and the SPA asks for nothing else.
    expect(paths).not.toContain("/api/workspaces/ensure-default");
  });

  it("signed in and onboarded → one boot read, then the workspace route (G2)", async () => {
    renderBoot();

    expect(await screen.findByText("WORKSPACE ROUTE")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        apiRequest.mock.calls.some(
          (c) =>
            (c as unknown[])[0] === "/api/boot" &&
            ((c as unknown[])[1] as { method?: string } | undefined)?.method === "POST"
        )
      ).toBe(true)
    );
    // THE COLLAPSE, pinned: one request in front of the workspace route, not
    // the four (`onboarding-state`, `ensure-default`, `resolve`, `me`) it
    // replaced. Anything else here is a regression of launch-blocker P0-2.
    expect(
      apiRequest.mock.calls.map((c) => (c as unknown[])[0])
    ).toEqual(["/api/boot"]);
    expect(fetch).not.toHaveBeenCalled();
  });

  // THE PERSISTED-CACHE HAZARD. The query cache is written to IndexedDB now
  // (`lib/query-client.ts`), so a relaunch restores this route's own entry and
  // renders it before any request lands. Everywhere else that is a free first
  // paint; here it is a ROUTING decision, and a restored segment can be a
  // corpse — the workspace was deleted, or a different account signed in.
  // Boot must route on the answer THIS mount fetched, never on the disk's.
  it("never routes on a restored answer — it waits for this mount's own", async () => {
    const queryClient = createQueryClient();
    // What a relaunch hydrates: a settled success for a workspace that has
    // since been deleted.
    queryClient.setQueryData(["/api/boot", undefined, undefined], {
      isOnboarded: true,
      surveyCompleted: true,
      userId: "user-1",
      workspace: { ...WORKSPACE, publicId: "dead99" },
      segment: "gone-dead99",
      needsRedirect: false,
      role: "owner",
      myAccess: { defaultLevel: "edit", overrides: [] },
    });

    let release: (() => void) | undefined;
    apiRequest.mockImplementation(
      (path: string) =>
        new Promise<BridgeResponse>((resolve) => {
          release = () => resolve(bridgeFor(true)(path) as unknown as BridgeResponse);
        })
    );

    renderBoot(queryClient);

    // The restored segment is on screen for exactly no time: the cover holds.
    expect(await screen.findByText("Starting Dopl")).toBeInTheDocument();
    expect(screen.queryByText("WORKSPACE ROUTE")).toBeNull();

    apiRequest.mockImplementation((path: string) => bridgeFor(true)(path));
    release?.();

    // …and the route that lands is the LIVE one, not the corpse.
    expect(await screen.findByText("WORKSPACE ROUTE")).toBeInTheDocument();
  });

  // THE WHOLE CHAIN, end to end: launch → real shell → routed page. This is
  // the assertion the launch-blocker is actually about — the four endpoints
  // below were four SERIAL round trips, and the shell gated `<Outlet/>` on
  // the third, so no page could start its own fetch until all of them landed.
  it("mounts the real shell and its page having read the API exactly once", async () => {
    const router = createMemoryRouter(
      [
        { path: "/", element: <BootPage /> },
        {
          path: "/:workspaceSegment",
          element: <AppShellLayout />,
          children: [{ index: true, element: <p>PAGE BODY</p> }],
        },
      ],
      { initialEntries: ["/"] }
    );
    apiRequest.mockImplementation((path: string) => {
      if (path === "/api/boot") return bridgeFor(true)(path);
      // The shell's chrome + notice layer. These are PARALLEL reads off the
      // mounted shell, not links in the boot chain.
      if (path === "/api/workspaces") {
        return Promise.resolve(ok({ workspaces: [{ ...WORKSPACE, role: "owner" }] }));
      }
      if (path === "/api/me/join-requests") return Promise.resolve(ok({ notices: [] }));
      if (path === "/api/onboarding/mcp-status") {
        return Promise.resolve(ok({ connected: true }));
      }
      if (path === "/api/channels/consent") return Promise.resolve(ok({ requests: [] }));
      return Promise.reject(new Error(`unexpected request: ${path}`));
    });

    render(
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );

    expect(await screen.findByText("PAGE BODY")).toBeInTheDocument();

    const paths = apiRequest.mock.calls.map((c) => (c as unknown[])[0] as string);
    expect(paths.filter((p) => p === "/api/boot")).toHaveLength(1);
    for (const gone of [
      "/api/user/onboarding-state",
      "/api/workspaces/ensure-default",
      "/api/workspaces/me",
    ]) {
      expect(paths).not.toContain(gone);
    }
    expect(paths.some((p) => p.startsWith("/api/workspaces/resolve"))).toBe(false);
    // `my-access` is deliberately NOT asserted absent: the shell's access
    // matrix is seeded (so it never blocks) but its own query may still
    // revalidate in the background — beside the page, never in front of it.
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a 401 from the API falls back to the signed-out screen", async () => {
    apiRequest.mockResolvedValue(unauthorized());

    renderBoot();

    expect(await screen.findByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
  });
});

/**
 * The signed-out screen's credential ops. Every one of them runs in MAIN over
 * the bridge — the renderer has no supabase client and never sees a token — so
 * the assertions are on the bridge calls, and `fetch` stays untouched.
 */
describe("signed-out login form", () => {
  beforeEach(() => {
    getAuthState.mockResolvedValue({ signedIn: false, userId: null });
    installBridge({
        apiRequest,
        getAuthState,
        openExternal,
        beginSignIn,
        passwordSignIn,
        sendMagicLink,
        appOrigin: "https://www.usedopl.com",
      });
  });

  async function renderForm() {
    renderBoot();
    await screen.findByRole("heading", { name: "Sign in" });
  }

  function type(label: string, value: string) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }

  it("submits email + password through passwordSignIn", async () => {
    await renderForm();

    type("Email Address", "sam@usedopl.com");
    type("Password", "hunter2-Hunter!");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(passwordSignIn).toHaveBeenCalledWith({
        mode: "sign-in",
        email: "sam@usedopl.com",
        password: "hunter2-Hunter!",
      })
    );
    // Success needs no navigation — main pushes the auth transition.
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sign up reuses passwordSignIn with mode: sign-up", async () => {
    await renderForm();

    type("Email Address", "new@usedopl.com");
    type("Password", "hunter2-Hunter!");
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));

    await waitFor(() =>
      expect(passwordSignIn).toHaveBeenCalledWith({
        mode: "sign-up",
        email: "new@usedopl.com",
        password: "hunter2-Hunter!",
      })
    );
  });

  it("surfaces a failed sign-in in the banner", async () => {
    passwordSignIn.mockResolvedValueOnce({ ok: false, error: "Invalid login credentials" });

    await renderForm();

    type("Email Address", "sam@usedopl.com");
    type("Password", "wrong-Password1!");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Invalid login credentials");
  });

  it("the magic-link fallback calls sendMagicLink", async () => {
    await renderForm();

    type("Email Address", "sam@usedopl.com");
    fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in link instead" }));

    await waitFor(() =>
      expect(sendMagicLink).toHaveBeenCalledWith({ email: "sam@usedopl.com" })
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Check your email for a sign-in link."
    );
  });

  it("the social buttons start OAuth in main, per provider", async () => {
    await renderForm();

    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    await waitFor(() => expect(beginSignIn).toHaveBeenCalledWith("google"));

    fireEvent.click(screen.getByRole("button", { name: "Continue with GitHub" }));
    await waitFor(() => expect(beginSignIn).toHaveBeenCalledWith("github"));

    // A renderer-built OAuth URL would skip main's login-CSRF nonce.
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("an older main (op absent) disables the path and says why", async () => {
    installBridge({ apiRequest, getAuthState, openExternal, appOrigin: "https://www.usedopl.com" });

    await renderForm();

    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeDisabled();
    expect(
      screen.getByText("Update the Dopl app to sign in with a password here.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Update the Dopl app to continue with Google or GitHub.")
    ).toBeInTheDocument();
  });
});
