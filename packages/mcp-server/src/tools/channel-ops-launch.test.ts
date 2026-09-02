/**
 * `op="launch_agent"` — the four terminal shapes and the FACTS each one ends on.
 *
 * ⚠ **EVERY CASE HERE IS ABOUT WHAT THE RESULT TEACHES, not about plumbing.** A
 * tool RESULT is read by the same model at the moment it chooses its next action
 * and outvotes a description read once at connection (INVARIANTS §10). The three
 * readings this op must prevent, and each has a case:
 *   1. A TIMEOUT read as a failure → the agent re-issues → a SECOND agent starts
 *      on the same work, and nothing can tell them apart.
 *   2. `no-bridge` read as a fault → the agent looks for a way around its
 *      operator's own consent setting.
 *   3. `cap` read as a fault → the agent retries into a machine that is FULL,
 *      instead of waiting for a slot.
 *
 * ⚠ **WHAT MOVED, AND HOW THIS SUITE FOLLOWED IT (T10, 2026-09-02).** The result
 * is ONE line of `key=value` facts now, ≤300 chars; every paragraph it carried
 * is standing doctrine and lives in `channel-doctrine.ts`. So each case asserts
 * BOTH halves — the FACT the terse line keeps AND the SENTENCE the doctrine
 * keeps. Only the first lets the prose vanish from the product; only the second
 * lets it grow back into the result.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient, LaunchDirective, LaunchRefusalReason } from "@dopl/client";
import { opLaunchAgent } from "./channel-ops-launch";
import { CHANNEL_DOCTRINE } from "./channel-doctrine";
import { WRITE_RESULT_MAX_CHARS } from "./channel-facts";

const CHANNEL = { id: "chan-1", slug: "general", name: "General", visibility: "private" };

function directive(over: Partial<LaunchDirective> = {}): LaunchDirective {
  return {
    id: "55555555-5555-5555-5555-555555555555",
    channelId: "chan-1",
    threadId: null,
    goal: "ship the parser",
    model: null,
    status: "pending",
    templateId: null,
    templateName: null,
    refusalReason: null,
    agentId: null,
    claimedAt: null,
    decidedAt: null,
    expiresAt: "2026-08-22T12:02:00.000Z",
    createdAt: "2026-08-22T12:00:00.000Z",
    ...over,
  };
}

function client(over: Record<string, unknown> = {}): DoplClient {
  return {
    listChannels: vi.fn(async () => [CHANNEL]),
    createLaunchDirective: vi.fn(async () => ({ offline: false, directive: directive() })),
    getLaunchDirective: vi.fn(async () => directive()),
    ...over,
  } as unknown as DoplClient;
}

const text = async (c: DoplClient, opts = {}) =>
  (await opLaunchAgent(c, "general", opts)).content[0].text as string;

/** A client whose CREATE already answers with this directive (no poll needed). */
const created = (over: Partial<LaunchDirective>) =>
  client({ createLaunchDirective: vi.fn(async () => ({ offline: false, directive: directive(over) })) });
/** A client whose create stays pending and whose POLL answers with this row. */
const polls = (over: Partial<LaunchDirective>) =>
  client({ getLaunchDirective: vi.fn(async () => directive(over)) });

describe("OFFLINE — nothing is filed, and the caveat is honest about presence", () => {
  const offline = client({
    createLaunchDirective: vi.fn(async () => ({ offline: true, directive: null })),
  });

  it("says NOTHING WAS FILED, so there is nothing pending to chase", async () => {
    // ⚠ `filed=no` IS THE LOAD-BEARING HALF AND MAY NEVER BE TRADED FOR BREVITY:
    // nothing was written, so nothing is pending and nothing can be cancelled —
    // the OPPOSITE of PENDING, where re-issuing starts a second agent.
    expect(await text(offline)).toBe("not launched reason=offline filed=no");
  });

  /**
   * ⚠ THE CAVEAT IS THE POINT. `agent_presence` is per-(user, workspace): it
   * cannot say WHICH machine is up or whether launching is enabled there, so
   * "your machine is offline" claims what the check cannot establish. The line
   * names a REASON for not launching and stops.
   * ⚠ REPORTED GAP: that paragraph has NO home in `channel-doctrine.ts` (no
   * section covers the offline branch), so the "still in the product" half of
   * this pair is unassertable today. See the report.
   */
  it("asserts no verdict about anybody's machine", async () => {
    const out = await text(offline);
    expect(out).not.toMatch(/your (machine|desktop) is/i);
    expect(out).not.toContain("HINT, NOT A VERDICT");
    expect(out.split("\n")).toHaveLength(1);
  });

  it("keeps the fallback that needs nobody's machine reachable in the doctrine", async () => {
    // ⚠ MOVED, NOT DELETED: a post reaches the PERSON whatever their desktop is
    // doing — the LAW's first rule, not this result's sentence.
    expect(await text(offline)).not.toContain('op="post"');
    expect(CHANNEL_DOCTRINE).toContain('op="post"');
  });

  it("never polls — there is no directive to poll", async () => {
    const getLaunchDirective = vi.fn();
    const create = vi.fn(async () => ({ offline: true, directive: null }));
    await text(client({ createLaunchDirective: create, getLaunchDirective }));
    expect(getLaunchDirective).not.toHaveBeenCalled();
  });
});

describe("LAUNCHED — the id, and how to direct it", () => {
  const launched = created({ status: "launched", agentId: "abcd1234" });

  it("names the agent and publishes the PREFIXED handle", async () => {
    const out = await text(launched);
    // ⚠ THE `agent-` FORM, AND THE BARE FORM MUST NOT COME BACK. Both parse on
    // the desktop, but the app's picker inserts and tints the prefixed one
    // (`lib/agent-mentions.ts › agentMentionHandle`); publishing one form while
    // the product writes the other is the F-266 split.
    expect(out).toContain("agent=@agent-abcd1234");
    // ⚠ MOVED, NOT DELETED — the rule that makes the prefixed form the only one
    // that means anything off the operator's own machine.
    expect(out).not.toContain("ITS HANDLE IS");
    expect(CHANNEL_DOCTRINE).toContain("THE HANDLE IS `@agent-<id>`");
  });

  it("says a custom NAME is machine-local and never addressable from here", async () => {
    // A rename lives in `main/agent-names.js` on ONE machine and nothing here
    // carries it — which is why the fact line publishes the ID, never a name.
    const out = await text(launched);
    expect(out).not.toContain("lives on their machine alone");
    expect(CHANNEL_DOCTRINE).toContain("is stored on that ONE machine, reaches no server");
  });

  it("⚠ KEEPS THE WAKE **WITH ITS THREE LIMITS** — the sentence the repro bought", async () => {
    // ⚠ THIS BRANCH SAID "DIRECT IT WITH `@<id>` — write that token in the BODY
    // of a post … and that specific agent picks it up", full stop. The sentence
    // was right and the surface underneath it was not: the loop fence refused
    // every agent-authored message, so the only caller holding the id could not
    // spend it, and a live orchestrator followed this copy five times into
    // silence (ENGINEERING, 2026-08-31). Samuel's same-account carve made it
    // true; the BOUNDARY it never had is what is asserted here, on the doctrine.
    expect(await text(launched)).not.toContain("THREE LIMITS");
    expect(CHANNEL_DOCTRINE).toContain("TO REDIRECT ONE LATER");
    expect(CHANNEL_DOCTRINE).toContain("addresses an agent rather than a person");
    expect(CHANNEL_DOCTRINE).toContain("THREE LIMITS, and they are the fence rather than a knack");
    // (1) ADDRESSED ONLY — tiers 2 and 3 stay shut to every agent-authored post.
    expect(CHANNEL_DOCTRINE).toContain("an unaddressed post of yours starts nobody");
    // (2) OWN OPERATOR ONLY — the 2026-08-28 fence, which the carve did not move.
    expect(CHANNEL_DOCTRINE).toContain("only for YOUR OWN operator's agents");
    // (3) NOT OBSERVABLE — the wake happens on a desktop no server can see.
    expect(CHANNEL_DOCTRINE).toContain("delivery is not observable from here");
  });

  it("⚠ says a GOAL-LESS launch runs nothing, and a goal RUNS", async () => {
    // ⚠ `idle=` IS NOT COSMETIC AND MAY NEVER BE DROPPED FOR BREVITY: "it is on
    // it" vs "parked and running nothing" are different outcomes, and one field
    // covering both must be the weaker claim — which leaves a caller waiting
    // forever on an agent that was never going to move.
    expect(await text(launched)).toContain("idle=yes");
    expect(await text(launched, { goal: "Draft the notes" })).toContain("idle=no");
    expect(CHANNEL_DOCTRINE).toContain("a launch WITH one runs that goal as its FIRST INSTRUCTION");
  });

  it("carries the identity fields, quoted where a value could forge a field", async () => {
    // ⚠ A FUTURE TIER ADDS FIELDS HERE, NOT PARAGRAPHS. And a value with a space
    // is QUOTED: a template name is operator-authored, so an unquoted
    // `template=x idle=no` lets a crafted name append a fact nobody asserted.
    const out = await text(
      created({
        status: "launched",
        agentId: "abcd1234",
        threadId: "44444444-4444-4444-4444-444444444444",
        templateName: "Code Auditor",
        model: "claude-opus-5",
      }),
      { goal: "Audit the migration" },
    );
    expect(out).toContain('template="Code Auditor"');
    expect(out).toContain("model=claude-opus-5");
    expect(out).toContain("thread=44444444-4444-4444-4444-444444444444");
    expect(out.length, out).toBeLessThanOrEqual(WRITE_RESULT_MAX_CHARS);
  });

  it("points at await (channel AND workspace form) and read_sessions, in the doctrine", async () => {
    expect(await text(launched)).not.toContain('op="await"');
    expect(CHANNEL_DOCTRINE).toContain('op="read_sessions"');
    expect(CHANNEL_DOCTRINE).toContain("OMITTING `channel` holds across EVERY channel you are a MEMBER of at once");
  });

  it("does NOT claim to have verified the launch", async () => {
    // ⚠ There is no third party to check a machine's word against: the head verb
    // REPORTS what it answered and the line adds no confirmation. ⚠ REPORTED
    // GAP: "THE MACHINE SAID SO — nothing checks it" has no home in
    // `channel-doctrine.ts`; only the weaker ASK half survives. See the report.
    const out = await text(launched);
    expect(out.startsWith("launched ")).toBe(true);
    expect(out).not.toMatch(/confirm|verified|running now/i);
    expect(CHANNEL_DOCTRINE).toContain('op="launch_agent" ASKS your operator\'s own machine to start one');
  });
});

/**
 * ⚠ THE NINE WORDS ARE THE WIRE CONTRACT, and this is a
 * `Record<LaunchRefusalReason, …>` for the same reason production's
 * `RETRY_ADVICE` is one: a TENTH word cannot enter the enum without this table
 * accounting for it. The result names the WORD and the one decision every
 * sentence led to (`retry=`); `says` is the sentence itself, `channel-doctrine`'s
 * now — asserted so a word cannot lose its explanation with its paragraph.
 */
const REFUSALS: Record<LaunchRefusalReason, { retry: "once" | "no"; says: string[] }> = {
  // ⚠ FULL, NOT BROKEN — the next action is to LOOK at what is running.
  cap: { retry: "no", says: ["ALREADY RUNNING AS MANY AGENTS AS IT ALLOWS", "Nothing is broken", 'op="read_sessions"'] },
  busy: { retry: "once", says: ["The one genuinely temporary refusal", "a minute or two"] },
  "no-sdk": { retry: "no", says: ["NO AGENT RUNTIME available", "Tell your operator"] },
  "auth-hold": { retry: "no", says: ["SIGNED OUT", "Tell your operator"] },
  // ⚠ THE OPERATOR SAYING NO — their own consent setting, never a fault and
  // never something to route around.
  "no-bridge": { retry: "no", says: ["LAUNCHING (or DIRECTING) OVER MCP TURNED OFF", "deliberate setting", "ASK THEM", "do not look for another route"] },
  "no-counterparty": { retry: "no", says: ['op="members"'] },
  // ⚠ TWO FENCES, TWO PEOPLE: you named it under YOUR visibility, their desktop
  // resolves it under THEIRS — and which of deleted/invisible stays unobservable,
  // because the resolve endpoint is 404-never-403.
  // ⚠ AND THE TENANCY IS THE THIRD CAUSE, NAMED FIRST (T35). It is not an
  // oracle: the resolve is keyed `(workspace_id, id)` against the CHANNEL's
  // container, so a template the caller owns elsewhere is ABSENT rather than
  // hidden — a standing rule, answerable without reading any row. Which of the
  // OTHER two it was stays unobservable.
  "no-template": { retry: "no", says: ["OPERATOR whose machine this is", "Do not re-issue the same id", "or it no longer exists", "THIS CHANNEL'S container", "a home channel IS its own container", "CHECK THE TENANCY FIRST"] },
  // ⚠ Neither of the last two has a producer on a LAUNCH — they belong to the
  // `end`/`rename` kinds sharing this mailbox, so arriving here IS the anomaly
  // and the answer is `no`: re-issuing over it would re-issue forever.
  "no-session": { retry: "no", says: ["no LIVE session of your operator's carries that agent id"] },
  "bad-name": { retry: "no", says: ["1-60 visible characters"] },
};

describe("REFUSED — nine words, nine next actions", () => {
  const refusedWith = (refusalReason: LaunchDirective["refusalReason"]) =>
    created({ status: "refused", refusalReason });

  it.each(Object.entries(REFUSALS))(
    "%s — the word and the verdict on the line, the sentence in the doctrine",
    async (reason, { retry, says }) => {
      const out = await text(refusedWith(reason as LaunchRefusalReason));
      expect(out, reason).toContain(`reason=${reason}`);
      expect(out, reason).toContain(`retry=${retry}`);
      // ⚠ `filed=yes` IS "NOTHING IS PENDING" in one token: the row exists and
      // was ANSWERED, so there is nothing to chase and nothing to cancel.
      expect(out, reason).toContain("filed=yes");
      expect(out.split("\n"), reason).toHaveLength(1);
      // ⚠ MOVED, NOT DELETED — each phrase is the one that stops its word being
      // misread (`cap` as a fault, `no-bridge` as something to work around).
      for (const phrase of says) expect(CHANNEL_DOCTRINE, `${reason}: ${phrase}`).toContain(phrase);
    },
  );

  it("BUSY is the ONLY word that invites a retry", () => {
    // ⚠ A boolean here would either invite a retry loop against a setting nobody
    // will flip, or forbid the one retry that works.
    expect(Object.entries(REFUSALS).filter(([, r]) => r.retry === "once").map(([w]) => w)).toEqual(["busy"]);
  });

  it("the CONSENT refusal never reads as a fault on the line either", async () => {
    // ⚠ `retry=no` must not read as "try harder" — there is no other route, and
    // a setting must not be editorialized into a failure.
    const out = await text(refusedWith("no-bridge"));
    expect(out).not.toMatch(/error|failure|failed|broken/i);
  });

  it("a refusal with NO reason is reported honestly rather than guessed at", async () => {
    // ⚠ `-` ON BOTH FIELDS, never a guessed retry verdict. The column's own CHECK
    // forbids that row; if one arrives the honest answer is that this build
    // cannot advise, and a fabricated `retry=no` strands a caller.
    expect(await text(refusedWith(null))).toBe("refused reason=- retry=- filed=yes");
  });
});

describe("TIMEOUT — pending, and the strongest possible do-not-re-issue", () => {
  const pending = polls({ status: "pending" });

  it("gives the directive id and the expiry", async () => {
    // ⚠ The id is the only handle left, and the expiry is when the question
    // stops being open — both things only this call can report.
    const out = await text(pending, { waitMs: 0 });
    expect(out).toContain("directive=55555555-5555-5555-5555-555555555555");
    expect(out).toContain("expires=2026-08-22T12:02:00.000Z");
    expect(out.startsWith("pending ")).toBe(true);
  });

  /** ⚠ THE ONE MISREADING THAT COSTS AN AGENT: a second call starts a SECOND
   *  agent on the same work, and nothing can tell them apart afterwards. */
  it("REGRESSION: says a timeout is NOT a refusal, and forbids re-issuing", async () => {
    const out = await text(pending, { waitMs: 0 });
    // ⚠ `retry=no` IS THE INSTRUCTION AND MAY NEVER BE SOFTENED OR DROPPED — it
    // is the whole of "DO NOT ISSUE THIS CALL AGAIN". And the head verb is
    // `pending`, never `refused`: a refusal was ANSWERED, this was not.
    expect(out).toContain("retry=no");
    expect(out.startsWith("pending ")).toBe(true);
    expect(out).not.toContain("refused");
    expect(out).not.toContain("DO NOT ISSUE THIS CALL AGAIN");
    // ⚠ MOVED, NOT DELETED — and the COST is what the doctrine states, because
    // "do not re-issue" without it is a rule an agent talks itself out of.
    expect(CHANNEL_DOCTRINE).toContain("A second launch starts a SECOND agent on the same work");
  });

  it("says where the answer will show up instead", async () => {
    expect(await text(pending, { waitMs: 0 })).not.toContain('op="read_sessions"');
    expect(CHANNEL_DOCTRINE).toContain('Look for the outcome in "read_sessions" or "read_directions" instead');
  });

  it("a CLAIMED-but-undecided hold says a machine has taken it", async () => {
    // ⚠ Driven through a REAL poll (waitMs > 0): `waitMs: 0` renders the CREATE
    // result and never reads the row, which is correct and exactly why this case
    // cannot use it. ⚠ 100ms, not 2s — ONE poll is all the row needs, and a
    // fixture with no terminal status otherwise burns its whole budget in
    // wall-clock time.
    const out = await text(polls({ status: "claimed" }), { waitMs: 100 });
    // ⚠ CLAIMED AND PENDING END THE SAME WAY, one field apart: the next action
    // is identical and only the field says a machine has taken it.
    expect(out).toContain("claimed=yes");
    expect(out).toContain("retry=no");
  });

  it("EXPIRED says it lapsed, and does NOT forbid asking again", async () => {
    const out = await text(created({ status: "expired" }), { waitMs: 0 });
    // ⚠ LAPSED IS NOT REFUSED AND NOT PENDING: no machine ever answered, so
    // nothing is outstanding and asking once more is legitimate. The ABSENCE of
    // `retry=no` is the whole difference from the branch above.
    expect(out).toBe("expired directive=55555555-5555-5555-5555-555555555555 filed=yes");
  });

  it("a FAILED poll ends on the PENDING shape, not on an error", async () => {
    // ⚠ The request is filed and the machine may still take it; reporting a
    // failure over a launch that may be running is the worse answer.
    const out = await text(
      client({ getLaunchDirective: vi.fn(async () => { throw new Error("connection reset"); }) }),
      { waitMs: 5 }
    );
    expect(out.startsWith("pending ")).toBe(true);
    expect(out).toContain("retry=no");
    expect(out).not.toContain("connection reset");
  });
});

describe("the call itself", () => {
  it("passes channel id, thread, goal, model and template through", async () => {
    const createLaunchDirective = vi.fn(async () => ({
      offline: false,
      directive: directive({ status: "launched", agentId: "abcd1234" }),
    }));
    await opLaunchAgent(client({ createLaunchDirective }), "general", {
      thread: "44444444-4444-4444-4444-444444444444",
      goal: "ship the parser",
      model: "claude-opus-5",
      template: "Code Auditor",
    });
    // ⚠ THE TEMPLATE STRING GOES OUT UNTOUCHED. Whether it is an id or a name,
    // and whether a name is ambiguous, is decided SERVER-SIDE against the
    // caller's own visibility — which this process cannot evaluate.
    expect(createLaunchDirective).toHaveBeenCalledWith({
      channel: "chan-1",
      threadId: "44444444-4444-4444-4444-444444444444",
      goal: "ship the parser",
      model: "claude-opus-5",
      template: "Code Auditor",
    });
  });

  it("names NO operator — there is no argument that could", async () => {
    const createLaunchDirective = vi.fn(async () => ({
      offline: false,
      directive: directive({ status: "launched", agentId: "abcd1234" }),
    }));
    await opLaunchAgent(client({ createLaunchDirective }), "general");
    const body = createLaunchDirective.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(body)).toEqual([
      "channel",
      "threadId",
      "goal",
      "model",
      "template",
      // THE POSTURE REQUEST (2026-09-01, T24). Three keys added by a CONSCIOUS
      // edit here, which is this assertion working rather than being worked
      // around: it enumerates the whole body precisely so a field nobody
      // reviewed cannot appear in it.
      // ⚠ WHAT IT GUARDS IS UNCHANGED — none of the three names an OPERATOR.
      // They say how much freedom to ASK FOR on the caller own machine, and the
      // machine clamps them to its owner ceiling; there is still no argument on
      // this path that could name somebody else computer.
      "tools",
      "messages",
      "chain",
    ]);
  });

  /**
   * THE TEMPLATE REFUSALS AT CREATE TIME (2026-08-23).
   *
   * ⚠ **THE DISCRIMINATOR IS THE ERROR CODE, NEVER THE STATUS**, and that is the
   * whole reason these cases exist. One call now has TWO ways to 404 (no such
   * channel / membership, no such template) and one to 409. A status-only branch
   * tells an agent its CHANNEL was wrong when its TEMPLATE NAME was — the exact
   * mis-narration `channel-errors.ts` was written to stop.
   */
  const apiError = (status: number, code: string, details?: unknown) =>
    Object.assign(new Error(code), { status, code, details });

  it("an AMBIGUOUS name is refused and EVERY match is listed with its id and visibility", async () => {
    // ⚠ REFUSES AND LISTS, NEVER PICKS. Names are deliberately not unique — a
    // unique index across a visibility boundary would leak the existence of a
    // private row through a conflict error — so two visible "Researcher"s is a
    // legitimate state and any tie-break silently starts the wrong identity.
    const res = await opLaunchAgent(
      client({
        createLaunchDirective: vi.fn(async () => {
          throw apiError(409, "AGENT_TEMPLATE_AMBIGUOUS", {
            matches: [
              { id: "t-1", name: "Researcher", visibility: "private" },
              { id: "t-2", name: "Researcher", visibility: "workspace" },
            ],
          });
        }),
      }),
      "general",
      { template: "Researcher" },
    );
    const out = res.content[0].text as string;
    expect(res.isError).toBe(true);
    expect(out).toContain("nothing was filed");
    expect(out).toContain("`t-1`");
    expect(out).toContain("`t-2`");
    expect(out).toContain("(private)");
    expect(out).toContain("(workspace)");
    // ⚠ It must not read as a CHANNEL problem, and it must not tell the agent to
    // wait for a machine: nothing was asked of one.
    expect(out).not.toContain("Channel not found");
    expect(out).not.toContain("still PENDING");
  });

  it("an UNRESOLVABLE template says so, and never says whether it EXISTS", async () => {
    // ⚠ 404-never-403 all the way down: "no such template" and "not shared with
    // you" are ONE answer, or the refusal becomes an id-probe.
    const res = await opLaunchAgent(
      client({ createLaunchDirective: vi.fn(async () => { throw apiError(404, "AGENT_TEMPLATE_NOT_FOUND"); }) }),
      "general",
      { template: "Ghost" },
    );
    const out = res.content[0].text as string;
    expect(res.isError).toBe(true);
    expect(out).toContain("`Ghost`");
    expect(out).toContain("nothing was filed");
    expect(out).not.toContain("Channel not found");
  });

  it("a channel 404 with NO template code is still a channel not-found", async () => {
    const res = await opLaunchAgent(
      client({ createLaunchDirective: vi.fn(async () => { throw apiError(404, "LAUNCH_DIRECTIVE_NOT_FOUND"); }) }),
      "general",
      { template: "Code Auditor" },
    );
    expect(res.content[0].text).toContain("general");
    expect(res.content[0].text).not.toContain("agent template");
  });

  it("`no-template` from the MACHINE says WHOSE visibility failed, and does not guess why", async () => {
    // ⚠ THE OTHER END OF THE SAME FACT, AND THE WORD IS THE DISCRIMINATOR. The
    // create-time refusals above are `isError` results naming YOUR template
    // before any row exists; this is an `ok` FACT LINE naming the OPERATOR's
    // machine's answer after the row was filed — two fences, two people, two
    // next actions, and a caller branches on `reason=`.
    const out = await text(created({ status: "refused", refusalReason: "no-template" }), {
      waitMs: 0,
    });
    expect(out).toContain("reason=no-template");
    expect(out).toContain("filed=yes");
    expect(out).not.toContain("nothing was filed");
    // It must NOT claim to know which of deleted / invisible it was: the resolve
    // endpoint is 404-never-403 so the difference is not observable.
    expect(CHANNEL_DOCTRINE).toContain("or it is not visible to the OPERATOR");
    expect(CHANNEL_DOCTRINE).toContain("or it no longer exists");
    // ⚠ AND THE DOCTRINE NAMES THE TENANCY (T35), which is NOT an oracle: the
    // resolve is keyed `(workspace_id, id)` against the CHANNEL's container, so
    // a template the caller owns elsewhere is ABSENT rather than hidden. That is
    // a standing rule of the system, answerable without reading any row — which
    // is why it may be said here, where "which row" may not.
    expect(CHANNEL_DOCTRINE).toContain("THIS CHANNEL'S container");
    expect(CHANNEL_DOCTRINE).toContain("a home channel IS its own container");
    expect(CHANNEL_DOCTRINE).toContain("CHECK THE TENANCY FIRST");
    // ⚠ AND IT NAMES NO PLACE, because it CANNOT: this refusal came back from a
    // DESKTOP over a closed vocabulary with no detail field, so the honest
    // classification `template-resolve.js` made stays a local log. The RULE
    // crossing instead of the ROW is the whole design.
    expect(out).not.toContain("not in this channel's own container");
  });

  it("an unknown channel comes back as a clean not-found", async () => {
    const res = await opLaunchAgent(client({ listChannels: vi.fn(async () => []) }), "nope");
    expect(res.content[0].text).toContain("nope");
  });

  it("the wait is CAPPED at 30s however much is asked for", async () => {
    // Driven through the clock rather than asserted on a constant: a 10-minute
    // ask must not produce a 10-minute hold.
    //
    // ⚠ THE CLOCK IS FAKE AND THE ASSERTION IS UNCHANGED. This case IS 30 of the
    // file's 32 SECONDS: the fixture never reaches a terminal status (correctly
    // — that is the case under test), so the op polled its capped hold out in
    // real time. Advancing in the hold's OWN 1.5s tick and STOPPING the moment
    // it settles makes `Date.now()` read the hold's real length rather than how
    // far this loop advanced, so a hold ignoring the cap still fails.
    vi.useFakeTimers();
    try {
      const started = Date.now();
      let elapsed = Number.NaN;
      const held = text(polls({ status: "pending" }), { waitMs: 600_000 }).then(() => {
        elapsed = Date.now() - started;
      });
      // Bounded: 600s asked for, at a 1.5s tick, is 400 turns — the cap must
      // settle it long before that.
      for (let i = 0; i < 500 && Number.isNaN(elapsed); i += 1) {
        await vi.advanceTimersByTimeAsync(1_500);
      }
      await held;
      expect(elapsed).toBeLessThan(31_000);
      // ⚠ …and it really HELD: a 0ms elapsed would mean the fake clock never
      // reached the op, and the upper bound would then pass vacuously.
      expect(elapsed).toBeGreaterThanOrEqual(1_500);
    } finally {
      vi.useRealTimers();
    }
  }, 40_000);
});
