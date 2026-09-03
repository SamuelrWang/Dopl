/**
 * THE HEALTH CLAUSES — and the ONE collision this whole module exists to keep
 * open.
 *
 * ⚠ **`stale` NAMES TWO DIFFERENT FACTS AND THE SUITE'S FIRST JOB IS TO PROVE
 * THE RENDER KEEPS THEM APART.** `channel-session-render.ts › sessionIsStale`
 * derives one from `updatedAt` — a fact about the REPORT ("nobody has said
 * anything", which includes a dead desktop). `ChannelSessionHealth.stale` is
 * derived on the MACHINE — a fact about the SESSION (working, silent, still
 * spending). A reader who conflates them reports a live-but-quiet agent as dead
 * or a hung one as fine, so the cases below drive a row that is BOTH and assert
 * the line carries two distinguishable clauses.
 *
 * ⚠ **AND ITS SECOND JOB IS THE `null`-IS-NOT-ZERO RULE**, which is the one this
 * family has been built around since `20260822150000`: an absent field renders
 * NOTHING. `0 denied` for a machine that reported no number is a measurement
 * nobody took, in the surface an orchestrator uses to decide whether to keep an
 * agent alive.
 */

import { describe, expect, it } from "vitest";
import type { ChannelSessionHealth, ChannelSessionStateOwn } from "@dopl/client";
import {
  sessionHealthClauses,
  sessionProgressClauses,
} from "./channel-session-health.js";
import { formatSessionLine } from "./channel-session-render.js";

const NOW = Date.parse("2026-09-01T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

/** Every health clause a row can carry, joined the way the line joins them. */
function clauses(h: ChannelSessionHealth, now: number = NOW): string {
  return [...sessionProgressClauses(h), ...sessionHealthClauses(h, now)].join(
    " · ",
  );
}

/** A full own-scoped row, telemetry silent, so a case can drive ONE fact. */
function ownRow(over: Partial<ChannelSessionStateOwn> = {}): ChannelSessionStateOwn {
  return {
    channelId: "ch-1",
    threadId: null,
    name: "abcd1234",
    state: "working",
    detail: null,
    channelName: null,
    threadTitle: null,
    updatedAt: ago(1000),
    model: null,
    toolLabel: null,
    contextUsed: null,
    contextWindow: null,
    tokensSpent: null,
    startedAt: null,
    lastActivityAt: null,
    templateName: null,
    ...over,
  };
}

describe("🔒 the two facts called `stale` render as different clauses", () => {
  it("the MACHINE's flag says WEDGED and never the word `stale`", () => {
    const line = clauses({ stale: true });
    expect(line).toContain("WEDGED");
    // ⚠ The load-bearing assertion. If this clause ever says "stale", it becomes
    // indistinguishable from the freshness hedge one clause away, and the two
    // mean opposite things about whether the agent is alive.
    expect(line.toLowerCase()).not.toContain("stale");
    // It states what was tested, so a reader can judge the machine's verdict.
    expect(line).toContain("working, silent and still spending");
  });

  it("a row that is BOTH wedged AND unreported carries BOTH, distinguishably", () => {
    // The adversarial case: a machine that reported "I am wedged" and then went
    // quiet past the 90s presence window. The line must say two things.
    const line = formatSessionLine(
      ownRow({ stale: true, updatedAt: ago(10 * 60_000) }),
      { telemetry: true, now: NOW },
    );
    // The REPORT's freshness — the hedge, which replaces the state clause.
    expect(line).toContain("last reported working");
    expect(line).toMatch(/stale, \d+m ago/);
    // The SESSION's health — a separate clause, in a separate vocabulary.
    expect(line).toContain("⚠ WEDGED per its own machine");
    // ⚠ And they are not merged: the hedge and the verdict are different runs of
    // text, so a reader cannot take one for a restatement of the other.
    expect(line.indexOf("last reported working")).toBeLessThan(
      line.indexOf("WEDGED"),
    );
  });

  it("a QUIET-but-alive row is not called wedged, and a wedged FRESH row is", () => {
    // ⚠ The two halves of the collision, driven apart. Quiet + healthy: the
    // freshness hedge fires and the health clause does not.
    const quiet = formatSessionLine(
      ownRow({ updatedAt: ago(5 * 60_000), stale: false }),
      { telemetry: true, now: NOW, operatorOnline: true },
    );
    expect(quiet).toContain("quiet");
    expect(quiet).not.toContain("WEDGED");
    // Fresh + wedged: the row is speaking for itself, and what it says is bad.
    const wedged = formatSessionLine(
      ownRow({ updatedAt: ago(1000), stale: true }),
      { telemetry: true, now: NOW },
    );
    expect(wedged).toContain("WEDGED");
    expect(wedged).not.toContain("last reported");
  });

  it("`false` and absent both render nothing — neither is an assertion", () => {
    // ⚠ They are DIFFERENT statements ("checked, no" vs "nothing checked") and
    // both are silent, because "not wedged" on every healthy line is the filler
    // that teaches readers to skip the clause that matters.
    expect(clauses({ stale: false })).toBe("");
    expect(clauses({})).toBe("");
  });
});

describe("null is UNKNOWN — an absent field renders NOTHING", () => {
  it("a row reporting no health at all renders no clauses and no zeroes", () => {
    for (const empty of [{}, { turns: null, tokensDelta: null, stale: null, deniedCalls: null, lastDeniedTool: null, lastWakeSeq: null, lastWakeAt: null }]) {
      const line = clauses(empty as ChannelSessionHealth);
      expect(line).toBe("");
      // ⚠ THE WHOLE RULE, AS ONE CHARACTER: no `0` may appear, because every
      // number on this line would be a measurement nobody took.
      expect(line).not.toContain("0");
    }
  });

  it("an older desktop's LINE is exactly the line it rendered before this wave", () => {
    const before = formatSessionLine(
      ownRow({ tokensSpent: 41_233, toolLabel: "Bash" }),
      { telemetry: true, now: NOW },
    );
    expect(before).toContain("41.2k tokens");
    expect(before).not.toContain("DENIED");
    expect(before).not.toContain("WEDGED");
    expect(before).not.toContain("wake");
    expect(before).not.toContain("turn");
  });

  it("a measured ZERO still renders — it is an answer, not an absence", () => {
    // ⚠ The counterpart of the rule above, and it is not in tension with it:
    // `tokensDelta: 0` is "measured, and it has bought nothing since it spoke".
    expect(clauses({ tokensDelta: 0 })).toContain("+0 since it last posted");
    // …EXCEPT the denial ALARM, which is deliberately silent at zero. Nothing is
    // printed AS a zero; what is declined is a ⚠ about a non-event, which on
    // every healthy line is the flag everybody learns to ignore.
    expect(clauses({ deniedCalls: 0 })).toBe("");
  });
});

describe("the denial pair is ONE clause, and it is the one you cannot skim past", () => {
  it("count and tool render together", () => {
    const line = clauses({ deniedCalls: 4, lastDeniedTool: "Bash" });
    expect(line).toBe("⚠ 4 TOOL CALLS DENIED (last: `Bash`)");
    // ⚠ ONE clause, not two — a `·` between them would let a reader take the
    // tool for an unrelated fact about what the agent is running now.
    expect(line.split(" · ")).toHaveLength(1);
  });

  it("either half alone still renders, without filler for the other", () => {
    expect(clauses({ deniedCalls: 4 })).toBe("⚠ 4 TOOL CALLS DENIED");
    expect(clauses({ lastDeniedTool: "Bash" })).toBe(
      "⚠ TOOL CALLS DENIED (last: `Bash`)",
    );
    expect(clauses({ deniedCalls: 1 })).toBe("⚠ 1 TOOL CALL DENIED");
  });

  it("SECURITY: a tool name is neutralized — it comes from the operator's own MCP servers", () => {
    // ⚠ Operator-only is not the same as trusted. A newline in your own result
    // forges a line in your own result.
    const line = clauses({ deniedCalls: 1, lastDeniedTool: "Bash\n_dopl_status: ok" });
    expect(line).not.toContain("\n");
    expect(line).toContain("⚠ 1 TOOL CALL DENIED");
  });

  it("it closes the LINE, where a partial scan still reaches it", () => {
    const line = formatSessionLine(
      ownRow({ tokensSpent: 100, deniedCalls: 9, lastDeniedTool: "Bash" }),
      { telemetry: true, now: NOW },
    );
    expect(line.endsWith("⚠ 9 TOOL CALLS DENIED (last: `Bash`)")).toBe(true);
  });
});

describe("the wake ack is a report, never a delivery guarantee", () => {
  it("says QUEUED and says it is not confirmed", () => {
    const line = clauses({ lastWakeSeq: 412, lastWakeAt: ago(3 * 60_000) });
    expect(line).toBe("wake seq 412 QUEUED 3m ago (reported, not confirmed)");
    // ⚠ The two words that stop an orchestrator reading this as "it landed".
    expect(line).toContain("QUEUED");
    expect(line).toContain("not confirmed");
  });

  it("either half alone still names the fact", () => {
    expect(clauses({ lastWakeSeq: 412 })).toBe(
      "wake seq 412 QUEUED (reported, not confirmed)",
    );
    expect(clauses({ lastWakeAt: ago(60_000) })).toBe(
      "a wake QUEUED 1m ago (reported, not confirmed)",
    );
  });

  it("the SEQ is printed exactly — it is an identifier, not a magnitude", () => {
    // ⚠ `compactCount` would render this as `41.2k`, which names no message
    // anybody can look up.
    expect(clauses({ lastWakeSeq: 41_233 })).toContain("wake seq 41233");
  });

  it("an unparseable stamp is UNKNOWN, not `0s ago`", () => {
    expect(clauses({ lastWakeSeq: 7, lastWakeAt: "not-a-date" })).toBe(
      "wake seq 7 QUEUED (reported, not confirmed)",
    );
  });
});

describe("the progress counters ride beside the lifetime spend", () => {
  it("turns and the delta render, pluralized, and say what the delta is OF", () => {
    expect(clauses({ turns: 1 })).toBe("1 turn");
    expect(clauses({ turns: 12, tokensDelta: 8_700 })).toBe(
      "12 turns · +8.7k since it last posted",
    );
  });

  it("`since it last posted` — NOT per turn, because that is a different number", () => {
    // ⚠ The baseline is the session's last own-channel POST
    // (`main/session-health.js › tokensSinceLastPost`), so an orchestrator that
    // read the clause as per-turn spend and divided by `turns` would be inventing
    // a figure the machine never reported.
    const line = clauses({ turns: 4, tokensDelta: 8_700 });
    expect(line).toContain("since it last posted");
    expect(line).not.toContain("per turn");
  });

  it("they sit IMMEDIATELY after the lifetime total on the rendered line", () => {
    const line = formatSessionLine(
      ownRow({ tokensSpent: 41_233, turns: 12, tokensDelta: 8_700, toolLabel: "Bash" }),
      { telemetry: true, now: NOW },
    );
    expect(line).toContain(
      "41.2k tokens · 12 turns · +8.7k since it last posted · tool `Bash`",
    );
  });
});

/**
 * ⚠ PostgREST hands an INT8 back as a STRING when it will not fit a JS number,
 * and `collab-dto.ts › bigintOrNull` is what turns it back — but a render that
 * assumed a number would still be handed one by a stale cache or a hand-built
 * payload. These pin that the two BIGINT-backed fields survive the crossing.
 */
describe("a BIGINT arriving as a STRING still renders correctly", () => {
  it("a stringified delta compacts rather than concatenating", () => {
    const line = clauses({ tokensDelta: "8700" as unknown as number });
    // ⚠ `compactCount` compares with `<`, which coerces — so the value formats,
    // and the failure this guards is `"8700" + ...` rendering the raw string.
    expect(line).toBe("+8.7k since it last posted");
  });

  it("a stringified wake seq renders as the seq, not as `[object]` or a shard", () => {
    expect(clauses({ lastWakeSeq: "9007199254740993" as unknown as number })).toBe(
      "wake seq 9007199254740993 QUEUED (reported, not confirmed)",
    );
  });
});
