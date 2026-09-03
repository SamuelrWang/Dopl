/**
 * THE READ/HOLD-RESULT BUDGET — the third per-call budget this package gates,
 * beside `write-result-budget.test.ts` (Samuel's ruling, 2026-09-03).
 *
 * ⚠ **WHY THE HOLD NEEDED ITS OWN NUMBER, AND WHY IT NEEDED IT MOST.** The
 * write budget is paid once per message sent. The HOLD result is paid by an
 * orchestrator sitting on a quiet exchange, every ~45s, forever, and it is the
 * one result that carries the LEAST news — "nothing arrived" — while it carried
 * the MOST prose. Measured on this tree at `1fcf044f`, with `ref="general"`:
 *
 *   | result                        | before | after |
 *   |-------------------------------|--------|-------|
 *   | hold, messages ARRIVED        |  1,599 |   134 |
 *   | hold, TIMED OUT               |    644 |   131 |
 *   | workspace hold, TIMED OUT     |    656 |   112 |
 *   | plain read, page returned     |    118 |   132 |
 *
 * (Guidance characters only — the message bodies and the session block are the
 * answer and are not counted.) The ~1,400 that left the arrived branch is now
 * `dopl://doctrine/channels › waiting`, PULLED once instead of pushed per hold.
 *
 * ⚠ **THE PLAIN READ WENT UP BY FOURTEEN AND THAT IS THE TRADE, STATED.** It
 * used to say "Highest seq shown: N. Watch for newer messages with …"; it now
 * leads with `cursor=N` as a liftable token and names the rule it is following.
 * Fourteen characters onto a page that is read ONCE, to buy the same wording on
 * every surface that hands a cursor back — a caller that learns to lift
 * `cursor=` off a hold lifts it off a read too.
 *
 * ⚠ **A REF IS CALLER-SUPPLIED AND UNBOUNDED**, so {@link WAITING_LINE_MAX_CHARS}
 * bounds what the SERVER writes around it, never the spliced value — the same
 * distinction `channel-facts.ts` draws between a bounded field and a bounded
 * line. Every case here uses a representative ref and says so.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient } from "@dopl/client";
import { opHold } from "./channel-ops-hold";
import { opHoldWorkspace } from "./channel-ops-hold-workspace";
import { opRead } from "./channel-ops-read";
import { DOCTRINE_URI } from "./channel-doctrine";
import {
  channelHoldCall,
  waitingLine,
  workspaceHoldCall,
  WAITING_LINE_MAX_CHARS,
} from "./channel-wake-guidance";

/** A representative channel ref — a slug, which is what these results splice. */
const REF = "general";

const textOf = (r: { content: Array<{ text: string }> }) => r.content[0].text;

/**
 * ⚠ THE GUIDANCE, NOT THE ANSWER. Every case measures the lines this package
 * WROTE, with the rendered messages and the session block removed: a budget
 * that counted the counterparty's bodies would tighten every time somebody sent
 * a long message and would say nothing about the prose it exists to bound.
 */
function guidanceOf(text: string): string {
  return text
    .split("\n")
    .filter((l) => l.startsWith("cursor=") || l.startsWith("reason="))
    .join("\n");
}

describe("the waiting line is ONE line, and it is budgeted", () => {
  it(`fits ${WAITING_LINE_MAX_CHARS} chars at a representative ref`, () => {
    const line = waitingLine(channelHoldCall(REF, 4_294_967_295), 4_294_967_295);
    // ⚠ A 10-DIGIT CURSOR, not `7`. `seq` is a table-wide BIGINT identity, so a
    // budget proved at a one-digit seq is a budget proved against nothing.
    expect(line.length, line).toBeLessThanOrEqual(WAITING_LINE_MAX_CHARS);
    // ⚠ RATCHET, BOTH WAYS: shrinking below the number without lowering it is
    // how a win stops being banked.
    expect(
      line.length,
      "it shrank — lower WAITING_LINE_MAX_CHARS to the measured size in the same commit",
    ).toBeGreaterThan(WAITING_LINE_MAX_CHARS - 40);
  });

  it("leads with the cursor as a bare token, and ends at the doctrine", () => {
    // ⚠ THE ORDER IS THE CONTRACT. An orchestrator reading this in a loop needs
    // ONE thing off it — the cursor — and must be able to lift it without
    // parsing prose. The pointer is last because it is the part a caller reads
    // once and then never again.
    const line = waitingLine(workspaceHoldCall(42), 42);
    expect(line.startsWith("cursor=42 ")).toBe(true);
    expect(line.endsWith(`${DOCTRINE_URI} › Waiting`)).toBe(true);
    expect(line).toContain("hold, never poll");
  });
});

function holdClient(messages: unknown[] = []): DoplClient {
  return {
    awaitChannelMessages: vi.fn(async () => {
      // ⚠ Same reason as the workspace case: an instant poll on a long ask is
      // the CUT SHORT branch, not the timeout one.
      if (messages.length === 0) await new Promise((r) => setTimeout(r, 30));
      return { messages, timedOut: messages.length === 0 };
    }),
  } as unknown as DoplClient;
}

describe("a HOLD result spends one line on waiting, whichever way it ends", () => {
  it("timed out: 131 chars of guidance where it used to be 644", async () => {
    const text = textOf(await opHold(holdClient(), REF, 7, 40, "u-me"));
    const guidance = guidanceOf(text);
    expect(guidance.length, guidance).toBeLessThanOrEqual(WAITING_LINE_MAX_CHARS);
    // ⚠ PINNED AS ABSENCES — every paragraph that left, named, so a future
    // "helpful" addition has to delete an assertion to put one back.
    expect(text).not.toContain("Keep re-arming while");
    expect(text).not.toContain("RETURNS INSIDE your current turn");
    expect(text).not.toContain("background shell tasks");
  });

  it("messages arrived: 134 chars where it used to be 1,599", async () => {
    const text = textOf(
      await opHold(
        holdClient([
          {
            id: "m-1",
            seq: 42,
            kind: "message",
            body: "done",
            authorUserId: "u-peer",
            createdAt: "2026-07-31T00:00:00Z",
            metadata: {},
          },
        ]),
        REF,
        7,
        1,
        "u-me",
      ),
    );
    const guidance = guidanceOf(text);
    expect(guidance.length, guidance).toBeLessThanOrEqual(WAITING_LINE_MAX_CHARS);
    // ⚠ THE BODY IS STILL THERE — this is a budget on the PROSE, never on the
    // answer, and a suite that could not tell the two apart would pass while
    // the feature stopped working.
    expect(text).toContain("done");
    expect(text).toContain("cursor=42");
  });

  it("the WORKSPACE hold's timeout is bounded the same way", async () => {
    // ⚠ THE INNER POLL SLEEPS, AND IT HAS TO — a hold that returns far under
    // its ask lands in the CUT SHORT branch, which is a different result with a
    // different (deliberately longer) warning. Elapsed must clear half the ask.
    const client = {
      awaitWorkspaceMessages: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 30));
        return { messages: [], timedOut: true, channelCount: 2 };
      }),
    } as unknown as DoplClient;
    const text = textOf(await opHoldWorkspace(client, 5, 40, "u-me"));
    expect(guidanceOf(text).length).toBeLessThanOrEqual(WAITING_LINE_MAX_CHARS);
    // ⚠ The SCOPE note is a fact about what was watched, not doctrine, and it
    // stays: "no messages" and "that room was never watched" are different
    // answers.
    expect(text).toContain("Scope: every channel you are a MEMBER of");
  });
});

describe("a plain READ spends one line on it too", () => {
  it("names the cursor and the rule, and nothing else", async () => {
    const client = {
      readChannelMessages: vi.fn(async () => [
        {
          id: "m-1",
          seq: 4,
          kind: "message",
          body: "hello",
          authorUserId: "u-peer",
          createdAt: "2026-07-31T00:00:00Z",
          metadata: {},
        },
      ]),
    } as unknown as DoplClient;
    const text = textOf(await opRead(client, REF, undefined, undefined, "u-me"));
    expect(guidanceOf(text).length).toBeLessThanOrEqual(WAITING_LINE_MAX_CHARS);
    expect(text).toContain("hello");
    // ⚠ The old "Highest seq shown: N" is gone: `cursor=N` is the same fact in
    // the shape every other result on this surface hands a cursor back.
    expect(text).not.toContain("Highest seq shown");
  });
});
