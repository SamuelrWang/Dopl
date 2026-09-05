import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts } from "#/lib/dopl-bridge";
import { USER_ID, bridgeCalls, installBridge, ok } from "#/test-utils/bridge";
import { HOME_OVERVIEW, renderHome, routes } from "./home-test-harness";

/**
 * /home → OVERVIEW — the account surface's analytics face (2026-09-01, rebuilt
 * the same day after Samuel's live review).
 *
 * ⚠ WHAT THIS SUITE OWNS is the STRUCTURE Samuel asked for, not the arithmetic:
 * the page OPENS on this face, it renders exactly ONE of each section, the agent
 * board groups by channel, and every activity row jumps. The tallies are pinned
 * server-side in `src/features/home/server/service-overview.test.ts`.
 *
 * ⚠ **`Waiting on you` AND `Recent threads` WERE CUT ON 2026-09-05** (Samuel:
 * Activity carries running agents and nothing else). Their cases are gone and
 * two REGRESSIONS stand in their place — the headings must not come back, and
 * the Activity panel must FOLD AWAY rather than stand empty, which is what those
 * two cards used to hide.
 *
 * ⚠ THE CHANNEL SURFACE IS STUBBED, like every other suite on this page.
 */

const apiRequest = vi.hoisted(() => vi.fn());

vi.mock(
  "@/features/channels/components/channels-v2/channel-surface-standalone",
  () => ({
    // ⚠ `initialThreadId` IS REFLECTED, because it is the whole assertion of the
    // activity jump: the page hands the surface a thread to raise.
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
 *  ⚠ **`Activity` IS NO LONGER A FIRST-PAINT GATE.** `Usage` and `All channels`
 *  still draw their own ghost, but Activity lost its skeleton with its two cards
 *  on 2026-09-05 and now renders only once the payload has landed AND an agent is
 *  running — so awaiting it proves DATA, not that the face is up. Use
 *  {@link loadedFace} for the latter. */
const panel = (name: string) => screen.findByRole("region", { name });

/** A CARD inside a panel, by its heading. */
async function card(name: string): Promise<HTMLElement> {
  const heading = await screen.findByRole("heading", { name });
  return heading.closest("section") as HTMLElement;
}

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
    ).toEqual(["Overview", "Channels", "Knowledge", "Agents"]);
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

    for (const region of ["Activity", "Usage", "All channels"]) {
      expect(screen.getAllByRole("region", { name: region })).toHaveLength(1);
    }
    for (const heading of ["Active agents", "Credits used"]) {
      expect(screen.getAllByRole("heading", { name: heading })).toHaveLength(1);
    }
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

    // Still one read, and the face is still on screen.
    await waitFor(() => expect(overviewCalls()).toHaveLength(1));
    expect(await panel("Activity")).toBeInTheDocument();
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
   * 🔒 **AN EMPTY ACTIVITY PANEL DOES NOT RENDER AT ALL** (Samuel's ruling on
   * the cut, 2026-09-05). The board was already `null` for an empty lane set;
   * with the two cards gone there is nothing else in the panel, so the guard is
   * on the `SectionPanel` itself. ⚠ The alternative — a heading over an empty box
   * — is the exact defect the first Overview attempt was rejected for, and this
   * is the test that stops it coming back the next time something is added here.
   */
  it("hides the whole Activity panel when no agent is running", async () => {
    apiRequest.mockImplementation((path: string, opts: BridgeRequestOpts = {}) =>
      path.split("?")[0] === "/api/home/overview"
        ? Promise.resolve(ok({ ...HOME_OVERVIEW, agents: [] }))
        : (routes(path, opts) ?? Promise.reject(new Error(`unexpected: ${path}`)))
    );
    renderHome();
    await loadedFace();

    expect(screen.queryByRole("region", { name: "Activity" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Active agents" })).toBeNull();
    // ⚠ AND THE REST OF THE FACE IS UNTOUCHED — the panel folds away on its own,
    // it does not take the page with it.
    expect(await panel("Usage")).toBeInTheDocument();
    expect(await panel("All channels")).toBeInTheDocument();
  });

  /**
   * 🔒 **THE BOARD IS GROUPED BY CHANNEL** (Samuel), which is the whole reason
   * it is a board and not a list — and a channel with no live agent gets no
   * column at all.
   *
   * 🔒 **AND IT CARRIES NO TELEMETRY.** `model`, `tool_label`, `tokens_spent`
   * and the context pair are the OPERATOR-ONLY seven; a home container holds
   * another PERSON, and a peer learns THAT an agent is working, never what it
   * costs its operator.
   */
  it("groups active agents into one column per channel, with the thread on each card", async () => {
    renderHome();
    await loadedFace();
    const board = await card("Active agents");

    const lanes = within(board).getAllByRole("heading", { level: 4 });
    expect(lanes.map((lane) => lane.textContent)).toEqual([
      "Priya Shah",
      "Q3 Fundraise",
    ]);

    // The card says WHICH THREAD, and a channel-level launch says so instead.
    expect(within(board).getByText("Q3 renewals")).toBeInTheDocument();
    expect(within(board).getByText("Deck review")).toBeInTheDocument();
    expect(within(board).getByText("Channel")).toBeInTheDocument();
    // The closed `detail` vocabulary in words — never the raw key.
    expect(within(board).getByText("Thinking")).toBeInTheDocument();
    expect(within(board).queryByText("thinking")).toBeNull();
    // A peer's session is MARKED, and the mark is a boolean.
    expect(within(board).getByText("Peer")).toBeInTheDocument();
    expect(board.textContent).not.toMatch(/token|context|opus|sonnet/i);
  });

  it("drops a channel from the board when nothing is running in it", async () => {
    apiRequest.mockImplementation((path: string, opts: BridgeRequestOpts = {}) =>
      path.split("?")[0] === "/api/home/overview"
        ? Promise.resolve(
            ok({
              ...HOME_OVERVIEW,
              agents: HOME_OVERVIEW.agents.filter(
                (agent) => agent.channelName === "Priya Shah"
              ),
            })
          )
        : (routes(path, opts) ?? Promise.reject(new Error(`unexpected: ${path}`)))
    );
    renderHome();
    await loadedFace();
    const board = await card("Active agents");

    expect(
      within(board).getAllByRole("heading", { level: 4 }).map((h) => h.textContent)
    ).toEqual(["Priya Shah"]);
  });

  /**
   * 🔒 **A JUMP ON /home IS A SELECTION, NOT A ROUTE** — a home channel lives in
   * a `kind='link'` container and containers have no page
   * (`use-activity-jump.ts`). So clicking an agent card raises the CHANNELS face
   * on that row and hands the surface the thread the agent is in.
   */
  it("jumps from an agent card to its thread, on the Channels face", async () => {
    renderHome();
    await loadedFace();
    const board = await card("Active agents");

    // ⚠ `flint`, NOT `quill`: the jump lands by SELECTING the container's row in
    // the left list, so the target has to be a container the channels payload
    // actually holds. `quill` runs in the board's second lane, which this
    // fixture deliberately gives no channel row — that case is covered below.
    fireEvent.click(within(board).getByRole("button", { name: /flint/ }));

    const surface = await screen.findByTestId("channel-surface");
    expect(surface).toHaveAttribute("data-thread", "task-1");
    expect(
      screen.getByRole("tab", { name: "Channels", selected: true })
    ).toBeInTheDocument();
  });

  /**
   * ⚠ A jump into a container the left list does not hold RAISES NO THREAD —
   * `use-activity-jump.ts` keys the held thread by ROW, and a row that is not in
   * `visible` never matches. The pane falls back to the first visible row with
   * no thread, which is the honest degradation: never another channel's thread.
   */
  it("raises no thread when the jump names a container the list has not got", async () => {
    renderHome();
    await loadedFace();
    const board = await card("Active agents");

    fireEvent.click(within(board).getByRole("button", { name: /quill/ }));

    expect(await screen.findByTestId("channel-surface")).toHaveAttribute(
      "data-thread",
      ""
    );
  });

  /**
   * The capacity bar is a PERIOD TOTAL with its denominator and its reset date,
   * read from the shared billing endpoint — no second credits read.
   */
  it("shows the credit allowance, what is left, and when it resets", async () => {
    renderHome();
    const credits = await panel("Usage");

    // ⚠ THE BILLING METER'S OWN FORMAT — `UsageMeter` prints `used / limit`.
    // This face uses that component, so it prints what the billing pane prints.
    expect(await within(credits).findByText("320 / 500")).toBeInTheDocument();
    expect(within(credits).getByText("Credits")).toBeInTheDocument();
    expect(within(credits).getByText("180 left")).toBeInTheDocument();
    // ⚠ THE BILLING PANE'S OWN LINE AND ITS OWN FORMATTER (`formatDate`), so
    // the assertion is on the SENTENCE rather than on a date string this suite
    // would otherwise be re-implementing.
    expect(within(credits).getByText(/^Resets /)).toBeInTheDocument();
    expect(
      bridgeCalls(apiRequest).filter((call) =>
        call.path.startsWith("/api/billing/status")
      ).length
    ).toBeGreaterThan(0);
  });

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

    expect(within(usage).getByText("Credits")).toBeInTheDocument();
    expect(
      within(usage).getByRole("heading", { name: "Credits used" })
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
    expect(within(usage).getByTitle("1/9 · 0")).toBeInTheDocument();
    expect(within(usage).getByTitle("30/9 · 0")).toBeInTheDocument();
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
});
