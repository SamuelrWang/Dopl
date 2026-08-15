// @vitest-environment jsdom
/**
 * Shared login form, web-host half (desktop half: `.../boot/index.test.tsx`).
 * Pins four things neither host may reintroduce: "Remember me", a "Don't have
 * an account?" preamble, magic link, visible field labels.
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

    expect(screen.getByRole("heading", { name: "Sign Up" })).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Sign Up" }).disabled).toBe(false);
    expect(screen.queryByRole("heading", { name: "Log In" })).toBeNull();
  });

  it("has no Remember me control — the session is always persisted", () => {
    render(<LoginFormCore actions={actions()} defaultMode="signup" />);

    // Session always persisted (cookies on web, disk on desktop) — nothing to opt out of.
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/remember/i)).toBeNull();
  });

  it("has no magic link — password and OAuth are the only credential paths", () => {
    render(<LoginFormCore actions={actions()} defaultMode="signup" />);

    expect(screen.queryByText(/sign-in link/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /link/i })).toBeNull();
  });

  it("names the fields with aria-label + placeholder, and shows no <label>", () => {
    const { container } = render(<LoginFormCore actions={actions()} defaultMode="signup" />);

    // ⚠ Placeholder is not an accessible name; `aria-label` must also hold.
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
    expect(screen.getByRole("button", { name: "Sign Up" })).toBeTruthy();
    expect(screen.queryByText(/have an account/i)).toBeNull();
  });

  it("a host that supplies `modeSwitch` gets a link, not the in-place toggle", () => {
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
    expect(screen.queryByRole("button", { name: "Log In" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Sign Up" })).toBeTruthy();
  });

  it("submitting in signup mode runs sign-up, not sign-in", async () => {
    const acts = actions();
    render(<LoginFormCore actions={acts} defaultMode="signup" />);

    type("Email Address", "new@usedopl.com");
    type("Password", VALID_PASSWORD);
    fireEvent.click(screen.getByRole("button", { name: "Sign Up" }));

    await waitFor(() =>
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
