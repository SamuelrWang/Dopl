/**
 * `op="end_agent"` / `op="rename_agent"` — the terminal shapes and what each one
 * teaches (2026-09-01, Samuel's external agent-management ruling).
 *
 * ⚠ **EVERY CASE HERE IS ABOUT WHAT THE RESULT TEACHES, not about plumbing.** A
 * tool RESULT is read by the same model at the moment it chooses its next action
 * and outvotes a description read once at connection (INVARIANTS §10). The
 * readings these two ops must prevent, and each has a case:
 *   1. `no-session` on an END read as a FAILURE → the agent re-issues, or worse
 *      re-launches, when the truthful reading is that the work already finished.
 *   2. A REFUSAL read as "the launch toggle is off" → the agent asks its operator
 *      to grant a permission that has nothing to do with what failed. This is the
 *      one that would have been introduced by copying the launch op's copy, and it
 *      is the sharpest case in the file.
 *   3. A RENAME read as ADDRESSABLE → the agent starts writing `@research` and
 *      reaches nobody, because the name lives on one desktop and reaches no server.
 *   4. A TIMEOUT read as a failure → a second request for the same change, with no
 *      way to tell which one acted.
 *
 * ⚠ **THE SENTENCES BECAME FIELDS (T10, 2026-09-02), AND THE READINGS DID NOT
 * MOVE.** Both ops closed on paragraphs — four on a successful end, two on every
 * rename, one per refusal word out of a nine-entry `REFUSAL_SENTENCES` map. All
 * of it was STANDING doctrine, re-transmitted per call, and it is now stated once
 * in `channel-doctrine.ts` (`WHY A LAUNCH, END, DIRECTION OR RENAME IS REFUSED`,
 * and `YOUR OWN AGENTS`). So each case below is pinned TWICE: the VERDICT is a
 * field on this call's line, and the paragraph it replaced is still somewhere a
 * reader can reach in one call. A guard that only checked the absence would pass
 * just as happily the day the text was deleted outright.
 *
 * ⚠ `foreignAgent()` STAYS PROSE and its case is unchanged. A refusal to a call
 * that was never filed is not narration under a write that happened, and it has
 * to CLOSE A DOOR ("do not look for another route"), which is an instruction
 * rather than a fact about a row.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient, LaunchDirective } from "@dopl/client";
import { opEndAgent, opRenameAgent } from "./channel-ops-agent";
// ⚠ THE OTHER HALF OF EVERY PIN BELOW. The paragraph a result stopped carrying
// has to still EXIST, or the tersening deleted doctrine instead of moving it.
import { CHANNEL_DOCTRINE } from "./channel-doctrine";
// ⚠ THE CLEAR-TO-DEFAULT WORDING LANDED ON THE ARGUMENT THAT TAKES IT rather
// than in the doctrine — `name`'s own `.describe()` is what a client reads at the
// moment it decides what to pass, which is closer to the decision than the op
// paragraph was.
import { CHANNEL_INPUT_SHAPE } from "./channel-schema";

const CHANNEL = { id: "chan-1", slug: "general", name: "General", visibility: "private" };
const AGENT = "a1b2c3d4";

/** The argument `.describe()` text, which is prose a client reads too. */
const ARG_PROSE = Object.values(CHANNEL_INPUT_SHAPE)
  .map((arg) => arg.description ?? "")
  .join("\n");

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
  "the thread untouched",
  "every message it posted still attributed",
  "instance ids are never reused",
  "there is no undo",
  // …a refusal is an answer, not an error, and re-asking does not change it.
  "A refusal is a normal answer from a machine its owner controls",
  "re-issuing does not change the answer",
  // …the two verbs the launch toggle does NOT gate.
  "THE LAUNCH TOGGLE GOVERNS STARTING AGENTS ONLY",
  "those two verbs are not gated by it",
  // …`no-session` on an END, which is the commonest outcome and not a fault.
  "On an END this is usually GOOD NEWS",
  "the agent already finished and there was nothing left to stop",
  // …a rename is display-only on ONE machine, so nothing here confirms it.
  "is invisible to every other member",
  "keeps printing the id after a rename",
  // …and a timed-out request is still filed. ⚠ **BACKED BY CODE SINCE A10/G10
  // (2026-09-02), AND THE SENTENCE MOVED WITH IT**: "do NOT issue it again" was
  // the only answer available while this lane had no idempotency key.
  "IF A WAIT TIMES OUT THE REQUEST IS STILL PENDING",
  "Re-issue it ONLY with the same `client_msg_id`",
  "WITHOUT one, do not re-issue at all",
] as const;

describe("the doctrine still carries every paragraph these results dropped", () => {
  it("each moved sentence is one op=\"help\" away", () => {
    for (const phrase of MOVED_DOCTRINE) {
      expect(CHANNEL_DOCTRINE, `${phrase} left the doctrine`).toContain(phrase);
    }
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
      for (const phrase of MOVED_DOCTRINE) {
        expect(text, `${phrase} is back in a result`).not.toContain(phrase);
      }
    }
  });
});

describe("end_agent — the success line", () => {
  const done = settled({ status: "done" });

  it("says what an end DOES NOT touch, because 'end' over-reads as 'remove'", async () => {
    // ⚠ **THE FACT REPLACED THREE SENTENCES AND KEPT THE READING.** `was ENDED`,
    // `thread it was working (if any) is untouched` and `stays in the channel`
    // were true of EVERY end, so they moved; `ended … filed=yes` says this call
    // reached a machine and the machine did it — the half only this call knows.
    // The reading they prevented is still guarded, by the doctrine pins above.
    const out = await endText(done);
    expect(out).toContain("ended agent=@agent-");
    expect(out).toContain("filed=yes");
    expect(out).not.toContain("not ended");
  });

  /**
   * ⚠ INSTANCE IDS ARE NEVER REUSED, so a handle after an end addresses nothing.
   * Without this an orchestrator keeps posting `@agent-<id>` into silence — the
   * exact failure `channel-session-handle.ts` documents one namespace over.
   */
  it("says the handle is SPENT — the one paragraph that had to survive as a FACT", async () => {
    // ⚠ A FIELD RATHER THAN A POINTER BECAUSE IT IS ABOUT THIS ID. "ids are
    // never reused" is a rule; "the handle in your hand is now spent" is a fact
    // about this call's value, and dropping it deletes the only signal that
    // catches an orchestrator talking to nobody. The route on — a new
    // `launch_agent` — is the rule half.
    const out = await endText(done);
    expect(out).toContain("handle=spent");
    expect(CHANNEL_DOCTRINE).toContain('op="launch_agent"');
  });

  it("does not claim more than a machine can prove", async () => {
    // ⚠ **`THE MACHINE SAID SO` IS NOT IN THE DOCTRINE VERBATIM** — the nearest
    // standing statement is that all of these verbs ASK, which is the same
    // property said the other way round, and it is pinned rather than the
    // missing headline. The result's own half is that it reports what came back
    // (`filed=yes` + a status word), never an outcome it did not observe.
    expect(CHANNEL_DOCTRINE).toContain("EVERY ONE OF THESE ASKS AND MAY BE REFUSED");
    expect(await endText(done)).toContain("filed=yes");
  });
});

describe("end_agent — no-session is NOT a fault", () => {
  const gone = settled({ status: "refused", refusalReason: "no-session" });

  /**
   * ⚠ **THE COMMONEST OUTCOME, AND THE ONE MOST EASILY MISREAD.** An agent that
   * finished is the ordinary cause, and for an END that is the outcome the caller
   * wanted, reached without them. A result that read as a failure would send an
   * orchestrator to re-launch the very work it was trying to stop.
   */
  it("names the word, and the doctrine calls it the outcome you wanted", async () => {
    const out = await endText(gone);
    // ⚠ THE WIRE WORD IS STILL THE RESULT'S OWN — the doctrine is keyed on it,
    // so a result that dropped it would leave a reader with no way in.
    expect(out).toContain("reason=no-session");
    expect(CHANNEL_DOCTRINE).toContain("On an END this is usually GOOD NEWS");
  });

  it("sends the caller to read_sessions rather than to a retry", async () => {
    // ⚠ `retry=no` IS THE WHOLE OF "DO NOT ASK AGAIN", and it is the one decision
    // the nine paragraphs were all leading to. The surface that answers instead
    // is named in the doctrine, not re-stated on every refusal.
    expect(await endText(gone)).toContain("retry=no");
    expect(CHANNEL_DOCTRINE).toContain('Look for the outcome in "read_sessions"');
  });

  it("and never reads as an error", async () => {
    // ⚠ THE READING, PINNED DIRECTLY: an ordinary answer must not arrive dressed
    // as a fault, in any wording, or the orchestrator re-launches.
    const out = await endText(gone);
    expect(out).not.toMatch(/\berror\b|\bfailed\b|\bfailure\b/i);
  });
});

describe("the refusal advice must NOT be the launch op's", () => {
  /**
   * ⚠ **THE SHARPEST CASE IN THIS FILE.** `no-bridge` on the LAUNCH lane means the
   * operator's launch-over-MCP toggle is off, and its paragraph tells the caller
   * to ask for it to be turned on. **THAT TOGGLE DOES NOT GATE THESE TWO VERBS** —
   * `main/launch-directives.js › handle` tests the kind, and
   * `directive-agent-ops.js`'s header carries the ruling. Copying the launch
   * sentence here would send an orchestrator to request a permission unrelated to
   * what failed, and to conclude its operator had denied it something they never
   * denied.
   *
   * ⚠ **ONE TEXT NOW SERVES ALL THREE MAILBOXES, so the carve-out moved INTO it.**
   * The doctrine's refusal section closes on the launch toggle governing starting
   * agents only — which is what stops the shared paragraph from teaching the
   * launch answer to an end.
   */
  it("no-bridge on an end never sends the caller to a permission toggle", async () => {
    const out = await endText(settled({ status: "refused", refusalReason: "no-bridge" }));
    expect(out).toContain("reason=no-bridge");
    expect(out).toContain("retry=no");
    // ⚠ The launch lane's own wording may not ride along on this lane's result.
    expect(out).not.toContain("TURNED OFF on that machine");
    expect(out).not.toMatch(/turn(ed)? (it )?on/i);
    // ⚠ …and the carve-out is in the text the reader is sent to.
    expect(CHANNEL_DOCTRINE).toContain("THE LAUNCH TOGGLE GOVERNS STARTING AGENTS ONLY");
    expect(CHANNEL_DOCTRINE).toContain("do not ask your operator to turn anything on");
    expect(CHANNEL_DOCTRINE).toContain("those two verbs are not gated by it");
  });

  /**
   * ⚠ `cap` on a launch means "wait for a running agent to finish". Telling a
   * caller that BEFORE ENDING ONE is advice that contradicts the request.
   *
   * ⚠ **THE END-SPECIFIC SENTENCE IS GONE AND `retry=no` IS WHAT CARRIES IT.**
   * The old copy said `cap` is "not a state an end or a rename can be blocked
   * by"; the shared doctrine paragraph is written for the launch lane and still
   * says "either wait for one to finish or ask your operator to end one". The
   * FIELD is what keeps the two lanes apart on this call — `busy` is the only
   * word in the whole table that answers `once`, and `cap` answers `no`, so the
   * result never tells an end-caller to wait for a slot.
   */
  it("cap on an end does not tell the caller to wait for a slot", async () => {
    const out = await endText(settled({ status: "refused", refusalReason: "cap" }));
    expect(out).toContain("reason=cap");
    expect(out).toContain("retry=no");
    expect(out).not.toContain("wait for one to finish");
    expect(out).not.toMatch(/wait for/i);
  });

  it("busy is the ONE word that earns a second ask, and it says so as a field", async () => {
    // ⚠ THE TABLE'S ONLY `once`, PINNED AGAINST ITS NEIGHBOURS. A retry verdict
    // that drifted to `once` across the board would turn every refusal into a
    // loop, and the map is the only thing standing between the two readings.
    const busy = await endText(settled({ status: "refused", refusalReason: "busy" }));
    expect(busy).toContain("reason=busy");
    expect(busy).toContain("retry=once");
    expect(CHANNEL_DOCTRINE).toContain("ask again in a minute or two, ONCE");
    for (const reason of ["cap", "no-sdk", "auth-hold", "no-template"] as const) {
      const out = await endText(settled({ status: "refused", refusalReason: reason }));
      expect(out, `${reason} earned a retry it should not have`).toContain("retry=no");
    }
  });

  it("a refusal with NO word named guesses no verdict", async () => {
    // ⚠ `-` IS "THE MACHINE NAMED NOTHING", never an invented `retry=no`: a
    // guessed verdict on an unreported reason is a claim about a machine we did
    // not hear from, which is the class of lie this whole lane is built against.
    const out = await endText(settled({ status: "refused" }));
    expect(out).toContain("reason=- retry=-");
    expect(out).toContain("filed=yes");
  });
});

describe("rename_agent — display only, on one machine", () => {
  const done = settled({ kind: "rename", status: "done", targetName: "Research" });

  it("says the handle is unchanged, which is the ONLY address", async () => {
    // ⚠ **`handle=unchanged` IS NOT DECORATION**, and it is why the DISPLAY-ONLY
    // paragraph could leave. `@agent-<id>` stays the only address — nothing
    // resolves an agent by its name, which is exactly what stops a rename
    // silently re-pointing a running instruction.
    const out = await renameText(done);
    expect(out).toContain(`renamed agent=@agent-${AGENT}`);
    expect(out).toContain("handle=unchanged");
    expect(out).toContain("name=Research");
    // ⚠ And the boundary a caller needs before believing a peer can see it.
    expect(CHANNEL_DOCTRINE).toContain("is invisible to every other member");
    expect(CHANNEL_DOCTRINE).toContain("reaches no server");
  });

  /**
   * ⚠ THE LINE THAT PREVENTS A POLLING LOOP. The name is stored on the operator's
   * desktop and reaches no server, so `read_sessions` keeps printing the id. An
   * agent that expected the listing to change would re-issue forever.
   */
  it("warns that read_sessions will NOT show the name, and that this is correct", async () => {
    // ⚠ **`confirm=none` IS THAT WARNING AS A FIELD, AND IT MUST NEVER BECOME
    // `read_sessions`.** There is no surface here that can confirm a rename
    // landed; a caller told to go and look would loop on a listing that is
    // CORRECTLY still printing the id.
    const out = await renameText(done);
    expect(out).toContain("confirm=none");
    expect(CHANNEL_DOCTRINE).toContain("keeps printing the id after a rename");
    expect(CHANNEL_DOCTRINE).toContain("that is correct rather than a stale read");
  });

  it("a name with a SPACE is quoted, so it cannot invent a field", async () => {
    // ⚠ OPERATOR-AUTHORED TEXT ON A `key=value` LINE. `name=Code Auditor` would
    // read as a value plus a stray token, and a name containing `confirm=` could
    // forge one — quoting is the fence, and this is the op that takes the most
    // obviously human string.
    const out = await renameText(
      settled({ kind: "rename", status: "done", targetName: "Code Auditor" }),
      "Code Auditor",
    );
    expect(out).toContain('name="Code Auditor"');
    expect(out).toContain("handle=unchanged");
  });

  it("an EMPTY name reads as a CLEAR, not as a rename to nothing", async () => {
    const cleared = settled({ kind: "rename", status: "done", targetName: "" });
    const out = (await opRenameAgent(cleared, "general", AGENT, "", { waitMs: 0 }))
      .content[0].text as string;
    // ⚠ CLEARED IS ITS OWN OUTCOME rather than an empty value: `name=-` would say
    // "nothing was reported", which is a different claim from "the display fell
    // back to its default". ⚠ THE DEFAULT ITSELF (`Agent #<id>`) IS NOT IN THE
    // DOCTRINE — it is on the `name` argument, which is where a caller reads it
    // at the moment it decides what to send.
    expect(out).toContain("name=cleared");
    expect(ARG_PROSE).toContain('clear it back to "Agent #<id>"');
  });

  it("bad-name says exactly what would be accepted, so one retry can fix it", async () => {
    const out = await renameText(
      settled({ kind: "rename", status: "refused", refusalReason: "bad-name" }),
    );
    expect(out).toContain("reason=bad-name");
    // ⚠ **`agentChanged=no` IS THE HALF THAT WAS PROSE** ("Nothing else about the
    // agent changed"): a refused rename is COSMETIC — the agent is still running
    // and still addressed the same way — and a caller that read a refusal as
    // damage would end and re-launch a healthy agent.
    expect(out).toContain("agentChanged=no");
    // ⚠ …and the accepted shape, which is the one thing a caller needs to fix it.
    expect(CHANNEL_DOCTRINE).toContain("1-60 visible characters on ONE line");
    expect(ARG_PROSE).toContain("1-60 visible characters on ONE line");
  });
});

describe("the foreign-agent refusal — answered here, before any row exists", () => {
  /**
   * ⚠ IT NAMES THE FACT PLAINLY RATHER THAN 404-ING. The caller has already proved
   * channel membership, inside which `op="members"` and `op="read_sessions"` are
   * readable anyway, so nothing is disclosed — while a 404 would tell an
   * orchestrator its OWN agent had vanished and send it to re-launch.
   *
   * ⚠ **DELIBERATELY STILL PROSE** (T10). Everything else on this lane became a
   * fact line; this did not, because it answers a call that was never filed and
   * has to close a door — an instruction, not a fact about a row.
   */
  const foreign = client({
    createAgentDirective: vi.fn(async () => {
      throw Object.assign(new Error("forbidden"), {
        code: "CHANNEL_AGENT_FOREIGN",
        status: 403,
      });
    }),
  });

  it("says nothing was filed and that there is no route around it", async () => {
    const res = await opEndAgent(foreign, "general", AGENT, { waitMs: 0 });
    const out = res.content[0].text as string;
    expect(res.isError).toBe(true);
    expect(out).toContain("ANOTHER MEMBER'S");
    expect(out).toContain("no request was filed");
    expect(out).toContain("no permission that would change that");
  });
});

describe("the handle a caller pasted", () => {
  /**
   * ⚠ `read_sessions` PRINTS `@agent-<id>`, so that is what a model copies.
   * Refusing the pasted form would 400 a caller for doing exactly what the
   * neighbouring op taught — the same reason `direct_agent` accepts both, and the
   * reason the parser is now one shared function.
   */
  it("accepts @agent-<id> and sends the bare id", async () => {
    const c = settled({ status: "done" });
    await opEndAgent(c, "general", `@agent-${AGENT}`, { waitMs: 0 });
    expect(c.createAgentDirective).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "end", agentId: AGENT }),
    );
  });
});

describe("offline and pending — nothing filed, versus filed and unanswered", () => {
  it("offline says NOTHING WAS FILED, which is the opposite of pending", async () => {
    const off = client({
      createAgentDirective: vi.fn(async () => ({ offline: true, directive: null })),
    });
    const out = await endText(off);
    // ⚠ **`filed=no` IS THE LOAD-BEARING HALF** and it is the field that keeps
    // this shape apart from the PENDING one below: nothing was written, so
    // nothing is outstanding and there is nothing to cancel.
    expect(out).toContain("reason=offline");
    expect(out).toContain("filed=no");
    expect(out).not.toContain("filed=yes");
    expect(out).not.toContain("directive=");
  });

  /**
   * ⚠ A TIMEOUT IS NOT A REFUSAL. The row stays pending and the machine may still
   * take it; a second request for the same change leaves the caller unable to say
   * which one acted.
   */
  it("pending names the row, says NOT to re-issue, and says where to look", async () => {
    const out = await endText(settled({ status: "pending" }));
    expect(out).toContain("pending agent=@agent-");
    // ⚠ THE ROW ID IS THE FACT ONLY THIS CALL HAS — it is what makes the outcome
    // findable later, and it is why a pending result is not simply "unknown".
    expect(out).toContain("directive=55555555-5555-5555-5555-555555555555");
    expect(out).toContain("claimed=no");
    // ⚠ **`retry=no` IS THE ONE INSTRUCTION THAT COULD NOT BECOME A BARE FACT AND
    // DID NOT.** A second directive is a second request for the same change, and
    // on an END nothing afterwards could tell you which one acted.
    expect(out).toContain("retry=no");
    // ⚠ AND AN END IS CONFIRMABLE: the agent disappearing from that listing IS
    // the answer, which is why `confirm=` is a field rather than one sentence.
    // ⚠ THE UNDERSCORE IS BLANKED BY THE SHARED NEUTRALIZER (`read sessions`,
    // quoted) — a defect reported to the tier, NOT pinned: the pattern below
    // passes today and keeps passing once the op name renders whole.
    expect(out).toMatch(/confirm="?read.sessions"?/);
    expect(out).not.toContain("confirm=none");
  });

  it("a pending RENAME says the opposite — nothing here can confirm it landed", async () => {
    // ⚠ **THE ASYMMETRY IS THE REASON `confirm=` EXISTS.** One pending line for
    // both verbs would promise the rename a confirmation that does not exist,
    // and the caller would poll `read_sessions` forever against a listing that
    // correctly still prints the id.
    const out = await renameText(settled({ kind: "rename", status: "pending" }));
    expect(out).toContain("confirm=none");
    expect(out).not.toMatch(/confirm="?read/);
    expect(out).toContain("retry=no");
  });

  it("expired is LAPSED, not refused — no machine ever answered", async () => {
    // ⚠ NOTHING IS OUTSTANDING, so this is not the pending shape; and no machine
    // refused, so it is not a refusal either — which is why it carries neither a
    // `retry=` verdict nor a refusal word beyond `expired`.
    const out = await endText(settled({ status: "expired" }));
    expect(out).toContain("not ended");
    expect(out).toContain("reason=expired");
    expect(out).toContain("directive=55555555-5555-5555-5555-555555555555");
    expect(out).not.toContain("retry=");
  });
});
