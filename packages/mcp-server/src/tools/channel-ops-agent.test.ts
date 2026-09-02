/**
 * `op="end_agent"` / `op="rename_agent"` — the terminal shapes and the sentences
 * each one ends on (2026-09-01, Samuel's external agent-management ruling).
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
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient, LaunchDirective } from "@dopl/client";
import { opEndAgent, opRenameAgent } from "./channel-ops-agent";

const CHANNEL = { id: "chan-1", slug: "general", name: "General", visibility: "private" };
const AGENT = "a1b2c3d4";

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

describe("end_agent — the success sentence", () => {
  const done = settled({ status: "done" });

  it("says what an end DOES NOT touch, because 'end' over-reads as 'remove'", async () => {
    const out = await endText(done);
    expect(out).toContain("was ENDED");
    expect(out).toContain("thread it was working (if any) is untouched");
    expect(out).toContain("stays in the channel");
  });

  /**
   * ⚠ INSTANCE IDS ARE NEVER REUSED, so a handle after an end addresses nothing.
   * Without this line an orchestrator keeps posting `@agent-<id>` into silence —
   * the exact failure `channel-session-handle.ts` documents one namespace over.
   */
  it("says the handle is SPENT and points at the only way to continue the work", async () => {
    const out = await endText(done);
    expect(out).toContain("HANDLE IS SPENT");
    expect(out).toContain("not reused");
    expect(out).toContain('op="launch_agent"');
  });

  it("does not claim more than a machine can prove", async () => {
    expect(await endText(done)).toContain("THE MACHINE SAID SO");
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
  it("names 'already finished' as the ordinary cause, and calls it wanted", async () => {
    const out = await gone.listChannels && (await endText(gone));
    expect(out).toContain("ALREADY FINISHED");
    expect(out).toContain("that is the outcome you wanted");
    expect(out).toContain("nothing is wrong");
  });

  it("sends the caller to read_sessions rather than to a retry", async () => {
    expect(await endText(gone)).toContain('op="read_sessions"');
  });
});

describe("the refusal copy must NOT be the launch op's", () => {
  /**
   * ⚠ **THE SHARPEST CASE IN THIS FILE.** `no-bridge` on the LAUNCH lane means the
   * operator's launch-over-MCP toggle is off, and its sentence tells the caller to
   * ask for it to be turned on. **THAT TOGGLE DOES NOT GATE THESE TWO VERBS** —
   * `main/launch-directives.js › handle` tests the kind, and
   * `directive-agent-ops.js`'s header carries the ruling. Copying the launch
   * sentence here would send an orchestrator to request a permission unrelated to
   * what failed, and to conclude its operator had denied it something they never
   * denied.
   */
  it("no-bridge on an end says the launch toggle is IRRELEVANT, not to ask for it", async () => {
    const out = await endText(settled({ status: "refused", refusalReason: "no-bridge" }));
    expect(out).toContain("NOT a permission setting");
    expect(out).toContain("has no bearing on ending or renaming");
    expect(out).toContain("do not ask for it to be turned on");
    expect(out).not.toContain("TURNED OFF on that machine");
  });

  /**
   * ⚠ `cap` on a launch means "wait for a running agent to finish". Telling a
   * caller that BEFORE ENDING ONE is advice that contradicts the request.
   */
  it("cap on an end does not tell the caller to wait for a slot", async () => {
    const out = await endText(settled({ status: "refused", refusalReason: "cap" }));
    expect(out).not.toContain("wait for one of the running agents to finish");
    expect(out).toContain("not a state an end or a rename can be blocked by");
  });
});

describe("rename_agent — display only, on one machine", () => {
  const done = settled({ kind: "rename", status: "done", targetName: "Research" });

  it("says the handle is unchanged and is the ONLY address", async () => {
    const out = await renameText(done);
    expect(out).toContain("DISPLAY ONLY");
    expect(out).toContain(`@agent-${AGENT}`);
    expect(out).toContain("ONLY address");
  });

  /**
   * ⚠ THE LINE THAT PREVENTS A POLLING LOOP. The name is stored on the operator's
   * desktop and reaches no server, so `read_sessions` keeps printing the id. An
   * agent that expected the listing to change would re-issue forever.
   */
  it("warns that read_sessions will NOT show the name, and that this is correct", async () => {
    const out = await renameText(done);
    expect(out).toContain("YOU WILL NOT SEE IT FROM HERE");
    expect(out).toContain("not a stale read");
    expect(out).toContain("do not re-issue");
  });

  it("an EMPTY name reads as a CLEAR, not as a rename to nothing", async () => {
    const cleared = settled({ kind: "rename", status: "done", targetName: "" });
    const out = (await opRenameAgent(cleared, "general", AGENT, "", { waitMs: 0 }))
      .content[0].text as string;
    expect(out).toContain("CLEARED");
    expect(out).toContain(`Agent #${AGENT}`);
  });

  it("bad-name says exactly what would be accepted, so one retry can fix it", async () => {
    const out = await renameText(settled({ kind: "rename", status: "refused", refusalReason: "bad-name" }));
    expect(out).toContain("1-60 visible characters");
    expect(out).toContain("refused rather than stripped");
    expect(out).toContain("Nothing else about the agent changed");
  });
});

describe("the foreign-agent refusal — answered here, before any row exists", () => {
  /**
   * ⚠ IT NAMES THE FACT PLAINLY RATHER THAN 404-ING. The caller has already proved
   * channel membership, inside which `op="members"` and `op="read_sessions"` are
   * readable anyway, so nothing is disclosed — while a 404 would tell an
   * orchestrator its OWN agent had vanished and send it to re-launch.
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
  it("offline says NO REQUEST WAS FILED, and warns that a stopped machine runs nothing",
    async () => {
      const off = client({
        createAgentDirective: vi.fn(async () => ({ offline: true, directive: null })),
      });
      const out = await endText(off);
      expect(out).toContain("No request was filed");
      expect(out).toContain("HINT, NOT A VERDICT");
      // ⚠ THE END-SPECIFIC HALF: an agent on a machine that is not running is not
      // running either, so there may be nothing left to stop.
      expect(out).toContain("there may be nothing left to stop");
    });

  /**
   * ⚠ A TIMEOUT IS NOT A REFUSAL. The row stays pending and the machine may still
   * take it; a second request for the same change leaves the caller unable to say
   * which one acted.
   */
  it("pending says the id, says NOT to re-issue, and says where to look", async () => {
    const out = await endText(settled({ status: "pending" }));
    expect(out).toContain("still PENDING");
    expect(out).toContain("A TIMEOUT IS NOT A REFUSAL");
    expect(out).toContain("DO NOT ISSUE THIS CALL AGAIN");
    expect(out).toContain("disappearing from that list is the answer");
  });

  it("a pending RENAME says the opposite — nothing here can confirm it landed", async () => {
    const out = await renameText(settled({ kind: "rename", status: "pending" }));
    expect(out).toContain("Nothing here can confirm a rename landed");
  });
});
