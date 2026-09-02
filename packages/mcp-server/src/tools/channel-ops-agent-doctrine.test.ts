/**
 * **THE DOCUMENT HALF OF `op="manage"`'s TWO-SIDED PIN** — every paragraph the
 * `end` / `rename` / `posture` results stopped carrying, asserted against
 * `CHANNEL_DOCTRINE` rather than against a result.
 *
 * ⚠ **THE SEAM IS THE INSTRUMENT, NOT THE LINE COUNT** (split from
 * `channel-ops-agent.test.ts` at the 500-line cap, INVARIANTS §1; same seam
 * `channel-ops-launch-posture.test.ts` draws next door). That file asserts what
 * ONE CALL'S RESULT teaches a model choosing its next action; this one asserts
 * what the DOCUMENT still says, and the two move on different clocks: this file
 * fails when `channel-doctrine.ts` is reworded, that one when
 * `channel-facts.ts`'s fields are. Halving the original by line number would
 * have put both instruments on both sides of the cut.
 *
 * ⚠ **BOTH DIRECTIONS, WHICH IS THE WHOLE POINT.** Each moved sentence is
 * asserted ABSENT from every terminal result on this lane (the tersening
 * happened) and PRESENT in the doctrine (it was a MOVE, not a deletion). Either
 * half alone passes for the wrong reason — a result check cannot tell a move
 * from a delete, and a doctrine check cannot tell a move from a copy. The
 * negative sweep needs every terminal shape of both verbs, which is why the
 * fixtures come across whole.
 *
 * ⚠ **AND IT CARRIES THE GROUP'S ONE COPY OF `RETIRED_BY_RULING`** — the prose
 * cut outright by wave B (`docs/specs/mcp-v2-wave-b.md` §4, contracts only),
 * pinned as an ABSENCE so a re-expansion is a decision rather than a drift.
 * `channel-ops-agent-gate.test.ts`, `channel-ops-agent-mode.test.ts`,
 * `channel-ops-launch.test.ts` and `channel-directions.test.ts` all name this
 * list in a comment instead of keeping a second copy.
 *
 * ⚠ THE FIXTURES ARE COPIED FROM THE SIBLING SUITE, NOT SHARED — the same call
 * `channel-ops-agent-gate.test.ts` makes and for the same reason: two suites
 * that must be able to disagree about one row cannot share the row.
 *
 * ⚠ `channel-` filename prefix is REQUIRED by the parity split-scan
 * (`parity.test.ts`) and the removed-vocabulary source scan.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient, LaunchDirective } from "@dopl/client";
import { opEndAgent, opRenameAgent } from "./channel-ops-agent";
// ⚠ THE OTHER HALF OF EVERY PIN BELOW. The paragraph a result stopped carrying
// has to still EXIST, or the tersening deleted doctrine instead of moving it.
import { CHANNEL_DOCTRINE } from "./channel-doctrine";

const CHANNEL = { id: "chan-1", slug: "general", name: "General", visibility: "private" };
const AGENT = "a1b2c3d4";

function directive(over: Partial<LaunchDirective> = {}): LaunchDirective {
  return {
    id: "55555555-5555-5555-5555-555555555555",
    kind: "end",
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
    refusalReason: null,
    agentId: null,
    claimedAt: null,
    decidedAt: null,
    expiresAt: "2026-09-01T12:02:00.000Z",
    createdAt: "2026-09-01T12:00:00.000Z",
    ...over,
  };
}

function client(over: Record<string, unknown> = {}): DoplClient {
  return {
    listChannels: vi.fn(async () => [CHANNEL]),
    createAgentDirective: vi.fn(async () => ({
      offline: false,
      directive: directive(),
    })),
    getLaunchDirective: vi.fn(async () => directive()),
    ...over,
  } as unknown as DoplClient;
}

/** A client whose create returns a settled directive, so no hold runs. */
function settled(over: Partial<LaunchDirective>): DoplClient {
  return client({
    createAgentDirective: vi.fn(async () => ({
      offline: false,
      directive: directive(over),
    })),
  });
}

const endText = async (c: DoplClient) =>
  (await opEndAgent(c, "general", AGENT, { waitMs: 0 })).content[0].text as string;
const renameText = async (c: DoplClient, name = "Research") =>
  (await opRenameAgent(c, "general", AGENT, name, { waitMs: 0 })).content[0].text as string;

/**
 * THE PARAGRAPHS THESE TWO OPS STOPPED CARRYING, as fragments of the sentences
 * that replaced them in `CHANNEL_DOCTRINE`. ⚠ **ASSERTED IN BOTH DIRECTIONS,
 * WHICH IS THE WHOLE POINT**: absent from every result (the tersening happened)
 * and present in the doctrine (it was a MOVE, not a deletion). Either half alone
 * passes for the wrong reason — a result check cannot tell a move from a delete,
 * and a doctrine check cannot tell a move from a copy.
 */
const MOVED_DOCTRINE = [
  // …a successful end touches nothing else, and the handle it spends is gone.
  // ⚠ RE-POINTED BY THE FIVE-OP COLLAPSE: what an end leaves alone is the
  // MODEL's statement that nothing ends a THREAD at all, and what it SPENDS is
  // one clause on the `manage` verb itself.
  "A THREAD HAS NO FINISHED STATE: nothing settles one, no op ends one",
  "the thread stays readable and postable",
  '"end" stops one, and there is no undo — instance ids are never reused',
  // …a refusal is an answer, not an error, and re-asking does not change it.
  "A REFUSAL IS A NORMAL ANSWER",
  "re-issuing changes nothing unless the word says so",
  // …`no-session`, which on an END is the commonest outcome and not a fault.
  "`no-session` no such agent",
  // …the two verbs the launch toggle does NOT gate. ⚠ ONE CLAUSE CARRIES BOTH
  // HALVES NOW — which lane the toggle governs AND which two it does not — so
  // the asymmetry cannot be half-deleted by a reword of either side.
  '`no-bridge` the operator\'s LAUNCH toggle is off',
  'it gates "launch" and "posture", never "end" or "rename"',
  // …and the one word a caller could FIX on a retry, with the shape it accepts.
  "`bad-name` the label was not one line of 1-60 visible characters",
  // …a rename is display-only on ONE machine, so nothing here confirms it.
  "is invisible to every other member",
  "is never addressable from here",
  // …and a timed-out request is still filed. ⚠ **BACKED BY CODE SINCE A10/G10
  // (2026-09-02), AND THE SENTENCE MOVED WITH IT**: "do NOT issue it again" was
  // the only answer available while this lane had no idempotency key.
  "A TIMEOUT IS NOT A FAILURE: the request stays PENDING",
  "re-issuing without the SAME `client_msg_id` starts a SECOND agent",
] as const;

/**
 * **THE PROSE RETIRED BY RULING, PINNED AS AN ABSENCE SO A RE-EXPANSION IS A
 * DECISION RATHER THAN A DRIFT** (wave B spec §4, `docs/specs/mcp-v2-wave-b.md`
 * — the doctrine carries CONTRACTS ONLY).
 *
 * ⚠ **THIS IS NOT THE `MOVED_DOCTRINE` PAIR WITH A SIDE MISSING.** Those
 * sentences moved and both halves are asserted. These four were CUT: each is a
 * CONSEQUENCE a caller can derive from a contract it already has, or
 * encouragement about how to feel about one, and the ruling is that neither
 * earns a line in a document somebody reads under a token budget. So the shape
 * inverts — the surviving CONTRACT is pinned at each call site, and the deleted
 * prose is pinned ABSENT here. A suite that simply dropped the pin would let the
 * paragraph grow back unnoticed, which is the drift this file exists against.
 *
 * ⚠ **IT IS THE GROUP'S ONE COPY.** Every sibling suite that pinned one of these
 * — `channel-ops-agent-gate.test.ts`, `channel-ops-agent-mode.test.ts`,
 * `channel-ops-launch.test.ts`, `channel-directions.test.ts` — pins the contract
 * that answers the same question and names the retirement in a comment pointing
 * HERE, so the absence is asserted once instead of five times over.
 */
const RETIRED_BY_RULING = [
  // …that `no-session` on an END is the outcome the caller wanted. DERIVABLE:
  // the table says the word means "no such agent there", and an END asked for
  // exactly that. `retry=no` on the line is the decision it was leading to.
  "On an END this is usually GOOD NEWS",
  "the agent already finished and there was nothing left to stop",
  // …that the session listing correctly keeps printing the id after a rename.
  // DERIVABLE: the rename clause already says the label reaches no server, and
  // `confirm=none` on the line already says nothing here can confirm it.
  "keeps printing the id after a rename",
  // …and the clause telling a caller not to hunt around its operator's consent
  // setting. ENCOURAGEMENT: the table says the toggle is the operator's and
  // `retry=no` says asking again changes nothing; "do not look for another
  // route" adds an exhortation, not a contract.
  "do not look for another route",
] as const;

describe("the doctrine still carries every paragraph these results dropped", () => {
  it('each moved sentence is one rooms(action="help") away', () => {
    for (const phrase of MOVED_DOCTRINE) {
      expect(CHANNEL_DOCTRINE, `${phrase} left the doctrine`).toContain(phrase);
    }
  });

  it("…and the ones retired by ruling stay OUT of it", () => {
    // ⚠ ONE ASSERTION OVER THE WHOLE LIST, not one per phrase: the value of this
    // case is the FULL set, and a per-phrase loop reports only the first.
    const grownBack = RETIRED_BY_RULING.filter((phrase) =>
      CHANNEL_DOCTRINE.includes(phrase),
    );
    expect(
      grownBack,
      "these were CUT by ruling — the doctrine carries contracts only (wave B " +
        "spec §4). Each is a consequence of a contract that is still there, or " +
        "encouragement about one. Putting one back is a decision to make in the " +
        "spec, not a sentence to slip into channel-doctrine.ts › MANAGE.",
    ).toEqual([]);
  });

  it("and no result on this lane carries one back", async () => {
    // ⚠ EVERY TERMINAL SHAPE, not just the happy one: prose grows back on the
    // branch nobody re-reads, which on this lane is a refusal.
    const lines = await Promise.all([
      endText(settled({ status: "done" })),
      endText(settled({ status: "refused", refusalReason: "no-session" })),
      endText(settled({ status: "expired" })),
      endText(settled({ status: "pending" })),
      renameText(settled({ kind: "rename", status: "done", targetName: "Research" })),
      renameText(settled({ kind: "rename", status: "refused", refusalReason: "bad-name" })),
      renameText(settled({ kind: "rename", status: "pending" })),
    ]);
    for (const text of lines) {
      // ⚠ ONE LINE, ALWAYS. A second line is how a paragraph comes back.
      expect(text.split("\n"), text).toHaveLength(1);
      for (const phrase of [...MOVED_DOCTRINE, ...RETIRED_BY_RULING]) {
        expect(text, `${phrase} is back in a result`).not.toContain(phrase);
      }
    }
  });
});
