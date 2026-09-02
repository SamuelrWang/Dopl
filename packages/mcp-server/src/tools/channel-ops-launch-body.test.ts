/**
 * `op="launch_agent"` — THE REQUEST THAT CROSSES THE WIRE, as distinct from the
 * RESULT that comes back.
 *
 * ⚠ SPLIT OUT OF `channel-ops-launch.test.ts` ON 2026-09-01, when the T24
 * posture trio (`tools`, `messages`, `chain`) landed from the
 * orchestrator-surface tier and pushed that file to 534 over the §1 cap of 500.
 * The seam is the one this suite already drew in prose: that file asserts what a
 * RESULT TEACHES a model choosing its next action; this one asserts what the
 * CREATE BODY CONTAINS. They fail for different reasons and are read by different
 * people.
 *
 * 🔒 **THE WHOLE-BODY ASSERTION IS THE POINT AND MUST STAY WHOLE.** It
 * enumerates every key, so a field nobody reviewed cannot appear in a launch
 * request — which is the fence that matters here, because none of these keys may
 * ever name an OPERATOR. They say how much freedom to ask for on the caller's
 * OWN machine, and that machine clamps them to its owner's ceiling. Loosening
 * this to a subset check is how that stops being observable.
 *
 * ⚠ THE FIXTURES BELOW ARE COPIED FROM THE SIBLING SUITE, not shared. They are a
 * client stub and a directive factory — small, pure, and loudly broken by any
 * change to `LaunchDirective`. A shared module would be a `tools/` export
 * existing only for tests.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient, LaunchDirective } from "@dopl/client";
import { opLaunchAgent } from "./channel-ops-launch";
import { CHANNEL_DOCTRINE } from "./channel-doctrine";

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
      // THE IDEMPOTENCY KEY (2026-09-02, A10/G10) — a fourth CONSCIOUS edit, and
      // the guard is still intact: it names WHICH GESTURE this is, never whose
      // machine runs it. The uniqueness it buys is scoped BY the operator id the
      // server stamps, so the field cannot widen who a launch reaches; what it
      // removes is the SECOND agent a re-issue after a timeout used to queue.
      "clientMsgId",
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
