// @vitest-environment jsdom
/**
 * 🔒 **THE PANE HEADER DRAWS NO HASHTAG GLYPH** (Samuel, 2026-09-16).
 *
 * ⚠ **A DELETION NEEDS A TEST MORE THAN AN ADDITION DOES.** Nothing else in this
 * tree fails when a decorative icon comes back — it typechecks, it lints, it
 * renders — so the only thing standing between this ruling and the next person
 * who thinks a channel header looks bare is this file.
 *
 * ⚠ **BOTH CHROMES, IN ONE SUITE, BECAUSE THE RULING IS THAT THEY MATCH.** The
 * page header and the pop-out window each carried their own `Hash`; putting the
 * two cases side by side is what stops one of them growing it back alone.
 *
 * ⚠ THE SIDEBAR'S GLYPH IS NOT IN SCOPE and must not be removed with it — it is
 * a channel MARK in a list of rooms, where this one sat in front of a title the
 * crumb had already said.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { PaneHeader } from "./message-pane-header";

afterEach(cleanup);

function mount(chrome: "page" | "window", threadTitle: string | null) {
  return render(
    <PaneHeader
      channelName="Website"
      threadTitle={threadTitle}
      favorited={false}
      chrome={chrome}
      onToggleFavorite={vi.fn()}
      onExitThread={vi.fn()}
    />
  );
}

/** lucide stamps its icon name on the rendered `svg`. */
const hashes = (c: HTMLElement) => c.querySelectorAll(".lucide-hash").length;

describe("the hashtag glyph", () => {
  it("is absent from the PAGE header, in channel view and in a thread", () => {
    const channelView = mount("page", null);
    expect(hashes(channelView.container)).toBe(0);
    expect(channelView.getByText("Website")).toBeTruthy();
    cleanup();
    const threadView = mount("page", "Deploy check");
    expect(hashes(threadView.container)).toBe(0);
    expect(threadView.getByText("Deploy check")).toBeTruthy();
  });

  it("is absent from the POP-OUT window's header too", () => {
    const { container, getByText } = mount("window", "Deploy check");
    expect(hashes(container)).toBe(0);
    expect(getByText("Deploy check")).toBeTruthy();
  });
});
