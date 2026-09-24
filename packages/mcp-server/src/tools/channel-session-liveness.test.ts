// Two telemetry-line defects, each pinned by the shape actually observed: a `[1m]` model suffix
// blanked into a fake relative time (F-293), and an idle-but-alive agent reported as maybe-offline
// (F-294). The two render paths are also pinned byte-identical for one DTO.

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { ChannelSessionStateOwn, DoplClient } from "@dopl/client";
import { opReadSessions } from "./channel-ops-read";
import {
  formatSessionLine,
  sessionLegend,
  shortModelLabel,
} from "./channel-session-render";
import { SESSION_TABLE_HEAD, sessionBlockLines } from "./channel-session-table";
import { channelDoctrine } from "./channel-doctrine";

/** From `from` up to the next `to`; throws when either marker is missing or they are out of order. */
function between(src: string, from: string, to: string): string {
  const start = src.indexOf(from);
  const end = src.indexOf(to, start + 1);
  if (start < 0 || end < 0) throw new Error(`marker missing: ${start < 0 ? from : to}`);
  return src.slice(start, end);
}

const NOW = Date.parse("2026-08-23T12:00:00.000Z");
const fresh = new Date(NOW - 5_000).toISOString();
const quietFor = (ms: number) => new Date(NOW - ms).toISOString();

/** Every telemetry field populated: a sparse row could hide a clause-join or truncation bug. */
function rich(
  over: Partial<ChannelSessionStateOwn> = {},
): ChannelSessionStateOwn {
  return {
    channelId: "chan-1",
    threadId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    name: "flint",
    state: "working",
    detail: "tool",
    channelName: "General",
    threadTitle: "Deploy check",
    updatedAt: fresh,
    model: "claude-opus-5",
    toolLabel: "Bash",
    contextUsed: 124_000,
    contextWindow: 1_000_000,
    tokensSpent: 41_233,
    startedAt: new Date(NOW - 12 * 60_000).toISOString(),
    lastActivityAt: new Date(NOW - 30_000).toISOString(),
    identityName: null,
    ...over,
  };
}

const CHANNEL = {
  id: "chan-1",
  slug: "general",
  name: "General",
  visibility: "private",
};

function stubClient(
  sessions: ChannelSessionStateOwn[],
  operatorOnline?: boolean,
): DoplClient {
  return {
    listChannels: vi.fn(async () => [CHANNEL]),
    listWorkspaceMembers: vi.fn(async () => []),
    listChannelSessions: vi.fn(async () => ({
      sessions,
      ...(operatorOnline === undefined ? {} : { operatorOnline }),
    })),
  } as unknown as DoplClient;
}

/** Table rows only, header dropped by identity; callers assert the length, since two empty arrays are equal. */
function sessionLines(text: string): string[] {
  return text
    .split("\n")
    .filter((l) => l.startsWith("| ") && !SESSION_TABLE_HEAD.includes(l));
}

beforeEach(() => {
  // Both paths call `Date.now()` themselves, so the clock is frozen rather than a stamp passed to one.
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// The account-wide renderer is diffed in `channel-session-liveness-account.test.ts`.

describe('op="status" and the holding read\'s session block render IDENTICALLY', () => {
  const cases: Array<[string, ChannelSessionStateOwn]> = [
    ["the full rich row", rich()],
    [
      "no identity, suffixed model — the observed shape",
      rich({ model: "claude-opus-5[1m]" }),
    ],
    ["an identity AND a model", rich({ identityName: "Code Auditor" })],
    [
      "every telemetry field absent — an older desktop",
      rich({
        model: null,
        toolLabel: null,
        contextUsed: null,
        contextWindow: null,
        tokensSpent: null,
        startedAt: null,
        lastActivityAt: null,
      }),
    ],
    ["a quiet row", rich({ updatedAt: quietFor(10 * 60_000) })],
  ];

  for (const [label, session] of cases) {
    it(`${label} — byte-identical from both paths`, async () => {
      const res = await opReadSessions(stubClient([session]));
      const fromRead = sessionLines(res.content[0].text);
      const fromAwait = sessionLines(sessionBlockLines([session]).join("\n"));
      // The length check keeps the diff real: renamed or dropped rows would leave two empty arrays.
      expect(fromRead).toHaveLength(1);
      // A hand-rolled header would survive the filter as a "row" on one side only.
      expect(fromAwait).toEqual(fromRead);
    });
  }

  it("and identically again once presence is in play", async () => {
    const session = rich({ updatedAt: quietFor(10 * 60_000) });
    const res = await opReadSessions(stubClient([session], true));
    const fromRead = sessionLines(res.content[0].text);
    expect(fromRead).toHaveLength(1);
    expect(
      sessionLines(sessionBlockLines([session], undefined, true).join("\n")),
    ).toEqual(fromRead);
  });
});


describe("F-293 — a model id can never split into two bare names", () => {
  it("REGRESSION: `claude-opus-5[1m]` rendered `opus-5 1m` — a fake relative time", () => {
    const line = formatSessionLine(rich({ model: "claude-opus-5[1m]" }), {
      telemetry: true,
      now: NOW,
    });
    expect(line).not.toContain("opus-5 1m");
    expect(line).toContain("`claude-opus-5-1m`");
  });

  it("the long-context suffix is KEPT, not dropped — it is a real fact about the run", () => {
    // Dropping it would render the 200k and 1M variants of one id as the same name.
    expect(shortModelLabel("claude-sonnet-4-6[1m]")).toBe("claude-sonnet-4-6-1m");
    expect(shortModelLabel("claude-opus-4-6[1m]")).toBe("claude-opus-4-6-1m");
    expect(shortModelLabel("claude-opus-4-6")).toBe("claude-opus-4-6");
  });

  it("no whitespace survives into the model slot, from any desktop-supplied id", () => {
    for (const model of [
      "claude-opus-5[1m]",
      "claude-opus-5 [1m]",
      "opus 5",
      "claude-opus-5{beta}",
      "claude-opus-5|next",
      "  claude-opus-5  ",
    ]) {
      expect(shortModelLabel(model), model).not.toMatch(/\s/);
    }
  });

  // With no identity, a two-token model span reads as `identity · model`.
  it("with NO identity the line carries exactly ONE bare name", () => {
    const line = formatSessionLine(rich({ model: "claude-opus-5[1m]" }), {
      telemetry: true,
      now: NOW,
    });
    // The model is the only bare-name clause; the others are code spans.
    const clauses = line.split(" · ");
    const bareNames = clauses.filter((c) => /^`[^`]+`$/.test(c));
    expect(bareNames).toEqual(["`claude-opus-5-1m`"]);
    expect(channelDoctrine()).toContain(
      "The MODEL is always ONE unbroken token, so a name with a space in it is an identity.",
    );
  });

  it("still never invents a name, and still renders an unknown id as itself", () => {
    expect(shortModelLabel("claude-opus-5")).toBe("claude-opus-5");
    expect(shortModelLabel("claude-opus-4-5-20251101")).toBe("claude-opus-4-5");
    expect(shortModelLabel("gpt-5.5-codex")).toBe("gpt-5.5-codex");
    expect(shortModelLabel("some-future-model")).toBe("some-future-model");
    // A strip that would empty the label falls back to the original.
    expect(shortModelLabel("claude-")).toBe("claude-");
    expect(shortModelLabel("[[[")).toBe("[[[");
  });

  it("an all-punctuation id fails the ORDINARY way, in inlineOr", () => {
    const line = formatSessionLine(rich({ model: "[[[" }), {
      telemetry: true,
      now: NOW,
    });
    // Not a blank span and not a fabricated name: the existing fallback.
    expect(line).toContain("(unnamed model)");
  });

  // `shortModelLabel` must join exactly the characters `neutralizeInline` blanks, or F-293 reopens.
  it("the joined class covers every character the neutralizer blanks", () => {
    const body = between(
      readFileSync(new URL("./narration.ts", import.meta.url), "utf8"),
      "export function neutralizeInline",
      "export function inlineOr",
    );
    // Every character class `neutralizeInline` replaces with a space, as source.
    const blanked = body.match(/\.replace\(\/\[[^\n]*?\/g[u]?, " "\)/g) ?? [];
    expect(
      blanked.length,
      "the blanking replaces moved",
    ).toBeGreaterThanOrEqual(1);
    const source = blanked.join("");
    // Behaviour, not just source: each character must come back joined.
    for (const ch of ["`", "*", "_", "#", ">", "[", "]", "{", "}", "|"]) {
      expect(source, `${ch} left neutralizeInline's blanking class`).toContain(
        ch,
      );
      expect(shortModelLabel(`a${ch}b`), ch).toBe("a-b");
    }
  });
});


describe("F-294 — an idle-but-alive agent is no longer reported as maybe-gone", () => {
  const quiet = rich({
    state: "idle",
    detail: null,
    updatedAt: quietFor(4 * 60_000),
  });

  it("REGRESSION: presence FRESH — the row reads unchanged, not unknown", () => {
    const line = formatSessionLine(quiet, {
      telemetry: true,
      now: NOW,
      operatorOnline: true,
    });
    expect(line).not.toContain("may be offline");
    expect(line).not.toContain("last reported");
    expect(line).toContain("— idle · quiet 4m");
    expect(line).toContain("UNCHANGED, not unknown");
  });

  it("presence STALE — today's hedge, word for word", () => {
    const line = formatSessionLine(quiet, {
      telemetry: true,
      now: NOW,
      operatorOnline: false,
    });
    expect(line).toContain("last reported idle");
    expect(line).toContain("its desktop may be offline");
  });

  it("presence NOT REPORTED — the hedge, because an unreported fact is not evidence of life", () => {
    // An older server sends no key; reading absence as "online" would hide a crashed desktop.
    const line = formatSessionLine(quiet, { telemetry: true, now: NOW });
    expect(line).toContain("its desktop may be offline");
  });

  it("a FRESH row is untouched by presence, in either direction", () => {
    for (const operatorOnline of [true, false, undefined]) {
      const line = formatSessionLine(rich(), {
        telemetry: true,
        now: NOW,
        operatorOnline,
      });
      expect(line).toContain("— working ·");
      expect(line).not.toContain("quiet");
      expect(line).not.toContain("last reported");
    }
  });

  // Presence says a report is still current; it does not license dating a stamp we cannot read.
  it("an UNREADABLE stamp keeps the old hedge even under a live heartbeat", () => {
    for (const updatedAt of ["", "yesterday"]) {
      const line = formatSessionLine(rich({ updatedAt }), {
        telemetry: true,
        now: NOW,
        operatorOnline: true,
      });
      expect(line, updatedAt).toContain("last reported working");
      expect(line, updatedAt).not.toContain("quiet");
    }
  });

  it("it still never claims the agent stopped, on EITHER branch", () => {
    for (const operatorOnline of [true, false]) {
      const line = formatSessionLine(quiet, { now: NOW, operatorOnline });
      expect(line).not.toMatch(/\bstopped\b/i);
      expect(line).not.toMatch(/\bdead\b/i);
    }
  });

  it("the quiet reading is NOT sold as a fresh observation", () => {
    const line = formatSessionLine(quiet, { now: NOW, operatorOnline: true });
    // A failed push also leaves a live machine looking quiet, so never "as of now".
    expect(line).not.toMatch(/as of now|right now|currently/i);
  });
});

describe("F-294 — the legend explains the reading the page actually contains", () => {
  // The quiet reading is `(unchanged)` in the state cell, and the legend teaches that form.
  it("a page of quiet rows under a live machine teaches the QUIET caveat", () => {
    const legend = sessionLegend(true, true);
    expect(legend).toContain("**(unchanged)** is ALIVE");
    expect(legend).not.toContain("desktop may be asleep");
    // The one row that can still take the other branch is named too.
    expect(legend).toContain("last reported <state>");
  });

  it("a page of quiet rows under a quiet machine keeps the UNKNOWN caveat", () => {
    for (const operatorOnline of [false, undefined]) {
      const legend = sessionLegend(true, operatorOnline);
      expect(legend).toContain("Treat it as UNKNOWN");
      // A page of "last reported" cells must not be handed the alive-branch caveat.
      expect(legend).not.toContain("(unchanged)");
    }
  });

  it("no quiet row, no caveat at all", () => {
    expect(sessionLegend(false, true)).not.toContain("(unchanged)");
    expect(sessionLegend(false, false)).not.toContain("last reported <state>");
  });

  it("the await block branches the same way its ROWS did", () => {
    const stale = rich({ updatedAt: quietFor(10 * 60_000) });
    const alive = sessionBlockLines([stale], NOW, true).join("\n");
    const gone = sessionBlockLines([stale], NOW, false).join("\n");
    // The row and the caveat move together; a block whose cells and legend disagree is the failure.
    expect(alive).toContain("| working (unchanged) ·");
    expect(alive).toContain("**(unchanged)** is ALIVE");
    expect(alive).not.toContain("desktop may be gone");
    expect(gone).toContain("| last reported working ·");
    expect(gone).toContain("desktop may be gone");
    expect(gone).not.toContain("(unchanged)");
  });
});


describe('op="status" carries the presence fact end to end', () => {
  it("an older server (no key) renders exactly the pre-F-294 page", async () => {
    const session = rich({ updatedAt: quietFor(10 * 60_000) });
    const text = (await opReadSessions(stubClient([session]))).content[0].text;
    // The hedge opens the cell; the legend carries the "asleep, signed out, or gone" half once per page.
    expect(text).toContain("| last reported working ·");
    expect(text).not.toContain("(unchanged)");
    expect(text).toContain("its desktop may be asleep");
    expect(text).toContain("Treat it as UNKNOWN");
  });

  it("a live heartbeat changes the ROW AND the legend together", async () => {
    const session = rich({ updatedAt: quietFor(10 * 60_000) });
    const text = (await opReadSessions(stubClient([session], true))).content[0]
      .text;
    // The reading is in the state cell and the age in the `idle` column; both are asserted.
    expect(text).toContain("| working (unchanged) ·");
    expect(text).toContain("| 10m |");
    expect(text).toContain("**(unchanged)** is ALIVE");
    expect(text).not.toContain("last reported working");
    expect(text).not.toContain("its desktop may be asleep");
  });
});
