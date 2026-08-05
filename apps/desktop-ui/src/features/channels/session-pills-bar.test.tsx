import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { SessionPillsBar } from "@/features/channels/components/session-pills-bar";
import { installBridge } from "#/test-utils/bridge";

/**
 * The SESSION PILLS BAR, exercised where it actually runs.
 *
 * The component lives in the WEB tree (`@/features/channels/components/…`) because
 * this renderer bundles that tree, but it is desktop-only: everything in it is a
 * fact about the operator's machine, delivered over `window.dopl.sessions`. So the
 * DOM half of its contract is pinned HERE, in the app with jsdom and a real bridge
 * fixture — the same split `use-bridged-image-src` uses. The web half (SSR renders
 * nothing; the pure per-channel filter) is pinned in the root suite.
 *
 * THE CASE THAT MATTERS MOST IS THE ABSENT ONE. This component self-hides on a
 * missing capability, which is correct for a browser, for the retired website's
 * preload, and for a desktop build older than §3.3 — and a self-hiding surface
 * cannot report its own absence. `dopl-desktop-app/test/preload-parity.test.mjs`
 * proves the SPA preload HAS `sessions.summaries` / `sessions.onSummaries`; these
 * cases prove the component asks for them by those names and degrades to silence
 * rather than to a broken call when it does not get them.
 */

const CHANNEL = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

function summary(over: Partial<DesktopSessionSummary> = {}): DesktopSessionSummary {
  return {
    sessionId: "sess-1",
    channelId: CHANNEL,
    taskId: "task-1",
    name: "quartz",
    state: "working",
    channelName: "general",
    threadTitle: "Ship the thing",
    ...over,
  };
}

type Listener = (e: { sessions: DesktopSessionSummary[] }) => void;

/**
 * A `window.dopl` shaped like `renderer/app-preload.js` really exposes.
 * `shape` picks which desktop this is:
 *   "current"  — the SPA preload as of §3.3
 *   "no-feed"  — `reopen` only: the retired website's preload, and any older main
 *   "no-sessions" — a bridge with no sessions namespace at all
 */
function bridge(
  opts: { sessions?: DesktopSessionSummary[]; shape?: "current" | "no-feed" | "no-sessions" } = {}
) {
  const shape = opts.shape ?? "current";
  const reopen = vi.fn(() => Promise.resolve({ ok: true }));
  const summaries = vi.fn(() => Promise.resolve({ sessions: opts.sessions ?? [] }));
  const listeners = new Set<Listener>();
  const unsubscribed = vi.fn();
  const sessions: Record<string, unknown> = { reopen };
  if (shape === "current") {
    sessions.summaries = summaries;
    sessions.onSummaries = (cb: Listener) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
        unsubscribed();
      };
    };
  }
  const surface: Record<string, unknown> = {
    // The SPA marker `getSpaBridge` keys on. The pre-1.8 wrapper's partial
    // `window.dopl` has no `apiRequest` and must never be mistaken for this.
    apiRequest: vi.fn(() => Promise.resolve({ status: 200, statusText: "OK", hasBody: false })),
  };
  if (shape !== "no-sessions") surface.sessions = sessions;
  installBridge(surface);
  return {
    reopen,
    summaries,
    unsubscribed,
    push: (next: DesktopSessionSummary[]) => listeners.forEach((l) => l({ sessions: next })),
  };
}

afterEach(() => {
  Reflect.deleteProperty(window as unknown as Record<string, unknown>, "dopl");
});

const bar = () => screen.queryByLabelText("Agent sessions");
/** The pill buttons, in the order main sent them. */
const pills = () => [...(bar()?.querySelectorAll(":scope > div > button") ?? [])];
const clickPill = (i: number) => fireEvent.click(pills()[i]!);
const clickOpen = () => fireEvent.click(screen.getByRole("menuitem", { name: /Open/ }));

describe("no capability, no bar", () => {
  it("renders nothing in a plain browser (no window.dopl)", async () => {
    render(<SessionPillsBar channelId={CHANNEL} />);
    await waitFor(() => expect(bar()).toBeNull());
  });

  it("renders nothing when the bridge has no sessions namespace", async () => {
    bridge({ shape: "no-sessions" });
    render(<SessionPillsBar channelId={CHANNEL} />);
    await waitFor(() => expect(bar()).toBeNull());
  });

  it("renders nothing on a build with reopen but no feed, and asks for nothing", async () => {
    // The retired website's preload is this exact shape (ENGINEERING §9.3), and so
    // is any main older than §3.3. Silence, not a thrown call.
    const b = bridge({ shape: "no-feed" });
    render(<SessionPillsBar channelId={CHANNEL} />);
    await waitFor(() => expect(bar()).toBeNull());
    expect(b.summaries).not.toHaveBeenCalled();
  });

  it("renders nothing when the desktop is there and no session is running", async () => {
    bridge({ sessions: [] });
    render(<SessionPillsBar channelId={CHANNEL} />);
    await waitFor(() => expect(bar()).toBeNull());
  });

  it("renders nothing when a read fails, rather than a stuck bar", async () => {
    installBridge({
      apiRequest: vi.fn(),
      sessions: {
        reopen: vi.fn(),
        summaries: vi.fn(() => Promise.reject(new Error("refused"))),
        onSummaries: () => () => {},
      },
    });
    render(<SessionPillsBar channelId={CHANNEL} />);
    await waitFor(() => expect(bar()).toBeNull());
  });
});

describe("the pills render from the summaries", () => {
  it("shows one pill per session in this channel, with its state in words", async () => {
    bridge({
      sessions: [
        summary({ sessionId: "a", name: "quartz", state: "working" }),
        summary({ sessionId: "b", name: "onyx", state: "idle" }),
        summary({ sessionId: "c", name: "flint", state: "ended" }),
      ],
    });
    render(<SessionPillsBar channelId={CHANNEL} />);
    await waitFor(() => expect(pills()).toHaveLength(3));
    expect(pills().map((p) => p.textContent)).toEqual([
      "quartzWorking",
      "onyxIdle",
      "flintEnded",
    ]);
  });

  it("shows only THIS channel's sessions", async () => {
    bridge({
      sessions: [
        summary({ sessionId: "a", name: "quartz" }),
        summary({ sessionId: "b", name: "onyx", channelId: OTHER }),
      ],
    });
    render(<SessionPillsBar channelId={CHANNEL} />);
    await waitFor(() => expect(pills()).toHaveLength(1));
    expect(screen.queryByText("onyx")).toBeNull();
  });

  it("repaints on a pushed frame", async () => {
    const b = bridge({ sessions: [summary({ state: "working" })] });
    render(<SessionPillsBar channelId={CHANNEL} />);
    await waitFor(() => expect(screen.getByText("Working")).toBeInTheDocument());
    b.push([summary({ state: "idle" })]);
    await waitFor(() => expect(screen.getByText("Idle")).toBeInTheDocument());
    expect(screen.queryByText("Working")).toBeNull();
  });

  it("a session that leaves the frame leaves the bar", async () => {
    const b = bridge({ sessions: [summary()] });
    render(<SessionPillsBar channelId={CHANNEL} />);
    await waitFor(() => expect(bar()).not.toBeNull());
    b.push([]);
    await waitFor(() => expect(bar()).toBeNull());
  });

  it("a frame pushed while the initial read is in flight is not overwritten by it", async () => {
    // The read is a promise and the subscription is synchronous; an older answer
    // resolving late must not walk a newer frame back.
    const b = bridge({ sessions: [summary({ name: "quartz" })] });
    render(<SessionPillsBar channelId={CHANNEL} />);
    b.push([summary({ name: "onyx" })]);
    await waitFor(() => expect(screen.getByText("onyx")).toBeInTheDocument());
    expect(screen.queryByText("quartz")).toBeNull();
  });

  it("unsubscribes on unmount", async () => {
    const b = bridge({ sessions: [summary()] });
    const view = render(<SessionPillsBar channelId={CHANNEL} />);
    await waitFor(() => expect(bar()).not.toBeNull());
    view.unmount();
    expect(b.unsubscribed).toHaveBeenCalledTimes(1);
  });
});

describe("the dropdown", () => {
  it("names the session, what its state means, and its thread", async () => {
    bridge({
      sessions: [summary({ name: "flint", state: "idle", threadTitle: "Rewrite the parser" })],
    });
    render(<SessionPillsBar channelId={CHANNEL} />);
    await waitFor(() => expect(pills()).toHaveLength(1));
    clickPill(0);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByText("Rewrite the parser")).toBeInTheDocument();
    // "Idle" covers between-turns, awaiting-peer and parked; the line says so.
    expect(screen.getByText(/parked/)).toBeInTheDocument();
  });

  it("says so when a session has no thread title, rather than leaving a gap", async () => {
    bridge({ sessions: [summary({ taskId: "", threadTitle: null })] });
    render(<SessionPillsBar channelId={CHANNEL} />);
    await waitFor(() => expect(pills()).toHaveLength(1));
    clickPill(0);
    expect(screen.getByText("No thread title")).toBeInTheDocument();
  });

  it("Open calls the SAME reopen op the session card uses, with (channel, thread)", async () => {
    // Not a new op: main has ONE reopen path (live window -> an ended session's kept
    // window -> recreate a parked shell) and a pill must not grow a second one.
    const b = bridge({ sessions: [summary({ taskId: "task-7" })] });
    render(<SessionPillsBar channelId={CHANNEL} />);
    await waitFor(() => expect(pills()).toHaveLength(1));
    clickPill(0);
    clickOpen();
    expect(b.reopen).toHaveBeenCalledWith(CHANNEL, "task-7");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("an ENDED session is openable — its window is the transcript to read", async () => {
    // Main retains an ended pill ONLY where the window survived (the abandonment
    // case), so every ended pill that exists is one `reopen` can answer.
    const b = bridge({ sessions: [summary({ state: "ended", taskId: "task-9" })] });
    render(<SessionPillsBar channelId={CHANNEL} />);
    await waitFor(() => expect(pills()).toHaveLength(1));
    clickPill(0);
    clickOpen();
    expect(b.reopen).toHaveBeenCalledWith(CHANNEL, "task-9");
  });

  it("opens one menu at a time", async () => {
    bridge({
      sessions: [
        summary({ sessionId: "a", name: "quartz" }),
        summary({ sessionId: "b", name: "onyx" }),
      ],
    });
    render(<SessionPillsBar channelId={CHANNEL} />);
    await waitFor(() => expect(pills()).toHaveLength(2));
    clickPill(0);
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    clickPill(1);
    expect(screen.getAllByRole("menu")).toHaveLength(1);
  });

  it("the pill starts NOTHING on its own — opening the menu is not a call", async () => {
    const b = bridge({ sessions: [summary()] });
    render(<SessionPillsBar channelId={CHANNEL} />);
    await waitFor(() => expect(pills()).toHaveLength(1));
    clickPill(0);
    expect(b.reopen).not.toHaveBeenCalled();
  });
});
