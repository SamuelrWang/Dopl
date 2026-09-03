/**
 * THE WRITE-RESULT BUDGET — the second of the two token budgets this package
 * gates, and the one paid by a DIFFERENT population (T82 / T10, 2026-09-02).
 *
 * ⚠ WHY IT IS NOT IN `tool-budget.test.ts`. That file gates the CONNECTION
 * surface: everything an external client is pushed once, at handshake —
 * descriptions, input schemas, `instructions` — plus the doctrine it may pull.
 * These cases gate what a caller is handed back PER CALL, which is a different
 * cost with a different payer, measured by calling the op functions directly
 * rather than by booting a server. Splitting on that seam is also what keeps
 * both files under the §1 500-line cap (F-415).
 *
 * ⚠ WRITE RESULTS ARE PULLED, BUT ON THE HOTTEST PATH THERE IS: an
 * orchestrator's check-in loop is post/launch/read, and a measured run spent
 * ~25 write results × ~3k chars ≈ 70k characters re-reading standing doctrine.
 * {@link WRITE_RESULT_MAX_CHARS} is the spec's own acceptance line.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient } from "@dopl/client";
import { WRITE_RESULT_MAX_CHARS } from "./tools/channel-facts.js";
import { opPost } from "./tools/channel-ops-write.js";
import { opCreateThread } from "./tools/channel-ops-threads.js";
import { opLaunchAgent } from "./tools/channel-ops-launch.js";
import { opDirectAgent } from "./tools/channel-ops-direct.js";
import { opEscalate } from "./tools/channel-ops-escalate.js";

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
  it("send — the fullest ordinary shape: threaded, addressed, a tag and a wake", async () => {
    const res = await opPost(
      // ⚠ THE STORED RECIPIENT SET, BECAUSE `addressed=` IS READ OFF THE ROW NOW
      // (B8). `to` is a union resolved SERVER-side, so the argument alone no
      // longer decides the fact — a stub that omits what the server wrote
      // reports `addressed=no` over a call that addressed somebody.
      writeClient({
        postChannelMessage: vi.fn(async () => ({
          id: MESSAGE_ID,
          seq: 858,
          kind: "message",
          authorUserId: "u-me",
          metadata: { taskId: THREAD_ID, mentionedUserIds: [] },
          recipientUserIds: ["u-peer"],
        })),
      }),
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

  it("send — unaddressed and unthreaded says so in two tokens, not two paragraphs (T12)", async () => {
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

  it("send — a thread tag the server DROPPED is still reported (the silent failure)", async () => {
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

  it('kind="milestone" and kind="decision" open on their OWN verb, not on `posted`', async () => {
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

  it('send thread="new" returns the id, the opening cursor and nothing else', async () => {
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
    expect(text).toContain("hold=since:861");
    expect(text).not.toContain("Now WATCH FOR THE REPLY");
  });

  it('manage(action="launch") reports the handle, the identity and whether it is running', async () => {
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

  it('manage(action="direct")\'s fact line fits — the agent\'s REPLY is payload and rides under it', async () => {
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
