// @vitest-environment jsdom
/**
 * THE AGENT WINDOW'S "Other agents" RAIL (2026-09-13).
 *
 * 🔒 **SAMUEL:** *"on the left, you see that there is this collapsible side panel … for this, I want
 * to display 'Other agents' … It should just be the name of the agent, and then under that, it
 * should show 'Idle', 'Thinking', or 'Not idle', like 'Waiting', stuff like that, instead of the
 * timestamp."*
 *
 * The properties that fail SILENTLY — which is what earns each of them a case:
 *
 *  - **THE SECOND LINE IS THE STATE AND NEVER A TIMESTAMP.** A rail that printed "2m ago" renders
 *    perfectly; it is only the thing he explicitly replaced.
 *  - **ENDED AGENTS ARE NOT LISTED**, and the feed retains a week of them — so the filter is the
 *    difference between a rail of things to open and a history.
 *  - **`null` IS "COULD NOT ASK", NOT "NO AGENTS"** (INVARIANTS §11). A browser must get the rail's
 *    chrome and no rows, never a claim about the operator's machine.
 *  - **A CLICK IS AN ADDRESS THAT GOES THROUGH MAIN.** A rail that selected a tab locally would show
 *    an agent main has not tabbed — and main is the only half that knows what is open.
 *  - **COLLAPSED IS THE SQUARE TILE, EXPANDED IS THE TWO-LINE ROW**, and the SELECTED one is shaded
 *    in both. The geometry itself is pinned in `agent-window-frame.test.ts`; what is pinned HERE is
 *    that the row actually WEARS it, and that the tinted element is the square one.
 *
 * ⚠ **IT MOUNTS THE RAIL DIRECTLY.** Driving it through the window's harness would mean mocking four
 * hooks to assert a list — the same argument `agent-window-chrome.test.tsx` states.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { AgentWindowRail, ROW_SELECTED_FACE } from "./agent-window-rail";
import { AgentWindowShell } from "./agent-window-shell";
import { TILE } from "./agent-window-frame";

afterEach(cleanup);

function session(over: Partial<DesktopSessionSummary> = {}): DesktopSessionSummary {
  return {
    sessionId: "s-1",
    channelId: "c1",
    taskId: "t1",
    name: "flint",
    state: "working",
    channelName: "Website",
    threadTitle: "UI-kit design",
    ...over,
  };
}

/** The host's key rule, as `pages/agent-window/index.tsx › agentTabKey` spells it. */
const keyFor = (s: DesktopSessionSummary) =>
  s.agentId ? `${s.channelId}|${s.taskId}|${s.agentId}` : `${s.channelId}|${s.taskId}`;

function mountRail(
  over: {
    sessions?: DesktopSessionSummary[] | null;
    collapsed?: boolean;
    activeKey?: string;
  } = {}
) {
  const onOpen = vi.fn();
  const onToggle = vi.fn();
  render(
    <AgentWindowRail
      sessions={over.sessions === undefined ? [session()] : over.sessions}
      activeKey={over.activeKey ?? ""}
      collapsed={over.collapsed ?? false}
      onToggle={onToggle}
      onOpen={onOpen}
      keyFor={keyFor}
    />
  );
  return { onOpen, onToggle };
}

describe("the rail lists the operator's live agents", () => {
  it("names each agent and puts its STATE under it — never a timestamp", () => {
    mountRail({
      sessions: [
        session({ name: "flint", state: "working", detail: "tool", toolLabel: "Bash" }),
        session({ sessionId: "s-2", taskId: "t2", name: "quill", state: "idle" }),
      ],
    });
    expect(screen.getByText("flint")).toBeTruthy();
    expect(screen.getByText("quill")).toBeTruthy();
    // ⚠ THE WORDS ARE `agents-model.ts › agentLiveness`'s, which is the ONE mapping from state to
    // copy — the chrome's badge and the Agents tab's cards read the same one.
    expect(screen.getByText("Running Bash")).toBeTruthy();
    expect(screen.getByText("Idle")).toBeTruthy();
    // ⚠ NOT A STAMP, IN ANY SHAPE. The rail must not reach `formatRelativeTime`.
    expect(screen.queryByText(/ago/)).toBeNull();
  });

  it("leaves ENDED agents out — a rail is a list of things to open", () => {
    mountRail({
      sessions: [session({ name: "flint" }), session({ sessionId: "s-2", taskId: "t2", name: "gone", state: "ended" })],
    });
    expect(screen.getByText("flint")).toBeTruthy();
    expect(screen.queryByText("gone")).toBeNull();
  });

  /** ⚠ `null` IS "COULD NOT ASK" — a browser, or a main with no feed. The rail renders its own
   *  chrome and no rows rather than claiming an empty machine (INVARIANTS §11). */
  it("renders its toggle and NO rows when the feed could not be asked", () => {
    mountRail({ sessions: null });
    expect(screen.getByRole("button", { name: "Collapse agents" })).toBeTruthy();
    // The toggle is the only button; no row, and no "no agents" claim either.
    expect(screen.getAllByRole("button").length).toBe(1);
  });

  it("hands the SESSION up on a click — the host asks main to open or focus that tab", () => {
    // ⚠ `displayName` IS THE OPERATOR'S OWN NAME AND OUTRANKS BOTH OTHER FIELDS
    // (`agents-model.ts › agentDisplayName`): with an `agentId` and no `displayName`, a row renders
    // `#abc123` — a NAME the operator accepted at launch, never a raw id (INVARIANTS §5).
    const row = session({ agentId: "abc123", displayName: "flint" });
    const { onOpen } = mountRail({ sessions: [row] });
    fireEvent.click(screen.getByText("flint"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    // ⚠ THE WHOLE ROW, NOT A KEY: `openAgentWindow` needs (channel, thread, agent), and a rail that
    // handed up a string would have to parse its own key rule back apart.
    expect(onOpen.mock.calls[0]![0]).toBe(row);
  });
});

describe("the toggle is one control in both states", () => {
  it("says Collapse when open and carries only the glyph when closed", () => {
    const { onToggle } = mountRail({ collapsed: false });
    const open = screen.getByRole("button", { name: "Collapse agents" });
    expect(open.getAttribute("aria-expanded")).toBe("true");
    expect(open.textContent).toContain("Collapse");
    fireEvent.click(open);
    expect(onToggle).toHaveBeenCalledTimes(1);
    cleanup();
    mountRail({ collapsed: true });
    const shut = screen.getByRole("button", { name: "Expand agents" });
    expect(shut.getAttribute("aria-expanded")).toBe("false");
    expect(shut.textContent).toBe("");
  });

  it("heads the list with Agents only when there is room for the word", () => {
    mountRail({ collapsed: false });
    expect(screen.getByRole("heading", { name: "Agents" })).toBeTruthy();
    cleanup();
    mountRail({ collapsed: true });
    expect(screen.queryByRole("heading", { name: "Agents" })).toBeNull();
  });
});

describe("the selected agent is shaded, and collapsed that shading is the SQUARE", () => {
  /** 🔒 *"the shaded area for the currently selected agent, it is not a perfect square. It has a
   *  longer width than height. It needs to be a perfect square."* */
  it("puts the tint on the TILE itself when collapsed — not on a wider row around it", () => {
    const row = session({ agentId: "abc123", displayName: "flint" });
    mountRail({ sessions: [row], collapsed: true, activeKey: keyFor(row) });
    const tile = screen.getByRole("button", { name: /flint/ });
    expect(tile.className.split(/\s+/)).toContain(ROW_SELECTED_FACE);
    // ⚠ THE TINTED ELEMENT AND THE SQUARE ARE THE SAME ELEMENT, which is the whole fix: the tint
    // used to sit on a `w-full` row with asymmetric padding around a `h-6` mark.
    for (const part of TILE.split(" ")) expect(tile.className).toContain(part);
    expect(tile.className, "the collapsed row took a width of its own back").not.toContain("w-full");
  });

  it("shades the expanded row and leaves every other row alone", () => {
    const mine = session({ agentId: "abc123", displayName: "flint" });
    const other = session({ sessionId: "s-2", taskId: "t2", agentId: "zzz999", displayName: "quill" });
    mountRail({ sessions: [mine, other], activeKey: keyFor(mine) });
    const rows = screen.getAllByRole("button").slice(1); // [0] is the toggle
    // ⚠ AS A CLASS TOKEN, NOT A SUBSTRING: every row carries `hover:bg-surface-raised-2`, so a
    // `toContain` on the raw string is true of the UNSELECTED rows too and the case would pass
    // whatever the code did.
    const tinted = (el: Element) => el.className.split(/\s+/).includes(ROW_SELECTED_FACE);
    expect(tinted(rows[0]!)).toBe(true);
    expect(rows[0]!.getAttribute("aria-current")).toBe("true");
    expect(tinted(rows[1]!)).toBe(false);
    expect(rows[1]!.getAttribute("aria-current")).toBeNull();
  });

  /** ⚠ COLLAPSED, THE NAME AND THE STATE MOVE TO THE TOOLTIP — the initial alone is not an
   *  accessible name, and a rail of single letters with no titles is unusable. */
  it("keeps the name and the state reachable when collapsed", () => {
    mountRail({ sessions: [session({ state: "idle" })], collapsed: true });
    const tile = screen.getByRole("button", { name: /flint/ });
    expect(tile.getAttribute("title")).toBe("flint — Idle");
    expect(tile.textContent).toBe("F");
  });
});

/**
 * 🔒 **THE COLOUR DOT REACHES THE RAIL — the half that shipped as a declared prop and an empty
 * screen** (2026-09-14; docs/specs/agent-colors.md item 8: *"the Agents-tab card and the pop-out
 * rail row show a small colour dot before the name for live agents"*).
 *
 * ⚠ **THE PIN IS ON THE SHELL, NOT ON THE RAIL, BECAUSE THE RAIL WAS NEVER THE BUG.**
 * `AgentWindowRail` has drawn `colorFor(session)` since the wave landed; what was missing is that
 * NOTHING PASSED IT — `AgentWindowShell` neither took the prop nor supplied one, and the pop-out
 * is the only host. A rail-only case would have passed a resolver by hand and proved the half
 * that already worked.
 *
 * ⚠ **THE SOURCE IS THIS MACHINE'S OWN FEED** (`agent-window-shell.tsx › colorFromOwnFeed`), the
 * only one this window has: it reads no channel projection by design.
 */
describe("the rail's colour dot, as the pop-out actually mounts it", () => {
  function mountShell(sessions: DesktopSessionSummary[]) {
    render(
      <AgentWindowShell
        tabs={[{ key: keyFor(sessions[0]!), name: "flint" }]}
        activeKey={keyFor(sessions[0]!)}
        onSelect={vi.fn()}
        onCloseTab={vi.fn()}
        sessions={sessions}
        onOpenSession={vi.fn()}
        keyFor={keyFor}
      >
        <div />
      </AgentWindowShell>
    );
    // ⚠ THE RAIL OPENS COLLAPSED (the shell's own default), and the collapsed shape is one square
    // holding one initial — no dot by ruling. Expanding is what the operator does to read names.
    fireEvent.click(screen.getByRole("button", { name: "Expand agents" }));
  }

  /**
   * 🔒 MUTATION-PROOF: drop `colorFor={colorFromOwnFeed}` from the shell's `AgentWindowRail`
   * mount — the rail still renders every row and every state, and only this fails.
   */
  it("draws the key the feed reports", () => {
    mountShell([session({ agentId: "abc123", color: "agent-07" })]);
    expect(document.querySelector('[data-agent-color="agent-07"]')).toBeTruthy();
  });

  /** ⚠ NARROWED, NEVER CAST: a seventeenth key from a newer desktop must read as NO COLOUR, not
   *  reach a `var(--agent-color-99)` that resolves to nothing and paints an invisible dot. */
  it("draws nothing for a key outside the bank, and nothing for no key", () => {
    mountShell([
      session({ agentId: "abc123", color: "agent-99" }),
      session({ sessionId: "s-2", taskId: "t2", agentId: "zzz999", name: "quill" }),
    ]);
    expect(document.querySelectorAll("[data-agent-color]")).toHaveLength(0);
  });
});
