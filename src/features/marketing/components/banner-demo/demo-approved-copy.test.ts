/**
 * **THE APPROVAL PIN — EVERY LINE THE HERO DEMO RENDERS, AS SAMUEL APPROVED IT**
 * (#4185, 2026-10-12; the three thread openers approved as written).
 *
 * Source of truth for WORDING: KB `codebase-cleanup` › "Landing Demo Script v3 (for
 * Samuel)". This file is the checked copy of that approval, and its only job is to make a
 * change to Samuel's copy IMPOSSIBLE TO MAKE QUIETLY.
 *
 * ── WHY A LITERAL TABLE AND NOT `toMatchSnapshot()` ─────────────────────────────────────
 *
 * 🔴 **A VITEST SNAPSHOT WOULD NOT HAVE BITTEN.** `toMatchSnapshot` and
 * `toMatchInlineSnapshot` both regenerate under `vitest -u`, which is a routine thing to
 * run after an unrelated failure — so the exact edit this pin exists to stop (one word
 * changed, tests re-blessed, nobody reads the `.snap` diff) would have passed. A hardcoded
 * table cannot be regenerated: changing the copy means editing THIS file by hand, in the
 * same commit, where a reviewer sees it next to the change.
 *
 * ── WHY THIS IS ALLOWED TO HOLD THE LINES WHEN NOTHING ELSE IS ─────────────────────────
 *
 * ⚠ `demo-script-devices.test.ts` fails if any PRODUCTION module restates a scripted line,
 * because two hand-maintained copies of one string always separate — this scene has paid
 * for that three times (mentions rows keyed to the wrong post, the inbound banner retyped,
 * the two KB copies drifting three words apart inside an hour). This file is the ONE
 * intentional second copy, and the distinction is the point: a production module that
 * holds a literal is a source of truth competing with `demo-transcript.ts`, whereas this
 * one is a CHECK against the approval. It is deliberately not in that probe's sibling list.
 *
 * ⚠ **IT PINS THE RENDERED SET, NOT THE FIXTURE'S SHAPE.** The list is what
 * `messagesAt(last)` and `narrationAt(last)` actually produce, in order, so it catches a
 * reworded body, a dropped line, an extra line, a reordered beat and a re-pointed derived
 * lane. The inbound banner's text is not listed separately on purpose: it DERIVES from
 * brief-1 (`citedMessage`), and `demo-script.test.ts` asserts that equality, so listing it
 * twice here would re-create the duplication this directory is cleaning up.
 */

import { describe, expect, it } from "vitest";
import { messagesAt } from "./demo-transcript";
import { narrationAt } from "./demo-narration";
import { STEPS } from "./demo-steps";

const LAST_STEP = STEPS.length - 1;

/**
 * Every channel and thread line, in seq order, exactly as approved. Numbers are the
 * script's own line numbers in the KB entry.
 */
const APPROVED_MESSAGES: readonly string[] = [
  // 1-3, the team notices the debt.
  "ok we've got a pile of debt again. three things keep coming up",
  "the flaky tests mostly. i've rerun that suite four times today",
  "yeah and session teardown is still open. let's actually clear some of it this week",
  // 4-6, each launches their own orchestrator.
  "Grace launched Debt Triage from an identity",
  "Daniel launched Cleanup Planner from an identity",
  "Anthony launched Backlog Scout from an identity",
  // 7-8, scouting.
  "Read the last two weeks of `#eng-help`. The flaky suite is the loudest complaint, **9 separate threads**. Upload retries timing out is second",
  "Checked the knowledge base. *Session teardown* already has a write-up with a repro, and the upload retry path has a planned doc. Nothing written for the flakes",
  // 9-11, they split it between themselves.
  "@debt-triage you have the most context on the suite, take the flakes. I'll take session teardown since the repro is already in our KB",
  "Works for me. @backlog-scout upload retries are closest to what Anthony has been in all week. @Daniel teardown is yours",
  "Taking it. Opening a thread",
  // 12-14, the thread openers — approved as written (#4185). These bodies ARE the cards'
  // preview lines, which is why they could not stay summarised in the KB entry.
  "Starting with the four that fail most often",
  "Three separate symptoms, splitting them out",
  "Reading the planned doc first",
  // 15-17, the coders launched inside the thread.
  "Cleanup Planner launched Teardown Order Fix from an identity",
  "Cleanup Planner launched End Notice Check from an identity",
  "Cleanup Planner launched Wake Replay Trace from an identity",
  // 18-20, each coder briefed.
  "@teardown-order-fix the socket closes before teardown finishes. Start at `session/teardown.ts` and work out whether the final post ever goes out",
  "@end-notice-check a session that ends mid-run never writes its closing record. Check what `history.ts` actually wrote",
  "@wake-replay-trace paused sessions might replay an old message when they resume. `boot.ts` never records where they left off",
  // 21, the coder picks it up.
  "On it. Reading `session/teardown.ts` now",
  // 26-29, the channel moving while the private chat runs.
  "@backlog-scout the flakes and the retry path share a fixture. I'll leave `tests/fixtures/session.ts` alone so you don't get conflicts",
  "Noted, thanks",
  "@Daniel do you want the flake fix behind a flag or straight in?",
  "straight in. it's test only",
];

/** The agent view's own lane, in stream order. Lane included: who SAYS it is approved too. */
const APPROVED_NARRATION: ReadonlyArray<readonly [string, string]> = [
  // The brief that woke it, derived from line 18 rather than authored.
  [
    "inbound",
    "@teardown-order-fix the socket closes before teardown finishes. Start at `session/teardown.ts` and work out whether the final post ever goes out",
  ],
  // 22-25, the private chat.
  ["operator", "don't fix the ordering yet. just tell me if the post ever lands"],
  [
    "private",
    "It doesn't. The socket closes first, so the final post races the shutdown and loses. Want me to write that up before touching anything?",
  ],
  ["operator", "yes write it up first"],
  ["private", "Writing it up now."],
];

describe("the approved copy, pinned line by line", () => {
  const rendered = () => messagesAt(LAST_STEP).map((m) => m.body);

  it("renders exactly the approved lines, in the approved order", () => {
    expect(rendered()).toEqual([...APPROVED_MESSAGES]);
  });

  it("renders exactly the approved private lane, in the approved order", () => {
    const lane = narrationAt(LAST_STEP).map(
      (e) => [e.lane, e.text] as readonly [string, string]
    );
    expect(lane).toEqual(APPROVED_NARRATION.map((row) => [...row]));
  });

  it("🔒 adds no line and drops none", () => {
    // Stated separately from the equality so a count change names itself in the failure
    // rather than arriving as a wall of diff.
    expect(rendered()).toHaveLength(APPROVED_MESSAGES.length);
    expect(narrationAt(LAST_STEP)).toHaveLength(APPROVED_NARRATION.length);
  });

  it("🔒 keeps the three thread openers Samuel approved as written", () => {
    // Called out on their own because they are the ones that arrived last (#4185) and
    // the ones a future edit is most likely to treat as throwaway preview text.
    for (const opener of [
      "Starting with the four that fail most often",
      "Three separate symptoms, splitting them out",
      "Reading the planned doc first",
    ]) {
      expect(rendered(), `opener missing: ${opener}`).toContain(opener);
    }
  });

  it("🔒 has no em dash and no semicolon anywhere in the copy", () => {
    // Samuel's voice rules, which no other probe covers and which a later edit would
    // break silently. Code spans and markdown are fine; these two are not.
    //
    // ⚠ CHECKED ON WHAT RENDERS *AND* ON THE APPROVED TABLE, not just the table. The
    // table alone would hold only while the equality above passes — and the case that
    // matters is somebody changing a line and dutifully updating the table to match,
    // which keeps equality green and is exactly when the voice rule needs its own
    // guard. Checking both means neither half can carry a dash or a semicolon.
    for (const line of [
      ...rendered(),
      ...narrationAt(LAST_STEP).map((e) => e.text ?? ""),
      ...APPROVED_MESSAGES,
      ...APPROVED_NARRATION.map(([, text]) => text),
    ]) {
      expect(line, `em dash in: ${line}`).not.toMatch(/—/);
      expect(line, `semicolon in: ${line}`).not.toMatch(/;/);
    }
  });
});
