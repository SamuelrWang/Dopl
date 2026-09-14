// @vitest-environment jsdom
/**
 * SHARED RENDER MACHINERY for the agent window's suite — the fake bridge, the
 * summary fixture, and the mount.
 *
 * WHY IT IS ITS OWN FILE. `agent-window.test.tsx` reached the 500-line cap
 * (§1) on the 2026-08-27 wave, and the cap did what it is for: it named the
 * seam this file already had. The CLAIMS and the MACHINERY have different
 * reasons to change — the claims move when the window's behaviour does, this
 * moves when the BRIDGE's shape does — and nothing here asserts anything.
 * Same precedent as `settings-agent-harness.tsx`.
 *
 * ⚠ THE `vi.mock` CALLS STAY IN THE SUITE. They are hoisted per FILE and their
 * factories cannot close over an import, so they cannot live here; what moves is
 * only what a plain function can hold.
 *
 * ⚠ NOT a `*.test.tsx` name on purpose — `vitest.config.ts` includes exactly
 * `src/**​/*.test.ts(x)`, so this file is imported, never collected.
 */

import { act, render } from "@testing-library/react";
import { vi } from "vitest";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { ChannelsAgentWindow } from "./agent-window";
import { CHANNEL_ID, ME } from "./test-fixtures";

export const TASK = "t-1";
export const WS = "ws-1";

export function summary(
  over: Partial<DesktopSessionSummary> = {}
): DesktopSessionSummary {
  return {
    sessionId: "s-1",
    channelId: CHANNEL_ID,
    taskId: TASK,
    name: "flint",
    state: "working",
    channelName: "Website",
    threadTitle: "UI-kit design",
    detail: "tool",
    toolLabel: "Bash",
    ...over,
  };
}

export interface BridgeOver {
  sessions?: DesktopSessionSummary[];
  entries?: unknown[];
  message?: ReturnType<typeof vi.fn>;
  withNarration?: boolean;
  withMessage?: boolean;
  /** The FRAMELESS window's own close/zoom pair (2026-09-13). Present by default because the
   *  real desktop has it; `false` is the plain-browser / older-main case, where the header must
   *  render NO buttons rather than dead ones. */
  withWindowChrome?: boolean;
}

/** One live push, as `main/session-narration.js › flush` sends it. */
export type NarrationPush = (e: {
  sessionKey: string;
  entries: unknown[];
}) => void;

export function installBridge(over: BridgeOver = {}) {
  const {
    sessions = [summary()],
    entries = [],
    message = vi.fn().mockResolvedValue({ ok: true }),
    withNarration = true,
    withMessage = true,
    withWindowChrome = true,
  } = over;
  const closeWindow = vi.fn().mockResolvedValue({ ok: true });
  const toggleMaximize = vi.fn().mockResolvedValue({ ok: true, maximized: true });
  // ⚠ CAPTURED, NOT STUBBED (2026-08-22, F-250). `onNarration` returning a bare
  // unsubscriber meant NO TEST EVER DROVE A FRAME — which is precisely how a
  // filter that could never match shipped: every case read the mount value and
  // the live half had no coverage at all.
  const pushes: NarrationPush[] = [];
  const narration = vi.fn(() => Promise.resolve({ entries }));
  const api: Record<string, unknown> = {
    summaries: () => Promise.resolve({ sessions }),
    onSummaries: () => () => {},
    reopen: vi.fn(),
  };
  if (withNarration) {
    api.narration = narration;
    api.onNarration = (cb: NarrationPush) => {
      pushes.push(cb);
      return () => {
        const at = pushes.indexOf(cb);
        if (at !== -1) pushes.splice(at, 1);
      };
    };
  }
  if (withMessage) api.message = message;
  (window as unknown as { dopl?: unknown }).dopl = {
    apiRequest: () => Promise.resolve({ status: 200, statusText: "", hasBody: false }),
    sessions: api,
    ...(withWindowChrome
      ? { appWindow: { close: closeWindow, toggleMaximize } }
      : {}),
  };
  /** Fan one frame out to every subscriber, exactly as main does. */
  const push = async (sessionKey: string, frame: unknown[]) => {
    await act(async () => {
      for (const cb of [...pushes]) cb({ sessionKey, entries: frame });
    });
  };
  return { message, narration, push, closeWindow, toggleMaximize };
}

/**
 * ⚠ **`logoSrc` LEFT THIS MOUNT ON 2026-09-13 WITH THE PROP** — the mark is the WINDOW's chrome
 * now (`agent-window-chrome.tsx`), so `ChannelsAgentWindow` no longer takes one and passing it
 * here was a `tsc` error rather than a harmless extra. The chrome's own suite mounts the chrome
 * and asserts the mark there.
 */
export async function mount() {
  await act(async () => {
    render(
      <ChannelsAgentWindow
        workspaceId={WS}
        channelId={CHANNEL_ID}
        taskId={TASK}
        currentUserId={ME}
      />
    );
  });
}
