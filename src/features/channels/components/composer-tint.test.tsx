// @vitest-environment jsdom
/**
 * 🔒 **BLUE IN THE COMPOSER MEANS "THIS TOKEN WILL ROUTE"** (Samuel, 2026-09-07), and the pin is
 * that it means the SAME thing there as in the transcript.
 *
 * ⚠ **THE FAILURE THIS EXISTS TO CATCH IS A SECOND RESOLUTION RULE.** The tint is a new SURFACE,
 * not a new rule: a token tints iff `resolveMentionToken` names a member or `resolveAgentHandle`
 * names an agent over `lib/draft-recipients.ts › draftAgentIndex` — the same index the recipient
 * line predicts with and the picker inserts from. The way this regresses is somebody
 * re-implementing "looks like a handle" in the overlay, at which point the composer tints tokens
 * the send does not deliver, which is worse than no tint at all.
 *
 * ⚠ **THE SUFFIX CASES ARE THE INTERESTING ONES.** Two agents sharing a name both stay
 * addressable (`coder`, `coder-1`), so BOTH have to tint — an overlay built on
 * `agentMentionHandle` would light the first and leave the second's real handle looking dead.
 *
 * ⚠ **WHAT IS NOT TESTED HERE, DELIBERATELY: GEOMETRY.** Whether the mirror sits on the same
 * glyph positions as the field is a layout fact jsdom cannot measure (no fonts, no line boxes);
 * what keeps it true is that both layers wear one constant, `composer-input.tsx › FIELD_TEXT`.
 * A test that appeared to check alignment here would be a green nobody could trust.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ComposerTint } from "./composer-tint";
import type { LiveAgentSession } from "../lib/draft-recipients";
import { member, ME, PEER } from "./test-fixtures";

afterEach(cleanup);

const AGENT = "k3v7d2mq";
const OTHER = "m4x8p1qr";

const MEMBERS = [
  member({ userId: ME, displayName: "Sam Wang" }),
  member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
];

const tinted = (text: string, sessions: LiveAgentSession[] = []): (string | null)[] => {
  const view = render(
    <ComposerTint text={text} members={MEMBERS} sessions={sessions} />
  );
  return [...view.container.querySelectorAll("span.text-link")].map(
    (node) => node.textContent
  );
};

describe("a token tints when it would route", () => {
  it("tints an agent's id form — the address that never stops working", () => {
    expect(tinted(`@agent-${AGENT} go`, [{ name: AGENT }])).toEqual([
      `@agent-${AGENT}`,
    ]);
  });

  it("tints an agent's slugged name", () => {
    expect(
      tinted("@research-bot go", [{ name: AGENT, displayName: "Research Bot" }])
    ).toEqual(["@research-bot"]);
  });

  it("tints a roster member by the existing member rule", () => {
    expect(tinted("morning @diana-taylor")).toEqual(["@diana-taylor"]);
  });

  it("leaves a handle nobody holds as plain prose — the absence IS the signal", () => {
    expect(tinted("@nobody-here hello", [{ name: AGENT }])).toEqual([]);
  });

  it("tints nothing at all in a draft with no tags", () => {
    expect(tinted("plain words about @ signs")).toEqual([]);
  });
});

/**
 * 🔒 **A SUFFIXED NAME TINTS LIKE ANY OTHER, BECAUSE IT IS ANY OTHER** (Samuel, 2026-09-15).
 *
 * ⚠ **THIS BLOCK HAS PINNED THREE DIFFERENT ANSWERS.** Under the 2026-09-07 mint `@coder` tinted
 * for the first claimant and `@coder-1` for the second; for part of 2026-09-15 NEITHER tinted;
 * and now the collision is prevented where the name is COMMITTED — the second "Coder" is STORED
 * as `Coder-1` (`main/agent-name-unique.js`) — so both tint, as two distinct names.
 *
 * ⚠ **THE PROPERTY THIS BLOCK EXISTS FOR IS UNCHANGED AND IS THE REASON IT IS DRIVEN BY THE REAL
 * INDEX**: a tint over a token that stamps nobody is F-266. Which is why the cross-machine
 * duplicate — the one case the commit rule cannot reach — is pinned below it.
 */
describe("a name suffixed at launch tints like any other", () => {
  const stored: LiveAgentSession[] = [
    { name: AGENT, displayName: "Coder" },
    { name: OTHER, displayName: "Coder-1" },
  ];

  it("tints the bare name and the suffixed one, each to its own agent", () => {
    expect(tinted("@coder go", stored)).toEqual(["@coder"]);
    expect(tinted("@coder-1 go", stored)).toEqual(["@coder-1"]);
  });

  it("tints ONLY the first claimant when a cross-machine duplicate arrives", () => {
    // ⚠ **NAMES ARE MINTED ON THE MACHINE THAT OWNS THE ID**, so two members can each run a
    // "Coder" and this machine cannot rename theirs. The loser's slug tints for NOBODY — the
    // missing highlight IS the signal that the token does not reach them — and it stays reachable
    // by its id form, which is the assertion below.
    const clash: LiveAgentSession[] = [
      { name: AGENT, displayName: "Coder" },
      { name: OTHER, displayName: "Coder" },
    ];
    expect(tinted("@coder go", clash)).toEqual(["@coder"]);
    expect(tinted(`@agent-${OTHER} go`, clash)).toEqual([`@agent-${OTHER}`]);
  });

  it("tints no spelling nothing holds — the resolve-time mint is withdrawn", () => {
    expect(tinted("@coder-2 go", stored)).toEqual([]);
  });
});

describe("the token is tinted exactly as the parser reads it", () => {
  it("keeps trailing punctuation inside the tinted run", () => {
    // ⚠ `mentionHandleOf` STRIPS THE COMMA BEFORE THE LOOKUP, so the tag resolves — and the
    // comma is part of the token the author typed. This layer may never re-spell what it
    // mirrors: a character moved is the tint sliding off the caret.
    expect(tinted(`@agent-${AGENT}, then`, [{ name: AGENT }])).toEqual([
      `@agent-${AGENT},`,
    ]);
  });
});

/**
 * 🔒 **THE MASK RUNS, AND THESE CASES ARE WHY** (blocker 8, 2026-09-07).
 *
 * ⚠ **THIS BLOCK USED TO PIN THE OPPOSITE AND THAT WAS THE DEFECT WEARING A TEST'S CLOTHES.** It
 * asserted `.not.toEqual([])` for a backticked handle and called the divergence a "known gap" —
 * so the suite was GREEN over a composer that tinted tokens the send would not deliver. A test
 * that documents a lie still lets the lie ship; what makes this the right shape is that the
 * assertion now names the behaviour the product promises.
 *
 * ⚠ **CODE DOES NOT TAG, AND IT WAS MEASURED RATHER THAN THEORISED** — two agents writing
 * documentation about @-tagging put backticked handles in their bodies and TAGGED BOTH OPERATORS
 * for real (channel seqs 647 / 653, 2026-08-21). The server has masked since; the composer's tint
 * is the third reader of that rule and the first one to have skipped it.
 */
describe("a handle the tagging rule does not read is not tinted", () => {
  const live: LiveAgentSession[] = [{ name: AGENT }];

  it("does not tint inside a code span", () => {
    expect(tinted(`\`@agent-${AGENT}\``, live)).toEqual([]);
  });

  it("does not tint inside a fenced block", () => {
    expect(tinted(`\`\`\`\n@agent-${AGENT}\n\`\`\``, live)).toEqual([]);
  });

  it("does not tint an ESCAPED handle — the author typed the backslash to avoid this", () => {
    expect(tinted(`\\@agent-${AGENT} go`, live)).toEqual([]);
  });

  it("does not tint a link DESTINATION", () => {
    expect(tinted(`[docs](https://ex.com/@agent-${AGENT})`, live)).toEqual([]);
  });

  it("🔒 tints the LIVE occurrence and not the fenced one beside it", () => {
    // ⚠ THE CASE A BY-VALUE FILTER CANNOT PASS, and the reason the tint walks OFFSETS rather
    // than calling `mentionTokensOf` and matching its array: both tokens are the same string,
    // so only their positions tell them apart. A greedy match would tint the code one and leave
    // the real one plain — the defect inverted, which reads as fixed and is not.
    expect(tinted(`\`@agent-${AGENT}\` and @agent-${AGENT}`, live)).toEqual([
      `@agent-${AGENT}`,
    ]);
  });

  it("renders the author's own characters in the masked run, never the mask's spaces", () => {
    // ⚠ THE MASK DECIDES TINTABILITY AND NOTHING ELSE. It blanks with SPACES of equal length,
    // and a mirror that painted those spaces would blank the operator's own code span on screen.
    const view = render(
      <ComposerTint text={`\`@agent-${AGENT}\``} members={MEMBERS} sessions={live} />
    );
    expect(view.container.textContent).toBe(`\`@agent-${AGENT}\``);
  });
});
