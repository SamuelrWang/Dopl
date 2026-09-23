/**
 * `op="manage" action="launch"` — THE REQUEST THAT CROSSES THE WIRE, as distinct from the
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
// ⚠ **THE TENANCY RULE IS A NAMED EXPORT, NOT A LINE IN THE DOCUMENT, SINCE THE
// FIVE-OP COLLAPSE.** It ships in `channel-ops-launch.ts`'s create-time
// refusals rather than in the pulled doctrine, so the pin moved to the constant
// itself — which is the one place a reword has to pass through either way.
import { CHANNEL_DOCTRINE, TENANCY_RULE } from "./channel-doctrine";
// ⚠ AND THE TWO-FENCES SENTENCE IS `identity`'S OWN `.describe()` NOW: a client
// reads it at the moment it decides what to pass, which is closer to the
// decision than the op paragraph was.
import { CHANNEL_INPUT_SHAPE } from "./channel-schema";

const CHANNEL = { id: "chan-1", slug: "general", name: "General", visibility: "private" };

function directive(over: Partial<LaunchDirective> = {}): LaunchDirective {
  return {
    id: "55555555-5555-5555-5555-555555555555",
    channelId: "chan-1",
    threadId: null,
    goal: "ship the parser",
    model: null,
    status: "pending",
    identityId: null,
    identityName: null,
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
  (await opLaunchAgent(c, "general", { name: "Scout", ...opts })).content[0].text as string;

/** A client whose CREATE already answers with this directive (no poll needed). */
const created = (over: Partial<LaunchDirective>) =>
  client({ createLaunchDirective: vi.fn(async () => ({ offline: false, directive: directive(over) })) });
/** A client whose create stays pending and whose POLL answers with this row. */
const polls = (over: Partial<LaunchDirective>) =>
  client({ getLaunchDirective: vi.fn(async () => directive(over)) });

describe("the call itself", () => {
  it("passes channel id, thread, goal, model and identity through", async () => {
    const createLaunchDirective = vi.fn(async () => ({
      offline: false,
      directive: directive({ status: "launched", agentId: "abcd1234" }),
    }));
    await opLaunchAgent(client({ createLaunchDirective }), "general", {
      name: "Scout",
      thread: "44444444-4444-4444-4444-444444444444",
      goal: "ship the parser",
      model: "claude-opus-5",
      identity: "Code Auditor",
    });
    // ⚠ THE IDENTITY STRING GOES OUT UNTOUCHED. Whether it is an id or a name,
    // and whether a name is ambiguous, is decided SERVER-SIDE against the
    // caller's own visibility — which this process cannot evaluate.
    expect(createLaunchDirective).toHaveBeenCalledWith({
      channel: "chan-1",
      threadId: "44444444-4444-4444-4444-444444444444",
      goal: "ship the parser",
      model: "claude-opus-5",
      identity: "Code Auditor",
      // ⚠ **THE NAME IS ON THE BODY SINCE 2026-09-15**, and TRIMMED rather than passed raw: the
      // refusal above it measured the trimmed value, so filing the raw one would send a string
      // the check never looked at.
      agentName: "Scout",
    });
  });

  it("names NO operator — there is no argument that could", async () => {
    const createLaunchDirective = vi.fn(async () => ({
      offline: false,
      directive: directive({ status: "launched", agentId: "abcd1234" }),
    }));
    await opLaunchAgent(client({ createLaunchDirective }), "general", { name: "Scout" });
    const body = createLaunchDirective.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(body)).toEqual([
      "channel",
      "threadId",
      "goal",
      "model",
      // ⚠ **`runtime` (2026-09-21, U9), AND IT IS A SECOND KEY BECAUSE IT IS A SECOND FACT.**
      // It sits beside `model` and is never derived from it: a live launch carrying
      // `model: "codex"` was accepted and started a Claude Sonnet agent. ⚠ IT NAMES NO OPERATOR
      // EITHER — it says which ENGINE on the caller's own machine, and that machine REFUSES a
      // runtime it cannot start rather than substituting one.
      "runtime",
      "identity",
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
      // ⚠ **THE COLOUR (2026-09-13), AND IT IS ON THIS LIST FOR THE REASON THE LIST
      // EXISTS**: a CONSCIOUS edit here, reviewed, rather than a field that appeared
      // in the body unnoticed. ⚠ WHAT THE ASSERTION GUARDS IS UNCHANGED — a colour
      // names no operator and confers nothing. It is an IDENTITY in one channel's
      // transcript, the server resolves it against EVERY member's live agents (which
      // is precisely why this process only asks), and a taken one comes back as a
      // 409 rather than as somebody else's agent recoloured.
      "color",
      // ⚠ **THE AGENT'S NAME (2026-09-15), A SIXTH CONSCIOUS EDIT, AND IT PASSES THE GUARD FOR
      // THE SAME REASON EVERY OTHER KEY DOES**: it says what the new agent is CALLED, never
      // whose machine runs it. Samuel: *"if agents are spinning up agents, they should be the
      // ones that are naming the agent."* ⚠ It is the only REQUIRED one of the six — omitting it
      // is refused before the create is reached — which is why this list can assert it
      // unconditionally where `color` and `clientMsgId` would be `undefined`.
      "agentName",
    ]);
  });

  /**
   * THE IDENTITY REFUSALS AT CREATE TIME (2026-08-23).
   *
   * ⚠ **THE DISCRIMINATOR IS THE ERROR CODE, NEVER THE STATUS**, and that is the
   * whole reason these cases exist. One call now has TWO ways to 404 (no such
   * channel / membership, no such identity) and one to 409. A status-only branch
   * tells an agent its CHANNEL was wrong when its IDENTITY NAME was — the exact
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
          throw apiError(409, "AGENT_IDENTITY_AMBIGUOUS", {
            matches: [
              { id: "t-1", name: "Researcher", visibility: "private" },
              { id: "t-2", name: "Researcher", visibility: "workspace" },
            ],
          });
        }),
      }),
      "general",
      { name: "Scout", identity: "Researcher" },
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

  it("an UNRESOLVABLE identity says so, and never says whether it EXISTS", async () => {
    // ⚠ 404-never-403 all the way down: "no such identity" and "not shared with
    // you" are ONE answer, or the refusal becomes an id-probe.
    const res = await opLaunchAgent(
      client({ createLaunchDirective: vi.fn(async () => { throw apiError(404, "AGENT_IDENTITY_NOT_FOUND"); }) }),
      "general",
      { name: "Scout", identity: "Ghost" },
    );
    const out = res.content[0].text as string;
    expect(res.isError).toBe(true);
    expect(out).toContain("`Ghost`");
    expect(out).toContain("nothing was filed");
    expect(out).not.toContain("Channel not found");
  });

  it("a channel 404 with NO identity code is still a channel not-found", async () => {
    const res = await opLaunchAgent(
      client({ createLaunchDirective: vi.fn(async () => { throw apiError(404, "LAUNCH_DIRECTIVE_NOT_FOUND"); }) }),
      "general",
      { name: "Scout", identity: "Code Auditor" },
    );
    expect(res.content[0].text).toContain("general");
    expect(res.content[0].text).not.toContain("agent identity");
  });

  it("`no-identity` from the MACHINE says WHOSE visibility failed, and does not guess why", async () => {
    // ⚠ THE OTHER END OF THE SAME FACT, AND THE WORD IS THE DISCRIMINATOR. The
    // create-time refusals above are `isError` results naming YOUR identity
    // before any row exists; this is an `ok` FACT LINE naming the OPERATOR's
    // machine's answer after the row was filed — two fences, two people, two
    // next actions, and a caller branches on `reason=`.
    const out = await text(created({ status: "refused", refusalReason: "no-identity" }), {
      waitMs: 0,
    });
    expect(out).toContain("reason=no-identity");
    expect(out).toContain("filed=yes");
    expect(out).not.toContain("nothing was filed");
    // It must NOT claim to know which of deleted / invisible it was: the resolve
    // endpoint is 404-never-403 so the difference is not observable.
    // ⚠ RE-POINTED ONTO THE ONE CLAUSE THAT REPLACED BOTH, AND IT IS STILL THE
    // UN-DISCRIMINATING ONE: "could not resolve it under the operator's
    // visibility" names WHOSE fence failed and refuses to say which of
    // deleted/invisible it was, which is the whole property under test.
    expect(CHANNEL_DOCTRINE).toContain(
      "`no-identity` THAT machine could not resolve it under the operator's visibility",
    );
    // ⚠ AND THE DOCTRINE NAMES THE TENANCY (T35), which is NOT an oracle: the
    // resolve is keyed `(workspace_id, id)` against the CHANNEL's container, so
    // an identity the caller owns elsewhere is ABSENT rather than hidden. That is
    // a standing rule of the system, answerable without reading any row — which
    // is why it may be said here, where "which row" may not.
    expect(CHANNEL_INPUT_SHAPE.identity.description).toContain(
      "THIS CHANNEL'S container",
    );
    expect(TENANCY_RULE).toContain("a home channel IS its own container");
    // 🔒 **THE RULE IS ABOUT THE NAME PATH, AND SAYING SO IS THE FIX OF
    // 2026-09-18.** It read "An identity resolves ONLY in the container the
    // channel lives in", which stopped being true for a UUID at B2 (2026-09-02):
    // `src/features/agent-identities/server/service-resolve-ref.ts` follows an id
    // through `read-resource.ts › readResourceById` to whichever container of
    // the caller's it lives in. ⚠ **BOTH HALVES ARE PINNED** — dropping the ID
    // clause would restore a refusal that tells an agent its Home identity
    // cannot launch here at the moment an id would have worked.
    expect(TENANCY_RULE).toContain(
      "A NAME resolves only in the container the channel lives in",
    );
    expect(TENANCY_RULE).toContain("an id resolves wherever the row lives");
    // ⚠ AND IT NAMES NO PLACE, because it CANNOT: this refusal came back from a
    // DESKTOP over a closed vocabulary with no detail field, so the honest
    // classification `identity-resolve.js` made stays a local log. The RULE
    // crossing instead of the ROW is the whole design.
    expect(out).not.toContain("not in this channel's own container");
  });

  it("an unknown channel comes back as a clean not-found", async () => {
    const res = await opLaunchAgent(client({ listChannels: vi.fn(async () => []) }), "nope", {
      name: "Scout",
    });
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

/**
 * **THE GOAL CAP — S50, 2026-09-18.**
 *
 * ⚠ **IT BELONGS IN THIS FILE AND NOT THE SIBLING'S**, on the seam this suite's header
 * draws: these cases are about WHAT THE CREATE BODY CONTAINS — and, in the refusing case,
 * about the create body never being built at all. The sibling asserts what a RESULT teaches.
 *
 * ⚠ **THE ASSERTION THAT MATTERS IS `not.toHaveBeenCalled()`.** A refusal rendered AFTER the
 * request went out would be the defect wearing better prose: the 2,000 is the route's, so a
 * post-hoc refusal still costs the round trip and still leaves the caller guessing whether
 * anything was filed. The whole point of a pre-flight is that nothing crossed the wire.
 */
describe("the launch goal has its own cap, and it is refused before the wire", () => {
  it("refuses a 2,001-character body BY NAME, and files nothing", async () => {
    const createLaunchDirective = vi.fn(async () => ({
      offline: false,
      directive: directive({ status: "launched", agentId: "abcd1234" }),
    }));
    const res = await opLaunchAgent(client({ createLaunchDirective }), "general", {
      name: "Scout",
      goal: "x".repeat(2_001),
    });
    // 🔒 NOTHING WENT OUT. This is the case, not a detail of it.
    expect(createLaunchDirective).not.toHaveBeenCalled();
    expect(res.isError).toBe(true);
    const out = res.content[0].text as string;
    // ⚠ THE FIELD IS `body`, THE NAME THE CALLER PASSED — never `goal`, which is what the
    // wire calls it. Telling an agent to shorten an argument it never sent is the
    // mis-narration this whole change exists to end.
    expect(out).toContain("field=body");
    expect(out).toContain("limit=2000");
    expect(out).toContain("reason=goal_too_long");
    expect(out).toContain("retry=no");
    // ⚠ AND IT SAYS NOTHING WAS FILED, plus where a long brief actually goes — a refusal
    // with no next action gets an agent to retry the same call.
    expect(out).toContain("Nothing was filed");
    expect(out).toContain("knowledge entry");
  });

  it("a 2,000-character body still goes through, untouched", async () => {
    const goal = "x".repeat(2_000);
    const createLaunchDirective = vi.fn(async () => ({
      offline: false,
      directive: directive({ status: "launched", agentId: "abcd1234" }),
    }));
    await opLaunchAgent(client({ createLaunchDirective }), "general", {
      name: "Scout",
      goal,
    });
    // ⚠ THE BOUNDARY IS INCLUSIVE ON BOTH SIDES, because the route's is
    // (`.max(2000)`). A pre-flight one character tighter than the fence it mirrors refuses
    // legal calls, which is worse than the bare 400 it replaced.
    expect(createLaunchDirective).toHaveBeenCalledWith(
      expect.objectContaining({ goal }),
    );
  });

  it("measures the TRIMMED length, because the route trims before it measures", async () => {
    // ⚠ 2,000 characters inside 40 of whitespace is a LEGAL goal — `.trim().max(2000)`.
    // Measuring the raw string would refuse a call the server would have taken.
    const goal = `${" ".repeat(20)}${"x".repeat(2_000)}${" ".repeat(20)}`;
    const createLaunchDirective = vi.fn(async () => ({
      offline: false,
      directive: directive({ status: "launched", agentId: "abcd1234" }),
    }));
    await opLaunchAgent(client({ createLaunchDirective }), "general", {
      name: "Scout",
      goal,
    });
    // ⚠ AND THE CALLER'S OWN STRING IS WHAT IS FILED. The trim is a MEASUREMENT here; the
    // route does its own, and substituting a normalized string would be this lane quietly
    // editing the instruction an agent was handed.
    expect(createLaunchDirective).toHaveBeenCalledWith(
      expect.objectContaining({ goal }),
    );
  });

  it("an ABSENT goal is not a refusal — a stand-by agent is a supported launch", async () => {
    const createLaunchDirective = vi.fn(async () => ({
      offline: false,
      directive: directive({ status: "launched", agentId: "abcd1234" }),
    }));
    await opLaunchAgent(client({ createLaunchDirective }), "general", { name: "Scout" });
    expect(createLaunchDirective).toHaveBeenCalled();
  });

  it("refuses a 61-character name the same way, and that cap was unpublished too", async () => {
    const createLaunchDirective = vi.fn(async () => ({
      offline: false,
      directive: directive({ status: "launched", agentId: "abcd1234" }),
    }));
    const res = await opLaunchAgent(client({ createLaunchDirective }), "general", {
      name: "N".repeat(61),
    });
    expect(createLaunchDirective).not.toHaveBeenCalled();
    expect(res.isError).toBe(true);
    const out = res.content[0].text as string;
    expect(out).toContain("field=name");
    expect(out).toContain("limit=60");
    expect(out).toContain("reason=name_too_long");
    expect(out).toContain("Nothing was filed");
  });

  it("publishes the launch cap on `body`, so the published bound matches the enforced one", () => {
    // ⚠ **THE DEFECT WAS THE GAP, NOT THE NUMBER.** `.max(16000)` is CORRECT — it is
    // `op="send"`'s — so this asserts the LAUNCH cap is stated as well, not that the
    // schema's was lowered. Both halves are pinned, in both directions.
    const described = CHANNEL_INPUT_SHAPE.body.description ?? "";
    expect(described).toContain("2000");
    expect(JSON.stringify(CHANNEL_INPUT_SHAPE.body.def)).toContain("16000");
  });
});
