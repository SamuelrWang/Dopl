/**
 * **THE NAME AN AGENT WAS GIVEN REACHES BOTH SESSION SURFACES** (F-708, 2026-09-16).
 *
 * 🔒 **THE DEFECT THIS PINS.** `channel_sessions.display_name` has been written by the desktop
 * and mapped by the server since 2026-08-31, but `@dopl/client › ChannelSessionState` had no
 * field for it — so `op="status"` rendered the agent-instance ID as the agent's NAME, and an
 * orchestrator that had just launched `Dopl Reader Main`, `Dopl Reader Server` and
 * `Dopl UI Fixes` read three eight-character ids and could not tell them apart. Samuel's
 * ruling is that the NAME is authoritative and everything else derives from it; a surface that
 * cannot show the name cannot state that rule.
 *
 * ⚠ **BOTH FORMS, IN ONE FILE, BECAUSE THEY ARE ONE FACT.** `formatSessionLine` (prose) and
 * `sessionRow` (grid) are held byte-for-byte against each other by
 * `channel-session-liveness.test.ts`; a name added to one and not the other is exactly the
 * drift that suite exists to catch, so both are asserted here where the reason is written down.
 *
 * ⚠ **AND THE ID STAYS.** The name is not an address — the `@agent-<id>` handle is the only
 * one an MCP caller can spend (`channel-session-handle.ts`) — so the cases below check that
 * naming an agent never costs the reader its address.
 */

import { describe, expect, it } from "vitest";
import type { ChannelSessionState } from "@dopl/client";
import { formatSessionLine } from "./channel-session-render";
import { sessionRow, SESSION_TABLE_HEAD } from "./channel-session-table";

const NOW = Date.parse("2026-09-16T18:20:00.000Z");

/** One peer-shaped row. ⚠ `name` IS THE AGENT ID, which is what a current desktop reports. */
function SESSION(over: Partial<ChannelSessionState> = {}): ChannelSessionState {
  return {
    channelId: "c-1",
    threadId: null,
    name: "nm8wlg6s",
    state: "working",
    channelName: "TEst Channel",
    threadTitle: null,
    updatedAt: new Date(NOW - 1000).toISOString(),
    ...over,
  };
}

/** The row's cells, trimmed — the column order is `SESSION_TABLE_HEAD`'s. */
function cells(row: string): string[] {
  return row.split("|").slice(1, -1).map((c) => c.trim());
}

describe("a named session shows its NAME, and keeps its handle", () => {
  it("leads the prose line with the display name", () => {
    const line = formatSessionLine(
      SESSION({ displayName: "Dopl Reader Main" }),
      { now: NOW, handle: true },
    );
    // ⚠ THE CODE SPAN IS `inlineOr`'s, not decoration: every peer-written string on these
    // surfaces is rendered as one inline span so it cannot pose as markdown structure.
    expect(line).toContain("**`Dopl Reader Main`**");
    // ⚠ THE ADDRESS IS STILL THERE — naming an agent may not cost the reader the only handle
    // it can actually spend.
    expect(line).toContain("`@agent-nm8wlg6s`");
  });

  it("falls back to the id when no name was reported", () => {
    // ⚠ BOTH SPELLINGS OF "nobody reported one": an older server sends no field at all, a
    // machine with no name sends null. Neither is a name and neither may render as one.
    for (const s of [SESSION(), SESSION({ displayName: null })]) {
      const line = formatSessionLine(s, { now: NOW, handle: true });
      expect(line).toContain("**`nm8wlg6s`**");
    }
  });

  it("puts the name in its own grid column, before the handle", () => {
    const head = SESSION_TABLE_HEAD[0];
    expect(head.indexOf("| name |")).toBeLessThan(head.indexOf(" handle "));
    const c = cells(
      sessionRow(SESSION({ displayName: "Dopl Reader Server" }), {
        now: NOW,
        handle: true,
      }),
    );
    expect(c[0]).toBe("`Dopl Reader Server`");
    expect(c[1]).toBe("`@agent-nm8wlg6s`");
    // ⚠ The alignment row must carry the same number of columns as the header, or the table
    // stops being one.
    expect(SESSION_TABLE_HEAD[1].split("|").length).toBe(head.split("|").length);
    expect(c.length).toBe(cells(head).length);
  });

  it("dashes the name cell rather than repeating the id", () => {
    // ⚠ `—` is NOT REPORTED per the legend. Repeating the handle would make an unnamed agent
    // look named, which is the failure this whole change is about, one column over.
    const c = cells(sessionRow(SESSION(), { now: NOW, handle: true }));
    expect(c[0]).toBe("—");
    expect(c[1]).toBe("`@agent-nm8wlg6s`");
  });

  it("neutralizes a name another machine wrote", () => {
    // ⚠ PEER-TYPED TEXT. A pipe would forge a column and a backtick would break the span; both
    // are blanked by `neutralizeInline`, the same treatment `channelName` gets.
    const c = cells(
      sessionRow(SESSION({ displayName: "ev|il `name`" }), {
        now: NOW,
        handle: true,
      }),
    );
    expect(c.length).toBe(cells(SESSION_TABLE_HEAD[0]).length);
    expect(c[0]).not.toContain("|");
    // ⚠ EXACTLY ONE SPAN: the two outer backticks are `neutralizeInline`'s own quoting, and a
    // third would mean the peer's string closed it and is now writing markdown of its own.
    expect(c[0].split("`").length - 1).toBe(2);
    expect(c[0]).toBe("`ev il name`");
  });
});
