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
 *
 * ⚠ THE PLACEMENT IS NOW AN ORDER, NOT ONLY A PRESENCE (Samuel, 2026-08-19). It sat beside
 * the breadcrumb until then, on the left of a header whose right side held the whole
 * channel-management cluster. The cluster moved to the Settings tab, and this button moved
 * to where it acts: immediately LEFT of the info toggle, wearing the same `IconButton`
 * face. A test that only asked "is it in the header" would stay green through the move.
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

  it("sits immediately LEFT of the info toggle, and is its LAST left-hand neighbour", () => {
    withBridge(vi.fn(async () => ({ ok: true })));
    renderPane(THREAD);
    const popOut = screen.getByRole("button", { name: POP_OUT_THREAD_LABEL });
    const info = screen.getByRole("button", { name: "Channel info" });
    expect(popOut.nextElementSibling).toBe(info);
  });

  it("matches the info toggle's GLYPH SIZE, and deliberately not its face", () => {
    // A 14px glyph in a 15px button reads as a smaller control beside it, which
    // is exactly what it looked like while it lived beside the crumb. THAT is
    // the parity this case was written for and it still holds.
    //
    // ⚠ THE FACE PARITY IS BROKEN ON PURPOSE (Samuel, 2026-08-25): the info
    // toggle is `bits.tsx › IconButton`'s `bare` variant — no circle, no fill,
    // no border, resting or pressed — while the pop-out keeps the header's
    // chrome face. Asserted as a DIFFERENCE rather than deleted, because
    // "restore the shared face" is the one-line change that would silently put
    // a button back around a control Samuel asked to have none.
    withBridge(vi.fn(async () => ({ ok: true })));
    renderPane(THREAD);
    const popOut = screen.getByRole("button", { name: POP_OUT_THREAD_LABEL });
    const info = screen.getByRole("button", { name: "Channel info" });
    const size = (el: Element) => el.querySelector("svg")?.getAttribute("width");
    expect(size(popOut)).toBe(size(info));
    expect(popOut.className).not.toBe(info.className);
    // The toggle paints nothing: no radius, no resting or hover surface, and no
    // `.raised-tab` on the pressed state.
    expect(info.className).not.toMatch(/rounded-|bg-|raised-tab/);
    // …and the pop-out beside it still does.
    expect(popOut.className).toMatch(/rounded-\[7px\]/);
  });

  it("leaves NOTHING else on the right of the header", () => {
    // The action cluster (settings / folder / invite / kebab) moved to the
    // Settings tab and the inert sparkle was deleted outright — a decorative
    // button with no handler is not a feature to rehome (Samuel, 2026-08-19).
    withBridge(vi.fn(async () => ({ ok: true })));
    renderPane(THREAD);
    for (const gone of [
      "Ask the assistant",
      "Channel actions",
      "Channel settings",
      "Add members",
      "Agent folder",
    ]) {
      expect(screen.queryByRole("button", { name: gone })).toBeNull();
    }
    // The crumb's bookmark STAYS — and since 2026-08-19 it is the real
    // favourite toggle, so it names the channel rather than saying "channel"
    // (`message-pane.test.tsx › the header's favourite toggle` owns its states).
    expect(screen.getByRole("button", { name: "Bookmark general" })).toBeTruthy();
  });
});
