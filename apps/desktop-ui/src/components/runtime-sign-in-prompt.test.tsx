import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeCredentialStatus } from "@/shared/lib/spa-bridge";
import { ToastHost } from "@/shared/ui/toast";
import { installBridge } from "#/test-utils/bridge";
import { RuntimeSignInPrompt } from "./runtime-sign-in-prompt";

/**
 * THE APP-LEVEL SIGN-IN PROMPT. Main decides when a runtime needs one (a held agent, a refused launch)
 * and keeps it once per runtime; this renders the first raised one, runs its sign-in, and reports a
 * dismissal. It closes when main's push says it is resolved.
 */

type Row = RuntimeCredentialStatus;
const row = (runtimeId: string, label: string, prompt: boolean, state: Row["state"] = "not-connected"): Row =>
  ({ runtimeId, label, state, prompt });

function mount(first: Row[], signInAnswer: { ok: boolean } = { ok: true }) {
  let push: (p: { runtimes: Row[] }) => void = () => {};
  const signIn = vi.fn().mockResolvedValue(signInAnswer);
  const dismissPrompt = vi.fn().mockResolvedValue({ ok: true });
  installBridge({
    apiRequest: vi.fn(),
    runtimeAuth: {
      signIn,
      status: () => Promise.resolve({ runtimes: first }),
      onStatus: (cb: typeof push) => { push = cb; return () => {}; },
      dismissPrompt,
    },
  });
  render(<><RuntimeSignInPrompt /><ToastHost /></>);
  return { signIn, dismissPrompt, push: (runtimes: Row[]) => act(() => push({ runtimes })) };
}

describe("RuntimeSignInPrompt", () => {
  it("shows ONE prompt, the first raised runtime's, titled by its own name", async () => {
    mount([row("claude", "Claude Code", true), row("codex", "Codex", true)]);
    expect(await screen.findByRole("dialog", { name: "Sign in to Claude Code" })).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("Sign in runs THAT runtime's sign-in; main's push then closes it", async () => {
    const m = mount([row("codex", "Codex", true)]);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    await act(async () => {});
    expect(m.signIn).toHaveBeenCalledWith("codex");
    m.push([row("codex", "Codex", false, "connected")]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a sign-in that does not take keeps it open and says so", async () => {
    mount([row("codex", "Codex", true)], { ok: false });
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Couldn't sign in to Codex")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Sign in to Codex" })).toBeInTheDocument();
  });

  it("Not now dismisses it in main, and the next raised runtime's prompt follows", async () => {
    const m = mount([row("claude", "Claude Code", true), row("codex", "Codex", true)]);
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(m.dismissPrompt).toHaveBeenCalledWith("claude");
    m.push([row("claude", "Claude Code", false), row("codex", "Codex", true)]);
    expect(screen.getByRole("dialog", { name: "Sign in to Codex" })).toBeInTheDocument();
  });

  it("renders nothing while no runtime is raised", async () => {
    mount([row("claude", "Claude Code", false, "expired")]);
    await act(async () => {});
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
