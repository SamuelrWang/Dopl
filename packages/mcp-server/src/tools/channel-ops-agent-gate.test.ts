/**
 * 🔒 **WHICH AGENT VERBS THE OPERATOR'S LAUNCH TOGGLE GATES — THE ASYMMETRY,
 * PINNED FROM BOTH ENDS** (split from `channel-ops-agent-mode.test.ts` at the
 * 500-line cap, 2026-09-02; INVARIANTS §1).
 *
 * ⚠ **THE SPLIT IS BY SUBJECT, NOT BY LINE COUNT.** That file answers "what does
 * a `set_agent_mode` result say about THIS call". This one answers a question no
 * single verb can: that `no-bridge` MEANS TWO DIFFERENT THINGS depending on which
 * verb it came back on, and that the two meanings have not collapsed into one.
 *
 *   • On `op="launch_agent"` and `op="set_agent_mode"` it MAY genuinely be the
 *     operator's launch-over-MCP setting — `main/launch-directive-wire.js ›
 *     KINDS_NEEDING_LAUNCH_CONSENT` is those two kinds and nothing else — so
 *     raising it with them is sensible.
 *   • On `op="end_agent"` and `op="rename_agent"` it explicitly is NOT. A stop
 *     verb and a display label widen nothing, so a caller sent to ask for that
 *     permission is asking for something unrelated to what failed, and will
 *     conclude its operator denied it something they never denied.
 *
 * ⚠ **AND THE ANSWER USED TO BE ENFORCED BY THREE COPIES OF ONE PARAGRAPH.** Each
 * op module shipped its own refusal sentences, so "this file says the opposite of
 * that file" was checkable by reading them. The verbosity tier (T10) replaced all
 * three with `reason=`/`retry=` fields over ONE shared doctrine text — which is
 * the right trade and also the moment the asymmetry became easy to lose, because
 * one text now has to carry both claims at once. That is what this suite exists
 * to prevent: the doctrine is asserted for BOTH halves, and the ungated module is
 * scanned for the claim it may never make.
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (`parity.test.ts`) and the removed-vocabulary source scan (`channel-law.test.ts`).
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient, LaunchDirective } from "@dopl/client";
import { opEndAgent, opRenameAgent } from "./channel-ops-agent";
import { CHANNEL_DOCTRINE } from "./channel-doctrine";
import { sourceOf } from "./tool-group-files";

const CHANNEL = { id: "chan-1", slug: "general", name: "General", visibility: "private" };
const AGENT = "a1b2c3d4";

// ⚠ A SECOND COPY OF THE SIBLING FIXTURE, AND DELIBERATELY SO. Sharing it would
// couple two suites that must be able to disagree — the whole claim here is that
// the three verbs answer differently over the SAME row, so each side building its
// own row is what makes a difference in the answer mean something.
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


describe("the sibling verbs keep their own answers (the two maps stay two)", () => {
  const endText = async (c: DoplClient) =>
    (await opEndAgent(c, "general", AGENT, { waitMs: 0 })).content[0].text as string;

  it("🔒 an END's `no-bridge` still DENIES the launch toggle — the opposite claim", async () => {
    const text = await endText(
      settled({ kind: "end", status: "refused", refusalReason: "no-bridge" }),
    );
    // ⚠ THE VERDICT IS THE SAME PAIR AS THE RE-POSTURE'S, and that is fine —
    // both are `no`. What may NOT be the same is the STORY, and the story is the
    // doctrine's. So: the launch lane's wording never rides along on this
    // result…
    expect(text).toContain("reason=no-bridge");
    expect(text).toContain("retry=no");
    expect(text).not.toMatch(/turn(ed)? (it )?on/i);
    // 🔒 …and the shared text still carries the DENIAL for these two verbs beside
    // the gate it grants the re-posture. BOTH CLAIMS MUST BE FINDABLE OR THEY
    // HAVE COLLAPSED INTO ONE ANSWER — the failure this pair of suites prevents.
    expect(CHANNEL_DOCTRINE).toContain("those two verbs are not gated by it");
    expect(CHANNEL_DOCTRINE).toContain("has no bearing on ending or renaming one");
  });

  it("an END's pending line still points at the disappearance, not at a posture", async () => {
    const text = await endText(settled({ kind: "end", status: "pending" }));
    // ⚠ THE ONE KIND WITH A REAL CONFIRMATION SURFACE. The agent disappearing
    // from `read_sessions` is the answer — which is exactly what a re-posture
    // and a rename must NOT be told.
    expect(text).toContain("confirm=read_sessions");
    expect(CHANNEL_DOCTRINE).toContain('Look for the outcome in "read_sessions"');
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
    // ⚠ `confirm=none` because the name lives on ONE desktop and reaches no
    // server, so that listing keeps printing the id — correct, not a stale read.
    expect(text).toContain("confirm=none");
    expect(text).not.toContain("confirm=read_sessions");
    // ⚠ AND NO `asked=`: a rename moves a label, not a posture. This is the tell
    // that keeps its line distinguishable from the re-posture's, now that both
    // answer `confirm=none`.
    expect(text).not.toContain("asked=");
    expect(CHANNEL_DOCTRINE).toContain("keeps printing the id after a rename");
  });
});

/**
 * ⚠ **THE COPY MOVED OUT OF THESE MODULES; THE CLAIM DID NOT** (T10, 2026-09-02).
 * This block was a pure SOURCE pin, because the sentences it guards shipped from
 * `channel-ops-agent.ts`'s own `REFUSAL_SENTENCES` and a behavioural test reaches
 * only the ones a case triggers. They are `CHANNEL_DOCTRINE`'s now, so the
 * POSITIVE half is pinned where it is READ and the source scan keeps the half it
 * is still the right instrument for — a NEGATIVE over every byte of a file, which
 * is the one thing a behavioural test cannot do.
 */
describe("🔒 the ungated verbs' copy never sends a caller to the launch toggle", () => {
  const src = sourceOf("channel-ops-agent.ts");

  it("states the DENIAL, and states it positively", () => {
    // In the shipped text, where a caller reads it…
    expect(CHANNEL_DOCTRINE).toContain("has no bearing on ending or renaming one");
    expect(CHANNEL_DOCTRINE).toContain("those two verbs are not gated by it");
    // …and in the module, where the next person to edit the refusal map reads it.
    expect(src).toContain("does NOT gate these two");
  });

  it("never tells that caller to have the toggle turned on", () => {
    // ⚠ The launch op's own advice, verbatim — the sentence that would arrive
    // here by a copy-paste and send an orchestrator to request a permission
    // unrelated to what failed.
    expect(src).not.toContain("If you believe they want it on, ASK THEM");
    expect(src).not.toContain("ask your operator to turn it on");
  });

  it("and the GATED verb is the only one whose copy says the toggle applies", () => {
    // ⚠ THE ASYMMETRY, PINNED FROM BOTH ENDS. The doctrine grants the gate to
    // `set_agent_mode` by name; the gated module's own header carries the
    // argument for why; and the ungated module must never claim it.
    expect(CHANNEL_DOCTRINE).toContain(
      'It gates op="launch_agent" and op="set_agent_mode"',
    );
    expect(sourceOf("channel-ops-agent-mode.ts")).toContain("this kind IS gated by it");
    expect(src).not.toContain("IS gated by it");
  });
});
