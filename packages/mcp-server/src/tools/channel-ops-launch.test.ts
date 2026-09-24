// What each terminal shape of `manage action="launch"` teaches: every case pins the fact on the terse
// result line AND the sentence that moved to `channelDoctrine()`, so prose can neither vanish nor grow back.

import { describe, it, expect, vi } from "vitest";
import type { LaunchDirective, LaunchRefusalReason } from "@dopl/client";
import { channelDoctrine } from "./channel-doctrine";
import { WRITE_RESULT_MAX_CHARS } from "./channel-facts";
import {
  created,
  directive,
  launchClient as client,
  launchText as text,
  polls,
} from "./launch-fixtures";

describe("OFFLINE — nothing is filed, and the caveat is honest about presence", () => {
  const offline = client({
    createLaunchDirective: vi.fn(async () => ({ offline: true, directive: null })),
  });

  it("says NOTHING WAS FILED, so there is nothing pending to chase", async () => {
    // `filed=no` is what separates this from PENDING, where re-issuing starts a second agent.
    expect(await text(offline)).toBe("not launched reason=offline filed=no retry=no");
  });

  // `agent_presence` is per-(user, workspace), so it cannot say which machine is up; the offline
  // branch has no doctrine sentence, so only the result half is pinned.
  it("asserts no verdict about anybody's machine", async () => {
    const out = await text(offline);
    expect(out).not.toMatch(/your (machine|desktop) is/i);
    expect(out).not.toContain("HINT, NOT A VERDICT");
    expect(out.split("\n")).toHaveLength(1);
  });

  it("keeps the fallback that needs nobody's machine reachable in the doctrine", async () => {
    expect(await text(offline)).not.toContain('op="send"');
    expect(channelDoctrine()).toContain('op="send"');
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
    // The app's picker inserts and tints the `agent-` form; publishing the bare one is the F-266 split.
    expect(out).toContain("agent=@agent-abcd1234");
    expect(out).not.toContain("ITS HANDLE IS");
    // The id stays the agent's permanent handle; the NAME is what a caller addresses.
    expect(channelDoctrine()).toContain("NEVER WRITE AN AGENT ID IN A MESSAGE");
    expect(channelDoctrine()).toContain("NAMES ARE UNIQUE among addressable agents");
    expect(channelDoctrine()).not.toContain("is then the address");
  });

  // The machine may store `Coder` as `Coder-1`; echoing the request would address the wrong agent.
  it("publishes the name the MACHINE stored, as a tag, not the one that was asked for", async () => {
    const out = await text(
      created({ status: "launched", agentId: "abcd1234", appliedAgentName: "Coder-1" }),
      { name: "Coder" }
    );
    // Slugged, because it is a tag the caller will type.
    expect(out).toContain("name=@coder-1");
    expect(out).not.toContain("name=@coder ");
  });

  // An absent field and a `null` one get one answer, and neither echoes the request (F-736).
  it("says (not reported) when the field is ABSENT", async () => {
    const out = await text(created({ status: "launched", agentId: "abcd1234" }), {
      name: "Bug Reviewer",
    });
    expect(out).toContain('name="(not reported)"');
    expect(out).not.toContain("@bug-reviewer");
  });

  it("says (not reported) when the machine CARRIES the field and it is null", async () => {
    const out = await text(
      created({ status: "launched", agentId: "abcd1234", appliedAgentName: null }),
      { name: "Coder" }
    );
    expect(out).toContain('name="(not reported)"');
    expect(out).not.toContain("@coder");
  });

  it("says a custom NAME is what people see AND what agents tag it by", async () => {
    // `channel_sessions.display_name` is peer-visible, so "reaches no server" must stay out.
    const out = await text(launched);
    expect(out).not.toContain("lives on their machine alone");
    expect(channelDoctrine()).toContain("what people see and what agents tag it by");
    expect(channelDoctrine()).not.toContain("it reaches no server");
  });

  it("KEEPS THE WAKE **WITH ITS THREE LIMITS** — the sentence the repro bought", async () => {
    expect(await text(launched)).not.toContain("THREE LIMITS");
    expect(channelDoctrine()).toContain("THE LOOP BRAKE, AND IT IS ABSOLUTE");
    expect(channelDoctrine()).toContain("that tag, in `to`, wakes THAT agent");
    // (1) addressed only
    expect(channelDoctrine()).toContain(
      "an AGENT-authored UNADDRESSED message starts nobody",
    );
    // (2) own operator only
    expect(channelDoctrine()).toContain("YOUR OWN AGENTS ARE THE ONE EXCEPTION, AND ONLY IN `to`, BY NAME");
    expect(channelDoctrine()).toContain(
      "Never another member's agent, and never without naming one",
    );
    // (3) the send lane's `delivery=` reports the wake
    expect(channelDoctrine()).toContain("`woken` a dormant one was started");
  });

  it("says a BODY-LESS launch runs nothing, and a body RUNS", async () => {
    // `idle=` separates "on it" from "parked"; one field for both leaves a caller waiting forever.
    expect(await text(created({ status: "launched", agentId: "abcd1234", goal: null }))).toContain(
      "idle=yes",
    );
    expect(await text(launched, { goal: "Draft the notes" })).toContain("idle=no");
    expect(channelDoctrine()).toContain(
      '`name` it (never an id; nameless is refused) and its `body` is its FIRST INSTRUCTION',
    );
  });

  it("reads `idle=` off the DIRECTIVE, so a converged retry with no body reports the first goal", async () => {
    const converged = client({
      createLaunchDirective: vi.fn(async () => ({
        offline: false,
        existing: true,
        directive: directive({ status: "launched", agentId: "abcd1234", goal: "ship the parser" }),
      })),
    });
    const out = await text(converged);
    expect(out).toContain("idle=no");
    expect(out).toContain("retry=existing");
  });

  it("carries the identity fields, quoted where a value could forge a field", async () => {
    // An identity name is operator-authored: unquoted, `x idle=no` would append a fact nobody asserted.
    const out = await text(
      created({
        status: "launched",
        agentId: "abcd1234",
        threadId: "44444444-4444-4444-4444-444444444444",
        identityName: "Code Auditor",
        model: "claude-opus-5",
      }),
      { goal: "Audit the migration" },
    );
    expect(out).toContain('identity="Code Auditor"');
    expect(out).toContain("model=claude-opus-5");
    expect(out).toContain("thread=44444444-4444-4444-4444-444444444444");
    expect(out.length, out).toBeLessThanOrEqual(WRITE_RESULT_MAX_CHARS);
  });

  it('points at the hold (channel AND workspace form) and op="status", in the doctrine', async () => {
    expect(await text(launched)).not.toContain('op="await"');
    expect(channelDoctrine()).toContain('op="status"');
    expect(channelDoctrine()).toContain("OMITTING `channel` IS A WIDER READ");
  });

  it("does NOT claim to have verified the launch", async () => {
    // Nothing checks a machine's word, so the line reports what it answered and confirms nothing.
    const out = await text(launched);
    expect(out.startsWith("launched ")).toBe(true);
    expect(out).not.toMatch(/confirm|verified|running now/i);
    expect(channelDoctrine()).toContain(
      "Every action files a request on your own operator's machine and holds for its answer",
    );
  });
});

// A `Record` over the refusal enum, like `channel-directive-hold.ts › LAUNCH_RETRY_ADVICE`, so a new
// word cannot land without a row; `says` is the doctrine's clause for that word, pinned whole.
const REFUSALS: Record<LaunchRefusalReason, { retry: "once" | "no"; says: string[] }> = {
  cap: { retry: "no", says: ["`cap` full", 'read op="status"', "A REFUSAL IS A NORMAL ANSWER"] },
  busy: { retry: "once", says: ["`busy` mid-turn"] },
  "no-sdk": { retry: "no", says: ["`no-sdk` no runtime"] },
  "auth-hold": { retry: "no", says: ["`auth-hold` the operator must sign in"] },
  // The operator's own consent setting; "do not look for another route" is pinned absent in
  // `channel-ops-agent-doctrine.test.ts › RETIRED_BY_RULING`.
  "no-bridge": {
    retry: "no",
    says: [
      "`no-bridge` the operator's LAUNCH toggle is off",
      'it gates "launch" and "posture", never "end" or "rename"',
    ],
  },
  "no-counterparty": { retry: "no", says: ["`no-counterparty` nothing to receive it"] },
  // The resolve is 404-never-403, so which of deleted / invisible / other container stays unobservable.
  "no-identity": { retry: "no", says: ["`no-identity` THAT machine could not resolve it under the operator's visibility"] },
  // No producer on a launch (it belongs to `end`/`rename`), so re-issuing would loop forever.
  "no-session": { retry: "no", says: ["`no-session` no such agent"] },
  "bad-name": {
    retry: "no",
    says: ["`bad-name` the label was not one line of 1-60 visible characters"],
  },
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
      // The row exists and was answered: nothing to chase, nothing to cancel.
      expect(out, reason).toContain("filed=yes");
      expect(out.split("\n"), reason).toHaveLength(1);
      for (const phrase of says) expect(channelDoctrine(), `${reason}: ${phrase}`).toContain(phrase);
    },
  );

  it("BUSY is the ONLY word that invites a retry", () => {
    expect(Object.entries(REFUSALS).filter(([, r]) => r.retry === "once").map(([w]) => w)).toEqual(["busy"]);
  });

  it("the CONSENT refusal never reads as a fault on the line either", async () => {
    const out = await text(refusedWith("no-bridge"));
    expect(out).not.toMatch(/error|failure|failed|broken/i);
  });

  it("a refusal with NO reason is reported honestly rather than guessed at", async () => {
    // The column's CHECK forbids this row; if one arrives, a guessed `retry=no` would strand the caller.
    expect(await text(refusedWith(null))).toBe("refused reason=- retry=- filed=yes");
  });
});

describe("TIMEOUT — pending, and the strongest possible do-not-re-issue", () => {
  const pending = polls({ status: "pending" });

  it("gives the directive id and the expiry", async () => {
    const out = await text(pending, { waitMs: 0 });
    expect(out).toContain("directive=55555555-5555-5555-5555-555555555555");
    expect(out).toContain("expires=2026-08-22T12:02:00.000Z");
    expect(out.startsWith("pending ")).toBe(true);
  });

  // A second call starts a second agent on the same work, and nothing tells them apart afterwards.
  it("REGRESSION: says a timeout is NOT a refusal, and forbids re-issuing", async () => {
    const out = await text(pending, { waitMs: 0 });
    expect(out).toContain("retry=no");
    expect(out.startsWith("pending ")).toBe(true);
    expect(out).not.toContain("refused");
    expect(out).not.toContain("DO NOT ISSUE THIS CALL AGAIN");
    expect(channelDoctrine()).toContain(
      "re-issuing without the SAME `client_msg_id` starts a SECOND agent",
    );
  });

  it("says where the answer will show up instead", async () => {
    expect(await text(pending, { waitMs: 0 })).not.toContain('op="status"');
    expect(channelDoctrine()).toContain(
      'op="status" reads your own machine\'s live sessions and the directions waiting for them',
    );
  });

  it("a CLAIMED-but-undecided hold says a machine has taken it", async () => {
    // A real poll: `waitMs: 0` renders the create result and never reads the row. 100ms is one poll.
    const out = await text(polls({ status: "claimed" }), { waitMs: 100 });
    expect(out).toContain("claimed=yes");
    expect(out).toContain("retry=no");
  });

  // The one arm a caller may legitimately re-issue, so it states `retry=once` rather than nothing.
  it("EXPIRED says it lapsed, and says asking again is legitimate", async () => {
    const out = await text(created({ status: "expired" }), { waitMs: 0 });
    expect(out).toBe(
      "expired directive=55555555-5555-5555-5555-555555555555 filed=yes retry=once",
    );
  });

  it("a FAILED poll ends on the PENDING shape, not on an error", async () => {
    // The request is filed and may still run; reporting a failure over it is the worse answer.
    const out = await text(
      client({ getLaunchDirective: vi.fn(async () => { throw new Error("connection reset"); }) }),
      { waitMs: 5 }
    );
    expect(out.startsWith("pending ")).toBe(true);
    expect(out).toContain("retry=no");
    expect(out).not.toContain("connection reset");
  });
});
