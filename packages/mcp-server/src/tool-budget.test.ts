/**
 * THE TOKEN BUDGET FOR THIS SURFACE — the gate that stops the prose growing back
 * (T82 / T10, 2026-09-02).
 *
 * ⚠ WHY IT IS A TEST AND NOT A CONVENTION. Every sentence that made this surface
 * expensive was an HONEST one: a rule somebody had been bitten by, written down
 * where the next agent would read it. Nothing about "keep it short" survives
 * that pressure, because each individual addition is defensible. A number does.
 *
 * ⚠ TWO BUDGETS, AND THEY ARE PAID BY DIFFERENT PEOPLE.
 *   1. DESCRIPTIONS are PUSHED. Every connected client pays for every tool's
 *      description on every connection, including the sessions that never call
 *      that tool — so this cost is borne by agents doing unrelated work.
 *   2. WRITE RESULTS are PULLED, but on the hottest path there is: an
 *      orchestrator's check-in loop is post/launch/read, and a measured run
 *      spent ~25 write results × ~3k chars ≈ 70k characters re-reading standing
 *      doctrine. {@link WRITE_RESULT_MAX_CHARS} is the spec's own acceptance
 *      line.
 *
 * ⚠ MEASURED AS **SERVED**, THROUGH A REAL `Client.listTools()` over a real
 * transport — not by reading the constants. The registrar injects a `workspace`
 * argument into every domain tool's schema and the SDK renders the JSON Schema,
 * so a description measured at its source is not the string an agent receives.
 * Same boot shape as `strict-args.test.ts`, for the same reason.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { DoplClient, WorkspaceListItem } from "@dopl/client";
import { createServer } from "./server.js";
import { DESCRIPTION_MAX_CHARS } from "./tools/channel-description.js";
import { WRITE_RESULT_MAX_CHARS } from "./tools/channel-facts.js";
import { opPost } from "./tools/channel-ops-write.js";
import { opCreateThread } from "./tools/channel-ops-threads.js";
import { opLaunchAgent } from "./tools/channel-ops-launch.js";
import { opDirectAgent } from "./tools/channel-ops-direct.js";
import { opEscalate } from "./tools/channel-ops-escalate.js";

/**
 * ⚠ THE RATCHET, AND IT IS NOT AN EXEMPTION LIST. Seven descriptions do not fit
 * {@link DESCRIPTION_MAX_CHARS} today, and each is at its smallest HONEST size:
 * what remains in them is a headline, one line per op, the tenancy wording the
 * P3 tier owns (`p3/mcp-tenancy-naming`), and the security / preview sentences
 * `tool-scope-claims.test.ts` pins by phrase. Getting them under the cap means
 * deleting one of those, which is a DECISION somebody has to take rather than a
 * trim. (⚠ This said "Six" over a table of seven until 2026-09-02 — count the
 * keys, do not quote the prose.)
 *
 * So the number below is a CEILING THAT ONLY EVER MOVES DOWN. Each entry fails
 * the moment its description grows, which is the regression this file exists to
 * catch; lowering one as ops are trimmed is the intended edit. ⚠ ADDING A NAME
 * HERE IS NOT A FIX — it is how a budget stops being a budget. Measured
 * 2026-09-02; re-derive with this suite rather than trusting the numbers.
 *
 * ── ⚠ THE ONE TIME A CEILING WENT UP, AND WHAT IT COST TO SAY SO ────────────
 *
 * **2026-09-02, the integration of the orchestrator-surface and tenancy tiers:
 * three of these rose, and the other two tools that broke the cap did NOT get an
 * entry.** The rule that separated them is the four-things rule in
 * `channel-description.ts`: a description may carry what the tool is, the SECURITY
 * sentence, the OPS named and glossed, and the arguments that are not
 * self-describing from their own `.describe()`.
 *
 *   • `current_workspace` (1,312) and `dopl_status` (1,525) grew on prose that
 *     RESTATED their own schema descriptions — the `since` cursor, which of
 *     "set"/"clear" does what, that a home-channel container is a legal target.
 *     A description and its arg descriptions are BOTH pushed on every
 *     connection, so that is the same fact paid for twice. Both were trimmed and
 *     both now fit 1,200 with no name added here.
 *   • `dopl_kb`, `dopl_agent` and `dopl_channel` grew on NEW OPS —
 *     "copy_base"/"pin"/"unpin", "copy", and "set_agent_mode"/"ping"/"pings".
 *     An op a model never sees is an op it cannot pick, and `parity.test.ts`
 *     requires every enum op to appear here as a quoted `"op_name"` with a
 *     bullet `tool-scope-claims.test.ts` then reads. That content cannot leave,
 *     so the ceilings moved to the measured post-trim size — and the trim came
 *     first: `dopl_kb` 3,557 → 3,400 and `dopl_agent` 2,632 → 2,476 by deleting
 *     the halves of the copy/pin bullets that `to_workspace` and `path` already
 *     say. `dopl_channel` had nothing duplicative to give back.
 *
 * ⚠ **A RISE IS A DECISION AND IT IS RECORDED HERE, NOT ABSORBED.** The honest
 * next move for the three is the one `dopl_channel` already made for its LAW: a
 * pulled doctrine resource per tool (`channel-doctrine.ts`, `resources.ts`), so
 * the op glosses stop being pushed to clients that never call them.
 */
const OVER_BUDGET_CEILINGS: Record<string, number> = {
  // ⚠ +931 ON 2026-09-02 for three new ops — "copy_base", "pin", "unpin" — after
  // the copy/pin bullets gave back what `to_workspace` and `path` already say.
  // ⚠ 3,400 → 3,399 ON 2026-09-02: R2 reworded the `copy_base` bullet from "a
  // base you can READ" to "a base YOU CREATED", one character shorter. Caught by
  // the downward half of the ratchet the same day it was repaired.
  // ⚠ 3,399 → 3,387 ON 2026-09-02: A8 took the TEAM AXIS off the `list_bases`
  // bullet. The FILTER is still disclosed ("no grant on", pinned by
  // `tool-scope-claims.test.ts`) — what left is the dead axis naming it.
  dopl_kb: 3387,
  // ⚠ 1,197 OF THIS IS THE P1 SUMMARY AND THE REST IS **ONE PARAGRAPH THE P3
  // TENANCY TIER ASKED TO KEEP WORD FOR WORD** — `channel-description.ts ›
  // HOME_CHANNEL_ADDRESSING`, ~650 chars on how a home channel is addressed,
  // discovered and tenanted. Each of its three facts was a measured misread in
  // the orchestration run this work came out of. It is interpolated by
  // REFERENCE precisely so it stays a decision somebody takes rather than a
  // sentence whoever is counting characters trims. Was 34,904.
  // ⚠ +116 ON 2026-09-02: three op NAMES in the ops line — "set_agent_mode",
  // "ping", "pings" — with two five-word glosses. Nothing here duplicated
  // anything, so nothing was traded for them.
  // ⚠ 1,781 → 1,775 ON 2026-09-02: the `seq` sentence said "workspace-global"
  // where `design/status.ts` and INVARIANTS §5 (F-412) say TABLE-WIDE, and the
  // correct word is six characters shorter. Caught by the downward half of the
  // ratchet, which is what that half is for.
  dopl_channel: 1775,
  dopl_ontology: 2321,
  // ⚠ +383 ON 2026-09-02 for op="copy", after its bullet gave back the sentences
  // `copy-target.ts › TO_WORKSPACE_ARG_DESCRIPTION` already carries.
  // ⚠ 2,476 → 2,467 ON 2026-09-02: A8 took the TEAM AXIS off the `list` bullet
  // and out of the `visibility` arg (which is a THIRD enum arm gone from the
  // schema too, and that is not counted here). The filter disclosure stayed.
  dopl_agent: 2467,
  dopl_chats: 1701,
  dopl_skill: 1615,
  dopl_members: 1535,
};

const WS: WorkspaceListItem = {
  id: "11111111-1111-1111-1111-111111111111",
  ownerId: "owner",
  name: "Alpha",
  slug: "alpha",
  publicId: "pub-1",
  description: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  role: "owner",
};

/** Enough of the client for registration. ⚠ No handler runs on this path. */
function stubClient(): DoplClient {
  return {
    listWorkspaces: vi.fn().mockResolvedValue({ workspaces: [WS] }),
    getWorkspaceId: vi.fn(() => null),
    setWorkspaceId: vi.fn(),
    listChannels: vi.fn().mockResolvedValue([]),
    listKbBases: vi.fn().mockResolvedValue([]),
    listSkills: vi.fn().mockResolvedValue([]),
    getOntology: vi.fn().mockResolvedValue({ clusters: [], objects: {} }),
  } as unknown as DoplClient;
}

let client: Client;
let listed: Awaited<ReturnType<Client["listTools"]>>;

beforeAll(async () => {
  const server = createServer(stubClient(), {
    directory: [WS],
    workspace: WS,
    role: "owner",
    workspaceSource: "sole membership",
    scopes: ["dopl.read", "dopl.write"],
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "budget-probe", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  listed = await client.listTools();
});

afterAll(async () => {
  await client?.close();
});

describe("every tool description fits its budget, as served", () => {
  it("registers the tools at all (a scan over nothing is not a guard)", () => {
    expect(listed.tools.length).toBeGreaterThan(5);
    expect(listed.tools.map((t) => t.name)).toContain("dopl_channel");
  });

  it(`no description exceeds ${DESCRIPTION_MAX_CHARS} chars, except the ratcheted ${Object.keys(OVER_BUDGET_CEILINGS).length}`, () => {
    const over = listed.tools
      .map((t) => ({ name: t.name, len: (t.description ?? "").length }))
      .filter(({ name, len }) => len > (OVER_BUDGET_CEILINGS[name] ?? DESCRIPTION_MAX_CHARS))
      .map(
        ({ name, len }) =>
          `${name}: ${len} chars (budget ${OVER_BUDGET_CEILINGS[name] ?? DESCRIPTION_MAX_CHARS})`,
      );
    expect(
      over,
      `a tool description grew past its budget. Move standing doctrine into an MCP resource (see channel-doctrine.ts) rather than raising the number:\n- ${over.join("\n- ")}`,
    ).toEqual([]);
  });

  it("the ratchet only ever moves DOWN — a shrunk description must lower its ceiling", () => {
    // ⚠ THE OTHER HALF OF A RATCHET. Without it a description trimmed below its
    // ceiling keeps the old number and silently regains the headroom somebody
    // just spent effort removing.
    //
    // ⚠ **IT COMPARES AGAINST THE CEILING, NOT AGAINST THE CAP, AND THAT WAS THE
    // BUG (2026-09-02).** It used to read `len <= Math.min(ceiling,
    // DESCRIPTION_MAX_CHARS)` — and since every one of these ceilings is ABOVE
    // the cap, `Math.min` collapsed to the cap for all of them. So the condition
    // was "does an over-budget description now fit the budget", which is exactly
    // what the case above already fails on. Every shrink in between — the whole
    // range this half exists to police — passed silently, and the case reported
    // green while asserting nothing.
    const byName = new Map(
      listed.tools.map((t) => [t.name, (t.description ?? "").length]),
    );
    const stale = Object.entries(OVER_BUDGET_CEILINGS)
      .filter(([name, ceiling]) => {
        const len = byName.get(name);
        return len !== undefined && len < ceiling;
      })
      .map(([name, ceiling]) => `${name}: ${byName.get(name)} chars, ceiling ${ceiling}`);
    expect(
      stale,
      `these shrank below their ceiling — lower it to the measured size, or (at or under ${DESCRIPTION_MAX_CHARS}) delete the entry so the cap enforces itself:\n- ${stale.join("\n- ")}`,
    ).toEqual([]);
  });

  it("`dopl_channel` POINTS at the doctrine instead of carrying it", () => {
    // ⚠ THE HEADLINE MEASUREMENT OF THIS TIER. It was 34,904 chars — half the
    // whole surface — because it carried the law, the model, the await protocol
    // and a paragraph per op. Those are the `dopl://doctrine/channels` resource
    // now, pulled on demand, and this is the assertion that keeps them there.
    const channel = listed.tools.find((t) => t.name === "dopl_channel");
    const description = channel?.description ?? "";
    expect(description.length).toBeLessThanOrEqual(OVER_BUDGET_CEILINGS.dopl_channel);
    expect(description).toContain('op="help"');
    expect(description).toContain("dopl://doctrine/channels");
    // ⚠ THE LAW IS NOT INLINED ANY MORE. This is the assertion that stops 35k of
    // prose growing back one honest sentence at a time.
    expect(description).not.toContain("THE LAW OF THIS ROOM");
  });
});

/**
 * ⚠ THE REPRESENTATIVE INPUT IS THE WORST ORDINARY ONE, not the smallest. Every
 * optional field is populated and both id-shaped values are full UUIDs, because
 * a cap proved against a bare success says nothing about the result an
 * orchestrator actually receives.
 */
const CHANNEL_ID = "22222222-2222-2222-2222-222222222222";
const THREAD_ID = "33333333-3333-3333-3333-333333333333";
const MESSAGE_ID = "44444444-4444-4444-4444-444444444444";

function writeClient(overrides: Record<string, unknown> = {}): DoplClient {
  return {
    listChannels: vi.fn(async () => [
      { id: CHANNEL_ID, name: "General", slug: "general", isDirect: false },
    ]),
    listWorkspaceMembers: vi.fn(async () => [
      {
        userId: "u-peer",
        displayName: "Diana Taylor",
        email: "diana@example.com",
        status: "active",
      },
    ]),
    postChannelMessage: vi.fn(async () => ({
      id: MESSAGE_ID,
      seq: 858,
      kind: "message",
      authorUserId: "u-me",
      metadata: { taskId: THREAD_ID, mentionedUserIds: [] },
    })),
    ...overrides,
  } as unknown as DoplClient;
}

/** The text of a `ToolResponse`, joined the way a client reads it. */
function textOf(res: { content: Array<{ type: string; text?: string }> }): string {
  return res.content.map((c) => c.text ?? "").join("\n");
}

describe(`every write result is one line and fits ${WRITE_RESULT_MAX_CHARS} chars`, () => {
  it("post — the fullest ordinary shape: threaded, addressed, a tag and a wake", async () => {
    const res = await opPost(
      writeClient(),
      CHANNEL_ID,
      "@diana please review, @agent-x2sz1ztt carry on with the audit",
      {
        to: "diana@example.com",
        thread: THREAD_ID,
        summary: "review request",
        runtime: null,
      },
    );
    const text = textOf(res as never);
    expect(text.split("\n")).toHaveLength(1);
    expect(text.length, `post result: ${text.length} chars — ${text}`).toBeLessThanOrEqual(
      WRITE_RESULT_MAX_CHARS,
    );
    // ⚠ THE FACTS THAT MAY NOT BE TRADED FOR BREVITY. `seq` is the cursor the
    // next call needs; `tags=0/1` is the ONLY signal in the product that catches
    // a misspelled handle (INVARIANTS §10); `wake=` says which agent the body
    // named, which the tag fraction deliberately does not count.
    expect(text).toContain("seq=858");
    expect(text).toContain("tags=0/1");
    expect(text).toContain("wake=@agent-x2sz1ztt");
    expect(text).toContain("addressed=yes");
    expect(text).toContain("landed=thread");
  });

  it("post — unaddressed and unthreaded says so in two tokens, not two paragraphs (T12)", async () => {
    const res = await opPost(
      writeClient({
        postChannelMessage: vi.fn(async () => ({
          id: MESSAGE_ID,
          seq: 859,
          kind: "message",
          authorUserId: "u-me",
          metadata: {},
        })),
      }),
      CHANNEL_ID,
      "a remark for the room",
      { runtime: null },
    );
    const text = textOf(res as never);
    expect(text.length).toBeLessThanOrEqual(WRITE_RESULT_MAX_CHARS);
    expect(text).toContain("addressed=no");
    expect(text).toContain("landed=room");
    // ⚠ THE PARAGRAPHS ARE GONE AND MUST STAY GONE. Each of these phrases opened
    // one of the standing notes this tier moved into the doctrine.
    expect(text).not.toContain("NOT ADDRESSED");
    expect(text).not.toContain("Expecting a reply?");
    expect(text).not.toContain("POSTED TO THE ROOM ITSELF");
  });

  it("post — a thread tag the server DROPPED is still reported (the silent failure)", async () => {
    const res = await opPost(
      writeClient({
        postChannelMessage: vi.fn(async () => ({
          id: MESSAGE_ID,
          seq: 860,
          kind: "message",
          authorUserId: "u-me",
          metadata: {},
        })),
      }),
      CHANNEL_ID,
      "continuing the audit",
      { thread: THREAD_ID, runtime: null },
    );
    const text = textOf(res as never);
    expect(text.length).toBeLessThanOrEqual(WRITE_RESULT_MAX_CHARS);
    expect(text).toContain("landed=dropped");
  });

  it("milestone and escalate open on their OWN verb, not on `posted`", async () => {
    const milestone = textOf(
      (await opPost(writeClient(), CHANNEL_ID, "step one landed", {
        kind: "task_progress",
        thread: THREAD_ID,
        resultHead: "milestone",
        runtime: null,
      })) as never,
    );
    expect(milestone.startsWith("milestone ")).toBe(true);
    expect(milestone.length).toBeLessThanOrEqual(WRITE_RESULT_MAX_CHARS);

    const escalated = textOf(
      (await opEscalate(
        writeClient(),
        CHANNEL_ID,
        {
          issue: "Ship the migration tonight or hold it?",
          context: "@samuel the rollback window closes at 02:00.",
          options: [
            { label: "Ship tonight", consequence: "No rollback window." },
            { label: "Hold to Monday", consequence: "Two days of drift." },
          ],
          recommendation: { index: 1, why: "The drift is recoverable." },
        },
        { thread: THREAD_ID, runtime: null },
      )) as never,
    );
    expect(escalated.split("\n")).toHaveLength(1);
    expect(escalated.startsWith("escalated ")).toBe(true);
    expect(escalated).toContain("options=2");
    expect(escalated).toContain("recommended=1");
    expect(escalated.length).toBeLessThanOrEqual(WRITE_RESULT_MAX_CHARS);
  });

  it("create_thread returns the id, the opening cursor and nothing else", async () => {
    const res = await opCreateThread(
      writeClient({
        createChannelThread: vi.fn(async () => ({
          thread: { id: THREAD_ID, title: "Deploy check", mode: "interactive" },
          openingSeq: 861,
        })),
      }),
      CHANNEL_ID,
      "Deploy check",
      "Please verify the migration.",
      "diana@example.com",
    );
    const text = textOf(res as never);
    expect(text.split("\n")).toHaveLength(1);
    expect(text.length, text).toBeLessThanOrEqual(WRITE_RESULT_MAX_CHARS);
    expect(text).toContain(`thread=${THREAD_ID}`);
    expect(text).toContain("await=since:861");
    expect(text).not.toContain("Now WATCH FOR THE REPLY");
  });

  it("launch_agent reports the handle, the identity and whether it is running", async () => {
    const res = await opLaunchAgent(
      writeClient({
        createLaunchDirective: vi.fn(async () => ({
          offline: false,
          directive: {
            id: "55555555-5555-5555-5555-555555555555",
            status: "launched",
            agentId: "x2sz1ztt",
            threadId: THREAD_ID,
            templateName: "Code Auditor",
            model: "claude-opus-5",
            refusalReason: null,
            expiresAt: "2026-09-02T00:00:00Z",
          },
        })),
      }),
      CHANNEL_ID,
      { thread: THREAD_ID, goal: "Audit the migration and post a milestone." },
    );
    const text = textOf(res as never);
    expect(text.split("\n")).toHaveLength(1);
    expect(text.length, text).toBeLessThanOrEqual(WRITE_RESULT_MAX_CHARS);
    expect(text).toContain("agent=@agent-x2sz1ztt");
    // ⚠ `idle=no` MEANS IT IS WORKING ON THE GOAL. The opposite outcome — an
    // agent registered and running nothing — is what an orchestrator waits
    // forever on, so the two may never render the same.
    expect(text).toContain("idle=no");
    expect(text).not.toContain("THREE LIMITS");
  });

  it("direct_agent's fact line fits — the agent's REPLY is payload and rides under it", async () => {
    const res = await opDirectAgent(
      writeClient({
        createAgentDirection: vi.fn(async () => ({
          offline: false,
          direction: {
            id: "66666666-6666-6666-6666-666666666666",
            agentId: "x2sz1ztt",
            status: "delivered",
            reply: "Audit done: three findings, all in the migration guard.",
            refusalReason: null,
            expiresAt: "2026-09-02T00:00:00Z",
          },
        })),
      }),
      CHANNEL_ID,
      "@agent-x2sz1ztt",
      "Where are you on the audit?",
    );
    const text = textOf(res as never);
    const [head] = text.split("\n");
    // ⚠ THE CAP IS OVER THE FACT LINE, NOT THE WHOLE RESULT, and deliberately: a
    // direction's REPLY is the value of the call and exists on no other surface
    // (`read`/`await` never show one), so clipping it would delete the feature.
    expect(head.length, head).toBeLessThanOrEqual(WRITE_RESULT_MAX_CHARS);
    expect(head).toContain("reply=below");
    expect(text).toContain("Audit done: three findings");
    expect(text).not.toContain("THAT IS THE FINAL TEXT OF ONE TURN");
  });
});
