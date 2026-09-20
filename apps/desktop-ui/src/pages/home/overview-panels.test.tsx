import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts } from "#/lib/dopl-bridge";
import { USER_ID, bridgeCalls, installBridge, ok } from "#/test-utils/bridge";
import { renderHome, routes } from "./home-test-harness";

/**
 * /home → OVERVIEW — the account surface's analytics face (2026-09-01, rebuilt
 * the same day after Samuel's live review).
 *
 * ⚠ WHAT THIS SUITE OWNS is the STRUCTURE Samuel asked for, not the arithmetic:
 * the page OPENS on this face and it renders exactly ONE of each section. The
 * tallies are pinned server-side in
 * `src/features/home/server/service-overview.test.ts`.
 *
 * 🔒 **THE ACTIVITY PANEL IS GONE ENTIRELY (Samuel, 2026-09-20 — he saw it in
 * the app and ruled it out).** Its cases — the board's channel grouping, the
 * lane that drops when nothing runs in it, and the two jump cases — are DELETED
 * rather than skipped, and ONE REGRESSION stands in their place: neither the
 * panel nor the **Active agents** heading may come back on this face.
 * ⚠ **WHAT THE DELETED CASES USED TO COVER STILL HAS A HOME.** The board itself
 * is the WORKSPACE Overview's now (`pages/overview/agent-board.test.tsx`), and
 * /home's jump — selection + face + `seq`/thread, keyed by row — is pinned by
 * the SEARCH popup's suite (`home-search-popup.test.tsx`), which is the only
 * caller of `use-activity-jump.ts › open` left.
 *
 * ⚠ **`Waiting on you` AND `Recent threads` WERE CUT ON 2026-09-05** (Samuel:
 * Activity carries running agents and nothing else). Their regression stands
 * below too — the headings must not come back on a face that no longer even has
 * the panel they lived in.
 *
 * ⚠ THE CHANNEL SURFACE IS STUBBED, like every other suite on this page.
 */

const apiRequest = vi.hoisted(() => vi.fn());

vi.mock(
  "@/features/channels/components/channel-surface-standalone",
  () => ({
    // ⚠ STUBBED ONLY SO A RAISED CHANNEL FACE COSTS THIS SUITE NOTHING — the
    // selection case below raises it. `initialThreadId` is still reflected, but
    // the case that ASSERTED it was the Activity board's jump and is deleted
    // (2026-09-20); `home-search-popup.test.tsx` carries that assertion now.
    StandaloneChannelSurface: (props: { initialThreadId?: string | null }) => (
      <div
        data-testid="channel-surface"
        data-thread={props.initialThreadId ?? ""}
      />
    ),
  })
);

const overviewCalls = () =>
  bridgeCalls(apiRequest).filter((call) =>
    call.path.startsWith("/api/home/overview?")
  );

/** A PANEL by its heading (Samuel's layout ruling, 2026-09-01).
 *  ⚠ **ONLY `Usage` AND `All channels` ARE FIRST-PAINT GATES.** They draw their
 *  own ghost; Token spend folds away until a row exists, so awaiting IT proves
 *  DATA rather than that the face is up. Use {@link loadedFace} for the latter.
 *  (`Activity` was the other folding panel and is deleted — 2026-09-20.) */
const panel = (name: string) => screen.findByRole("region", { name });

/** The face WITH ITS DATA. ⚠ Gated on a rail heading, which only exists once
 *  `/api/home/overview` has answered — the panels themselves are up before it. */
async function loadedFace(): Promise<void> {
  await screen.findByRole("heading", { name: "Credits by channel" });
}

describe("home overview face", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockImplementation(
      (path: string, opts: BridgeRequestOpts = {}) =>
        routes(path, opts) ??
        Promise.reject(new Error(`unexpected request: ${path}`))
    );
    installBridge({
      apiRequest: (path: string, opts: BridgeRequestOpts = {}) =>
        apiRequest(path, opts),
      getAuthState: () => Promise.resolve({ signedIn: true, userId: USER_ID }),
      onAuthState: () => () => {},
      openExternal: () => Promise.resolve({ ok: true }),
    });
  });

  /**
   * ⚠ **THE PAGE OPENS ON OVERVIEW (Samuel, 2026-09-01)** — the landing moved
   * off Channels. Order is asserted beside it because they are two decisions
   * (`home-tabs.ts` states them separately) and this is the test that would
   * catch one silently following the other.
   */
  it("opens on Overview, leftmost of the four faces", async () => {
    renderHome();
    expect(
      await screen.findByRole("tab", { name: "Overview", selected: true })
    ).toBeInTheDocument();
    // ⚠ THE FIRST FOUR, not every tab on the page: the Overview face itself
    // renders a `SegmentedControl` (the chart's metric switcher), whose options
    // are also `role="tab"`. The FACE row is the page header's, and it is first
    // in document order.
    expect(
      screen.getAllByRole("tab").slice(0, 4).map((tab) => tab.textContent)
    ).toEqual(["Overview", "Channel", "Knowledge", "Agents"]);
  });

  /**
   * 🔒 **THE DUPLICATION FIX, PINNED AS A COUNT.** The face used to stack an
   * account-wide panel over a channel-scoped one built from the same components,
   * so an operator with ONE home channel saw every section rendered twice from
   * two payloads that were identical by construction. There is one payload now
   * and there must be exactly one of each section.
   */
  it("renders exactly ONE of each section — no channel-scoped duplicate", async () => {
    renderHome();
    await loadedFace();

    // ⚠ TWO REGIONS, NOT THREE — `Activity` left the list on 2026-09-20 and its
    // absence is asserted in its own case below, not by an omission here.
    for (const region of ["Usage", "All channels"]) {
      expect(screen.getAllByRole("region", { name: region })).toHaveLength(1);
    }
    // ⚠ **`Credits used` WAS ON THIS LIST UNTIL 2026-09-13** — the histogram's
    // heading was deleted for Samuel's scope dropdown, so the card is counted by
    // its own region name now (and the ABSENCE is pinned below).
    expect(
      screen.getAllByRole("region", { name: "Usage histogram" })
    ).toHaveLength(1);
    // The rails, too — these were the visibly doubled ones.
    for (const rail of [
      "Credits by channel",
      "Messages by channel",
      "Credit usage by person",
      "Top MCP tools",
    ]) {
      expect(screen.getAllByRole("heading", { name: rail })).toHaveLength(1);
    }
  });

  /** 🔒 The client may no longer ASK for a scoped payload — the param is the
   *  other half of the duplicate render. */
  it("never sends a workspaceId, and asks for the month", async () => {
    renderHome();
    await loadedFace();
    await waitFor(() => expect(overviewCalls().length).toBeGreaterThan(0));

    expect(
      overviewCalls().every((call) => !call.path.includes("workspaceId="))
    ).toBe(true);
    expect(overviewCalls().map((call) => call.path)).toContain(
      "/api/home/overview?range=month"
    );
  });

  /** 🔒 Selecting a different channel must not refetch or repaint this face —
   *  it is cross-channel, so its pane token carries no row. */
  it("does NOT re-read when the left list's selection moves", async () => {
    renderHome();
    await loadedFace();
    await waitFor(() => expect(overviewCalls()).toHaveLength(1));

    fireEvent.click(await screen.findByText("Link out"));

    // Still one read, and the face is still on screen. ⚠ Gated on `Usage`
    // since 2026-09-20: `Activity` was the panel this line used to name.
    await waitFor(() => expect(overviewCalls()).toHaveLength(1));
    expect(await panel("Usage")).toBeInTheDocument();
  });

  /** ⚠ THE STAT TILES ARE GONE ENTIRELY (Samuel) — not hidden, not collapsed. */
  it("shows no stat tiles", async () => {
    renderHome();
    await loadedFace();

    for (const label of ["Agent sessions", "Tokens", "Active channels"]) {
      expect(screen.queryByText(label)).toBeNull();
    }
    // …and no cross-channel/this-channel toggle survives either.
    expect(screen.queryByRole("tab", { name: "This channel" })).toBeNull();
  });

  /**
   * 🔒 **THE TWO PANES ARE GONE ENTIRELY (Samuel, 2026-09-05)** — not hidden and
   * not collapsed, exactly as the stat tiles above. Activity carries running
   * agents and nothing else.
   */
  it("shows no Waiting on you and no Recent threads", async () => {
    renderHome();
    await loadedFace();

    for (const heading of ["Waiting on you", "Recent threads"]) {
      expect(screen.queryByRole("heading", { name: heading })).toBeNull();
    }
  });

  /**
   * 🔒 **THE ACTIVITY PANEL IS NOT ON THIS FACE AT ALL (Samuel, 2026-09-20).**
   * It used to FOLD AWAY when no agent was running, which is what this case
   * asserted; it is now deleted outright — panel, **Active agents** board, the
   * `onOpenActivity` prop and the `HomeOverview.agents` read behind it. **Delete,
   * never disarm**, so the assertion is absence on the LOADED face rather than
   * absence under an empty payload: there is no payload key left that could
   * bring it back.
   * ⚠ **THE BOARD COMPONENT IS NOT WHAT THIS FORBIDS** — it lives in
   * `#/components/overview/agent-board.tsx` and the WORKSPACE Overview still
   * hosts it (`pages/overview/agent-board.test.tsx`). What is forbidden is a
   * SECOND host, here.
   */
  it("renders no Activity panel and no Active agents board", async () => {
    renderHome();
    await loadedFace();

    expect(screen.queryByRole("region", { name: "Activity" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Active agents" })).toBeNull();
    // ⚠ AND THE REST OF THE FACE IS UNTOUCHED — the panel was removed, it did
    // not take the page with it.
    expect(await panel("Usage")).toBeInTheDocument();
    expect(await panel("All channels")).toBeInTheDocument();
  });

  /**
   * ⚠ **THE BAR'S OWN THREE CASES MOVED OUT ON 2026-09-06** — what it says, what
   * it reads and its degraded arm now live in `./overview-credit-bar.test.tsx`,
   * which carries why. What stays here is STRUCTURAL: the bar and the plot are
   * in the Usage panel and the rails are not.
   */

  /**
   * 🔒 **THE USAGE PANEL HOLDS EXACTLY TWO THINGS — THE BAR, THEN THE
   * HISTOGRAM** (Samuel, verbatim: "I said Usage panel has the usage bar and
   * the histogram. That's it"). The four rails lived inside it for one pass;
   * they are their own panel now, and this asserts BOTH halves so neither drifts
   * back.
   */
  it("puts the bar and the histogram in Usage, and the rails outside it", async () => {
    renderHome();
    await loadedFace();
    const usage = await panel("Usage");

    expect(
      within(usage).getByRole("region", { name: "Credit allowance" })
    ).toBeInTheDocument();
    expect(
      within(usage).getByRole("region", { name: "Usage histogram" })
    ).toBeInTheDocument();
    for (const rail of [
      "Credits by channel",
      "Messages by channel",
      "Credit usage by person",
      "Top MCP tools",
    ]) {
      expect(within(usage).queryByRole("heading", { name: rail })).toBeNull();
    }

    // …and they really are on the page, one panel down.
    const breakdown = await panel("All channels");
    expect(
      within(breakdown).getByRole("heading", { name: "Credits by channel" })
    ).toBeInTheDocument();
  });

  /**
   * 🔒 **THE CHART IS CREDITS AND HAS NO METRIC SWITCHER** (Samuel, verbatim:
   * "I explicitly said not to do MCP calls but credits. Why is there a MCP
   * option"). The face asks for exactly one series.
   */
  it("charts CREDITS for the month, with no MCP or Messages option", async () => {
    renderHome();
    await panel("Usage");

    await waitFor(() =>
      expect(
        bridgeCalls(apiRequest).some(
          (call) =>
            call.path === "/api/home/overview-series?range=month&metric=credits"
        )
      ).toBe(true)
    );
    expect(
      bridgeCalls(apiRequest).some(
        (call) =>
          call.path.includes("metric=mcp") ||
          call.path.includes("metric=messages")
      )
    ).toBe(false);

    // No pills on this chart at all — the face's only tabs are its four faces.
    const usage = await panel("Usage");
    expect(within(usage).queryByRole("tab")).toBeNull();
  });

  /**
   * 🔒 **AN EMPTY LEDGER STILL DRAWS THE WHOLE MONTH (Samuel: he wants to SEE
   * the month).** The series zero-fills every day rather than answering an empty
   * array, so the axis is the frame and the page never loses its chart. This
   * asserted the OPPOSITE for one pass — "nothing yet" instead of bars — which
   * is how the chart disappeared on his machine.
   */
  it("draws a full month of bars even when every day is zero", async () => {
    const zeroed = {
      range: "month",
      metric: "credits",
      bucket: "day",
      points: Array.from({ length: 30 }, (_, i) => ({
        at: `2026-09-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
        count: 0,
      })),
      truncated: false,
    };
    apiRequest.mockImplementation((path: string, opts: BridgeRequestOpts = {}) =>
      path.split("?")[0] === "/api/home/overview-series"
        ? Promise.resolve(ok(zeroed))
        : (routes(path, opts) ?? Promise.reject(new Error(`unexpected: ${path}`)))
    );
    renderHome();
    const usage = await panel("Usage");

    // The axis is drawn: one captioned column per day, and NOT the empty arm.
    await waitFor(() =>
      expect(within(usage).queryByText("Nothing yet.")).toBeNull()
    );
    // ⚠ BY BAR TITLE, not by caption: the axis only captions every Nth bin, so
    // the first day carries no visible label. Every BAR has a `label · value`
    // title, which is what proves all 30 bins are drawn.
    expect(within(usage).getByTitle("9/1 · 0")).toBeInTheDocument();
    expect(within(usage).getByTitle("9/30 · 0")).toBeInTheDocument();
  });

  /** 🔒 The guest mark survived the swap from calls to credits — it is the
   *  reason this rail exists, and the figure is a real cost now. */
  it("marks guests in the by-person rail and subtotals their credits", async () => {
    renderHome();
    await loadedFace();
    const breakdown = await panel("All channels");

    const rail = within(breakdown)
      .getByRole("heading", { name: "Credit usage by person" })
      .closest("section") as HTMLElement;
    expect(within(rail).getByText("Guest")).toBeInTheDocument();
    expect(within(rail).getByText(/1 guest · 12/)).toBeInTheDocument();
  });
  /**
   * 🔒 **ONE GRAY WELL BEHIND THE WHOLE USAGE BLOCK, AND THE 2026-09-08 WHITE
   * TRIAL IS REVERTED (Samuel, 2026-09-13: *"the usage panel doesn't have the
   * gray shadow anymore. I want you to restore the gray shadow behind the usage
   * panel. This will be one gray shadow right behind this"*).**
   *
   * ⚠ **THE ASSERTION IS THE ABSENCE OF AN OVERRIDE, WHICH IS THE ONLY THING
   * THIS SUITE CAN SEE.** The gray itself is a Tailwind utility jsdom does not
   * paint (`shared/ui/section-panel.tsx › SECTION_PANEL_GROUND`, the component's
   * own ground since R-38), so what is pinned is (1) the panel still carries the
   * `data-section-panel` hook a page override would key on and (2) no
   * `!bg-home-card` is forcing it white. Those two together are what the trial
   * changed.
   *
   * 🔒 **AND TWO WHITE `.bento` CARDS INSIDE IT WITH A GAP (Samuel: *"I want the
   * credits bar and the bar graph to be split into two different white panels
   * with some spacing between them"*)** — it was one card holding both.
   */
  it("grounds Usage in ONE well and splits it into two bento cards", async () => {
    renderHome();
    const usage = await panel("Usage");

    expect(usage).toHaveAttribute("data-section-panel");
    expect(usage.className).not.toContain("bg-home-card");

    const cards = [
      within(usage).getByRole("region", { name: "Credit allowance" }),
      within(usage).getByRole("region", { name: "Usage histogram" }),
    ];
    for (const bento of cards) expect(bento.className).toContain("bento");
    // ⚠ THE GAP IS THE RAILS' OWN `gap-3`, on the one element that holds both
    // cards — so the three panels on this face space identically.
    const holder = cards[0].parentElement as HTMLElement;
    expect(holder).toBe(cards[1].parentElement);
    expect(holder.className).toContain("gap-3");
    // ⚠ AND NOTHING ELSE IS IN THE WELL.
    expect(holder.children).toHaveLength(2);
  });

  /**
   * 🔒 **THE TWO WORDS SAMUEL REMOVED, PINNED AS ABSENCES (2026-09-13: *"remove
   * the credits and the 'Credits used' text"*).** The meter's `Credits` label and
   * the histogram's `Credits used` heading are both gone; the NUMBERS they stood
   * beside are not. ⚠ A heading query alone would not catch the meter's label,
   * and a text query alone would not catch a heading that came back as a `h3`, so
   * this asserts both shapes.
   */
  it("carries no Credits label and no Credits used heading", async () => {
    renderHome();
    const usage = await panel("Usage");
    // ⚠ WAIT ON THE CAPTION ROW, NOT ON A `credits spent` SENTENCE — that line was
    // deleted on 2026-09-13 (Samuel: *"under the bar … '0 of 500 credits spent'.
    // Can you remove that line"*); `overview-credit-bar.test.tsx` pins its absence.
    await within(usage).findByText(/ left$/);

    expect(within(usage).queryByText("Credits")).toBeNull();
    expect(within(usage).queryByText("Credits used")).toBeNull();
    expect(
      within(usage).queryByRole("heading", { name: "Credits used" })
    ).toBeNull();
    // The measurement is untouched — the meter's pair and the plot's total.
    expect(within(usage).getByText("320 / 500")).toBeInTheDocument();
    expect(within(usage).getByText("210")).toBeInTheDocument();
  });
});
