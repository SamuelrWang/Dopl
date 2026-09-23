// @vitest-environment jsdom
/**
 * THE GENERIC IN-APP SIGN-IN CONTROL (2026-09-23) — one control for every runtime, over the real
 * descriptors: labelled per runtime, a busy state, a plain failure line, and absent (never grayed)
 * where the bridge op or the runtime's in-app flow is missing.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { realDescriptor } from "../lib/runtime-descriptors-harness";
import { RuntimeSignInButton } from "./runtime-signin-button";

afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

function bridge(signIn?: ReturnType<typeof vi.fn>) {
  (window as { dopl?: unknown }).dopl = {
    apiRequest: vi.fn(),
    ...(signIn ? { runtimeAuth: { signIn } } : {}),
  };
  return signIn;
}

describe.each([
  ["codex", "Sign in to Codex", "Couldn't sign in to Codex"],
  ["claude", "Sign in to Claude Code", "Couldn't sign in to Claude Code"],
])("%s", (id, label, failed) => {
  it("is labelled by its runtime and signs in THAT runtime", async () => {
    const signIn = bridge(vi.fn().mockResolvedValue({ ok: true, resumed: 1 }))!;
    const onSignedIn = vi.fn();
    render(<RuntimeSignInButton runtime={realDescriptor(id)} onSignedIn={onSignedIn} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: label }));
    });
    expect(signIn).toHaveBeenCalledWith(id);
    expect(onSignedIn).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(failed)).toBeNull();
  });

  it("is busy while the flow runs, then says plainly that it did not take", async () => {
    let answer: (v: { ok: boolean }) => void = () => {};
    bridge(vi.fn().mockReturnValue(new Promise((r) => { answer = r; })));
    const onSignedIn = vi.fn();
    render(<RuntimeSignInButton runtime={realDescriptor(id)} onSignedIn={onSignedIn} />);
    fireEvent.click(screen.getByRole("button", { name: label }));
    const busy = screen.getByRole("button", { name: "Signing in…" }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    await act(async () => {
      answer({ ok: false });
    });
    expect(screen.getByRole("button", { name: label })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(failed);
    expect(onSignedIn).not.toHaveBeenCalled();
  });
});

describe("absent, never grayed", () => {
  it("renders nothing where the runtime declares no in-app flow (Cursor)", () => {
    bridge(vi.fn());
    const { container } = render(<RuntimeSignInButton runtime={realDescriptor("cursor")} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing without the bridge op", () => {
    bridge();
    const { container } = render(<RuntimeSignInButton runtime={realDescriptor("codex")} />);
    expect(container.innerHTML).toBe("");
  });

  it("with no descriptor yet, the bridge op decides and the stamped id is sent", async () => {
    const signIn = bridge(vi.fn().mockResolvedValue({ ok: true }))!;
    render(<RuntimeSignInButton runtime={null} runtimeId="codex" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    });
    expect(signIn).toHaveBeenCalledWith("codex");
  });

  it("a bridge that throws is a plain failure, not an unhandled rejection", async () => {
    bridge(vi.fn().mockRejectedValue(new Error("ipc gone")));
    render(<RuntimeSignInButton runtime={realDescriptor("codex")} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign in to Codex" }));
    });
    expect(screen.getByRole("status").textContent).toBe("Couldn't sign in to Codex");
  });
});
