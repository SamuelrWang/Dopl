/**
 * TWO PRODUCTION DEFECTS IN THE TELEMETRY LINE, EACH PINNED BY THE SHAPE THAT
 * WAS ACTUALLY OBSERVED.
 *
 * ⚠ **F-293 — A TIME-SHAPED FRAGMENT IN THE NAME SEGMENT.** One session rendered
 * `` `opus-5` `` from one call and `` `opus-5 1m` `` from another. `1m` is
 * byte-for-byte what `coarseAge` emits between 30s and 90s, it sat one clause
 * away from `started 12m ago`, and the session had NO TEMPLATE — so under
 * the doctrine's "two bare names" rule (once `SESSION_TELEMETRY_NOTE`'s, now
 * `CHANNEL_DOCTRINE`'s) an operator reads a WINDOW SUFFIX as a template or a
 * model. The leak is not in either call path: it is the
 * model id itself. The bundled CLI ships `claude-opus-5[1m]` for the explicit
 * long-context variant (`main/session-model.js › contextWindowFor` reads exactly
 * that suffix), and `narration.ts › neutralizeInline` blanks `[` and `]` to
 * SPACES because they are markdown structure. One id became two tokens.
 *
 * ⚠ **F-294 — "its desktop may be offline" ABOUT A MACHINE THAT WAS FINE.** The
 * push is change-driven and the staleness window is 90s, so an idle-but-alive
 * agent crossed the line in ~2 minutes and was reported with the same words as a
 * crash. `agent_presence` DOES beat on a timer, unconditionally, and joining the
 * caller's OWN presence separates the two.
 *
 * ⚠ **AND THE FIRST TEST HERE IS THE ONE THAT SETTLED THE ARGUMENT.** The two
 * render paths — `read_sessions`' page and the `await` hold's session block —
 * were SUSPECTED of diverging, because the same session looked different from
 * each. They do not: driven with one identical DTO they are byte-identical, and
 * that is pinned below so the suspicion never has to be re-litigated. What
 * differed was the ROW, at two moments in one session's life (the operator's
 * picked id before the SDK's `system/init` reports the live one, the CLI's own
 * suffixed id after).
 */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type {
  ChannelSessionStateOwn,
  DoplClient,
} from "@dopl/client";
import type { WorkspaceDirectory } from "../workspace-directory.js";
import { opReadSessions } from "./channel-ops-read";
import { opReadSessionsAccount } from "./channel-ops-account";
import {
  formatSessionLine,
  sessionLegend,
  shortModelLabel,
} from "./channel-session-render";
// ⚠ THE TABLE MOVED OUT OF THE RENDERER (T13, 2026-09-02) at the 500-line cap,
// along the seam that was already there: `channel-session-render.ts` answers
// "what STATE is this row in" and still owns every predicate above, and
// `channel-session-table.ts` answers "how does a PAGE of them render". Both
// surfaces this file diffs are built from the constants below, so the identity
// case still compares two renders of ONE definition.
import { SESSION_TABLE_HEAD, sessionBlockLines } from "./channel-session-table";
// ⚠ `SESSION_TELEMETRY_NOTE` IS DELETED (T13). Its ~800 standing chars rode on
// every `read_sessions` page; the promises it made are in `CHANNEL_DOCTRINE`,
// served once by op="help" and the MCP resource. The F-293 pin below reads the
// promise there rather than dropping it with the constant.
import { CHANNEL_DOCTRINE } from "./channel-doctrine";

const NOW = Date.parse("2026-08-23T12:00:00.000Z");
const fresh = new Date(NOW - 5_000).toISOString();
const quietFor = (ms: number) => new Date(NOW - ms).toISOString();

/**
 * THE RICH ROW, exactly as an own-scoped read maps it. ⚠ Every telemetry field
 * is populated on purpose: the F-293 hypothesis under test was that a clause
 * join or a truncation behaves differently once the fuller set is present, so a
 * sparse fixture would have proved nothing.
 */
function rich(over: Partial<ChannelSessionStateOwn> = {}): ChannelSessionStateOwn {
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
    templateName: null,
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

/**
 * The session ROWS out of whatever a path rendered — the only part both share.
 *
 * ⚠ **TABLE ROWS SINCE T13, NOT `- **` LINES.** Both surfaces stopped rendering
 * the prose line and now emit `SESSION_TABLE_HEAD` + one `sessionRow` per
 * session, so the shape this diff reads changed and the diff itself did not: the
 * header and its alignment row are dropped (they are literals, held by identity
 * against the exported constant rather than by a `---` sniff, so a future column
 * cannot slip past this filter) and what is left is exactly one row per session.
 * ⚠ The old filter would now match NOTHING and every case below would pass
 * vacuously by comparing two empty arrays — which is why the emptiness is
 * asserted at the call sites.
 */
function sessionLines(text: string): string[] {
  return text
    .split("\n")
    .filter((l) => l.startsWith("| ") && !SESSION_TABLE_HEAD.includes(l));
}

beforeEach(() => {
  // ⚠ BOTH PATHS CALL `Date.now()` THEMSELVES (`opReadSessions` strikes one
  // `now` per page; `sessionBlockLines` defaults one per block), so the only way
  // to diff them honestly is to freeze the clock rather than to pass a stamp
  // into one and not the other.
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── THE DIFF: ONE DTO, BOTH PATHS ────────────────────────────────────

/**
 * ⚠ **THE THIRD SURFACE (2026-09-02).** `op="read_sessions"` with NO `channel`
 * renders the same sessions grouped by room, and until this date it rendered
 * `formatSessionLine` — the PRE-TERSE prose form — while its per-channel sibling
 * rendered the table. Two shapes for one session is exactly the drift this file
 * exists to catch, so the account path is driven here too.
 */
const UNLOCKED: WorkspaceDirectory = {
  lockedWorkspaceId: () => null,
} as unknown as WorkspaceDirectory;

function accountStubClient(sessions: ChannelSessionStateOwn[]): DoplClient {
  return {
    getAccountStatus: vi.fn(async () => ({
      channels: [
        {
          channelId: "chan-1",
          channelName: "General",
          channelSlug: "general",
          workspaceId: "ws-1",
          lastSeq: null,
          lastMessageAt: null,
          unread: null,
          sessions,
          waiting: [],
        },
      ],
      operatorOnline: undefined,
      since: null,
      truncated: { channels: false, unread: false, waiting: false },
    })),
  } as unknown as DoplClient;
}

describe("read_sessions and the await session block render IDENTICALLY", () => {
  const cases: Array<[string, ChannelSessionStateOwn]> = [
    ["the full rich row", rich()],
    ["no template, suffixed model — the observed shape", rich({ model: "claude-opus-5[1m]" })],
    ["a template AND a model", rich({ templateName: "Code Auditor" })],
    ["every telemetry field absent — an older desktop", rich({
      model: null,
      toolLabel: null,
      contextUsed: null,
      contextWindow: null,
      tokensSpent: null,
      startedAt: null,
      lastActivityAt: null,
    })],
    ["a quiet row", rich({ updatedAt: quietFor(10 * 60_000) })],
  ];

  for (const [label, session] of cases) {
    it(`${label} — byte-identical from both paths`, async () => {
      const res = await opReadSessions(stubClient([session]));
      const fromRead = sessionLines(res.content[0].text);
      const fromAwait = sessionLines(sessionBlockLines([session]).join("\n"));
      // ⚠ THE LENGTH IS THE GUARD THAT THE DIFF IS REAL. `sessionLines` filters,
      // so a surface that renamed or dropped its rows would hand this an empty
      // array from BOTH sides and the equality below would pass on nothing.
      expect(fromRead).toHaveLength(1);
      // ⚠ AND A SURFACE THAT SHIPPED ITS OWN HEADER WOULD FAIL HERE TOO — the
      // filter drops only `SESSION_TABLE_HEAD` verbatim, so a hand-rolled one
      // survives as a "row" on one side and not the other.
      expect(fromAwait).toEqual(fromRead);
    });

    it(`${label} — and the ACCOUNT-WIDE read matches them too`, async () => {
      // ⚠ MUTATION CHECK. Render `formatSessionLine` in
      // `channel-ops-account.ts` again and `sessionLines` finds nothing on this
      // side, so the length assertion fails before the equality can pass on two
      // empty arrays.
      const res = await opReadSessionsAccount(
        accountStubClient([session]),
        UNLOCKED,
      );
      const fromAccount = sessionLines(res.content[0].text);
      expect(fromAccount).toHaveLength(1);
      const fromRead = sessionLines(
        (await opReadSessions(stubClient([session]))).content[0].text,
      );
      expect(fromAccount).toEqual(fromRead);
    });
  }

  it("the account-wide page ships the SHARED header, not a hand-rolled one", async () => {
    const res = await opReadSessionsAccount(accountStubClient([rich()]), UNLOCKED);
    for (const line of SESSION_TABLE_HEAD) {
      expect(res.content[0].text).toContain(line);
    }
  });

  /**
   * ⚠ The presence fact must reach BOTH paths or the surface contradicts itself
   * about the same machine within one orchestrator loop — which is the shape of
   * the bug that was originally suspected here.
   */
  it("and identically again once presence is in play", async () => {
    const session = rich({ updatedAt: quietFor(10 * 60_000) });
    const res = await opReadSessions(stubClient([session], true));
    const fromRead = sessionLines(res.content[0].text);
    // ⚠ Same reason as above: without this the equality can be satisfied by two
    // empty filters, which is precisely how this case went quiet under T13.
    expect(fromRead).toHaveLength(1);
    expect(sessionLines(sessionBlockLines([session], undefined, true).join("\n")))
      .toEqual(fromRead);
  });
});

// ── F-293: THE MODEL SLOT IS ONE TOKEN ───────────────────────────────

describe("F-293 — a model id can never split into two bare names", () => {
  /**
   * ⚠ THE LIVE REPRODUCTION. Observed twice by test agents against a real
   * session, on a build that had never seen a `[1m]` id in a test.
   */
  it("REGRESSION: `claude-opus-5[1m]` rendered `opus-5 1m` — a fake relative time", () => {
    const line = formatSessionLine(rich({ model: "claude-opus-5[1m]" }), {
      telemetry: true,
      now: NOW,
    });
    expect(line).not.toContain("opus-5 1m");
    expect(line).toContain("`opus-5-1m`");
  });

  it("the long-context suffix is KEPT, not dropped — it is a real fact about the run", () => {
    // ⚠ Dropping it would be the other kind of lie: two different models (200k
    // and 1M variants of one id) rendering as the same name.
    expect(shortModelLabel("claude-sonnet-4-6[1m]")).toBe("sonnet-4-6-1m");
    expect(shortModelLabel("claude-opus-4-6[1m]")).toBe("opus-4-6-1m");
    expect(shortModelLabel("claude-opus-4-6")).toBe("opus-4-6");
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

  /**
   * ⚠ THE PROMISE IS ONLY WORTH ANYTHING IF IT IS CHECKABLE. With no template,
   * a two-token model span reads as `template · model` to exactly the skimming
   * orchestrator the doctrine's READING "read_sessions" section is written for.
   */
  it("with NO template the line carries exactly ONE bare name", () => {
    const line = formatSessionLine(rich({ model: "claude-opus-5[1m]" }), {
      telemetry: true,
      now: NOW,
    });
    // The name span, the thread title, the channel and the tool are the other
    // code spans; the model is the only bare NAME clause.
    const clauses = line.split(" · ");
    const bareNames = clauses.filter((c) => /^`[^`]+`$/.test(c));
    expect(bareNames).toEqual(["`opus-5-1m`"]);
    // ⚠ RE-POINTED, NOT DROPPED (T13). The promise this render keeps used to be
    // a constant printed under every page; it is doctrine now, so the words are
    // asserted where a reader is actually served them.
    expect(CHANNEL_DOCTRINE).toContain("ONE unbroken token");
  });

  it("still never invents a name, and still renders an unknown id as itself", () => {
    expect(shortModelLabel("claude-opus-5")).toBe("opus-5");
    expect(shortModelLabel("claude-opus-4-5-20251101")).toBe("opus-4-5");
    expect(shortModelLabel("some-future-model")).toBe("some-future-model");
    // ⚠ A strip that would EMPTY the label falls back to the original — both
    // strips, the old vendor-prefix one and the new one-token join.
    expect(shortModelLabel("claude-")).toBe("claude-");
    expect(shortModelLabel("[[[")).toBe("[[[");
  });

  it("an all-punctuation id fails the ORDINARY way, in inlineOr", () => {
    const line = formatSessionLine(rich({ model: "[[[" }), {
      telemetry: true,
      now: NOW,
    });
    // ⚠ Not a blank span, and not a fabricated name: the existing fallback.
    expect(line).toContain("(unnamed model)");
  });

  /**
   * ⚠ TWO SIDES HELD AGAINST EACH OTHER, not a comment. `shortModelLabel` joins
   * exactly the characters `neutralizeInline` would blank; a class that grew in
   * one file and not the other re-opens F-293 silently.
   */
  it("the joined class covers every character the neutralizer blanks", () => {
    const narration = readFileSync("src/tools/narration.ts", "utf8");
    const body = narration.slice(
      narration.indexOf("export function neutralizeInline"),
      narration.indexOf("export function inlineOr"),
    );
    expect(body, "neutralizeInline moved or was renamed").not.toBe("");
    // Every character class `neutralizeInline` REPLACES WITH A SPACE, as source.
    const blanked = body.match(/\.replace\(\/\[[^\n]*?\/g[u]?, " "\)/g) ?? [];
    expect(blanked.length, "the blanking replaces moved").toBeGreaterThanOrEqual(1);
    const source = blanked.join("");
    // ⚠ BEHAVIOUR, not just source: each character must come back JOINED here.
    for (const ch of ["`", "*", "_", "#", ">", "[", "]", "{", "}", "|"]) {
      expect(source, `${ch} left neutralizeInline's blanking class`).toContain(ch);
      expect(shortModelLabel(`a${ch}b`), ch).toBe("a-b");
    }
  });
});

// ── F-294: A QUIET ROW UNDER A LIVE MACHINE ──────────────────────────

describe("F-294 — an idle-but-alive agent is no longer reported as maybe-gone", () => {
  const quiet = rich({ state: "idle", detail: null, updatedAt: quietFor(4 * 60_000) });

  /**
   * ⚠ THE LIVE REPRODUCTION: ~2 minutes of an idle agent doing nothing wrong,
   * and the surface told its orchestrator the desktop might be offline.
   */
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
    // ⚠ An older server sends no key. Reading absence as "online" would restore
    // the crashed-desktop-reads-as-working defect against every older deployment.
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

  /**
   * ⚠ THE FAIL-SAFE DIRECTION SURVIVES THE NEW BRANCH. Presence licenses us to
   * say a report is still current; it does not license us to DATE a report whose
   * own stamp we cannot read.
   */
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
    // ⚠ A push that FAILED also leaves a live machine looking quiet, so the
    // word is "quiet"/"unchanged" and never "as of now".
    expect(line).not.toMatch(/as of now|right now|currently/i);
  });
});

describe("F-294 — the legend explains the reading the page actually contains", () => {
  /**
   * ⚠ **THE CAVEAT MOVED WORDS, NOT MEANING** (T13). The quiet reading is
   * spelled `(unchanged)` in a state CELL now — the age it used to carry
   * inline is read off the `idle` column — so the legend teaches THAT form.
   * The assertion is still "the alive branch is taught and the offline one is
   * not"; only the string the branch is named by changed.
   */
  it("a page of quiet rows under a live machine teaches the QUIET caveat", () => {
    const legend = sessionLegend(true, true);
    expect(legend).toContain("**(unchanged)** is ALIVE");
    expect(legend).not.toContain("desktop may be asleep");
    // ⚠ The one row that can still take the other branch is named, so a mixed
    // page is not left with an unexplained form.
    expect(legend).toContain("last reported <state>");
  });

  it("a page of quiet rows under a quiet machine keeps the UNKNOWN caveat", () => {
    for (const operatorOnline of [false, undefined]) {
      const legend = sessionLegend(true, operatorOnline);
      expect(legend).toContain("Treat it as UNKNOWN");
      // ⚠ `(unchanged)` for `quiet Xm`: a page whose cells all read "last
      // reported <state>" must not be handed the alive-branch caveat, which is
      // the wrong lesson and worse than none.
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
    // ⚠ THE ROW AND THE CAVEAT MOVE TOGETHER, and both are checked on each
    // branch — a block whose cells say one thing and whose closing line says
    // the other is the exact failure this case was written for.
    expect(alive).toContain("| working (unchanged) ·");
    expect(alive).toContain("**(unchanged)** is ALIVE");
    expect(alive).not.toContain("desktop may be gone");
    expect(gone).toContain("| last reported working ·");
    expect(gone).toContain("desktop may be gone");
    expect(gone).not.toContain("(unchanged)");
  });
});

// ── THE WIRE CONTRACT THE RENDER LEANS ON ────────────────────────────

describe("read_sessions carries the presence fact end to end", () => {
  it("an older server (no key) renders exactly the pre-F-294 page", async () => {
    const session = rich({ updatedAt: quietFor(10 * 60_000) });
    const text = (await opReadSessions(stubClient([session]))).content[0].text;
    // ⚠ THE HEDGE IS IN THE CELL NOW, AND IT IS STILL FIRST. `its desktop may
    // be offline` was the prose line's trailing clause; the row states the
    // tense and the LEGEND carries the "may be asleep, signed out, or gone"
    // half exactly once for the page instead of once per row.
    expect(text).toContain("| last reported working ·");
    expect(text).not.toContain("(unchanged)");
    expect(text).toContain("its desktop may be asleep");
    expect(text).toContain("Treat it as UNKNOWN");
  });

  it("a live heartbeat changes the ROW AND the legend together", async () => {
    const session = rich({ updatedAt: quietFor(10 * 60_000) });
    const text = (await opReadSessions(stubClient([session], true))).content[0].text;
    // ⚠ `quiet 10m` SPLIT INTO TWO CELLS (T13) and both halves are still
    // asserted: the state cell carries the READING and the `idle` column
    // carries the NUMBER. Dropping either would let a page say "alive" with no
    // age, or print an age with no reading of it.
    expect(text).toContain("| working (unchanged) ·");
    expect(text).toContain("| 10m |");
    expect(text).toContain("**(unchanged)** is ALIVE");
    // ⚠ Neither the row nor the legend may still hedge — this is the "together"
    // the case is named for, and the offline half must be gone from BOTH.
    expect(text).not.toContain("last reported working");
    expect(text).not.toContain("its desktop may be asleep");
  });
});
