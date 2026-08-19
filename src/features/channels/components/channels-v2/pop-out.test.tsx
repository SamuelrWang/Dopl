// @vitest-environment jsdom
/**
 * "Open as new window" — the thread view's POP-OUT affordance (wiring plan Phase 10,
 * 2026-08-18).
 *
 * ⚠ THE FAILURE THIS FILE EXISTS FOR IS THE ABSENCE, NOT THE PRESENCE. Four shipped
 * features have gone silently missing the same way (see
 * `dopl-desktop-app/test/preload-parity.test.mjs`): a component feature-detects a bridge
 * capability, renders NOTHING when it is absent — the correct behaviour in a browser — and
 * so nobody notices when the bridge never grew the capability. The desktop half is pinned
 * over there; this is the renderer half, and it asserts BOTH directions: no button without
 * the bridge, a working button with it.
 *
 * ⚠ AND IT ASSERTS THE HEADER PLACEMENT, because the button is only correct in the THREAD
 * view — the channel view has no thread to pop out, and a button that pops out "the current
 * transcript" from there would open a window on nothing.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// The composer is a WRITE surface with its own mutation stack (and its own suite). What is
// under test here is the pane's HEADER, so it is mocked out rather than given a query
// client — the same reasoning `channels-v2-core.test.tsx` uses for its panes.
vi.mock("./composer", () => ({
  ChannelsV2Composer: () => null,
}));

import { PopOutThreadButton, POP_OUT_THREAD_LABEL } from "./pop-out";
import { ChannelsV2MessagePane } from "./message-pane";
import { indexMembers } from "./view-model";
import { member, ME } from "./test-fixtures";
import type { ChannelThread } from "../../types";

afterEach(() => {
  cleanup();
  delete (window as unknown as { dopl?: unknown }).dopl;
});

const SEGMENT = "acme-a1b2";
const CH = "44444444-4444-4444-8444-444444444444";
const TH = "t-1";

function withBridge(openWindow: (...args: string[]) => Promise<{ ok: boolean }>) {
  (window as unknown as { dopl?: unknown }).dopl = { threads: { openWindow } };
}

describe("the pop-out button", () => {
  it("renders NOTHING in a plain browser — there is no window to open", () => {
    render(
      <PopOutThreadButton workspaceSlug={SEGMENT} channelId={CH} threadId={TH} />
    );
    expect(screen.queryByRole("button", { name: POP_OUT_THREAD_LABEL })).toBeNull();
  });

  it("renders NOTHING against a desktop build whose preload predates the op", () => {
    // An older main exposes `dopl` with no `threads` namespace. Feature detection is on the
    // OP, never on the bridge being truthy.
    (window as unknown as { dopl?: unknown }).dopl = { sessions: { reopen: () => {} } };
    render(
      <PopOutThreadButton workspaceSlug={SEGMENT} channelId={CH} threadId={TH} />
    );
    expect(screen.queryByRole("button", { name: POP_OUT_THREAD_LABEL })).toBeNull();
  });

  it("renders in the desktop shell and hands main the three ids, in order", () => {
    const openWindow = vi.fn(async () => ({ ok: true }));
    withBridge(openWindow);
    render(
      <PopOutThreadButton workspaceSlug={SEGMENT} channelId={CH} threadId={TH} />
    );
    const button = screen.getByRole("button", { name: POP_OUT_THREAD_LABEL });
    fireEvent.click(button);
    expect(openWindow).toHaveBeenCalledWith(SEGMENT, CH, TH);
  });

  it("swallows a refusal — main already said which one it was, in its own log", async () => {
    // `{ ok: false }` covers a rejected id, a blocking version floor and a full window
    // budget alike, so there is no honest sentence to show. A REJECTED promise must not
    // surface as an unhandled rejection in a header.
    const openWindow = vi.fn(() => Promise.reject(new Error("refused")));
    withBridge(openWindow as never);
    render(
      <PopOutThreadButton workspaceSlug={SEGMENT} channelId={CH} threadId={TH} />
    );
    expect(() =>
      fireEvent.click(screen.getByRole("button", { name: POP_OUT_THREAD_LABEL }))
    ).not.toThrow();
    await Promise.resolve();
  });
});

// ── Where it appears ─────────────────────────────────────────────────────────

const THREAD: ChannelThread = {
  id: TH,
  channelId: CH,
  title: "Ship the release",
  status: "open",
  createdAt: "2026-08-18T10:00:00.000Z",
  updatedAt: "2026-08-18T10:00:00.000Z",
} as ChannelThread;

function renderPane(thread: ChannelThread | null) {
  const index = indexMembers([member({ userId: ME })], ME);
  return render(
    <ChannelsV2MessagePane
      channelId={CH}
      workspaceId="ws-1"
      channelName="general"
      thread={thread}
      rows={[]}
      index={index}
      members={[]}
      loading={false}
      requested={new Set()}
      scrollTarget={null}
      infoOpen={false}
      gate={{ settleWith: (p: unknown) => p } as never}
      popOut={
        <PopOutThreadButton workspaceSlug={SEGMENT} channelId={CH} threadId={TH} />
      }
      onToggleInfo={() => {}}
      onExitThread={() => {}}
      onOpenThread={() => {}}
    />
  );
}

describe("the header slot", () => {
  it("shows the button in the THREAD view", () => {
    withBridge(vi.fn(async () => ({ ok: true })));
    renderPane(THREAD);
    expect(screen.getByRole("button", { name: POP_OUT_THREAD_LABEL })).toBeTruthy();
  });

  it("does NOT show it in the channel view — there is no thread to pop out", () => {
    withBridge(vi.fn(async () => ({ ok: true })));
    renderPane(null);
    expect(screen.queryByRole("button", { name: POP_OUT_THREAD_LABEL })).toBeNull();
  });
});
