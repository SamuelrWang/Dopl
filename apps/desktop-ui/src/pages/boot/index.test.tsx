import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import type { BridgeOpResult, BridgeResponse } from "#/lib/dopl-bridge";
import { SEGMENT, installBridge } from "#/test-utils/bridge";
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

function bridgeFor(isOnboarded: boolean) {
  return (path: string): Promise<BridgeResponse> => {
    if (path === "/api/user/onboarding-state") {
      return Promise.resolve(ok({ isOnboarded }));
    }
    if (path === "/api/workspaces/ensure-default") {
      return Promise.resolve(
        ok({ workspace: { id: "w1", slug: "acme", publicId: "ab12cd" }, segment: SEGMENT })
      );
    }
    return Promise.reject(new Error(`unexpected request: ${path}`));
  };
}

function renderBoot() {
  const router = createMemoryRouter(
    [
      { path: "/", element: <BootPage /> },
      { path: "/onboarding", element: <div>ONBOARDING ROUTE</div> },
      { path: "/:workspaceSegment", element: <div>WORKSPACE ROUTE</div> },
    ],
    { initialEntries: ["/"] }
  );
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

describe("boot page", () => {
  beforeEach(() => {
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
    expect(paths).toContain("/api/user/onboarding-state");
    // The workspace is not provisioned until onboarding completes.
    expect(paths).not.toContain("/api/workspaces/ensure-default");
  });

  it("signed in and onboarded → ensure-default, then the workspace route (G2)", async () => {
    renderBoot();

    expect(await screen.findByText("WORKSPACE ROUTE")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        apiRequest.mock.calls.some(
          (c) =>
            (c as unknown[])[0] === "/api/workspaces/ensure-default" &&
            ((c as unknown[])[1] as { method?: string } | undefined)?.method === "POST"
        )
      ).toBe(true)
    );
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
