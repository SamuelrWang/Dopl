/**
 * THE TOOL-RUN COUNT MAY NOT GO DOWN (Samuel, 2026-10-10: *"it reached 105 then decreased"*).
 *
 * ⚠ THE DEFECT. `groupStreamItems` prints the size of a run of consecutive tool activity, and it took that
 * size by COUNTING THE FRAMES IT HELD. Main's ring evicts its oldest entries past either bound by design
 * (`narration-ring.js`), and a tool use is TWO frames, so a run longer than the ring is deep loses its own
 * head while it is still growing — and the row counted down. A running total that decreases is the one thing
 * a running total cannot do.
 *
 * ⚠ THE FIX IS A NUMBER FROM WHERE NOTHING IS EVICTED: `main/session-narration.js › stampToolRun` stamps the
 * run's ordinal on each frame, so the reader takes the MAX over the frames that survived. These tests pin
 * both halves of {@link toolUses}'s rule — the ordinal for an evicted head, the frame count for a group
 * WIDER than one of main's runs — and the fallback for a main that stamps nothing.
 *
 * ⚠ IT IS ITS OWN FILE because `agent-stream.test.tsx` renders (jsdom, the collapsed row, the empty state)
 * and sat at 485 lines under the 500 cap; this half needs no DOM at all.
 */

import { describe, it, expect } from "vitest";
import { buildAgentStream, groupStreamItems } from "./agent-stream-model";
import type { AgentNarrationEntry } from "./use-agent-narration";

function tool(at: number, runCount?: number): AgentNarrationEntry {
  return {
    at,
    kind: "tool",
    tool: "mcp__dopl__dopl_edit_object",
    text: '{"object":"Field"}',
    ...(runCount === undefined ? {} : { runCount }),
  };
}

function result(at: number, runCount?: number): AgentNarrationEntry {
  return {
    at,
    kind: "result",
    ok: true,
    text: "ok",
    ...(runCount === undefined ? {} : { runCount }),
  };
}

/** One run of `uses` tool uses, stamped the way main stamps it. `from` drops the head, as eviction does. */
function run(uses: number, from = 1): AgentNarrationEntry[] {
  const out: AgentNarrationEntry[] = [];
  for (let i = from; i <= uses; i += 1) {
    out.push(tool(i * 2, i), result(i * 2 + 1, i));
  }
  return out;
}

const groupsOf = (entries: AgentNarrationEntry[]) =>
  groupStreamItems(buildAgentStream({ entries, sent: [] }));

describe("the run count comes from main's ordinal, not from the frames we kept", () => {
  it("REGRESSION: an evicted head does not shrink the count", () => {
    // 105 uses happened; the ring kept only the last 40. The old derivation answered 40.
    const kept = run(105, 66);
    const groups = groupsOf(kept);
    expect(groups).toHaveLength(1);
    expect(groups[0].tools).toBe(105);
    expect(groups[0].items.filter((i) => !!i.tool)).toHaveLength(40);
  });

  it("REGRESSION: it never decreases as the run grows past the ring", () => {
    const KEEP = 50; // whatever the ring can hold, in uses
    let last = 0;
    for (let uses = 1; uses <= 120; uses += 1) {
      const from = Math.max(1, uses - KEEP + 1);
      const tools = groupsOf(run(uses, from))[0]?.tools ?? 0;
      expect(tools).toBeGreaterThanOrEqual(last);
      expect(tools).toBe(uses);
      last = tools;
    }
  });

  it("is exact with nothing evicted, and still counts USES not frames", () => {
    expect(groupsOf(run(3))[0].tools).toBe(3);
  });
});

describe("the frame count is still taken, and the LARGER wins", () => {
  it("a group WIDER than one of main's runs reports the sum, not a per-run max", () => {
    // A `sent` echo between two runs is dropped once the transcript carries it, which merges the runs
    // either side of it into ONE group here while main counted them separately. Two runs of 3 → 6.
    const merged = [...run(3), ...run(3)];
    const groups = groupsOf(merged);
    expect(groups).toHaveLength(1);
    expect(groups[0].tools).toBe(6);
  });

  it("falls back to the frame count when main stamps no ordinal (an older build)", () => {
    const unstamped = [tool(2), result(3), tool(4), result(5)];
    expect(groupsOf(unstamped)[0].tools).toBe(2);
  });

  it("falls back to the ROW count for a run carrying neither a name nor an ordinal", () => {
    // Never zero: a nameless run is still a run (the rule `toolUses` already had).
    const nameless = [result(2), result(3)];
    expect(groupsOf(nameless)[0].tools).toBe(2);
  });
});

describe("the ordinal changes nothing else about the grouping", () => {
  it("still BREAKS the run on any non-tool lane", () => {
    // ⚠ The stream sorts by TIME, so the later run's stamps must actually be later.
    const entries = [
      ...run(2),
      { at: 99, kind: "assistant", text: "now the next field" } as AgentNarrationEntry,
      tool(200, 1),
      result(201, 1),
    ];
    expect(groupsOf(entries).map((g) => g.tools)).toEqual([2, null, 1]);
  });

  it("drops no frame — every row still comes out inside a group", () => {
    const entries = run(4);
    const groups = groupsOf(entries);
    const rows = groups.reduce((n, g) => n + g.items.length, 0);
    expect(rows).toBe(entries.length);
  });
});
