// @vitest-environment jsdom
/**
 * STEP 3, "BRING YOUR AGENT" (Samuel 2026-10-13): the button flips to a GREEN "Signed in" on main's status
 * PUSH, not on the click's answer; "Signing in…" is the Cancel; a cancel is not a failure; a double click
 * starts one flow.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { RuntimeCredentialStatus } from "@/shared/lib/spa-bridge";
import { BringAgentStep } from "./bring-agent-step";

afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

type Row = Pick<RuntimeCredentialStatus, "runtimeId" | "state">;
const rows = (r: Row[]) => ({ runtimes: r.map((x) => ({ label: x.runtimeId, prompt: false, ...x })) });

function bridge({ initial = [] as Row[], signIn = vi.fn() } = {}) {
  let push: (p: ReturnType<typeof rows>) => void = () => {};
  const cancelSignIn = vi.fn().mockResolvedValue({ ok: true });
  (window as { dopl?: unknown }).dopl = {
    apiRequest: vi.fn(),
    runtimeAuth: {
      signIn,
      signInFull: vi.fn(),
      cancelSignIn,
      status: vi.fn().mockResolvedValue(rows(initial)),
      onStatus: (cb: typeof push) => {
        push = cb;
        return () => {};
      },
      dismissPrompt: vi.fn(),
    },
  };
  return { signIn, cancelSignIn, push: (r: Row[]) => act(() => push(rows(r))) };
}

const step = () => render(<BringAgentStep previewOnly={false} onContinue={() => {}} />);
const check = (name: RegExp) => screen.getByRole("button", { name }).querySelector("svg");

describe.each([
  ["claude", "Claude"],
  ["codex", "ChatGPT"],
  // Real runtimes since the runtime scaffold (wired 2026-10-14): same flow.
  ["muse", "Muse"],
  ["grok", "Grok"],
])("%s", (id, label) => {
  it("flips to a green 'Signed in' when main pushes connected", async () => {
    let answer: (v: { ok: boolean }) => void = () => {};
    const b = bridge({ signIn: vi.fn().mockReturnValue(new Promise((r) => (answer = r))) });
    step();
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: `Sign in to ${label}` }));
    expect(b.signIn).toHaveBeenCalledWith(id);
    expect(screen.getByRole("button", { name: /Signing in…/ })).toBeTruthy();
    b.push([{ runtimeId: id, state: "connected" }]);
    await act(async () => answer({ ok: true }));
    const btn = screen.getByRole("button", { name: `Signed in to ${label}` }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(check(new RegExp(`Signed in to ${label}`))?.getAttribute("class")).toContain("text-success");
    expect(screen.queryByRole("status")).toBeNull();
  });
});

it("already signed in on mount: green at once, no click", async () => {
  bridge({ initial: [{ runtimeId: "claude", state: "connected" }] });
  step();
  await act(async () => {});
  expect(check(/Signed in to Claude/)?.getAttribute("class")).toContain("text-success");
  expect(screen.getByRole("button", { name: "Sign in to ChatGPT" })).toBeTruthy();
});

it("'Signing in…' cancels; a cancel returns to idle with no failure line", async () => {
  let answer: (v: { ok: boolean }) => void = () => {};
  const b = bridge({ signIn: vi.fn().mockReturnValue(new Promise((r) => (answer = r))) });
  const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
  step();
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Sign in to ChatGPT" }));
  fireEvent.click(screen.getByRole("button", { name: /Signing in…/ }));
  expect(b.cancelSignIn, "a double click's second press is not a Cancel").not.toHaveBeenCalled();
  now.mockReturnValue(5_000);
  fireEvent.click(screen.getByRole("button", { name: /Signing in…/ }));
  now.mockRestore();
  expect(b.cancelSignIn).toHaveBeenCalledWith("codex");
  await act(async () => answer({ ok: false }));
  expect(screen.getByRole("button", { name: "Sign in to ChatGPT" })).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
});

it("a flow that ends without a credential (timeout) says so; a double click starts one flow", async () => {
  let answer: (v: { ok: boolean }) => void = () => {};
  const b = bridge({ signIn: vi.fn().mockReturnValue(new Promise((r) => (answer = r))) });
  step();
  await act(async () => {});
  const btn = screen.getByRole("button", { name: "Sign in to Claude" });
  fireEvent.click(btn);
  fireEvent.click(screen.getByRole("button", { name: "Sign in to ChatGPT" }));
  expect(b.signIn).toHaveBeenCalledTimes(1);
  await act(async () => answer({ ok: false }));
  expect(screen.getByRole("status").textContent).toContain("Claude sign-in didn");
});

it("a failed Muse or Grok sign-in names that runtime", async () => {
  for (const [id, label] of [["muse", "Muse"], ["grok", "Grok"]] as const) {
    let answer: (v: { ok: boolean }) => void = () => {};
    const b = bridge({ signIn: vi.fn().mockReturnValue(new Promise((r) => (answer = r))) });
    step();
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: `Sign in to ${label}` }));
    expect(b.signIn).toHaveBeenCalledWith(id);
    await act(async () => answer({ ok: false }));
    expect(screen.getByRole("status").textContent).toContain(`${label} sign-in didn`);
    cleanup();
  }
});

it("preview: the fake sign-in shows the same green check", () => {
  render(<BringAgentStep previewOnly onContinue={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Sign in to Muse" }));
  expect(check(/Signed in to Muse/)?.getAttribute("class")).toContain("text-success");
});
