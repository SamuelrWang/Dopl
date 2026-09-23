// `manage action="end"` / `"rename"`: what each terminal result teaches. Each case pins the field on
// this call's line and the rule in `CHANNEL_DOCTRINE`; the doctrine-only half is
// `channel-ops-agent-doctrine.test.ts`.

import { describe, it, expect, vi } from "vitest";
import { opEndAgent, opRenameAgent } from "./channel-ops-agent";
import { CHANNEL_DOCTRINE } from "./channel-doctrine";
import { CHANNEL_INPUT_SHAPE } from "./channel-schema";
import {
  AGENT,
  agentClient as client,
  endText,
  renameText,
  settled,
} from "./launch-fixtures";

/** The argument `.describe()` text, which is prose a client reads too. */
const ARG_PROSE = Object.values(CHANNEL_INPUT_SHAPE)
  .map((arg) => arg.description ?? "")
  .join("\n");

describe('manage action="end" — the success line', () => {
  const done = settled({ status: "done" });

  it("says what an end DOES NOT touch, because 'end' over-reads as 'remove'", async () => {
    // What an end leaves untouched is doctrine (`channel-ops-agent-doctrine.test.ts`); the line says
    // only that this call reached a machine and it acted.
    const out = await endText(done);
    expect(out).toContain("ended agent=@agent-");
    expect(out).toContain("filed=yes");
    expect(out).not.toContain("not ended");
  });

  // Instance ids are never reused, so after an end the handle addresses nothing.
  it("says the handle is SPENT — the one paragraph that had to survive as a FACT", async () => {
    const out = await endText(done);
    expect(out).toContain("handle=spent");
    expect(CHANNEL_DOCTRINE).toContain('op="manage" action="launch"');
  });

  it("does not claim more than a machine can prove", async () => {
    // The result reports what came back and never an outcome it did not observe.
    expect(CHANNEL_DOCTRINE).toContain(
      "Every action files a request on your own operator's machine and holds for its answer",
    );
    expect(await endText(done)).toContain("filed=yes");
  });
});

describe('manage action="end" — no-session is NOT a fault', () => {
  const gone = settled({ status: "refused", refusalReason: "no-session" });

  // The commonest outcome of an end (the agent already finished); read as a failure it sends an
  // orchestrator to re-launch the work it meant to stop.
  it("names the word, and the doctrine calls it the outcome you wanted", async () => {
    const out = await endText(gone);
    // The wire word stays on the result: the doctrine is keyed on it.
    expect(out).toContain("reason=no-session");
    // The "usually good news" gloss is pinned absent in `channel-ops-agent-doctrine.test.ts › RETIRED_BY_RULING`.
    expect(CHANNEL_DOCTRINE).toContain("`no-session` no such agent");
  });

  it('sends the caller to op="status" rather than to a retry', async () => {
    // `retry=no` is the whole of "do not ask again"; the surface that answers instead is in the doctrine.
    expect(await endText(gone)).toContain("retry=no");
    expect(CHANNEL_DOCTRINE).toContain(
      'op="status" reads your own machine\'s live sessions and the directions waiting for them',
    );
  });

  it("and never reads as an error", async () => {
    const out = await endText(gone);
    expect(out).not.toMatch(/\berror\b|\bfailed\b|\bfailure\b/i);
  });
});

describe("the refusal advice must NOT be the launch op's", () => {
  // The launch toggle does not gate end/rename (`main/launch-directives.js › handle` tests the kind),
  // so this lane must never send a caller to ask for it.
  it("no-bridge on an end never sends the caller to a permission toggle", async () => {
    const out = await endText(settled({ status: "refused", refusalReason: "no-bridge" }));
    expect(out).toContain("reason=no-bridge");
    expect(out).toContain("retry=no");
    expect(out).not.toContain("TURNED OFF on that machine");
    expect(out).not.toMatch(/turn(ed)? (it )?on/i);
    // One clause carries both halves, so a reword of either side cannot delete the asymmetry.
    expect(CHANNEL_DOCTRINE).toContain("`no-bridge` the operator's LAUNCH toggle is off");
    expect(CHANNEL_DOCTRINE).toContain('it gates "launch" and "posture", never "end" or "rename"');
  });

  // `cap` on a launch means "wait for a slot"; on an end that contradicts the request, and `retry=no`
  // is what keeps the lanes apart.
  it("cap on an end does not tell the caller to wait for a slot", async () => {
    const out = await endText(settled({ status: "refused", refusalReason: "cap" }));
    expect(out).toContain("reason=cap");
    expect(out).toContain("retry=no");
    expect(out).not.toContain("wait for one to finish");
    expect(out).not.toMatch(/wait for/i);
  });

  it("busy is the ONE word that earns a second ask, and it says so as a field", async () => {
    // The table's only `once`: a verdict drifting to `once` everywhere turns every refusal into a loop.
    const busy = await endText(settled({ status: "refused", refusalReason: "busy" }));
    expect(busy).toContain("reason=busy");
    expect(busy).toContain("retry=once");
    expect(CHANNEL_DOCTRINE).toContain("`busy` mid-turn");
    for (const reason of ["cap", "no-sdk", "auth-hold", "no-identity"] as const) {
      const out = await endText(settled({ status: "refused", refusalReason: reason }));
      expect(out, `${reason} earned a retry it should not have`).toContain("retry=no");
    }
  });

  it("a refusal with NO word named guesses no verdict", async () => {
    // `-` is "the machine named nothing"; a guessed verdict is a claim about a machine we did not hear from.
    const out = await endText(settled({ status: "refused" }));
    expect(out).toContain("reason=- retry=-");
    expect(out).toContain("filed=yes");
  });
});

describe('manage action="rename" — display only, on one machine', () => {
  const done = settled({ kind: "rename", status: "done", targetName: "Research" });

  it("says the handle is unchanged, which is the ONLY address", async () => {
    // A rename never changes the agent's id handle.
    const out = await renameText(done);
    expect(out).toContain(`renamed agent=@agent-${AGENT}`);
    expect(out).toContain("handle=unchanged");
    expect(out).toContain("name=Research");
    expect(CHANNEL_DOCTRINE).toContain("what people see and what agents tag it by");
  });

  it('warns that op="status" will NOT show the name, and that this is correct', async () => {
    // Nothing here can confirm a rename landed, so the caller is not sent to poll a listing.
    const out = await renameText(done);
    expect(out).toContain("confirm=none");
    expect(CHANNEL_DOCTRINE).toContain("what people see and what agents tag it by");
  });

  it("a name with a SPACE is quoted, so it cannot invent a field", async () => {
    // Operator-authored text on a `key=value` line: unquoted, a name could forge a field.
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
    // `name=-` would mean "not reported"; `cleared` means the display fell back to its default.
    expect(out).toContain("name=cleared");
    expect(ARG_PROSE).toContain('"" clears');
  });

  it("bad-name says exactly what would be accepted, so one retry can fix it", async () => {
    const out = await renameText(
      settled({ kind: "rename", status: "refused", refusalReason: "bad-name" }),
    );
    expect(out).toContain("reason=bad-name");
    // A refused rename is cosmetic: the agent still runs, so a caller must not end and re-launch it.
    expect(out).toContain("agentChanged=no");
    // The doctrine explains the word; `name`'s own `.describe()` states the bound where a client decides.
    expect(CHANNEL_DOCTRINE).toContain(
      "`bad-name` the label was not one line of 1-60 visible characters",
    );
    expect(ARG_PROSE).toContain("1-60 visible characters on ONE line");
  });
});

describe("the foreign-agent refusal — answered here, before any row exists", () => {
  // Plain prose rather than a 404 (the caller is already a member, so nothing leaks); a 404 would
  // read as its own agent vanishing and send it to re-launch.
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
  // `op="status"` prints `@agent-<id>`, so that is the form a model pastes.
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
    // `filed=no` separates this from PENDING: nothing is outstanding or cancellable.
    expect(out).toContain("reason=offline");
    expect(out).toContain("filed=no");
    expect(out).not.toContain("filed=yes");
    expect(out).not.toContain("directive=");
  });

  it("pending names the row, says NOT to re-issue, and says where to look", async () => {
    const out = await endText(settled({ status: "pending" }));
    expect(out).toContain("pending agent=@agent-");
    // The row id is the fact only this call has: it makes the outcome findable later.
    expect(out).toContain("directive=55555555-5555-5555-5555-555555555555");
    expect(out).toContain("claimed=no");
    expect(out).toContain("retry=no");
    // An end is confirmable: the agent disappearing from `op="status"` is the answer.
    expect(out).toContain("confirm=status");
    expect(out).not.toContain("confirm=none");
  });

  it("a pending RENAME says the opposite — nothing here can confirm it landed", async () => {
    // One pending line for both verbs would promise the rename a confirmation that does not exist.
    const out = await renameText(settled({ kind: "rename", status: "pending" }));
    expect(out).toContain("confirm=none");
    expect(out).not.toMatch(/confirm="?read/);
    expect(out).toContain("retry=no");
  });

  it("expired is LAPSED, not refused — no machine ever answered", async () => {
    // Nothing outstanding and nobody refused, so neither `retry=` nor a refusal word.
    const out = await endText(settled({ status: "expired" }));
    expect(out).toContain("not ended");
    expect(out).toContain("reason=expired");
    expect(out).toContain("directive=55555555-5555-5555-5555-555555555555");
    expect(out).not.toContain("retry=");
  });
});
