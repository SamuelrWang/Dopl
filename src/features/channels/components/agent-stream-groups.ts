"use client";

/**
 * THE TOOL-RUN GROUPING — a run of consecutive tool activity as ONE row, its count, and the
 * name that row shows (split out of `agent-stream-model.ts`).
 *
 * ⚠ THE SEAM IS THE ONE THAT FILE'S HEADER ALREADY NAMED, and it is a real one.
 * `agent-stream-lanes.ts` moves when THE DESKTOP's vocabulary moves; `agent-stream-model.ts`
 * moves when the stream's own arithmetic does — the echo dedupe, the held-draft join, the TTL,
 * **and the tool-run grouping**. That last clause had grown its own reason to change: the count
 * is now a negotiation between what main stamped and what this side received
 * (`DesktopNarrationEntry.runCount`, 2026-10-10), which moves when the RING's bounds move and
 * has nothing to do with how a post is deduped against the transcript.
 *
 * ⚠ IT MOVED VERBATIM except for {@link toolUses}' own 2026-10-10 change, and every name is
 * RE-EXPORTED from `agent-stream-model.ts`, which stays the import path of record — no importer
 * changed, and a second canonical path for one symbol is how two call sites come to disagree
 * about which is authoritative.
 *
 * ⚠ PURE, and takes one type-only import. No clock, no messages, no consent rows.
 */

import type { StreamItem } from "./agent-stream-model";

/**
 * ONE RUN OF CONSECUTIVE TOOL ACTIVITY, AS ONE ROW (Samuel, 2026-08-27 — the
 * Claude-Code-desktop pattern).
 *
 * ⚠ IT IS A GROUPING, NOT A FILTER. Every frame that went in comes out inside a
 * group; nothing is dropped, and the detail the operator can open is the same
 * rows this stream rendered before. The stream's job is unchanged (a log that
 * loses lines is worse than a plain one) — what changes is that a dozen raw JSON
 * payloads no longer push the POST the operator opened the panel to read off the
 * screen.
 *
 * ⚠ THE BREAK IS ANY NON-TOOL LANE. A thinking line between two tool calls ends
 * the run, because the agent said something there and the summary must not
 * swallow it into "Used 4 tools".
 *
 * ⚠ THE COUNT IS TOOL USES, NOT ROWS. A call and its result are two frames about
 * ONE use (`LANE_BY_KIND` maps `tool` and `result` alike), so the number comes
 * from the frames that carry a tool NAME; a run of nameless frames falls back to
 * its row count rather than reporting zero.
 */
export interface StreamGroup {
  key: string;
  /** `null` for a single non-tool row; otherwise the run's tool-use count. */
  tools: number | null;
  items: StreamItem[];
}

export function groupStreamItems(items: readonly StreamItem[]): StreamGroup[] {
  const out: StreamGroup[] = [];
  for (const item of items) {
    if (item.lane !== "tool") {
      out.push({ key: item.key, tools: null, items: [item] });
      continue;
    }
    const last = out[out.length - 1];
    if (last && last.tools !== null) {
      last.items.push(item);
      last.tools = toolUses(last.items);
      continue;
    }
    out.push({ key: item.key, tools: toolUses([item]), items: [item] });
  }
  return out;
}

/**
 * THE RUN'S TOOL-USE COUNT, AND IT MAY NOT GO DOWN (2026-10-10).
 *
 * ⚠ **COUNTING THE FRAMES WE HOLD IS NOT COUNTING THE RUN.** Main's ring evicts
 * its oldest entries past either bound by design (`narration-ring.js`), so a run
 * longer than the ring is deep loses its own head while it is still growing —
 * and this row, which recomputes on every pushed frame, counted up to 105 and
 * then counted DOWN. ⚠ So the ordinal main stamped on the surviving (NEWEST)
 * frames is preferred: a ring never drops those, and `max` over them is the
 * run's real size however much of the head is gone.
 *
 * ⚠ **THE FRAME COUNT IS STILL TAKEN, AND THE LARGER WINS.** The two disagree in
 * one direction each. Eviction only ever shrinks the frame count, which the
 * ordinal covers. A group can also be WIDER than one of main's runs: a `sent`
 * echo between two runs is dropped once the transcript carries it
 * ({@link buildStreamItems}), which merges the runs either side of it into one
 * group here while main counted them separately — there the summed frames are
 * the honest number and the per-run max would under-report. `max` of the two is
 * right in both, and is the only form that cannot print a number smaller than
 * the rows it is sitting over.
 *
 * ⚠ FALLS BACK TO THE ROW COUNT for a run of frames carrying neither a tool NAME
 * nor an ordinal, rather than reporting zero — the rule this function already had.
 */
function toolUses(items: readonly StreamItem[]): number {
  const named = items.filter((item) => !!item.tool).length;
  let stamped = 0;
  for (const item of items) {
    if (typeof item.runCount === "number" && item.runCount > stamped) {
      stamped = item.runCount;
    }
  }
  return Math.max(named, stamped) || items.length;
}

/** `mcp__dopl__dopl_channel` → `dopl_channel`. ⚠ The segment after the LAST `__`,
 *  which is the rule `main/mcp-tool-names.js › mcpShortName` states: the server
 *  segment is the CLIENT's to choose and has never been ours to assume (F-139). */
export function shortToolName(name: string | undefined): string {
  if (!name) return "runs";
  return name.replace(/^mcp__.*__/i, "") || "runs";
}
