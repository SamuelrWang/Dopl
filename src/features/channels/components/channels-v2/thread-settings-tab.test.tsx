// @vitest-environment jsdom
/**
 * THE RIGHT PANEL'S SETTINGS TAB WHILE A THREAD IS OPEN (Samuel, 2026-08-21).
 *
 * ⚠ WHAT THIS SUITE IS ACTUALLY GUARDING is that the tab stays SMALL and stays
 * HONEST. A thread has exactly two settings — the mode and whether it exists —
 * and the two ways this surface goes wrong are (a) growing the channel tab's rows
 * back into it, and (b) rendering a control the server will refuse.
 *
 * The rules, each pinned below:
 *  - **NO DEAD ROWS** (INVARIANTS §5). Mode is CREATOR-only because
 *    `service-tasks.ts › setTaskMode` is; Delete is creator-or-manager because
 *    `service-tasks-delete.ts` is. A reader entitled to neither gets the empty
 *    state, not a heading over greyed-out controls.
 *  - **NO CHANNEL ROWS.** Invite / visibility / archive / leave belong to
 *    `settings-tab.tsx` and must not reappear here at a scope where they mean
 *    nothing.
 *  - **NO CLOSE, NO STATUS, NO OUTCOME.** A thread has no finished state, and
 *    Delete is not one wearing a new word — a "Mark done" here would be thread
 *    closing coming back through the settings tab.
 *  - **THE DESTRUCTIVE ROW REPORTS INTENT.** It opens `thread-manage.tsx`'s
 *    confirm dialog; this file never deletes, exactly as `settings-tab.tsx` never
 *    does.
 *  - **MINIMAL COPY** (Samuel, 2026-08-19, still binding): a name plus a control.
 *    The word bound below goes red for a new explainer under any control,
 *    including one nobody thought to forbid — the same measurement
 *    `settings-tab.test.tsx › a settings panel, not documentation` makes.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChannelsV2ThreadSettingsTab } from "./thread-settings-tab";
import { thread as makeThread } from "./test-fixtures";
import type { ChannelThread } from "../../types";

afterEach(cleanup);

const noop = () => {};

function mount(
  over: {
    thread?: Partial<ChannelThread>;
    canSetMode?: boolean;
    canDelete?: boolean;
    onSetMode?: (mode: ChannelThread["mode"]) => void;
    onRequestDelete?: () => void;
  } = {}
) {
  return render(
    <ChannelsV2ThreadSettingsTab
      thread={makeThread(over.thread)}
      canSetMode={over.canSetMode ?? true}
      canDelete={over.canDelete ?? true}
      onSetMode={over.onSetMode ?? noop}
      onRequestDelete={over.onRequestDelete ?? noop}
    />
  );
}

describe("the thread Settings tab", () => {
  it("is the thread's two controls and nothing else", () => {
    mount();
    expect(screen.getByText("Thread")).toBeTruthy();
    expect(screen.getByText("Mode")).toBeTruthy();
    expect(screen.getByText("Delete thread")).toBeTruthy();

    // ⚠ The CHANNEL tab's rows are the ones most likely to be copied in here by
    // somebody "completing" the surface. They mean nothing at thread scope.
    const text = document.body.textContent ?? "";
    for (const absent of [
      "Add members",
      "Make private",
      "Make public",
      "Archive",
      "Leave channel",
      "Delete channel",
      "Always allow",
    ]) {
      expect(text).not.toContain(absent);
    }
  });

  /** ⚠ A thread has NO finished state (INVARIANTS §5). Deleting is not closing,
   *  and a word from that family appearing here is the regression. */
  it("offers no close, no status and no outcome", () => {
    mount();
    const text = (document.body.textContent ?? "").toLowerCase();
    for (const absent of ["close", "reopen", "status", "outcome", "mark done"]) {
      expect(text).not.toContain(absent);
    }
  });

  it("shows Mode to the creator alone", () => {
    mount({ canSetMode: false });
    expect(screen.queryByText("Mode")).toBeNull();
    expect(screen.getByText("Delete thread")).toBeTruthy();
  });

  it("shows Delete to whoever may delete alone", () => {
    mount({ canDelete: false });
    expect(screen.getByText("Mode")).toBeTruthy();
    expect(screen.queryByText("Delete thread")).toBeNull();
  });

  /** Neither gate open: the empty state, never a heading over nothing. */
  it("gives a reader with neither permission the empty state", () => {
    mount({ canSetMode: false, canDelete: false });
    expect(screen.queryByText("Thread")).toBeNull();
    expect(screen.getByText("Nothing to manage")).toBeTruthy();
  });

  /** ⚠ INTENT ONLY. The row must not write — `thread-manage.tsx` owns the dialog
   *  and the mutation, exactly as `channel-manage.tsx` does for the channel. */
  it("reports the delete intent instead of deleting", () => {
    const onRequestDelete = vi.fn();
    mount({ onRequestDelete });
    fireEvent.click(screen.getByText("Delete thread"));
    expect(onRequestDelete).toHaveBeenCalledTimes(1);
  });

  /** The control renders the CURRENT mode, in the same words the Info tab reads
   *  it out in — one label map, two surfaces (`constants.ts ›
   *  THREAD_MODE_LABELS`). */
  it("renders the thread's current mode", () => {
    mount({ thread: { mode: "autonomous" } });
    expect(screen.getByText("Autonomous")).toBeTruthy();
  });

  /**
   * ⚠ A MEASUREMENT, NOT A COPY LIST. Every `text-caption` node on the tab is
   * bounded at 8 words with no mid-string sentence break, so a new explainer
   * paragraph goes red whichever control it is bolted under.
   */
  it("is a settings panel, not documentation", () => {
    mount();
    for (const node of document.querySelectorAll(".text-caption")) {
      const text = (node.textContent ?? "").trim();
      expect(text.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(8);
      expect(text).not.toMatch(/\.\s+\S/);
    }
  });
});
