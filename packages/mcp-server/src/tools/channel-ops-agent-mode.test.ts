// `manage action="posture"`: the ask is never a grant, a `null` echo is "not reported", and each
// terminal shape pins its field on the line and its rule in `CHANNEL_DOCTRINE`. The cross-verb
// `no-bridge` asymmetry lives in `channel-ops-agent-gate.test.ts`.

import { describe, it, expect, vi } from "vitest";
import type { DoplClient, LaunchDirective } from "@dopl/client";
import { opSetAgentMode } from "./channel-ops-agent-mode";
import { factsLine, postureFacts } from "./channel-facts";
import { CHANNEL_DOCTRINE } from "./channel-doctrine";
import { CHANNEL_INPUT_SHAPE } from "./channel-schema";
import {
  AGENT,
  DIRECTIVE_ID,
  agentClient,
  modeDirective as directive,
  settledMode as settled,
} from "./launch-fixtures";

/** The argument `.describe()` text, which is prose a client reads too. */
const ARG_PROSE = Object.values(CHANNEL_INPUT_SHAPE)
  .map((arg) => arg.description ?? "")
  .join("\n");

const modeText = async (
  c: DoplClient,
  modes: Parameters<typeof opSetAgentMode>[3] = { tools: "auto" },
) =>
  (await opSetAgentMode(c, "general", AGENT, modes, { waitMs: 0 }))
    .content[0].text as string;

/** The posture pair as a caller reads it, through the real renderer. */
const postureText = (d: LaunchDirective) => factsLine("taken", postureFacts(d));

describe('manage action="posture" — the ASK, never the SET', () => {
  it("names what was asked for and never claims it was granted", async () => {
    const text = await modeText(settled({ status: "done" }), {
      tools: "bypass",
      messages: "auto_both",
    });
    // `taken`, never `set`: the machine applied something, not necessarily what was asked. `asked=`
    // and `posture=` stay separate fields so the gap between ask and outcome is visible.
    expect(text.startsWith("taken ")).toBe(true);
    expect(text).toContain("asked=bypass/auto_both");
    expect(text).toContain('posture="not reported"');
    expect(ARG_PROSE).toContain("how much freedom to ASK FOR");
    expect(ARG_PROSE).toContain(
      "narrows whatever you ask for to their own ceiling and never widens past it",
    );
  });

  it("says the agent keeps running — a posture is not an interruption", async () => {
    const text = await modeText(settled({ status: "done" }));
    // The line names the live handle and borrows nothing from `end` (`ended`, `handle=spent`).
    expect(text).toContain(`agent=@agent-${AGENT}`);
    expect(text.startsWith("taken ")).toBe(true);
    expect(text).not.toContain("handle=spent");
    expect(text).not.toContain("ended");
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

describe("the posture ECHO — a NULL is 'not reported', never agreement", () => {
  it("says NOT REPORTED, in words, when all three echo fields are null", () => {
    // The whole record: a dropped field is the same lie as a wrong one.
    expect(postureFacts(directive())).toEqual({
      posture: "not reported",
      chain: "not reported",
    });
    // Quoted, so the space cannot split the `key=value` pairs.
    expect(postureText(directive())).toBe(
      'taken posture="not reported" chain="not reported"',
    );
    expect(ARG_PROSE).toContain("how much freedom to ASK FOR");
    expect(CHANNEL_DOCTRINE).toContain("A `—` cell was NOT REPORTED");
  });

  it("NEVER echoes the REQUEST back when the echo is null", () => {
    // The row carries request-side values on every axis, so a renderer reading the wrong column finds one.
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
    // `off` (the machine said no) and `not reported` (it said nothing) must render differently.
    expect(postureText(directive())).toContain('chain="not reported"');
  });

  it("a PARTIAL report shows `-` for the unreported axis and never the request", () => {
    // Half-clamped: the reported axis is authoritative, the other shows `-`, never the request on the row.
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
    // `filed=yes`: a row was written and answered, so nothing is pending or cancellable.
    expect(text.startsWith("not re-postured ")).toBe(true);
    expect(text).toContain("reason=no-session");
    expect(text).toContain("retry=no");
    expect(text).toContain("filed=yes");
    // The "agent already finished" gloss is pinned absent in
    // `channel-ops-agent-doctrine.test.ts › RETIRED_BY_RULING`.
    expect(CHANNEL_DOCTRINE).toContain("A REFUSAL IS A NORMAL ANSWER");
    expect(CHANNEL_DOCTRINE).toContain("`no-session` no such agent");
  });

  it("`no-bridge` HERE MAY BE THE LAUNCH TOGGLE — and the doctrine names it", async () => {
    const text = await modeText(
      settled({ status: "refused", refusalReason: "no-bridge" }),
    );
    // A toggle is a decision, so re-issuing cannot change the answer.
    expect(text).toContain("reason=no-bridge");
    expect(text).toContain("retry=no");
    // The one asymmetry on this lane: the shared text names `posture` as gated, and
    // `channel-ops-agent-gate.test.ts` pins the other end.
    expect(CHANNEL_DOCTRINE).toContain("`no-bridge` the operator's LAUNCH toggle is off");
    expect(CHANNEL_DOCTRINE).toContain('it gates "launch" and "posture"');
  });

  it("`cap` does NOT borrow the launch advice to wait for a free slot", async () => {
    const text = await modeText(settled({ status: "refused", refusalReason: "cap" }));
    // `cap` answers `retry=no`, so the launch lane's "wait for a slot" advice never rides along.
    expect(text).toContain("reason=cap");
    expect(text).toContain("retry=no");
    expect(text).not.toMatch(/wait for/i);
  });

  it("`bad-name` is answered honestly as a word this verb cannot produce", async () => {
    const text = await modeText(
      settled({ status: "refused", refusalReason: "bad-name" }),
    );
    // Nothing here sends a name, so this word is an anomaly and re-issuing over it would loop forever.
    expect(text).toContain("reason=bad-name");
    expect(text).toContain("retry=no");
    // The doctrine says the word is about a label, and this verb sends none.
    expect(CHANNEL_DOCTRINE).toContain(
      "`bad-name` the label was not one line of 1-60 visible characters",
    );
  });

  it("a TIMEOUT is pending, says the id, and forbids a re-issue", async () => {
    const text = await modeText(settled({ status: "pending" }));
    // The directive id is the only handle the caller has left.
    expect(text.startsWith("pending ")).toBe(true);
    expect(text).toContain(`directive=${DIRECTIVE_ID}`);
    expect(text).toContain("retry=no");
    // A second directive is a second request for the same change, with nothing to say which acted.
    expect(CHANNEL_DOCTRINE).toContain(
      "A TIMEOUT IS NOT A FAILURE: the request stays PENDING",
    );
    expect(CHANNEL_DOCTRINE).toContain(
      "re-issuing without the SAME `client_msg_id` starts a SECOND agent",
    );
  });

  it("the PENDING line answers `confirm=none`, not the END's confirm surface", async () => {
    // A re-posture that never landed leaves the agent on its OLD permissions, and a listing that
    // still prints it looks like success.
    const text = await modeText(settled({ status: "pending" }));
    expect(text).toContain("confirm=none");
    // The end's confirm surface by its live name, or the negative guards nothing.
    expect(text).not.toContain("confirm=status");
    // A rename answers `none` too; `asked=`, which only this verb carries, tells the two lines apart.
    expect(text).toContain("asked=auto/-");
  });

  it("an EXPIRED request says the agent kept the posture it had", async () => {
    const text = await modeText(settled({ status: "expired" }));
    // Lapsed is neither refused nor pending: nothing was applied, so the agent keeps its posture.
    expect(text.startsWith("not re-postured ")).toBe(true);
    expect(text).toContain("reason=expired");
    expect(text).toContain(`directive=${DIRECTIVE_ID}`);
    expect(text).toContain("filed=yes");
    // Not the timeout shape: no machine will ever take this row.
    expect(text).not.toContain("confirm=");
  });

  it("OFFLINE names THIS verb, not a rename — the shared verb table", async () => {
    const client = agentClient({
      createAgentDirective: vi.fn(async () => ({ offline: true, directive: null })),
    });
    const text = await modeText(client);
    // `filed=no`: no row was written, so nothing is pending or cancellable.
    expect(text).toContain("reason=offline");
    expect(text).toContain("filed=no");
    // `channel-ops-agent.ts › VERB_PAST` is a map over the kind set, so the offline head names this
    // verb; a `kind === "end"` ternary reported it as a rename (F-413).
    const why =
      "channel-ops-agent.ts › fileAndHold renders the offline head with a " +
      "kind === 'end' ternary, so a posture reports as a RENAME. " +
      "Use VERB_PAST — the map that exists for exactly this.";
    expect(text.startsWith("not re-postured "), `${why}\ngot: ${text}`).toBe(true);
    expect(text, why).not.toContain("not renamed");
  });
});
