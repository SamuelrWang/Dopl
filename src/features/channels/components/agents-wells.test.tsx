// @vitest-environment jsdom
/**
 * THE AGENTS TAB'S FOUR GRAY WELLS (Samuel, 2026-09-13).
 *
 * These are the properties that fail QUIETLY:
 *
 *  - **A CARD CANNOT FALL OUT OF THE LIST.** The four buckets are exhaustive and
 *    an UNDATED agent lands in the one well that is OPEN, so an older main's
 *    missing `startedAt` cannot bury a live agent inside a collapsed **Earlier**.
 *  - **THE BUCKET IS TIME, NOT STATE.** An ENDED agent last active three days ago
 *    belongs in **Last 7 days**, which is exactly the case Samuel spelled out.
 *  - **THE HEADER TYPE IS THE ONE HE NAMED** — the /home Overview's *Credit spend*
 *    face, `IDENTITY_NAME_TEXT`, reached by import. A hand-typed `text-title
 *    font-medium` here would pass a class assertion and drift the day that
 *    constant moves, so the assertion is against the CONSTANT.
 *  - **THE CARDS ARE UNCHANGED.** This ruling put a GROUND under the column; the
 *    white `.bento` cards and their gap are the ones that were already there.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { IDENTITY_NAME_TEXT } from "@/shared/ui/section-heading";
import { PANEL_ROWS, PANEL_WELL } from "@/shared/ui/panel-well";

vi.mock("@/features/agent-identities/hooks/use-agent-identities", () => ({
  useAgentIdentities: () => ({
    identities: [],
    loading: false,
    error: null,
    refetch: () => {},
  }),
}));

import { AgentsTab } from "./agents-tab";
import {
  AGENT_WELLS_STORAGE_KEY,
  agentActivityAt,
  peerActivityAt,
} from "./agents-wells";
// ⚠ THE SPANS AND THE BUCKETING FUNCTION COME FROM THE GENERIC MODULE (2026-09-14).
// `agents-wells.tsx` used to re-export them under this tab's own names; those aliases had
// no non-test reader and are deleted, so this suite names the one declaration.
import { RECENCY_WELLS, wellFor } from "./recency-wells";
import { CHANNEL_ID } from "./test-fixtures";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 13, 12, 0, 0);

// ⚠ **EVERY FIXTURE CARRIES A `displayName` SINCE 2026-09-15**, and that is not decoration.
// These cases locate a card BY ITS TITLE, and the title used to be `#<agentId>` — eight machine
// characters, unique per fixture, which made the id a convenient locator AND was the leak
// Samuel's ruling removed (`shared/lib/agent-name.ts`). Every unnamed agent now reads
// `New Agent`, so a suite that wants to say WHICH card it found has to name the agents, exactly
// as the product now expects a launch to.
function summary(over: Partial<DesktopSessionSummary> = {}): DesktopSessionSummary {
  return {
    sessionId: "s-1",
    channelId: CHANNEL_ID,
    taskId: "t-1",
    name: "flint",
    state: "idle",
    channelName: "Website",
    threadTitle: "UI-kit design",
    contextUsed: null,
    contextWindow: null,
    tokensSpent: null,
    startedAt: NOW - HOUR,
    lastActivityAt: NOW - HOUR,
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  window.localStorage.clear();
  delete (window as { dopl?: unknown }).dopl;
});

function headers(): string[] {
  return screen.queryAllByRole("heading").map((h) => h.textContent ?? "");
}

/**
 * 🔒 **EVERY WELL, ALWAYS, SINCE 2026-09-17 (Samuel, verbatim):** *"in the Threads
 * and Agents view, i want to have the gray boxes kept there even if there's nothing
 * in them. Same as the channel picker"* — so the question a case asks is no longer
 * WHICH headers rendered (always these four, in this order) but which well a card
 * landed IN. The previous shape of these cases, `headers()` as a proxy for "where is
 * the card", is what that ruling took away.
 */
const ALL_WELLS = ["Recent", "Last 7 days", "Last 30 days", "Earlier"];

/** The gray box a heading belongs to. */
function wellOf(label: string): HTMLElement {
  return screen.getByRole("heading", { name: label }).closest("section")!;
}

describe("agents-wells — the bucketing expression", () => {
  it("is max(startedAt, lastActivityAt ?? endedAt), and never coerces a null to 0", () => {
    // The MAX is what makes Samuel's "active in the last 24 hours OR just created
    // in the last 24 hours" one read rather than two passes.
    expect(agentActivityAt(summary({ startedAt: NOW - 40 * DAY, lastActivityAt: NOW - HOUR }))).toBe(
      NOW - HOUR
    );
    expect(agentActivityAt(summary({ startedAt: NOW - HOUR, lastActivityAt: NOW - 40 * DAY }))).toBe(
      NOW - HOUR
    );
    // `lastActivityAt ?? endedAt`: an ended agent on a main that reports only the
    // end stamp is still dated by it.
    expect(
      agentActivityAt({
        ...summary({ state: "ended", startedAt: NOW - 9 * DAY, lastActivityAt: null }),
        endedAt: NOW - 3 * DAY,
      })
    ).toBe(NOW - 3 * DAY);
    // ⚠ The regression this guards: `Math.max(null, null)` is 0, which would date
    // every legacy agent to 1970 and file all of them under Earlier.
    expect(agentActivityAt(summary({ startedAt: null, lastActivityAt: null }))).toBeNull();
  });

  it("files a stamp in the well its AGE falls in, and an unknown stamp in Recent", () => {
    expect(wellFor(NOW - HOUR, NOW)).toBe("recent");
    expect(wellFor(NOW - 3 * DAY, NOW)).toBe("week");
    expect(wellFor(NOW - 12 * DAY, NOW)).toBe("month");
    expect(wellFor(NOW - 90 * DAY, NOW)).toBe("earlier");
    // ⚠ UNKNOWN IS VISIBLE, NOT OLD — Recent is the one well open by default.
    expect(wellFor(null, NOW)).toBe("recent");
    // Clock skew is ordinary and a negative age is not evidence of anything.
    expect(wellFor(NOW + HOUR, NOW)).toBe("recent");
    // The boundaries are exclusive-at-the-top, so the buckets cannot overlap.
    expect(wellFor(NOW - DAY, NOW)).toBe("week");
    expect(wellFor(NOW - 7 * DAY, NOW)).toBe("month");
    expect(wellFor(NOW - 30 * DAY, NOW)).toBe("earlier");
  });

  it("dates a PEER row by its one stamp, and reads an unparseable one as unknown", () => {
    expect(peerActivityAt({ updatedAt: new Date(NOW - 3 * DAY).toISOString() })).toBe(NOW - 3 * DAY);
    expect(peerActivityAt({ updatedAt: "" })).toBeNull();
    expect(peerActivityAt({ updatedAt: "not a date" })).toBeNull();
  });
});

describe("AgentsTab — the four wells", () => {
  /** One agent per bucket, plus the two cases Samuel named. */
  const fixture: DesktopSessionSummary[] = [
    summary({ sessionId: "s-now", agentId: "aaaa1111", displayName: "Alpha", taskId: "t-1", startedAt: NOW - 2 * HOUR }),
    // ⚠ AN ENDED AGENT, LAST ACTIVE THREE DAYS AGO → Last 7 days. Verbatim: "if
    // it's an ended agent but they were active last thirty days … that should be
    // in … the respective gray boxes."
    summary({
      sessionId: "s-ended",
      agentId: "bbbb2222", displayName: "Bravo",
      taskId: "t-2",
      state: "ended",
      startedAt: NOW - 4 * DAY,
      lastActivityAt: NOW - 3 * DAY,
    }),
    summary({
      sessionId: "s-month",
      agentId: "cccc3333", displayName: "Charlie",
      taskId: "t-3",
      startedAt: NOW - 12 * DAY,
      lastActivityAt: NOW - 12 * DAY,
    }),
    summary({
      sessionId: "s-old",
      agentId: "dddd4444", displayName: "Delta",
      taskId: "t-4",
      startedAt: NOW - 200 * DAY,
      lastActivityAt: NOW - 120 * DAY,
    }),
  ];

  function renderTab(sessions: DesktopSessionSummary[]) {
    return render(
      <AgentsTab
        sessions={sessions}
        channelId={CHANNEL_ID}
        openAgent={null}
        onOpenAgent={() => {}}
      />
    );
  }

  it("renders the four headers in Samuel's order, and files each agent in its own", () => {
    renderTab(fixture);
    expect(headers()).toEqual(["Recent", "Last 7 days", "Last 30 days", "Earlier"]);

    // Recent is open, so its card is mounted; the other three are collapsed.
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.queryByText("Bravo")).toBeNull();

    // Open each in turn and the right agent is inside it.
    for (const [label, name] of [
      ["Last 7 days", "Bravo"],
      ["Last 30 days", "Charlie"],
      ["Earlier", "Delta"],
    ] as const) {
      fireEvent.click(screen.getByRole("heading", { name: label }));
      const well = screen.getByRole("heading", { name: label }).closest("section")!;
      expect(within(well).getByText(name)).toBeTruthy();
    }
  });

  it("files a CREATED-TODAY idle agent in Recent — an idle agent is not an old one", () => {
    // Verbatim: "They might be idle but they just show up there."
    renderTab([summary({ agentId: "eeee5555", displayName: "Echo", state: "idle", startedAt: NOW - 10 * 60_000 })]);
    expect(headers()).toEqual(ALL_WELLS);
    expect(within(wellOf("Recent")).getByText("Echo")).toBeTruthy();
  });

  it("files an UNDATED agent in Recent, where it is visible", () => {
    renderTab([summary({ agentId: "ffff6666", displayName: "Foxtrot", startedAt: null, lastActivityAt: null })]);
    expect(headers()).toEqual(ALL_WELLS);
    expect(within(wellOf("Recent")).getByText("Foxtrot")).toBeTruthy();
  });

  /**
   * 🔒 **THE REVERSAL, AND THE CASE THAT USED TO ASSERT THE OPPOSITE.** This read
   * *"does NOT render a well with no agents in it"* until 2026-09-17, when Samuel
   * ruled the other way: *"in the Threads and Agents view, i want to have the gray
   * boxes kept there even if there's nothing in them. Same as the channel picker"*.
   * ⚠ **AN EMPTY WELL IS THE BOX AND ITS HEADER, WITH NO PLACEHOLDER SENTENCE** —
   * the picker's empty face exactly (minimal copy, §5), which is why the empty ones
   * are asserted to hold NO text of their own.
   */
  it("renders EVERY well, including the ones with no agents in them", () => {
    renderTab([fixture[2]!]);
    expect(headers()).toEqual(ALL_WELLS);
    // Open the three empty ones: an empty well is a header over an empty body.
    for (const label of ["Last 7 days", "Earlier"]) {
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(wellOf(label).textContent).toBe(label);
    }
    fireEvent.click(screen.getByRole("button", { name: "Last 30 days" }));
    expect(within(wellOf("Last 30 days")).getByText("Charlie")).toBeTruthy();
  });

  it("renders all four wells when the feed is empty, with the one sentence BESIDE them", () => {
    renderTab([]);
    expect(headers()).toEqual(ALL_WELLS);
    // ⚠ BESIDE, NOT INSIDE — /home's channel column's shape: the sentence is a
    // sibling of the wells, never placeholder copy in one of them.
    const sentence = screen.getByText(/No agents running in this channel/i);
    expect(sentence.closest("section")).toBeNull();
  });
});

describe("AgentsTab — the well's face and its collapse", () => {
  function renderOne() {
    return render(
      <AgentsTab
        sessions={[summary({ agentId: "aaaa1111", displayName: "Alpha" })]}
        channelId={CHANNEL_ID}
        openAgent={null}
        onOpenAgent={() => {}}
      />
    );
  }

  it("is the /home Overview's well — the shared recipe, with no hairline of its own", () => {
    renderOne();
    const well = screen.getByRole("heading", { name: "Recent" }).closest("section")!;
    // ⚠ THE CONSTANT, not a copy of its current value.
    expect(well.className).toBe(PANEL_WELL);
    expect(PANEL_WELL).not.toMatch(/\bborder/);
  });

  it("puts the title left in the CREDIT SPEND type and the chevron right, in ONE button", () => {
    renderOne();
    const heading = screen.getByRole("heading", { name: "Recent" });
    // ⚠ THE TYPE SAMUEL NAMED: "it should be the same as … the credit spend".
    expect(heading.className).toContain(IDENTITY_NAME_TEXT);
    // The whole header row is the control, and the heading is its accessible name.
    const row = screen.getByRole("button", { name: "Recent" });
    expect(row.contains(heading)).toBe(true);
    // ⚠ ONE control for one act — no nested button inside the header row.
    expect(row.querySelector("button")).toBeNull();
  });

  /**
   * 🔒 **THE COLLAPSE IS AN ANIMATION (Samuel, 2026-09-13):** *"Even when the right
   * arrow turns to the down arrow, it should be a spinning right … it should be a
   * smooth animation, like the gray box increases in size."*
   *
   * ⚠ **ONE CHEVRON THAT ROTATES, NOT TWO THAT SWAP** — the assertion that catches
   * the regression, because a `ChevronDown`/`ChevronRight` swap looks identical in
   * a still frame and renders a hard toggle: two elements have nothing to
   * interpolate between. `rotate-90` is the *"spinning right"*.
   */
  it("rotates ONE chevron and grows the box, and unmounts the cards one transition late", async () => {
    renderOne();
    const row = screen.getByRole("button", { name: "Recent" });
    // ⚠ `getAttribute("class")`, NOT `.className` — on an SVG element that property
    // is an `SVGAnimatedString`, so a `toContain` against it reads an empty list and
    // passes nothing. (It cost this test one run.)
    const chevron = row.querySelector("[data-well-chevron]")!;
    const chevronClass = () => chevron.getAttribute("class") ?? "";
    expect(row.getAttribute("aria-expanded")).toBe("true");
    // ⚠ THE GLYPH IS THE SAME ONE IN BOTH STATES — only its rotation moves.
    expect(chevron.classList.contains("lucide-chevron-right")).toBe(true);
    expect(chevronClass()).toContain("rotate-90");
    expect(chevronClass()).toContain("transition-transform");
    // ⚠ AND THE MOTION STANDS DOWN UNDER REDUCED MOTION while the state stays.
    expect(chevronClass()).toContain("motion-reduce:transition-none");
    expect(row.querySelector("svg.lucide-chevron-down")).toBeNull();

    const box = () =>
      row.parentElement!.querySelector<HTMLElement>(".collapse-grid")!;
    expect(box().getAttribute("data-open")).toBe("true");
    expect(screen.getByText("Alpha")).toBeTruthy();

    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(chevronClass()).toContain("rotate-0");
    expect(chevronClass()).not.toContain("rotate-90");
    expect(box().getAttribute("data-open")).toBe("false");
    // ⚠ STILL MOUNTED FOR THE LENGTH OF THE SHRINK — a closing box with nothing
    // inside it has no content to clip and would snap shut.
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(box().getAttribute("aria-hidden")).toBe("true");
    // ⚠ AND THEN GONE: collapsed still means UNMOUNTED, not hidden (§5).
    await waitFor(() => expect(screen.queryByText("Alpha")).toBeNull());
  });

  it("keeps the cards the WHITE CARDS they were, directly inside the well's column", () => {
    renderOne();
    const well = screen.getByRole("heading", { name: "Recent" }).closest("section")!;
    // ⚠ `PANEL_ROWS` PLUS THE WELL'S OWN GAP, RE-STATED AS PADDING (2026-09-13) —
    // the animated wrapper is a permanent flex child now, so `PANEL_WELL`'s `gap-2`
    // moved inside the box that grows. The COLUMN is still the well's own recipe.
    const column = Array.from(well.querySelectorAll("div")).find((el) =>
      el.className.startsWith(PANEL_ROWS)
    );
    expect(column).toBeTruthy();
    const card = screen.getByText("Alpha").closest(".bento")!;
    // ⚠ NO WRAPPER BOX between the column and the card (the `Fragment` key) — a
    // `div` per card would be a second layout owner inside the well.
    expect(card.parentElement).toBe(column);
  });
});

describe("AgentsTab — the wells remember, per device", () => {
  it("defaults to Recent open and the other three collapsed", () => {
    render(
      <AgentsTab
        sessions={[
          summary({ agentId: "aaaa1111", displayName: "Alpha" }),
          summary({ sessionId: "s-2", agentId: "bbbb2222", displayName: "Bravo", taskId: "t-2", startedAt: NOW - 3 * DAY, lastActivityAt: NOW - 3 * DAY }),
        ]}
        channelId={CHANNEL_ID}
        openAgent={null}
        onOpenAgent={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: "Recent" }).getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getByRole("button", { name: "Last 7 days" }).getAttribute("aria-expanded")
    ).toBe("false");
  });

  it("round-trips the choice through localStorage", () => {
    const tab = (
      <AgentsTab
        sessions={[summary({ agentId: "aaaa1111", displayName: "Alpha" })]}
        channelId={CHANNEL_ID}
        openAgent={null}
        onOpenAgent={() => {}}
      />
    );
    const first = render(tab);
    fireEvent.click(screen.getByRole("button", { name: "Recent" }));
    expect(JSON.parse(window.localStorage.getItem(AGENT_WELLS_STORAGE_KEY)!)).toMatchObject({
      recent: false,
    });

    first.unmount();
    render(tab);
    expect(screen.getByRole("button", { name: "Recent" }).getAttribute("aria-expanded")).toBe(
      "false"
    );
    expect(screen.queryByText("Alpha")).toBeNull();
  });

  it("ignores a corrupt or foreign write rather than crashing on it", () => {
    window.localStorage.setItem(AGENT_WELLS_STORAGE_KEY, "{not json");
    render(
      <AgentsTab
        sessions={[summary({ agentId: "aaaa1111", displayName: "Alpha" })]}
        channelId={CHANNEL_ID}
        openAgent={null}
        onOpenAgent={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: "Recent" }).getAttribute("aria-expanded")).toBe(
      "true"
    );

    cleanup();
    // A key no well owns must not be able to change anything.
    window.localStorage.setItem(
      AGENT_WELLS_STORAGE_KEY,
      JSON.stringify({ nonsense: false, recent: "yes" })
    );
    render(
      <AgentsTab
        sessions={[summary({ agentId: "aaaa1111", displayName: "Alpha" })]}
        channelId={CHANNEL_ID}
        openAgent={null}
        onOpenAgent={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: "Recent" }).getAttribute("aria-expanded")).toBe(
      "true"
    );
  });

  it("declares four wells and no more — the ids the stored object is filtered against", () => {
    expect(RECENCY_WELLS.map((w) => w.id)).toEqual(["recent", "week", "month", "earlier"]);
  });
});
