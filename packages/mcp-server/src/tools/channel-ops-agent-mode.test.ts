/**
 * `op="manage" action="posture"` — THE ROUTING, THE REFUSAL VERDICTS, AND THE POSTURE
 * ECHO (2026-09-01, T24's sibling verb; re-expressed against the terse result
 * convention 2026-09-02, T10/T24).
 *
 * ⚠ **EVERY CASE HERE IS ABOUT WHAT THE RESULT TEACHES.** A tool RESULT is read
 * by the same model at the moment it chooses its next action and outvotes a
 * description read once at connection (INVARIANTS §10). The readings this op must
 * prevent, each with a case:
 *
 *  1. **"I SET THE POSTURE."** The machine CLAMPS whatever is asked for to the
 *     operator's own ceiling, so a caller that reads "set" reports room it does
 *     not have and sizes its next instruction for it.
 *  2. **A NULL ECHO READ AS AGREEMENT.** No machine writes `applied_*` yet, so it
 *     is `null` on every live row and `null` MEANS NOT REPORTED — rendering it as
 *     "unclamped", or echoing the request back, is (1) with a column behind it.
 *  3. **`no-bridge` NARRATED WITH THE WRONG TOGGLE STORY.** This is the one agent
 *     verb the launch toggle DOES gate, so the shipped copy must be allowed to
 *     say so — while `action="end"` / `action="rename"` must keep saying the opposite.
 *  4. **A TIMEOUT READ AS A FAILURE**, producing a second request for the same
 *     change with no way to tell which one acted.
 *
 * ── ⚠ HOW THESE CASES CHANGED SHAPE, AND WHY NONE OF THEM WEAKENED ──────────
 *
 * Each of the four used to be pinned on a PARAGRAPH in the result. The verbosity
 * tier moved every standing paragraph into `channel-doctrine.ts` and left ONE
 * line of `key=value` facts behind (`channel-facts.ts › factsLine`), so each case
 * is now asserted in the TWO places the claim lives: the **VERDICT**, as a token
 * on THIS call's result (`asked=`, `posture=`, `reason=`, `retry=`, `confirm=`,
 * and the head word) — the half a caller branches on and no doctrine can supply
 * — and the **RULE**, in `CHANNEL_DOCTRINE`, one `op="help"` away. A doctrine
 * check alone cannot tell a move from a copy; a result check alone cannot tell a
 * move from a DELETE. Both halves, or the case covers nothing. Same split as
 * `channel-ops-agent.test.ts` takes for the two sibling verbs — read together.
 *
 * ⚠ **THE CROSS-VERB HALF LIVES NEXT DOOR** (`channel-ops-agent-gate.test.ts`,
 * split off at the 500-line cap, INVARIANTS §1): that `no-bridge` means the
 * launch toggle HERE and explicitly does not on `action="end"` / `action="rename"`, and
 * that the ungated module's copy never claims otherwise. It is one claim about
 * three verbs, so it could not live under any one of them. ⚠ A new case about
 * the ASYMMETRY goes there; a new case about THIS op's own result goes here.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient, LaunchDirective } from "@dopl/client";
import { opSetAgentMode } from "./channel-ops-agent-mode";
// ⚠ `postureLine` (a prose paragraph) BECAME `postureFacts` (two fields). The
// distinction it exists to hold — a null echo is "not reported", never the
// request — did not move, so the cases below drive the new function and render
// its answer through the one write-result renderer, which is what a caller sees.
import { postureFacts } from "./channel-facts";
import { factsLine } from "./channel-facts";
import { CHANNEL_DOCTRINE } from "./channel-doctrine";
// ⚠ **THE ASK-IS-NOT-A-GRANT RULE IS `posture`'S OWN `.describe()` NOW.** The
// five-op collapse folded the three axes into one object and moved the rule onto
// it: a client reads it at the moment it decides what to send, which is closer to
// the decision than the op paragraph was. The claim did not move surfaces by
// accident — the doctrine keeps CONTRACTS, an argument keeps its own rule.
import { CHANNEL_INPUT_SHAPE } from "./channel-schema";

/** The argument `.describe()` text, which is prose a client reads too. */
const ARG_PROSE = Object.values(CHANNEL_INPUT_SHAPE)
  .map((arg) => arg.description ?? "")
  .join("\n");

const CHANNEL = { id: "chan-1", slug: "general", name: "General", visibility: "private" };
const AGENT = "a1b2c3d4";
const DIRECTIVE_ID = "55555555-5555-5555-5555-555555555555";

function directive(over: Partial<LaunchDirective> = {}): LaunchDirective {
  return {
    id: DIRECTIVE_ID,
    kind: "set_agent_mode",
    operatorUserId: "user-1",
    channelId: "chan-1",
    threadId: null,
    goal: null,
    model: null,
    status: "pending",
    templateId: null,
    templateName: null,
    targetAgentId: AGENT,
    targetName: null,
    startToolMode: null,
    startMessageMode: null,
    chain: null,
    targetToolMode: "auto",
    targetMessageMode: null,
    appliedToolMode: null,
    appliedMessageMode: null,
    appliedChain: null,
    refusalReason: null,
    agentId: null,
    claimedAt: null,
    decidedAt: null,
    expiresAt: "2026-09-01T12:02:00.000Z",
    createdAt: "2026-09-01T12:00:00.000Z",
    ...over,
  };
}

/** A client whose create returns a settled directive, so no hold runs. */
function settled(over: Partial<LaunchDirective>): DoplClient {
  return {
    listChannels: vi.fn(async () => [CHANNEL]),
    createAgentDirective: vi.fn(async () => ({
      offline: false,
      directive: directive(over),
    })),
    getLaunchDirective: vi.fn(async () => directive(over)),
  } as unknown as DoplClient;
}

const modeText = async (
  c: DoplClient,
  modes: Parameters<typeof opSetAgentMode>[3] = { tools: "auto" },
) =>
  (await opSetAgentMode(c, "general", AGENT, modes, { waitMs: 0 }))
    .content[0].text as string;

/** The posture pair as a caller reads it — through the real renderer. */
const postureText = (d: LaunchDirective) => factsLine("taken", postureFacts(d));

describe('manage action="posture" — the ASK, never the SET', () => {
  it("names what was asked for and never claims it was granted", async () => {
    const text = await modeText(settled({ status: "done" }), {
      tools: "bypass",
      messages: "auto_both",
    });
    // ⚠ THE VERDICT. `asked=` is the request echoed AS a request, and the head
    // word is `taken` rather than `set`: the machine says it applied something,
    // never that it applied what was named. The phrase "asked for" used to carry
    // that inside a paragraph; it is a KEY now, and a key cannot be softened by
    // the sentence around it. ⚠ `posture=` STAYS A SEPARATE FIELD, which is what
    // lets a reader see the gap between ask and outcome with no paragraph
    // explaining that one may exist — collapsing the two is the regression here.
    expect(text.startsWith("taken ")).toBe(true);
    expect(text).toContain("asked=bypass/auto_both");
    expect(text).toContain('posture="not reported"');
    // ⚠ THE RULE, in its one home. "ASKED FOR IS NOT GRANTED" and "never widens
    // past it" were paragraphs on every result of this verb; they are standing
    // doctrine — true of every call — and are read once at op="help".
    // ⚠ RE-POINTED ONTO `posture`'S OWN `.describe()`, where the rule lives now.
    expect(ARG_PROSE).toContain("how much freedom to ASK FOR");
    expect(ARG_PROSE).toContain(
      "narrows whatever you ask for to their own ceiling and never widens past it",
    );
  });

  it("says the agent keeps running — a posture is not an interruption", async () => {
    const text = await modeText(settled({ status: "done" }));
    // ⚠ THE VERDICT IS AN ABSENCE PLUS AN ADDRESS. "still running" was a
    // sentence; what carries it is that the line names the agent by its LIVE
    // handle and borrows nothing from the stop verb — `action="end"` answers
    // `ended` with `handle=spent`, the reading this must never produce.
    expect(text).toContain(`agent=@agent-${AGENT}`);
    expect(text.startsWith("taken ")).toBe(true);
    expect(text).not.toContain("handle=spent");
    expect(text).not.toContain("ended");
    // ⚠ THE RULE: it moves permissions and nothing else.
    expect(CHANNEL_DOCTRINE).toContain('"posture" re-permissions a running one');
  });

  it("renders `-` for an axis deliberately left alone", async () => {
    expect(await modeText(settled({ status: "done" }), { tools: "auto" })).toContain(
      "asked=auto/-",
    );
  });

  it("accepts the pasted `@agent-<id>` handle, as its siblings do", async () => {
    const client = settled({ status: "done" });
    await opSetAgentMode(client, "general", `@agent-${AGENT}`, { tools: "auto" }, { waitMs: 0 });
    const call = vi.mocked(client.createAgentDirective).mock.calls[0][0];
    expect(call).toMatchObject({ kind: "set_agent_mode", agentId: AGENT });
  });

  it("passes both axes through untouched — this process cannot see the ceiling", async () => {
    const client = settled({ status: "done" });
    await opSetAgentMode(
      client,
      "general",
      AGENT,
      { tools: "manual", messages: "ask" },
      { waitMs: 0 },
    );
    expect(vi.mocked(client.createAgentDirective).mock.calls[0][0]).toMatchObject({
      tools: "manual",
      messages: "ask",
    });
  });
});

describe("🔒 the posture ECHO — a NULL is 'not reported', never agreement", () => {
  it("says NOT REPORTED, in words, when all three echo fields are null", () => {
    // ⚠ ASSERTED ON THE WHOLE RECORD, not on a substring: a field QUIETLY
    // DROPPED is the same lie as one filled in wrongly, because a reader with no
    // `posture=` key concludes the server never looked.
    expect(postureFacts(directive())).toEqual({
      posture: "not reported",
      chain: "not reported",
    });
    // ⚠ …and it survives the renderer, quoted, so the space in it cannot split
    // the `key=value` pairs (`channel-facts.ts › renderValue`).
    expect(postureText(directive())).toBe(
      'taken posture="not reported" chain="not reported"',
    );
    // ⚠ THE RULE. "DO NOT ASSUME YOU GOT IT" was the paragraph's headline; the
    // doctrine says the same thing and says WHICH reading is forbidden.
    // ⚠ RE-POINTED: the ask-is-not-a-grant rule is `posture`'s `.describe()`, and
    // the "a blank cell was NOT REPORTED and is not a value" principle is stated
    // once, on the surface that renders those cells.
    expect(ARG_PROSE).toContain("how much freedom to ASK FOR");
    expect(CHANNEL_DOCTRINE).toContain("A `—` cell was NOT REPORTED");
  });

  it("⚠ NEVER echoes the REQUEST back when the echo is null", () => {
    // The failure this closes: a line that is right whenever nothing was clamped
    // and confidently wrong precisely when it was. ⚠ THE SOURCE ROW IS LOADED
    // WITH REQUEST-SIDE VALUES on every axis, so a renderer reaching for the
    // wrong column has something to find.
    const d = directive({
      startToolMode: "bypass",
      startMessageMode: "auto_both",
      chain: true,
      targetToolMode: "bypass",
    });
    expect(postureFacts(d).posture).toBe("not reported");
    expect(postureFacts(d).chain).toBe("not reported");
    const line = postureText(d);
    expect(line).not.toContain("posture=bypass");
    expect(line).not.toContain("chain=on");
  });

  it("prints `posture=<tools>/<messages> chain=on|off` when the machine DID report", () => {
    const line = postureText(
      directive({
        appliedToolMode: "accept_edits",
        appliedMessageMode: "ask",
        appliedChain: true,
      }),
    );
    expect(line).toContain("posture=accept_edits/ask chain=on");
  });

  it("`chain=off` when it reported false — and `off` is not what a null renders as", () => {
    expect(
      postureText(
        directive({
          appliedToolMode: "auto",
          appliedMessageMode: "auto_both",
          appliedChain: false,
        }),
      ),
    ).toContain("chain=off");
    // ⚠ THE PAIR IS THE ASSERTION. `off` and `not reported` are different
    // answers — one is the machine saying no, the other is the machine saying
    // nothing — and a renderer that collapsed them would pass the line above.
    expect(postureText(directive())).toContain('chain="not reported"');
  });

  it("a PARTIAL report shows `-` for the unreported axis and never the request", () => {
    // ⚠ THE HALF-CLAMPED ROW IS WHERE THE TWO READINGS ARE HARDEST TO TELL
    // APART: the tool axis really was reported, so the line is authoritative,
    // and the message axis was not. "NOT an axis that was left wide" was the
    // sentence; the pin is now on the two things it protected — the dash
    // appears, and the REQUEST (`auto_both`, on the row) is not what fills it.
    const line = postureText(
      directive({ appliedToolMode: "auto", targetMessageMode: "auto_both" }),
    );
    expect(line).toContain("posture=auto/-");
    expect(line).not.toContain("auto_both");
    expect(line).toContain('chain="not reported"');
  });

  it('the action="posture" success renders the echo line', async () => {
    expect(await modeText(settled({ status: "done" }))).toContain("not reported");
  });
});

describe('manage action="posture" — the terminal shapes', () => {
  it("a refusal says nothing changed and is not an error", async () => {
    const text = await modeText(
      settled({ status: "refused", refusalReason: "no-session" }),
    );
    // ⚠ THE HEAD WORD IS THE VERDICT. "was NOT re-postured" is the head of the
    // fact line now, and `filed=yes` says this is an ANSWER rather than an error
    // — a row was written and replied to, so nothing is pending or cancellable.
    expect(text.startsWith("not re-postured ")).toBe(true);
    expect(text).toContain("reason=no-session");
    expect(text).toContain("retry=no");
    expect(text).toContain("filed=yes");
    // ⚠ THE RULE, both halves of it: that a refusal is normal, and what
    // `no-session` means — the agent already finished, so there is no posture to
    // move and no re-issue will find one.
    // ⚠ RE-POINTED onto the refusal table's opening sentence and the word's own
    // entry — the two CONTRACTS. ⚠ The "the agent already finished, so there was
    // nothing left to stop" gloss was RETIRED BY RULING (contracts only, wave B
    // spec §4) and is pinned ABSENT once, in
    // `channel-ops-agent-doctrine.test.ts › RETIRED_BY_RULING`.
    expect(CHANNEL_DOCTRINE).toContain("A REFUSAL IS A NORMAL ANSWER");
    expect(CHANNEL_DOCTRINE).toContain("`no-session` no such agent");
  });

  it("⚠ `no-bridge` HERE MAY BE THE LAUNCH TOGGLE — and the doctrine names it", async () => {
    const text = await modeText(
      settled({ status: "refused", refusalReason: "no-bridge" }),
    );
    // ⚠ THE VERDICT: the word, and `retry=no` — a toggle is a decision, so
    // re-issuing cannot change the answer whichever of the two causes it was.
    expect(text).toContain("reason=no-bridge");
    expect(text).toContain("retry=no");
    // 🔒 THE RULE, AND IT IS THE ONE ASYMMETRY ON THIS LANE. The shipped copy
    // used to say "DOES gate this op" in THIS module and the opposite next door;
    // one text now serves all three mailboxes, so it has to carry BOTH claims or
    // they collapse into one wrong answer. The sibling suite below pins the
    // other end.
    // 🔒 THE RULE, AND IT IS THE ONE ASYMMETRY ON THIS LANE. The shipped copy
    // used to say "DOES gate this op" in THIS module and the opposite next door;
    // one text serves all three mailboxes now, so it has to carry BOTH claims or
    // they collapse into one wrong answer — which is exactly what happened for a
    // day in the five-op collapse. It names THIS action as gated, by name.
    expect(CHANNEL_DOCTRINE).toContain("`no-bridge` the operator's LAUNCH toggle is off");
    expect(CHANNEL_DOCTRINE).toContain('it gates "launch" and "posture"');
  });

  it("`cap` does NOT borrow the launch advice to wait for a free slot", async () => {
    const text = await modeText(settled({ status: "refused", refusalReason: "cap" }));
    // ⚠ **THE FIELD IS WHAT KEEPS THE TWO LANES APART NOW.** "not a state a
    // re-posture can be blocked by" was copy; the shared doctrine paragraph is
    // written for the LAUNCH lane and still says "either wait for one to finish
    // or ask your operator to end one". `busy` is the only word in the table
    // that answers `once`, so `retry=no` on `cap` IS "do not wait for a slot" —
    // and the launch advice may not ride along on the result at all.
    expect(text).toContain("reason=cap");
    expect(text).toContain("retry=no");
    expect(text).not.toMatch(/wait for/i);
  });

  it("`bad-name` is answered honestly as a word this verb cannot produce", async () => {
    const text = await modeText(
      settled({ status: "refused", refusalReason: "bad-name" }),
    );
    // ⚠ NOTHING HERE SENDS A NAME, so arriving on this word IS the anomaly and
    // `retry=no` is the honest answer — a caller that re-issues over a word
    // nothing could have produced re-issues forever.
    expect(text).toContain("reason=bad-name");
    expect(text).toContain("retry=no");
    // …and the doctrine says whose word it is, which is what "belongs to
    // RENAMING an agent" used to say in the result: a LABEL was refused, and this
    // verb sends none.
    expect(CHANNEL_DOCTRINE).toContain(
      "`bad-name` the label was not one line of 1-60 visible characters",
    );
  });

  it("a TIMEOUT is pending, says the id, and forbids a re-issue", async () => {
    const text = await modeText(settled({ status: "pending" }));
    // ⚠ THE VERDICT. "A TIMEOUT IS NOT A REFUSAL" and "DO NOT ISSUE THIS CALL
    // AGAIN" were two paragraphs; `pending` + `retry=no` is both of them, and
    // the directive id is the only handle the caller has left.
    expect(text.startsWith("pending ")).toBe(true);
    expect(text).toContain(`directive=${DIRECTIVE_ID}`);
    expect(text).toContain("retry=no");
    // ⚠ THE RULE — and it is the expensive one: a second directive is a second
    // request for the same change, with nothing afterwards to say which acted.
    expect(CHANNEL_DOCTRINE).toContain(
      "A TIMEOUT IS NOT A FAILURE: the request stays PENDING",
    );
    // ⚠ **AND THE RULE NAMES ITS REMEDY SINCE A10 (2026-09-02).** "do NOT issue
    // it again" was the whole answer while the lane had no idempotency key;
    // `client_msg_id` makes the retry answerable, so the doctrine points at the
    // key and keeps the prohibition for a re-issue that carries none.
    // ⚠ RE-POINTED: one sentence now states the key AND the cost of omitting it,
    // which is the same pair the two sentences carried.
    expect(CHANNEL_DOCTRINE).toContain(
      "re-issuing without the SAME `client_msg_id` starts a SECOND agent",
    );
  });

  it("🔒 the PENDING line answers `confirm=none`, not the END's confirm surface", async () => {
    // The defect a `kind === "end" ? … : …` ternary produces the day a third
    // verb arrives: a re-posture told to go and confirm itself somewhere that
    // cannot report it. ⚠ THE DANGEROUS MISREAD IS THE `op="status"` ONE — an
    // agent whose re-posture never landed is still running at its OLD
    // permissions, and a listing that keeps printing it looks like success.
    const text = await modeText(settled({ status: "pending" }));
    expect(text).toContain("confirm=none");
    // ⚠ THE END'S CONFIRM SURFACE, BY ITS CURRENT NAME: `PENDING_CONFIRM.end`
    // shipped the retired `read_sessions` until it moved to `status`
    // (2026-09-02), and the negative has to track the LIVE value or it stops
    // guarding anything the day the ternary comes back.
    expect(text).not.toContain("confirm=status");
    // ⚠ **A RENAME ANSWERS `none` TOO, AND THAT IS CORRECT RATHER THAN THE
    // COLLAPSE THIS CASE GUARDS** — neither is confirmable, for the same reason.
    // What keeps the two lines apart is `asked=`, which only this verb carries,
    // so it is pinned here as the tell; the END (the one kind with a real
    // confirmation surface) is pinned apart below.
    expect(text).toContain("asked=auto/-");
  });

  it("an EXPIRED request says the agent kept the posture it had", async () => {
    const text = await modeText(settled({ status: "expired" }));
    // ⚠ LAPSED IS NOT REFUSED AND NOT PENDING, and the head word plus
    // `reason=expired` is the whole of "it keeps whatever posture it already
    // had": nothing was applied, so nothing changed. `filed=yes` says the row
    // exists — it simply was never answered.
    expect(text.startsWith("not re-postured ")).toBe(true);
    expect(text).toContain("reason=expired");
    expect(text).toContain(`directive=${DIRECTIVE_ID}`);
    expect(text).toContain("filed=yes");
    // ⚠ AND IT IS NOT THE TIMEOUT SHAPE. A caller that read this as `pending`
    // would sit waiting on a row no machine will ever take.
    expect(text).not.toContain("confirm=");
  });

  it("OFFLINE names THIS verb, not a rename — the shared verb table", async () => {
    const client = {
      listChannels: vi.fn(async () => [CHANNEL]),
      createAgentDirective: vi.fn(async () => ({ offline: true, directive: null })),
    } as unknown as DoplClient;
    const text = await modeText(client);
    // ⚠ `filed=no` IS THE HALF THAT MAKES OFFLINE DIFFERENT FROM EVERY OTHER
    // TERMINAL SHAPE: no row was written, so there is nothing pending and
    // nothing to cancel.
    expect(text).toContain("reason=offline");
    expect(text).toContain("filed=no");
    // ⚠ **AND THE HEAD MUST NAME THIS VERB.** `channel-ops-agent.ts` keeps
    // `VERB_PAST` as a Record over the closed kind set precisely because a
    // `kind === "end" ? … : …` ternary is CORRECT for two kinds and silently
    // reports the third as a RENAME.
    //
    // 🔴 **THIS CASE IS RED AGAINST A LIVE DEFECT, DELIBERATELY LEFT RED.**
    // `channel-ops-agent.ts › fileAndHold` renders the OFFLINE shape as
    // `factsLine(input.kind === "end" ? "not ended" : "not renamed", …)` — the
    // exact ternary `VERB_PAST` and `PENDING_CONFIRM` were both made into maps
    // to avoid — so an offline `action="posture"` answers **`not renamed`** and
    // tells the caller its posture request was a rename. The fix is one
    // expression (`not ${VERB_PAST[input.kind]}`); it is NOT applied here,
    // because a suite that goes green against the bug it names is the defect
    // rather than the evidence (INVARIANTS §14, mutation-verify culture).
    const why =
      "channel-ops-agent.ts › fileAndHold renders the offline head with a " +
      "kind === 'end' ternary, so a posture reports as a RENAME. " +
      "Use VERB_PAST — the map that exists for exactly this.";
    expect(text.startsWith("not re-postured "), `${why}\ngot: ${text}`).toBe(true);
    expect(text, why).not.toContain("not renamed");
  });
});
