/**
 * `op="launch_agent"` — the four terminal shapes and the sentences each one ends
 * on.
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
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient, LaunchDirective } from "@dopl/client";
import { opLaunchAgent } from "./channel-ops-launch";

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
    createLaunchDirective: vi.fn(async () => ({
      offline: false,
      directive: directive(),
    })),
    getLaunchDirective: vi.fn(async () => directive()),
    ...over,
  } as unknown as DoplClient;
}

const text = async (c: DoplClient, opts = {}) =>
  (await opLaunchAgent(c, "general", opts)).content[0].text as string;

describe("OFFLINE — nothing is filed, and the caveat is honest about presence", () => {
  const offline = client({
    createLaunchDirective: vi.fn(async () => ({ offline: true, directive: null })),
  });

  it("says NO REQUEST WAS FILED, so there is nothing pending to chase", async () => {
    const out = await text(offline);
    expect(out).toContain("No request was filed");
    expect(out).toContain("nothing to cancel");
  });

  /**
   * ⚠ THE CAVEAT IS THE POINT. `agent_presence` is per-(user, workspace): it
   * cannot say WHICH machine is up, whether the one that would run this agent is
   * up, or whether launching is even enabled there. A result that reported
   * "your machine is offline" as a fact would be asserting something the check
   * cannot establish.
   */
  it("states that presence is a HINT and names what it cannot tell", async () => {
    const out = await text(offline);
    expect(out).toContain("HINT, NOT A VERDICT");
    expect(out).toContain("per-(user, workspace)");
    expect(out).toContain("WHICH of their machines");
  });

  it("offers the fallback that does not need anyone's machine", async () => {
    expect(await text(offline)).toContain('op="post"');
  });

  it("never polls — there is no directive to poll", async () => {
    const getLaunchDirective = vi.fn();
    await text(
      client({
        createLaunchDirective: vi.fn(async () => ({ offline: true, directive: null })),
        getLaunchDirective,
      })
    );
    expect(getLaunchDirective).not.toHaveBeenCalled();
  });
});

describe("LAUNCHED — the id, and how to direct it", () => {
  const launched = client({
    createLaunchDirective: vi.fn(async () => ({
      offline: false,
      directive: directive({ status: "launched", agentId: "abcd1234" }),
    })),
  });

  it("names the agent and publishes the PREFIXED handle", async () => {
    const out = await text(launched);
    expect(out).toContain("abcd1234");
    // ⚠ THE `agent-` FORM, AND THE BARE FORM MUST NOT COME BACK. Both parse on
    // the desktop, but the app's picker inserts and tints the prefixed one
    // (`lib/agent-mentions.ts › agentMentionHandle`), and a surface publishing
    // one form while the product writes the other is the F-266 split.
    expect(out).toContain("@agent-abcd1234");
    expect(out).toContain("ITS HANDLE IS");
  });

  it("says a custom NAME is machine-local and never addressable from here", async () => {
    // A rename lives in `main/agent-names.js` on ONE machine; nothing here
    // carries it, so a caller must not infer that a name it saw in the app works.
    expect(await text(launched)).toContain("lives on their machine alone");
  });

  it("⚠ TEACHES THE WAKE **WITH ITS THREE LIMITS** — the sentence the repro bought", async () => {
    // ⚠ THIS BRANCH SAID "DIRECT IT WITH `@<id>` — write that token in the BODY
    // of a post … and that specific agent picks it up", full stop. The sentence
    // was right and the surface underneath it was not: the loop fence refused
    // every agent-authored message, so the only caller holding the id could not
    // spend it, and a live orchestrator followed this copy five times into
    // silence (ENGINEERING, 2026-08-31). Samuel's same-account carve made it
    // true; what it never had, and must never lose again, is the boundary.
    const out = await text(launched);
    expect(out).toContain("TO REDIRECT IT LATER");
    expect(out).toContain("addresses an agent rather than a person");
    expect(out).toContain("THREE LIMITS, AND THEY ARE THE FENCE RATHER THAN A KNACK");
    // (1) ADDRESSED ONLY — tiers 2 and 3 stay shut to every agent-authored post.
    expect(out).toContain("an unaddressed post of yours starts nobody");
    // (2) OWN OPERATOR ONLY — the 2026-08-28 fence, which the carve did not move.
    expect(out).toContain("only for YOUR OWN operator's agents");
    // (3) NOT OBSERVABLE — the wake happens on a desktop no server can see.
    expect(out).toContain("nothing here confirms it landed");
  });

  it("says a GOAL-LESS launch runs nothing, and a goal RUNS", async () => {
    // ⚠ Two different outcomes an orchestrator acts on differently. One
    // sentence covering both would have to be the weaker claim, and the weaker
    // one leaves a caller waiting on an agent that was never going to move.
    expect(await text(launched)).toContain("IT IS STANDING BY AND IS RUNNING NOTHING");
    expect(await text(launched, { goal: "Draft the notes" })).toContain(
      "Its FIRST INSTRUCTION is the `goal` you sent",
    );
  });

  it("points at await (channel AND workspace form) for what comes back", async () => {
    const out = await text(launched);
    expect(out).toContain('op="await"');
    expect(out).toContain("omit `channel`");
    expect(out).toContain('op="read_sessions"');
  });

  it("does NOT claim to have verified the launch", async () => {
    // ⚠ There is no third party to check a machine's word against, and the
    // sentence must not pretend there is.
    expect(await text(launched)).toContain("THE MACHINE SAID SO");
  });
});

describe("REFUSED — six reasons, six next actions", () => {
  const refusedWith = (refusalReason: LaunchDirective["refusalReason"]) =>
    client({
      createLaunchDirective: vi.fn(async () => ({
        offline: false,
        directive: directive({ status: "refused", refusalReason }),
      })),
    });

  it("CAP: says the machine is FULL, and says NOT to re-issue", async () => {
    const out = await text(refusedWith("cap"));
    expect(out).toContain("ALREADY RUNNING AS MANY AGENTS AS IT ALLOWS");
    expect(out).toContain("Nothing is broken");
    expect(out).toContain("Do not re-issue");
    // The next action is to look at what is running, not to try again.
    expect(out).toContain('op="read_sessions"');
  });

  it("NO-BRIDGE: names it as the operator's SETTING, not a failure or a workaround", async () => {
    const out = await text(refusedWith("no-bridge"));
    expect(out).toContain("LAUNCHING OVER MCP TURNED OFF");
    expect(out).toContain("deliberate setting");
    expect(out).toContain("ASK THEM");
    expect(out).toContain("do not look for another route");
  });

  it("BUSY is the only reason that invites a retry, and bounds it", async () => {
    const out = await text(refusedWith("busy"));
    expect(out).toContain("temporary");
    expect(out).toContain("once");
  });

  it("NO-SDK and AUTH-HOLD both send the agent to a human", async () => {
    expect(await text(refusedWith("no-sdk"))).toContain("Tell your operator");
    expect(await text(refusedWith("auth-hold"))).toContain("Tell your operator");
  });

  it("NO-COUNTERPARTY points at the channel, not at the machine", async () => {
    expect(await text(refusedWith("no-counterparty"))).toContain('op="members"');
  });

  it("NO-TEMPLATE names WHOSE visibility failed, and refuses to guess which failure it was", async () => {
    const out = await text(refusedWith("no-template"));
    // ⚠ THE TWO FENCES BELONG TO DIFFERENT PEOPLE, and an orchestrator that does not
    // know that re-issues the same id forever.
    expect(out).toContain("OPERATOR");
    expect(out).toContain("Do not re-issue");
    // ⚠ AND IT MUST NOT SAY WHICH of deleted / invisible it was: the resolve endpoint is
    // 404-never-403 precisely so that difference is not observable.
    expect(out).not.toContain("deleted, so");
  });

  it("every refusal says nothing is pending, and offers the do-it-yourself lane", async () => {
    for (const reason of [
      "cap",
      "busy",
      "no-sdk",
      "auth-hold",
      "no-bridge",
      "no-counterparty",
      "no-template",
    ] as const) {
      const out = await text(refusedWith(reason));
      expect(out, reason).toContain("Nothing is pending");
      expect(out, reason).toContain('op="post"');
    }
  });

  it("a refusal with NO reason is reported honestly rather than guessed at", async () => {
    const out = await text(refusedWith(null));
    expect(out).toContain("gave no reason");
    expect(out).toContain("should not happen");
  });
});

describe("TIMEOUT — pending, and the strongest possible do-not-re-issue", () => {
  const pending = client({
    getLaunchDirective: vi.fn(async () => directive({ status: "pending" })),
  });

  it("gives the directive id and the expiry", async () => {
    const out = await text(pending, { waitMs: 0 });
    expect(out).toContain("55555555-5555-5555-5555-555555555555");
    expect(out).toContain("2026-08-22T12:02:00.000Z");
    expect(out).toContain("still PENDING");
  });

  /** ⚠ THE ONE MISREADING THAT COSTS AN AGENT: a second call starts a SECOND
   *  agent on the same work, and nothing can tell them apart afterwards. */
  it("REGRESSION: says a timeout is NOT a refusal, and forbids re-issuing", async () => {
    const out = await text(pending, { waitMs: 0 });
    expect(out).toContain("A TIMEOUT IS NOT A REFUSAL");
    expect(out).toContain("DO NOT ISSUE THIS CALL AGAIN");
    expect(out).toContain("SECOND agent");
  });

  it("says where the answer will show up instead", async () => {
    expect(await text(pending, { waitMs: 0 })).toContain('op="read_sessions"');
  });

  it("a CLAIMED-but-undecided hold says a machine has taken it", async () => {
    // ⚠ Driven through a REAL poll (waitMs > 0), because `waitMs: 0` renders the
    // CREATE result and never reads the row — which is correct behaviour and
    // exactly why this case cannot use it.
    const out = await text(
      client({
        getLaunchDirective: vi.fn(async () => directive({ status: "claimed" })),
      }),
      { waitMs: 2_000 }
    );
    expect(out).toContain("TAKEN it");
    expect(out).toContain("DO NOT ISSUE THIS CALL AGAIN");
  });

  it("EXPIRED says it lapsed, and that nothing is pending now", async () => {
    const out = await text(
      client({
        createLaunchDirective: vi.fn(async () => ({
          offline: false,
          directive: directive({ status: "expired" }),
        })),
      }),
      { waitMs: 0 }
    );
    expect(out).toContain("LAPSED");
    expect(out).toContain("Nothing is pending now");
  });

  it("a FAILED poll ends on the PENDING shape, not on an error", async () => {
    // ⚠ The request is filed and the machine may still take it; reporting a
    // failure over a launch that may well be running is the worse answer.
    const out = await text(
      client({
        getLaunchDirective: vi.fn(async () => {
          throw new Error("connection reset");
        }),
      }),
      { waitMs: 5 }
    );
    expect(out).toContain("still PENDING");
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
    expect(createLaunchDirective).toHaveBeenCalledWith({
      channel: "chan-1",
      threadId: "44444444-4444-4444-4444-444444444444",
      goal: "ship the parser",
      model: "claude-opus-5",
      // ⚠ THE STRING, UNTOUCHED. Whether it is an id or a name, and whether a
      // name is ambiguous, is decided SERVER-SIDE against the caller's own
      // template visibility — which this process cannot evaluate.
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
      client({
        createLaunchDirective: vi.fn(async () => {
          throw apiError(404, "AGENT_TEMPLATE_NOT_FOUND");
        }),
      }),
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
      client({
        createLaunchDirective: vi.fn(async () => {
          throw apiError(404, "LAUNCH_DIRECTIVE_NOT_FOUND");
        }),
      }),
      "general",
      { template: "Code Auditor" },
    );
    expect(res.content[0].text).toContain("general");
    expect(res.content[0].text).not.toContain("agent template");
  });

  it("`no-template` from the MACHINE says WHOSE visibility failed, and does not guess why", async () => {
    // ⚠ THE OTHER END OF THE SAME FACT. The create-time refusals above are YOUR
    // visibility failing before any row exists; this one is the OPERATOR's,
    // after the request was filed — two fences, two people, two next actions.
    const out = (await opLaunchAgent(
      client({
        createLaunchDirective: vi.fn(async () => ({
          offline: false,
          directive: directive({ status: "refused", refusalReason: "no-template" }),
        })),
      }),
      "general",
      { waitMs: 0 },
    )).content[0].text as string;
    expect(out).toContain("OPERATOR");
    expect(out).toContain("Do not re-issue");
    // It must NOT claim to know which of deleted / invisible it was: the resolve
    // endpoint is 404-never-403 so the difference is not observable, and a
    // sentence that guessed would rebuild the oracle.
    expect(out).toContain("Either it no longer exists, or it is not visible");
  });

  it("an unknown channel comes back as a clean not-found", async () => {
    const res = await opLaunchAgent(
      client({ listChannels: vi.fn(async () => []) }),
      "nope"
    );
    expect(res.content[0].text).toContain("nope");
  });

  it("the wait is CAPPED at 30s however much is asked for", async () => {
    // Driven through the clock rather than asserted on a constant: a 10-minute
    // ask must not produce a 10-minute hold.
    const started = Date.now();
    await text(
      client({ getLaunchDirective: vi.fn(async () => directive({ status: "pending" })) }),
      { waitMs: 600_000 }
    );
    expect(Date.now() - started).toBeLessThan(31_000);
  }, 40_000);
});
