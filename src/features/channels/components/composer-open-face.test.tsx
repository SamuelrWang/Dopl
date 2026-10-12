// @vitest-environment jsdom
/**
 * **A GLYPH WHOSE POPUP IS OPEN IS THE BLACK ROUNDED SQUARE** (Samuel, 2026-10-12, item 4:
 * *"while their popup is OPEN, today they become a circle. Instead show a ROUNDED SQUARE, black
 * fill, white icon … Closed state stays as today"*).
 *
 * ⚠ **THIS IS ITS OWN FILE BECAUSE THE SUBJECT IS ITS OWN** (§1's seam). The three glyphs reach
 * their open state through three UNRELATED mechanisms — a toggle's own state, a dialog reporting
 * up, a derivation off the draft — and the property under test is that all three land on ONE
 * face. `composer-toolbar.test.tsx` is about the ROW's geometry and `composer-launch.test.tsx`
 * sits at the 500-line cap; neither is where a reader would look for this.
 *
 * ⚠ **WHAT FAILED, AND WHY A CLASS ASSERTION IS THE RIGHT FORM.** The reported circle on New
 * thread and Mention was never a pressed state at all — those two carried none, so what Samuel
 * saw while their popup was up was `icon-button.tsx`'s HOVER fill under the toolbar's
 * `rounded-full`, with the cursor still on the glyph that opened it. jsdom loads no stylesheet
 * and paints no `:hover`, so the only observable form of "the open face wins over the hover
 * fill" is the declaration itself: the open glyph must carry the CTA fill AT the `hover:`
 * variant, because tailwind-merge keeps `hover:bg-*` independently of `bg-*` and the resting
 * `hover:bg-surface-raised-1` would otherwise survive underneath it.
 *
 * ⚠ **EVERY CASE IS OPEN *AND* CLOSED.** "Closed state stays as today" is half the ruling, and a
 * test that only looked at the open face would pass on a glyph that had become a permanent black
 * square.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../hooks/use-thread-writes", () => ({
  useThreadWrites: () => ({
    send: { mutate: vi.fn() },
    fanOutThreads: { mutate: vi.fn() },
    pending: false,
  }),
}));

vi.mock("@/features/agent-identities/hooks/use-agent-identities", () => ({
  useAgentIdentities: () => ({
    identities: [],
    loading: false,
    error: null,
    resolved: true,
    refetch: () => {},
  }),
}));

import { ChannelsComposer } from "./composer";
import type { AgentLaunchControls } from "./use-agents-panel";
import { member, CHANNEL_ID, ME, PEER } from "./test-fixtures";

const MEMBERS = [
  member({ userId: ME, displayName: "Sam Wang" }),
  member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
];

/** A real id by `main/agent-id.js`'s charset — a letter, then seven of [a-z0-9]. */
const MINTED = "k3v7d2mq";

/** ⚠ `apiRequest` IS THE SPA MARKER (`spa-bridge.ts › getSpaBridge`): without it the whole bridge
 *  reads as absent and the Bot glyph never renders. */
function stubBridge() {
  (window as { dopl?: unknown }).dopl = {
    apiRequest: () => Promise.resolve({ status: 200, statusText: "OK", hasBody: false }),
    sessions: {
      mintAgentId: vi.fn().mockResolvedValue({ ok: true, agentId: MINTED }),
      rename: vi.fn().mockResolvedValue({ ok: true }),
      describe: vi.fn().mockResolvedValue({ ok: true }),
    },
  };
}

const LAUNCHER: AgentLaunchControls = {
  canLaunch: true,
  launchBusy: false,
  launchError: null,
  launchAgent: vi.fn().mockResolvedValue({ ok: true, agentId: MINTED }),
  approveIdentity: vi.fn().mockResolvedValue({ ok: true }),
};

beforeEach(stubBridge);
afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

function mount() {
  render(
    <ChannelsComposer
      channelId={CHANNEL_ID}
      workspaceId="ws-1"
      members={MEMBERS}
      currentUserId={ME}
      newAgent={LAUNCHER}
      gate={{ begin: vi.fn(), end: vi.fn() }}
    />
  );
}

const btn = (name: string) => screen.getByRole("button", { name });

/**
 * THE OPEN FACE, AS FOUR CLAIMS. ⚠ **`rounded-full`'s ABSENCE IS ONE OF THEM** — the whole
 * ruling is a square corner where a circle was, and the circle came from a class the glyph wears
 * in its closed state, so "it gained `rounded-[7px]`" is not enough: tailwind-merge resolves a
 * composed pair by string order and a face that carried both would still paint round.
 */
function expectOpenFace(el: HTMLElement) {
  const classes = el.className.split(/\s+/);
  // Black fill, white glyph — Samuel's two tokens, no gradient and no elevation.
  expect(classes).toContain("bg-surface-cta");
  expect(classes).toContain("text-text-on-cta");
  // A ROUNDED SQUARE: `icon-button.tsx`'s own radius, and NOT the closed state's circle.
  expect(classes).toContain("rounded-[7px]");
  expect(classes).not.toContain("rounded-full");
  // ⚠ THE RULING "the open face must win over the hover fill", in its only observable form.
  expect(classes).toContain("hover:bg-surface-cta");
  expect(classes).toContain("hover:text-text-on-cta");
  expect(classes).not.toContain("hover:bg-surface-raised-1");
  // ⚠ NO KIT RAISE UNDER IT — `.raised-tab` is a fill, a border and a shadow in one rule, and
  // the fill it supplies is what drew the circle on the one glyph that did have a pressed state.
  expect(classes).not.toContain("raised-tab");
  // The box does not move between the two faces (the row's 24px face, `composer-toolbar.test.tsx`).
  expect(classes).toContain("h-6");
  expect(classes).toContain("w-6");
}

/** THE CLOSED FACE: the circle, and the quiet hover fill, exactly as before. */
function expectClosedFace(el: HTMLElement) {
  const classes = el.className.split(/\s+/);
  expect(classes).toContain("rounded-full");
  expect(classes).not.toContain("bg-surface-cta");
  expect(classes).not.toContain("text-text-on-cta");
  expect(classes).toContain("hover:bg-surface-raised-1");
  expect(classes).toContain("h-6");
  expect(classes).toContain("w-6");
}

describe("the Agent glyph", () => {
  it("is the black square while its launch form is open, and the circle when it is not", async () => {
    mount();
    expectClosedFace(btn("New Agent"));

    fireEvent.click(btn("New Agent"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Launch" })).toBeTruthy());
    expectOpenFace(btn("New Agent"));

    // ⚠ IT IS A REAL TOGGLE — the only one of the three — so it keeps `aria-pressed`. The face
    // changed; the semantics did not.
    expect(btn("New Agent").getAttribute("aria-pressed")).toBe("true");
  });

  it("goes back to the circle when the form closes", async () => {
    mount();
    fireEvent.click(btn("New Agent"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Launch" })).toBeTruthy());
    fireEvent.click(btn("New Agent"));
    await waitFor(() => expect(btn("New Agent").getAttribute("aria-pressed")).toBe("false"));
    expectClosedFace(btn("New Agent"));
  });
});

describe("the Thread glyph", () => {
  it("is the black square while the new-thread dialog is open", async () => {
    mount();
    expectClosedFace(btn("New thread"));

    fireEvent.click(btn("New thread"));
    // ⚠ THE DIALOG REPORTS ITS OWN `open` FROM AN EFFECT (`new-thread-dialog.tsx ›
    // onOpenChange`), so the face lands one commit after the click — `waitFor`, not a bare read.
    await waitFor(() => expect(screen.getByLabelText("New thread title")).toBeTruthy());
    expectOpenFace(btn("New thread"));
  });

  it("stays a NON-toggle — the open face claims no `aria-pressed`", async () => {
    // ⚠ `composer-toolbar.tsx` states this: the glyph opens the dialog and cannot shut it from
    // behind its scrim, so painting the state must not start claiming it is a toggle.
    mount();
    fireEvent.click(btn("New thread"));
    await waitFor(() => expect(screen.getByLabelText("New thread title")).toBeTruthy());
    expect(btn("New thread").getAttribute("aria-pressed")).toBeNull();
  });

  it("goes back to the circle when the dialog is discarded", async () => {
    mount();
    fireEvent.click(btn("New thread"));
    await waitFor(() => expect(screen.getByLabelText("New thread title")).toBeTruthy());
    fireEvent.click(btn("Close new thread form"));
    await waitFor(() => expectClosedFace(btn("New thread")));
  });
});

describe("the Mention glyph", () => {
  it("is the black square while the @-popover is open", () => {
    mount();
    expectClosedFace(btn("Mention"));

    fireEvent.click(btn("Mention"));
    // The glyph writes an `@`, and the popover is a pure function of the draft.
    expect(screen.getByRole("listbox")).toBeTruthy();
    expectOpenFace(btn("Mention"));
  });

  it("lights for an `@` TYPED into the draft, not only for its own click", () => {
    // ⚠ THE FACE FOLLOWS THE POPOVER, AND THE POPOVER FOLLOWS THE DRAFT. A glyph that tracked
    // its own click would be dark with the list up — the exact disagreement the shared
    // derivation (`mentions.query !== null`) removes.
    mount();
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "ping @di" } });
    expectOpenFace(btn("Mention"));
  });

  it("goes back to the circle once the draft leaves the token", () => {
    mount();
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "ping @di" } });
    expectOpenFace(btn("Mention"));
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "ping" } });
    expectClosedFace(btn("Mention"));
  });
});
