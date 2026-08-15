// @vitest-environment jsdom
/**
 * THE SHARED LOGIN FORM, FROM THE WEB HOST'S SIDE.
 *
 * `login-form-core` is the only login UI either app has: `/signup` and `/login`
 * bind it with supabase actions (`./login-form`) and the desktop SPA binds it
 * with bridge actions (`apps/desktop-ui/src/pages/boot/signed-out-screen.tsx`).
 * The desktop suite already covers its host (`.../boot/index.test.tsx`), which
 * opens on SIGN IN and toggles in place — this pins the other half of the split,
 * where the web opens on SIGN UP and the switch is a NAVIGATION, plus the four
 * things neither host may reintroduce: a "Remember me" control, a "Don't have
 * an account?" preamble, a magic link, and visible field labels.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LoginFormCore } from "./login-form-core";
import type { LoginActions } from "../hooks/use-login-core";

afterEach(cleanup);

const VALID_PASSWORD = "hunter2-Hunter!";

function actions(): LoginActions {
  return {
    signInWithPassword: vi.fn(async () => ({})),
    signUpWithPassword: vi.fn(async () => ({})),
    oauth: vi.fn(async () => ({})),
  };
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("login form core", () => {
  it("opens on the host's defaultMode — signup for the web /signup route", () => {
    render(<LoginFormCore actions={actions()} defaultMode="signup" />);

    // Heading AND submit label follow the mode; nothing still says "Log In"
    // except the switch, which is the OTHER route.
    expect(screen.getByRole("heading", { name: "Sign Up" })).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Sign Up" }).disabled).toBe(false);
    expect(screen.queryByRole("heading", { name: "Log In" })).toBeNull();
  });

  it("has no Remember me control — the session is always persisted", () => {
    render(<LoginFormCore actions={actions()} defaultMode="signup" />);

    // Not hidden, GONE: the web client keeps the session in cookies and the
    // desktop app keeps it on disk, so there is no non-remembered path to opt
    // out of. A checkbox here would be decoration wired to nothing.
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/remember/i)).toBeNull();
  });

  it("has no magic link — password and OAuth are the only credential paths", () => {
    render(<LoginFormCore actions={actions()} defaultMode="signup" />);

    // The control is gone, and so is the action member behind it — a host that
    // still passed `sendMagicLink` would not type-check (`LoginActions`).
    expect(screen.queryByText(/sign-in link/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /link/i })).toBeNull();
  });

  it("names the fields with aria-label + placeholder, and shows no <label>", () => {
    const { container } = render(<LoginFormCore actions={actions()} defaultMode="signup" />);

    // The placeholder IS the label now, so the accessible name has to come from
    // `aria-label` — a placeholder alone vanishes on the first keystroke and is
    // not a name. Both must hold, or the field is unreachable by assistive tech.
    expect(container.querySelector("label")).toBeNull();
    const email = screen.getByLabelText<HTMLInputElement>("Email Address");
    const password = screen.getByLabelText<HTMLInputElement>("Password");
    expect(email.placeholder).toBe("Email Address");
    expect(password.placeholder).toBe("Password");
  });

  it("the mode switch names its destination, with no preamble", async () => {
    render(<LoginFormCore actions={actions()} defaultMode="signup" />);

    expect(screen.queryByText(/have an account/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Log In" }));

    expect(await screen.findByRole("heading", { name: "Log In" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log In" })).toBeTruthy();
    // Symmetric, and still preamble-free in the other direction.
    expect(screen.getByRole("button", { name: "Sign Up" })).toBeTruthy();
    expect(screen.queryByText(/have an account/i)).toBeNull();
  });

  it("a host that supplies `modeSwitch` gets a link, not the in-place toggle", () => {
    // THE WEB'S SHAPE. `/signup` and `/login` are separate routes, so the switch
    // has to leave the page — a toggle would leave the URL claiming the flow the
    // screen is no longer running.
    render(
      <LoginFormCore
        actions={actions()}
        defaultMode="signup"
        modeSwitch={({ to, className, children }) => (
          <a href={to === "signup" ? "/signup" : "/login"} className={className}>
            {children}
          </a>
        )}
      />
    );

    const link = screen.getByRole<HTMLAnchorElement>("link", { name: "Log In" });
    expect(link.getAttribute("href")).toBe("/login");
    // …and the fallback button is not ALSO rendered.
    expect(screen.queryByRole("button", { name: "Log In" })).toBeNull();
    // The heading still says the mode this route is on.
    expect(screen.getByRole("heading", { name: "Sign Up" })).toBeTruthy();
  });

  it("submitting in signup mode runs sign-up, not sign-in", async () => {
    const acts = actions();
    render(<LoginFormCore actions={acts} defaultMode="signup" />);

    type("Email Address", "new@usedopl.com");
    type("Password", VALID_PASSWORD);
    fireEvent.click(screen.getByRole("button", { name: "Sign Up" }));

    await waitFor(() =>
      // Exactly two arguments: there is no persistence flavour to pass, which
      // is what "always remembered" means at this seam.
      expect(acts.signUpWithPassword).toHaveBeenCalledWith("new@usedopl.com", VALID_PASSWORD)
    );
    expect(acts.signInWithPassword).not.toHaveBeenCalled();
  });

  it("submitting after the switch runs sign-in", async () => {
    const acts = actions();
    render(<LoginFormCore actions={acts} defaultMode="signup" />);

    fireEvent.click(screen.getByRole("button", { name: "Log In" }));
    type("Email Address", "sam@usedopl.com");
    type("Password", VALID_PASSWORD);
    fireEvent.click(screen.getByRole("button", { name: "Log In" }));

    await waitFor(() =>
      expect(acts.signInWithPassword).toHaveBeenCalledWith("sam@usedopl.com", VALID_PASSWORD)
    );
    expect(acts.signUpWithPassword).not.toHaveBeenCalled();
  });

  it("switching modes clears a stale banner", async () => {
    const acts = actions();
    acts.signUpWithPassword = vi.fn(async () => ({ error: "User already registered" }));
    render(<LoginFormCore actions={acts} defaultMode="signup" />);

    type("Email Address", "sam@usedopl.com");
    type("Password", VALID_PASSWORD);
    fireEvent.click(screen.getByRole("button", { name: "Sign Up" }));
    expect((await screen.findByRole("status")).textContent).toContain("User already registered");

    fireEvent.click(screen.getByRole("button", { name: "Log In" }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });
});
