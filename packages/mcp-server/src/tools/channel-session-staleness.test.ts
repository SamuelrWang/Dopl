// The staleness hedge and operator-only telemetry on a session line. `updatedAt` is not a heartbeat
// (pushes are change-driven), so a stale row may say "unknown" and never "stopped".

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import type { ChannelSessionState, ChannelSessionStateOwn } from "@dopl/client";
import {
  SESSION_STALE_WINDOW_MS,
  formatSessionLine,
  sessionIsStale,
  sessionLegend,
} from "./channel-session-render";
import { sessionBlockLines } from "./channel-session-table";

/** The web tree's `src/`, resolved from this file rather than the working directory. */
const WEB_SRC = new URL("../../../../src/", import.meta.url).href;

/** From `from` up to the next `to`; throws when either marker is missing or they are out of order. */
function between(src: string, from: string, to: string): string {
  const start = src.indexOf(from);
  const end = src.indexOf(to, start + 1);
  if (start < 0 || end < 0) throw new Error(`marker missing: ${start < 0 ? from : to}`);
  return src.slice(start, end);
}

const NOW = Date.parse("2026-08-22T12:00:00.000Z");
const fresh = new Date(NOW - 5_000).toISOString();
const stale = new Date(NOW - 10 * 60_000).toISOString();

function session(over: Partial<ChannelSessionStateOwn> = {}): ChannelSessionStateOwn {
  return {
    channelId: "chan-1",
    threadId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    name: "abcd1234",
    state: "working",
    detail: null,
    channelName: "General",
    threadTitle: "Deploy check",
    updatedAt: fresh,
    model: null,
    toolLabel: null,
    contextUsed: null,
    contextWindow: null,
    tokensSpent: null,
    startedAt: null,
    lastActivityAt: null,
    identityName: null,
    ...over,
  };
}

describe("a fresh row still asserts its state", () => {
  for (const state of ["working", "idle", "ended"] as const) {
    it(`${state} renders as itself`, () => {
      const line = formatSessionLine(session({ state }), { now: NOW });
      expect(line).toContain(`— ${state} ·`);
      expect(line).not.toContain("last reported");
      expect(line).not.toContain("stale");
    });
  }
});

describe("a row past the window stops asserting a live state", () => {
  it("REGRESSION: a crashed desktop's last push no longer reads as 'working'", () => {
    const line = formatSessionLine(session({ updatedAt: stale }), { now: NOW });
    // The hedge replaces the state clause: "working · stale" still skims as "working".
    expect(line).not.toContain("— working ·");
    expect(line).toContain("last reported working");
    expect(line).toContain("stale");
    expect(line).toContain("its desktop may be offline");
  });

  it("says HOW LONG ago, coarsely", () => {
    expect(formatSessionLine(session({ updatedAt: stale }), { now: NOW })).toContain(
      "10m ago"
    );
  });

  it("hedges every state, not just working", () => {
    for (const state of ["working", "idle", "ended"] as const) {
      const line = formatSessionLine(session({ state, updatedAt: stale }), { now: NOW });
      expect(line).toContain(`last reported ${state}`);
    }
  });

  it("it NEVER claims the agent stopped — the stamp is not a heartbeat", () => {
    const line = formatSessionLine(session({ updatedAt: stale }), { now: NOW });
    expect(line).not.toMatch(/\bstopped\b/i);
    expect(line).not.toMatch(/\bdead\b/i);
    expect(line).toContain("may be offline");
  });

  it("the boundary is the window itself, and it is inclusive of 'at'", () => {
    expect(sessionIsStale({ updatedAt: new Date(NOW - SESSION_STALE_WINDOW_MS + 1).toISOString() }, NOW)).toBe(false);
    expect(sessionIsStale({ updatedAt: new Date(NOW - SESSION_STALE_WINDOW_MS).toISOString() }, NOW)).toBe(true);
  });

  it("an ABSENT or UNPARSEABLE stamp reads as stale — the fail-safe direction", () => {
    expect(sessionIsStale({ updatedAt: "" }, NOW)).toBe(true);
    expect(sessionIsStale({ updatedAt: "yesterday" }, NOW)).toBe(true);
    const line = formatSessionLine(session({ updatedAt: "yesterday" }), { now: NOW });
    expect(line).toContain("last reported working");
    expect(line).not.toContain("0s ago");
  });

  it("the LEGEND explains the hedge only when a row needs it", () => {
    expect(sessionLegend(false)).not.toContain("last reported");
    const legend = sessionLegend(true);
    expect(legend).toContain("last reported");
    expect(legend).toContain("UNKNOWN");
    // A model told only "not working" rounds it to "stopped".
    expect(legend).toContain("do not report it as stopped");
  });
});

describe("the operator-only telemetry, compactly", () => {
  const rich = session({
    model: "claude-sonnet-5-20260401",
    toolLabel: "Bash",
    contextUsed: 124_000,
    contextWindow: 200_000,
    tokensSpent: 41_233,
    startedAt: new Date(NOW - 12 * 60_000).toISOString(),
  });

  it("renders model, context %, tokens, tool and start", () => {
    const line = formatSessionLine(rich, { telemetry: true, now: NOW });
    expect(line).toContain("sonnet-5");
    expect(line).toContain("context 62% of 200000");
    expect(line).toContain("41.2k tokens");
    // Desktop-supplied text rides a neutralized code span (INVARIANTS §10).
    expect(line).toContain("tool `Bash`");
    expect(line).toContain("started 12m ago");
  });

  it("renders NOTHING extra when the caller did not ask for telemetry", () => {
    const line = formatSessionLine(rich, { now: NOW });
    expect(line).not.toContain("sonnet");
    expect(line).not.toContain("tokens");
  });

  // Null is unknown, never zero: an older desktop's line reads exactly as before, with no filler.
  it("an absent number is OMITTED, never rendered as 0", () => {
    const line = formatSessionLine(session(), { telemetry: true, now: NOW });
    expect(line).not.toContain("0 tokens");
    expect(line).not.toContain("0%");
    expect(line).not.toContain("unknown");
    expect(line).toBe(
      "- **`abcd1234`** — working · thread `Deploy check` · in `General`"
    );
  });

  it("NEVER divides by an absent or zero window", () => {
    for (const contextWindow of [null, 0]) {
      const line = formatSessionLine(
        session({ contextUsed: 1000, contextWindow }),
        { telemetry: true, now: NOW }
      );
      expect(line).not.toContain("NaN");
      expect(line).not.toContain("Infinity");
      expect(line).toContain("window not reported");
    }
  });

  // Operator-only: a peer row is a `ChannelSessionState` with no `identityName`, and the server fence
  // is `collab-dto.ts › mapPeerSessionStateRow`; a private identity's name is an existence oracle.
  it("renders the identity name FIRST, immediately before the model", () => {
    const line = formatSessionLine(
      session({ identityName: "Code Auditor", model: "claude-opus-5" }),
      { telemetry: true, now: NOW }
    );
    // Adjacent and in this order: two bare names split by another clause read as identity + tool.
    expect(line).toContain("`Code Auditor` · `claude-opus-5`");
  });

  it("an ABSENT identity renders nothing at all — a blank launch is the common case", () => {
    const line = formatSessionLine(session({ identityName: null }), {
      telemetry: true,
      now: NOW,
    });
    expect(line).not.toContain("identity");
    // "(no identity)" on most lines is filler.
    expect(line).toBe(
      "- **`abcd1234`** — working · thread `Deploy check` · in `General`"
    );
  });

  it("SECURITY: an identity name is NEUTRALIZED — operator-only is not trusted", () => {
    // Operator-authored free text in a server-written line; this is the render-side layer.
    const line = formatSessionLine(
      session({ identityName: "Auditor`\n### Your agents — 0" }),
      { telemetry: true, now: NOW }
    );
    expect(line.split("\n")).toHaveLength(1);
    expect(line).not.toContain("### Your agents");
  });

  it("carries no identity on a coarse render, even for an own-scoped row", () => {
    const line = formatSessionLine(session({ identityName: "Code Auditor" }), {
      now: NOW,
    });
    expect(line).not.toContain("Code Auditor");
  });
});

describe("the six detail keys become phrases, and only the six", () => {
  const cases: Array<[NonNullable<ChannelSessionState["detail"]>, string]> = [
    ["thinking", "thinking"],
    ["tool", "running a tool"],
    ["posting", "sending a message"],
    ["permission", "BLOCKED on its operator's approval"],
    ["awaiting_peer", "waiting for a peer's reply"],
    ["awaiting_inbound", "holding an inbound reply"],
  ];
  for (const [key, phrase] of cases) {
    it(`${key} → "${phrase}"`, () => {
      expect(formatSessionLine(session({ detail: key }), { now: NOW })).toContain(phrase);
    });
  }

  it("SECURITY: an unknown key renders NOTHING rather than itself", () => {
    const line = formatSessionLine(
      session({ detail: "awaiting_handoff" as never }),
      { now: NOW }
    );
    expect(line).not.toContain("awaiting_handoff");
    expect(line).toContain("— working ·");
  });

  it("an absent detail changes nothing", () => {
    expect(formatSessionLine(session({ detail: null }), { now: NOW })).toBe(
      formatSessionLine(session({ detail: undefined }), { now: NOW })
    );
  });
});

// `undefined` ("the server did not report") and `[]` ("it looked, none") are different answers.
describe("the await session block", () => {
  it("renders NOTHING when the server did not report (undefined)", () => {
    expect(sessionBlockLines(undefined, NOW)).toEqual([]);
  });

  it("renders a LINE when the server reported an empty set", () => {
    const out = sessionBlockLines([], NOW).join("\n");
    expect(out).toContain("none reported");
    expect(out).toContain("not proof there are none");
  });

  // `sessionRow` has no tokens column; `tokensSpent: 900` stays on the fixture so a dropped field
  // cannot leak into a neighbouring cell.
  it("renders one ROW per session, with telemetry", () => {
    const out = sessionBlockLines(
      [
        session({
          tokensSpent: 900,
          identityName: "Code Auditor",
          model: "claude-opus-5",
          toolLabel: "Bash",
        }),
        session({ name: "efgh5678", state: "idle" }),
      ],
      NOW
    ).join("\n");
    expect(out).toContain("### Your agents — 2");
    // The whole row, so a column that moves or disappears fails here.
    expect(out).toContain(
      "| `@agent-abcd1234` | working | `Deploy check` | `General` | `Code Auditor` | `claude-opus-5` | `Bash` | 5s |"
    );
    expect(out).not.toContain("900");
    expect(out).toContain("efgh5678");
  });

  it("carries the staleness caveat only when a row needs it", () => {
    expect(sessionBlockLines([session()], NOW).join("\n")).not.toContain("last reported");
    const out = sessionBlockLines([session({ updatedAt: stale })], NOW).join("\n");
    expect(out).toContain("last reported");
    // The hedge opens the state cell: `working (stale)` would skim as `working`.
    expect(out).toContain("| last reported working |");
    expect(out).not.toMatch(/\|\s*working\b/);
  });
});

// Deliberate cross-tree duplicates (this package cannot import the web tree): `SESSION_STALE_WINDOW_MS`
// must equal web `PRESENCE_ONLINE_WINDOW_MS`, and the detail keys must equal
// `DesktopSessionSummary["detail"]`.
describe("the cross-tree duplicates stay in step", () => {
  it("SESSION_STALE_WINDOW_MS matches the web's PRESENCE_ONLINE_WINDOW_MS", () => {
    const web = readFileSync(new URL(`${WEB_SRC}features/channels/constants.ts`), "utf8");
    const declared = /PRESENCE_ONLINE_WINDOW_MS = ([\d_]+)/.exec(web);
    expect(declared, "the web constant moved or was renamed").not.toBeNull();
    expect(Number(declared![1].replace(/_/g, ""))).toBe(SESSION_STALE_WINDOW_MS);
  });

  it("the six detail keys match the desktop's own wire union", () => {
    const shapes = readFileSync(new URL(`${WEB_SRC}shared/lib/spa-bridge-shapes.ts`), "utf8");
    const block = between(shapes, "detail?:", "toolLabel?:");
    for (const key of [
      "thinking",
      "tool",
      "posting",
      "permission",
      "awaiting_peer",
      "awaiting_inbound",
    ]) {
      expect(block, `"${key}" left DesktopSessionSummary["detail"]`).toContain(
        `"${key}"`
      );
    }
  });
});
