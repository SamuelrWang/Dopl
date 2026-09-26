// @vitest-environment jsdom
/**
 * THE CONNECT PAGE'S RUNTIME BARS — one per runtime Dopl signs in from the app, in all four states, live
 * from main's push, and absent without the bridge.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { RuntimeCredentialStatus } from "@/shared/lib/spa-bridge";
import { RuntimeCredentialBars } from "./runtime-credential-bars";

type Row = RuntimeCredentialStatus;
const row = (runtimeId: string, label: string, state: Row["state"]): Row => ({ runtimeId, label, state, prompt: false });

afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

function bridge(first: Row[]) {
  let push: (p: { runtimes: Row[] }) => void = () => {};
  const signIn = vi.fn().mockResolvedValue({ ok: true });
  const signInFull = vi.fn().mockResolvedValue({ ok: true });
  const off = vi.fn();
  (window as { dopl?: unknown }).dopl = {
    apiRequest: vi.fn(),
    runtimeAuth: {
      signIn,
      signInFull,
      status: () => Promise.resolve({ runtimes: first }),
      onStatus: (cb: typeof push) => { push = cb; return off; },
      dismissPrompt: vi.fn(),
    },
  };
  return { signIn, signInFull, off, push: (runtimes: Row[]) => act(() => push({ runtimes })) };
}

const bar = (label: string) => screen.getByText(label).closest("li") as HTMLElement;

describe("each state is its label and its control, nothing more", () => {
  it.each([
    ["not-connected", "Not connected", "Sign in"],
    ["expired", "Sign-in expired", "Sign in"],
    ["connected", "Connected", null],
  ] as const)("%s", async (state, text, control) => {
    bridge([row("codex", "Codex", state)]);
    render(<RuntimeCredentialBars />);
    expect(await screen.findByText(text)).toBeTruthy();
    const buttons = within(bar("Codex")).queryAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(control ? [control] : []);
    expect(bar("Codex").textContent).toBe(`Codex${text}${control ?? ""}`);
  });

  it("signing-in: the control is busy and cannot be pressed again", async () => {
    bridge([row("claude", "Claude Code", "signing-in")]);
    render(<RuntimeCredentialBars />);
    const busy = (await screen.findByRole("button", { name: "Signing in…" })) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute("aria-busy")).toBe("true");
  });
});

it("one bar per runtime, and Sign in runs THAT runtime's sign-in", async () => {
  const b = bridge([row("claude", "Claude Code", "not-connected"), row("codex", "Codex", "expired")]);
  render(<RuntimeCredentialBars />);
  fireEvent.click(await screen.findByRole("button", { name: "Sign in to Codex" }));
  expect(b.signIn).toHaveBeenCalledWith("codex");
  expect(screen.getAllByRole("listitem").map((li) => li.firstChild?.textContent)).toEqual(["Claude Code", "Codex"]);
});

it("follows main's push: a sign-in's progress and its result land without a reload", async () => {
  const b = bridge([row("claude", "Claude Code", "not-connected")]);
  render(<RuntimeCredentialBars />);
  await screen.findByText("Not connected");
  b.push([row("claude", "Claude Code", "signing-in")]);
  expect(screen.getByRole("button", { name: "Signing in…" })).toBeTruthy();
  b.push([row("claude", "Claude Code", "connected")]);
  expect(screen.getByText("Connected")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

it("a push that beats the first read is not overwritten by it", async () => {
  let answer: (v: { runtimes: Row[] }) => void = () => {};
  const b = bridge([]);
  (window as unknown as { dopl: { runtimeAuth: { status: () => Promise<unknown> } } }).dopl.runtimeAuth.status =
    () => new Promise((r) => { answer = r; });
  render(<RuntimeCredentialBars />);
  b.push([row("codex", "Codex", "connected")]);
  await act(async () => answer({ runtimes: [row("codex", "Codex", "not-connected")] }));
  expect(screen.getByText("Connected")).toBeTruthy();
});

it("unmounting stops following the push", async () => {
  const b = bridge([row("codex", "Codex", "connected")]);
  const { unmount } = render(<RuntimeCredentialBars />);
  await screen.findByText("Connected");
  unmount();
  expect(b.off).toHaveBeenCalledTimes(1);
});

it("renders nothing without the bridge op — the web tree, an older desktop", () => {
  (window as { dopl?: unknown }).dopl = { apiRequest: vi.fn() };
  const { container } = render(<RuntimeCredentialBars />);
  expect(container.innerHTML).toBe("");
});

describe("Enable Chrome & connectors: the optional full login, on a connected runtime only", () => {
  const full = (state: Row["state"], f: Row["full"]): Row => ({ ...row("claude", "Claude Code", state), full: f });

  it("off: the control runs THAT runtime's full login", async () => {
    const b = bridge([full("connected", "off")]);
    render(<RuntimeCredentialBars />);
    fireEvent.click(await screen.findByRole("button", { name: "Enable Chrome & connectors" }));
    expect(b.signInFull).toHaveBeenCalledWith("claude");
    expect(b.signIn).not.toHaveBeenCalled();
  });

  it("signing-in: busy and not pressable; on: a label, no control", async () => {
    const b = bridge([full("connected", "signing-in")]);
    render(<RuntimeCredentialBars />);
    const busy = (await screen.findByRole("button", { name: "Signing in…" })) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    b.push([full("connected", "on")]);
    expect(bar("Claude Code").textContent).toBe("Claude CodeConnectedChrome & connectors on");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("absent until the runtime itself is connected, and absent where the runtime offers none", async () => {
    bridge([full("not-connected", "off"), row("codex", "Codex", "connected")]);
    render(<RuntimeCredentialBars />);
    await screen.findByText("Not connected");
    expect(screen.queryByRole("button", { name: "Enable Chrome & connectors" })).toBeNull();
    expect(bar("Codex").textContent).toBe("CodexConnected");
  });
});
