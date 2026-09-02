/**
 * `op="set_agent_mode"` — THE ROUTING, THE REFUSAL SENTENCES, AND THE POSTURE
 * ECHO (2026-09-01, T24's sibling verb).
 *
 * ⚠ **EVERY CASE HERE IS ABOUT WHAT THE RESULT TEACHES.** A tool RESULT is read
 * by the same model at the moment it chooses its next action and outvotes a
 * description read once at connection (INVARIANTS §10). The readings this op must
 * prevent, each with a case:
 *
 *  1. **"I SET THE POSTURE."** The machine CLAMPS whatever is asked for to the
 *     operator's own ceiling. A caller that reads "set" reports room it does not
 *     have and then sizes its next instruction for it. Every success sentence has
 *     to say ASKED.
 *  2. **A NULL ECHO READ AS AGREEMENT.** No machine writes `applied_*` yet, so it
 *     is `null` on every live row and `null` MEANS NOT REPORTED. Rendering it as
 *     "unclamped", or echoing the request back, is the same lie as (1) with a
 *     column standing behind it.
 *  3. **`no-bridge` NARRATED WITH THE WRONG TOGGLE STORY.** This is the one agent
 *     verb the launch toggle DOES gate, so its sentence must be allowed to say so
 *     — while `end_agent` / `rename_agent` must keep saying the opposite. Two
 *     maps, one enum, and the copy pin below drives both.
 *  4. **A TIMEOUT READ AS A FAILURE**, producing a second request for the same
 *     change with no way to tell which one acted.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient, LaunchDirective } from "@dopl/client";
import { opSetAgentMode } from "./channel-ops-agent-mode";
import { opEndAgent, opRenameAgent } from "./channel-ops-agent";
import { postureLine } from "./channel-ops-launch";
import { sourceOf } from "./tool-group-files";

const CHANNEL = { id: "chan-1", slug: "general", name: "General", visibility: "private" };
const AGENT = "a1b2c3d4";

function directive(over: Partial<LaunchDirective> = {}): LaunchDirective {
  return {
    id: "55555555-5555-5555-5555-555555555555",
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

describe("set_agent_mode — the ASK, never the SET", () => {
  it("names what was asked for and never claims it was granted", async () => {
    const text = await modeText(settled({ status: "done" }), {
      tools: "bypass",
      messages: "auto_both",
    });
    expect(text).toContain("asked for");
    expect(text).toContain("bypass/auto_both");
    expect(text).toContain("ASKED FOR IS NOT GRANTED");
    expect(text).toContain("never widens past it");
  });

  it("says the agent keeps running — a posture is not an interruption", async () => {
    const text = await modeText(settled({ status: "done" }));
    expect(text).toContain("still running");
    expect(text).toContain(`@agent-${AGENT}`);
  });

  it("renders `-` for an axis deliberately left alone", async () => {
    expect(await modeText(settled({ status: "done" }), { tools: "auto" })).toContain(
      "auto/-",
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
    const line = postureLine(directive());
    expect(line).toContain("not reported");
    expect(line).toContain("DO NOT ASSUME YOU GOT IT");
    expect(line).toContain("NARROWER");
  });

  it("⚠ NEVER echoes the REQUEST back when the echo is null", () => {
    // The failure this closes: a line that is right whenever nothing was clamped
    // and confidently wrong precisely when it was.
    const line = postureLine(
      directive({
        startToolMode: "bypass",
        startMessageMode: "auto_both",
        chain: true,
        targetToolMode: "bypass",
      }),
    );
    expect(line).not.toContain("posture=bypass");
    expect(line).not.toContain("chain=on");
  });

  it("prints `posture=<tools>/<messages> chain=on|off` when the machine DID report", () => {
    const line = postureLine(
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
      postureLine(
        directive({
          appliedToolMode: "auto",
          appliedMessageMode: "auto_both",
          appliedChain: false,
        }),
      ),
    ).toContain("chain=off");
  });

  it("a PARTIAL report shows `-` for the unreported axis and says so", () => {
    const line = postureLine(directive({ appliedToolMode: "auto" }));
    expect(line).toContain("posture=auto/-");
    expect(line).toContain("chain=not reported");
    expect(line).toContain("NOT an axis that was left wide");
  });

  it("the set_agent_mode success renders the echo line", async () => {
    expect(await modeText(settled({ status: "done" }))).toContain("not reported");
  });
});

describe("set_agent_mode — the terminal shapes", () => {
  it("a refusal says nothing changed and is not an error", async () => {
    const text = await modeText(
      settled({ status: "refused", refusalReason: "no-session" }),
    );
    expect(text).toContain("was NOT re-postured");
    expect(text).toContain("ALREADY FINISHED");
    expect(text).toContain("keeps whatever posture it already had");
  });

  it("⚠ `no-bridge` HERE MAY BE THE LAUNCH TOGGLE — and names both causes", async () => {
    const text = await modeText(
      settled({ status: "refused", refusalReason: "no-bridge" }),
    );
    expect(text).toContain("LAUNCHING OVER MCP TURNED OFF");
    expect(text).toContain("DOES gate this op");
    expect(text).toContain("not watching that channel");
  });

  it("`cap` does NOT borrow the launch advice to wait for a free slot", async () => {
    const text = await modeText(settled({ status: "refused", refusalReason: "cap" }));
    expect(text).toContain("not a state a re-posture can be blocked by");
    expect(text).not.toContain("wait for one of those to finish");
  });

  it("`bad-name` is answered honestly as a word this verb cannot produce", async () => {
    expect(
      await modeText(settled({ status: "refused", refusalReason: "bad-name" })),
    ).toContain("belongs to RENAMING an agent");
  });

  it("a TIMEOUT is pending, says the id, and forbids a re-issue", async () => {
    const text = await modeText(settled({ status: "pending" }));
    expect(text).toContain("A TIMEOUT IS NOT A REFUSAL");
    expect(text).toContain("DO NOT ISSUE THIS CALL AGAIN");
    expect(text).toContain("55555555-5555-5555-5555-555555555555");
  });

  it("🔒 the PENDING line uses the POSTURE sentence, not the rename's", async () => {
    // The defect a `verb === "ended" ? … : …` ternary produces the day a third
    // verb arrives: a re-posture told to check read_sessions for a RENAME.
    const text = await modeText(settled({ status: "pending" }));
    expect(text).toContain("A posture lives on your operator's machine");
    expect(text).not.toContain("The rename is DISPLAY-ONLY");
  });

  it("an EXPIRED request says the agent kept the posture it had", async () => {
    expect(await modeText(settled({ status: "expired" }))).toContain(
      "keeps the posture it already had",
    );
  });

  it("OFFLINE names THIS verb, not a rename — the shared verb table", async () => {
    const client = {
      listChannels: vi.fn(async () => [CHANNEL]),
      createAgentDirective: vi.fn(async () => ({ offline: true, directive: null })),
    } as unknown as DoplClient;
    const text = await modeText(client);
    expect(text).toContain("Nothing was re-postured");
    expect(text).not.toContain("Nothing was renamed");
  });
});

describe("the sibling verbs keep their own answers (the two maps stay two)", () => {
  const endText = async (c: DoplClient) =>
    (await opEndAgent(c, "general", AGENT, { waitMs: 0 })).content[0].text as string;

  it("🔒 an END's `no-bridge` still DENIES the launch toggle — the opposite claim", async () => {
    const text = await endText(
      settled({ kind: "end", status: "refused", refusalReason: "no-bridge" }),
    );
    expect(text).toContain("has no bearing on ending or renaming one");
    expect(text).toContain("do not ask for it to be turned on");
  });

  it("an END's pending line still points at the disappearance, not at a posture", async () => {
    const text = await endText(settled({ kind: "end", status: "pending" }));
    expect(text).toContain("The agent disappearing from that list is the answer.");
  });

  it("a RENAME's pending line is still the rename's", async () => {
    const text = (
      await opRenameAgent(
        settled({ kind: "rename", status: "pending" }),
        "general",
        AGENT,
        "Research",
        { waitMs: 0 },
      )
    ).content[0].text as string;
    expect(text).toContain("The rename is DISPLAY-ONLY");
  });
});

/**
 * ⚠ **A SOURCE PIN, NOT A BEHAVIOUR ONE, AND DELIBERATELY SO.** The claim is
 * about what the shipped COPY of the two ungated verbs may say: their module must
 * never tell a caller that the launch toggle gates an end or a rename. A
 * behavioural test can only reach the sentences a case happens to trigger; this
 * reads every byte of the file.
 */
describe("🔒 the ungated verbs' copy never sends a caller to the launch toggle", () => {
  const src = sourceOf("channel-ops-agent.ts");

  it("states the DENIAL, and states it positively", () => {
    expect(src).toContain("has no bearing on ending or renaming one");
  });

  it("never tells that caller to have the toggle turned on", () => {
    // ⚠ The launch op's own advice, verbatim — the sentence that would arrive
    // here by a copy-paste and send an orchestrator to request a permission
    // unrelated to what failed.
    expect(src).not.toContain("If you believe they want it on, ASK THEM");
    expect(src).not.toContain("ask your operator to turn it on");
  });

  it("and the GATED verb's module is the only one allowed to say the toggle applies", () => {
    expect(sourceOf("channel-ops-agent-mode.ts")).toContain("DOES gate this op");
    expect(src).not.toContain("DOES gate this op");
  });
});
