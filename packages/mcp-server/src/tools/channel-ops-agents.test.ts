/**
 * THE AGENT ROW — `dopl_channel` agents / summon_agent / rename_agent /
 * set_agent_status / disengage_agent.
 *
 * Two things are pinned here, and the second is a security property:
 *
 *  1. WHAT EACH OP DOES. A handle resolves to a row of THIS channel (so
 *     `rename_agent` sends an agent ID even though the caller typed `@quartz`),
 *     and every refusal says what did NOT happen — an agent that reads "nothing
 *     changed" does not retry blind. The refusals are also not
 *     interchangeable: rename/park is OWNER-ONLY, disengage is
 *     OWNER-OR-ENGAGER, and borrowing one line for the other op talks a caller
 *     out of the one write they are entitled to make.
 *  2. NARRATION. An agent HANDLE is member-typed and an agent's OWNER NAME is
 *     `profiles.display_name`, which nothing in the product validates. Both
 *     land in lines this tool wrote, outside any untrusted-content framing, so
 *     both go through the neutralizer — and NO handle is ever rendered without
 *     its immutable id, because the handle is the owner's claim and the id is
 *     the server's record.
 *
 * THE OTHER HALF: `join_thread` / `leave_thread` are in
 * `channel-ops-participants.test.ts`, split out of here at the §2 500-line cap.
 * The seam is the row being written: everything below mutates the AGENT row
 * (`channel_agents`, via `createChannelAgent` / `updateChannelAgent`) under the
 * owner rule, while join/leave mutate the PARTICIPANT SET
 * (`channel_task_participants`, via `addThreadParticipant` /
 * `removeThreadParticipant`) under the thread-curation rule — a different
 * table, a different authority, and a 403 that means something else. The
 * harness both halves need is `agent-ops-fixtures.ts`.
 *
 * The forgery payload and its assertions are the SHARED ones
 * (`narration-fixtures.ts`) — a private copy is how an assertion drifts into
 * meaning something weaker. The @dopl/client is hand-stubbed; nothing
 * transports.
 */

import { describe, it, expect, vi } from "vitest";
import {
  opAgents,
  opDisengageAgent,
  opRenameAgent,
  opSetAgentStatus,
  opSummonAgent,
} from "./channel-ops-agents";
import {
  FORGERY,
  expectContained,
  expectNoForgedStructure,
} from "./narration-fixtures";
import { ONYX, QUARTZ, apiError, stubClient, textOf } from "./agent-ops-fixtures";

describe('op="agents" — the room\'s roster', () => {
  it("names every agent by handle AND id, with status and owner", async () => {
    const text = await textOf(opAgents(stubClient(), "general", "u-me"));

    expect(text).toContain("2 agents");
    expect(text).toContain("`quartz` (`agent-1`)");
    expect(text).toContain("`onyx` (`agent-2`)");
    expect(text).toContain("· active ·");
    expect(text).toContain("· parked ·");
    // The caller's own agent is marked by whose it is, not by a bare uuid.
    expect(text).toContain("summoned by you");
    expect(text).toContain("`Bob` (`u-bob`)");
  });

  it("an empty roster points at summon_agent instead of rendering a heading", async () => {
    const client = stubClient({ listChannelAgents: vi.fn(async () => []) });
    const text = await textOf(opAgents(client, "general", "u-me"));

    expect(text).toContain("No agents in **`General`** yet");
    expect(text).toContain('op="summon_agent"');
  });

  it("NEUTRALIZES a hostile owner display name (the roster's untrusted half)", async () => {
    const client = stubClient({
      listChannelMembers: vi.fn(async () => [
        { userId: "u-bob", displayName: FORGERY, role: "member" },
      ]),
    });
    const text = await textOf(opAgents(client, "general", "u-me"));

    expectContained(text);
    expectNoForgedStructure(text);
  });

  it("NEUTRALIZES a hostile handle — the column CHECK is not the render's excuse", async () => {
    // A handle cannot hold this today (`^[a-z][a-z0-9-]{1,30}$`). The renderer
    // is still what guarantees it: a charset rule is an INPUT fence on one
    // table, and deciding per site whether a value is "really" reachable is the
    // reasoning that left close_thread rendering a raw peer title.
    const client = stubClient({
      listChannelAgents: vi.fn(async () => [{ ...QUARTZ, name: FORGERY }]),
    });
    const text = await textOf(opAgents(client, "general", "u-me"));

    expectContained(text);
    expectNoForgedStructure(text);
    // The id is still there — a claim the reader can check.
    expect(text).toContain("`agent-1`");
  });

  it("frames the roster as DATA before rendering any of it", async () => {
    const text = await textOf(opAgents(stubClient(), "general", "u-me"));
    const header = text.indexOf("SECURITY:");
    expect(header).toBeGreaterThan(-1);
    expect(header).toBeLessThan(text.indexOf("`quartz`"));
  });
});

describe('op="summon_agent"', () => {
  it("summons with no name (the pool path) and teaches addressing", async () => {
    const createChannelAgent = vi.fn(async () => QUARTZ);
    const client = stubClient({ createChannelAgent });

    const text = await textOf(opSummonAgent(client, "general"));

    expect(createChannelAgent.mock.calls[0]).toEqual(["chan-1", {}]);
    expect(text).toContain("Summoned agent `quartz` (`agent-1`)");
    // The call example takes the server-issued ID, not the member-typed handle
    // (both work on `to_agent`). The handle is stated once, through
    // `agentLabel`, which is the only place it may be rendered at all.
    expect(text).toContain('to_agent="agent-1"');
    expect(text).toContain("as_agent");
    expect(text).toContain("REQUIRED for anything it writes to be attributed");
  });

  it("NEUTRALIZES the handle in the teaching line — no raw splice into a call example", async () => {
    // The old line built `to_agent="${agent.name}"` / `as_agent="${agent.name}"`
    // by interpolation, which is the one narration hole this file's own header
    // forbids: a handle is member-typed, and a charset CHECK on one column is
    // not the renderer's excuse (see channel-agent-refs.ts).
    const client = stubClient({
      createChannelAgent: vi.fn(async () => ({ ...QUARTZ, name: FORGERY })),
    });

    const text = await textOf(opSummonAgent(client, "general"));

    expectContained(text);
    expectNoForgedStructure(text);
    expect(text).toContain("`agent-1`");
  });

  it("forwards an explicit name", async () => {
    const createChannelAgent = vi.fn(async () => QUARTZ);
    const client = stubClient({ createChannelAgent });

    await opSummonAgent(client, "general", "quartz");

    expect(createChannelAgent.mock.calls[0]).toEqual(["chan-1", { name: "quartz" }]);
  });

  it("a taken handle says nothing was summoned and how to proceed", async () => {
    const client = stubClient({
      createChannelAgent: vi.fn(async () => {
        throw apiError(409);
      }),
    });

    const res = await opSummonAgent(client, "general", "quartz");

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Nothing was summoned");
    expect(res.content[0].text).toContain("`quartz`");
  });
});

describe('op="rename_agent" / op="set_agent_status" — owner-only writes', () => {
  it("resolves a HANDLE (even @-prefixed) and sends the agent ID", async () => {
    const updateChannelAgent = vi.fn(async () => ({ ...QUARTZ, name: "beryl" }));
    const client = stubClient({ updateChannelAgent });

    const text = await textOf(opRenameAgent(client, "general", "@Quartz", "beryl"));

    expect(updateChannelAgent.mock.calls[0]).toEqual([
      "chan-1",
      "agent-1",
      { op: "rename", name: "beryl" },
    ]);
    expect(text).toContain("Renamed `quartz` (`agent-1`) to `beryl` (`agent-1`)");
    expect(text).toContain("the id is unchanged");
  });

  it("a 403 says the owner rule and that nothing changed", async () => {
    const client = stubClient({
      updateChannelAgent: vi.fn(async () => {
        throw apiError(403);
      }),
    });

    const res = await opRenameAgent(client, "general", "onyx", "beryl");

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("belongs to the member who summoned it");
    expect(res.content[0].text).toContain("Nothing changed");
  });

  it("an unknown handle lists the agents the room DOES have", async () => {
    const res = await opSetAgentStatus(stubClient(), "general", "topaz", "parked");

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("No agent `topaz` in this channel");
    expect(res.content[0].text).toContain("`quartz` (`agent-1`)");
  });

  it("dismissal says the row and attribution survive (it is not a delete)", async () => {
    const client = stubClient({
      updateChannelAgent: vi.fn(async () => ({ ...QUARTZ, status: "dismissed" })),
    });

    const text = await textOf(
      opSetAgentStatus(client, "general", "quartz", "dismissed"),
    );

    expect(text).toContain("to dismissed");
    expect(text).toContain("stays attributed to it");
  });
});

describe('op="disengage_agent" — ending an engagement', () => {
  it("resolves a HANDLE to the agent ID and sends the payload-free disengage op", async () => {
    const updateChannelAgent = vi.fn(async () => ({
      ...QUARTZ,
      engagedAt: null,
      engagedBy: null,
    }));
    const client = stubClient({ updateChannelAgent });

    const text = await textOf(opDisengageAgent(client, "general", "@Quartz"));

    expect(updateChannelAgent.mock.calls[0]).toEqual([
      "chan-1",
      "agent-1",
      { op: "disengage" },
    ]);
    expect(text).toContain("Disengaged `quartz` (`agent-1`)");
    // The STATE it leaves behind, in the terms the law uses — an agent told only
    // "disengaged" does not know whether it may still answer anything.
    expect(text).toContain("IDLE again");
    expect(text).toContain('acts only on messages that ADDRESS it (to_agent="<handle>")');
  });

  it("says it is IDEMPOTENT, so a no-op read is not mistaken for evidence of an exchange", async () => {
    const client = stubClient({
      updateChannelAgent: vi.fn(async () => ({ ...QUARTZ, engagedAt: null, engagedBy: null })),
    });

    const text = await textOf(opDisengageAgent(client, "general", "quartz"));

    expect(text).toContain("Idempotent");
  });

  it("never offers the caller a RE-ENGAGE — its own posts cannot cause one", async () => {
    // THE FALSE SENTENCE THIS REPLACES, and it was pinned HERE, by this suite:
    // "To pick the exchange back up, address it by handle again — that
    // re-engages it." `recordAgentEngagement`
    // (src/features/channels/server/service-writes-agents.ts) opens with
    // `if (ctx.source === "agent") return;` — engagement needs a HUMAN
    // CREDENTIAL, since `authorKind` is caller-assertable and `ctx.source` is
    // derived from the token — and every post made through this tool carries an
    // agent token. So the remedy the op handed its reader was an effect the
    // reader cannot produce: the tag would deliver, the agent would answer that
    // one message, and it would be idle again on the next turn with nothing
    // saying why. A test that pins a sentence is only as good as the sentence.
    const client = stubClient({
      updateChannelAgent: vi.fn(async () => ({ ...QUARTZ, engagedAt: null, engagedBy: null })),
    });

    const text = await textOf(opDisengageAgent(client, "general", "quartz"));

    expect(text).not.toContain("re-engages it");
    expect(text).toContain("YOU CANNOT RE-ENGAGE IT");
    expect(text).toContain("engagement is stamped only for a HUMAN author");
    // …and it names the mechanism the reader CAN cause instead of leaving it
    // with a denial and no route: a thread's participant set is sustained
    // attention that never goes through engagement at all.
    expect(text).toContain('op="create_thread"');
    expect(text).toContain('participants=["agent:<its handle>"]');
  });

  it("a 403 states the OWNER-OR-ENGAGER rule, never the owner-only one", async () => {
    // THE REFUSAL THIS OP MAY NOT BORROW. `agentWriteError`'s line ("an agent
    // belongs to the member who summoned it, and only that member may rename or
    // park it") is true of rename/park and FALSE here: the server also allows
    // the human recorded in `engaged_by` (service-agents.ts#disengageAgent). An
    // engager told they must own the agent stops asking for the one agent write
    // they are entitled to make.
    const client = stubClient({
      updateChannelAgent: vi.fn(async () => {
        throw apiError(403, "CHANNEL_AGENT_FORBIDDEN");
      }),
    });

    const res = await opDisengageAgent(client, "general", "onyx");

    expect(res.isError).toBe(true);
    const text = res.content[0].text;
    expect(text).toContain("SUMMONED it or by the human who ENGAGED it");
    expect(text).toContain("nothing changed");
    expect(text).not.toContain("only that member may rename or park it");
  });

  it("an unknown handle never reaches the route, and lists the room's agents", async () => {
    const updateChannelAgent = vi.fn();
    const res = await opDisengageAgent(
      stubClient({ updateChannelAgent }),
      "general",
      "topaz",
    );

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("No agent `topaz` in this channel");
    expect(updateChannelAgent).not.toHaveBeenCalled();
  });

  it("NEUTRALIZES the handle it renders — a disengage names a peer's agent", async () => {
    const forged = { ...ONYX, name: FORGERY };
    const client = stubClient({
      listChannelAgents: vi.fn(async () => [forged]),
      updateChannelAgent: vi.fn(async () => forged),
    });

    const text = await textOf(opDisengageAgent(client, "general", "agent-2"));

    expectContained(text);
    expectNoForgedStructure(text);
    expect(text).toContain("`agent-2`");
  });
});
