/**
 * THE LAW — the multiplayer contract every agent reads on every connection.
 *
 * THIS FILE PINS PROSE, NOT BEHAVIOUR. Every assertion below is a string match
 * on `CHANNEL_DESCRIPTION`; not one of them executes a handler, reaches a
 * route, or observes what the desktop listener actually does with a message.
 * It can only ever catch an edit that changes the WORDS. Whether the words are
 * TRUE is checked against the code that owns each fact — `classify` in
 * `dopl-desktop-app/main/targeting.js` for what wakes whom, `mayWriteThread` in
 * `src/features/channels/server/service-writes-metadata.ts` for who may post
 * into a thread — and this suite is worthless against a change on that side.
 * The header used to imply otherwise ("the law is not documentation, it is the
 * behaviour"), and a reviewer read the green suite as evidence the escalation
 * promise held. It did not: the promise was false by default for a year of
 * this file passing.
 *
 * What it IS worth: the description is the only thing that tells a summoned
 * agent when to act and when to stay quiet, and a room full of agents that
 * answer everything they can read is the failure this whole feature is built to
 * avoid. So the law's load-bearing sentences are pinned — including the ones
 * that must NOT come back, because the regression is a later edit that softens
 * THE LOOP BRAKE into a suggestion, or that restores an unconditional
 * "addressing a person only notifies them".
 *
 * A STALE LAW IS THE SAME BUG AS A FALSE ONE, and this file has now been on
 * three sides of it. It pinned "NOTHING ACTS UNLESS ADDRESSED"; ENGAGEMENT
 * shipped and that sentence described a product that no longer existed. So it
 * pinned engagement, multi-address, `as_agent` and the one-opener thread
 * handshake instead — and the channels rollback (§1, 2026-08-05) deleted every
 * one of those, which would have left this suite green over a law teaching
 * agents to call ops that no longer exist. What is pinned now is what actually
 * remains: chat vs. request, addressing a PERSON, the loop brake, and the
 * two-party thread. The removed vocabulary is pinned as an ABSENCE below, which
 * is the half that catches a resurrection.
 *
 * Captured through the real registrar with a recording `register` and a stub
 * client (registration is all this needs — no handler ever runs).
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, it, expect } from "vitest";
import type { DoplClient } from "@dopl/client";
import type { RegisterTool } from "./respond";
import { registerChannelTool } from "./channel";

function description(): string {
  let text = "";
  const cap: RegisterTool = ((name: string, d: string) => {
    if (name === "dopl_channel") text = d;
  }) as RegisterTool;
  registerChannelTool(cap, {} as DoplClient);
  if (!text) throw new Error("dopl_channel was not registered");
  return text;
}

const DESCRIPTION = description();

/**
 * THE SECOND GUARD IS AN ABSENCE, and it is the stronger form of what it
 * replaced.
 *
 * It used to be a truth guard: any sentence asserting that ENGAGEMENT happens
 * had to name the HUMAN it depended on, because `recordAgentEngagement` opened
 * with `if (ctx.source === "agent") return;` and every post through this tool
 * is agent-credentialed — so "address it by handle again, that re-engages it"
 * (shipped until 2026-07-31) promised the reader an outcome the reader could
 * not cause.
 *
 * Engagement is GONE (channels rollback §1), and so is every other named-agent
 * surface. A description that still mentions any of them does not merely
 * mislead about a mechanism; it names ops an MCP client will reject as invalid
 * enum values. So the pin is total: the words must not appear.
 *
 * MODULE SCOPE since F-145, because the DESCRIPTION was never the whole shipped
 * surface — see the source-wide scan at the bottom of this file.
 */
const REMOVED_VOCABULARY: ReadonlyArray<[string, RegExp]> = [
  ["engagement", /\bengage/i],
  ["summoning", /\bsummon/i],
  ["to_agent / to_agents", /to_agents?\b/],
  ["as_agent", /as_agent/],
  ["breakout rooms", /breakout|participant set|\bparticipants\b/i],
  ["the thread-open handshake", /thread-open-|handshake/i],
  ["the agent lifecycle ops", /rename_agent|set_agent_status|disengage_agent|join_thread|leave_thread/],
  ["the agents roster op", /op="agents"/],
];

describe("THE LAW is stated, in full, in the tool description", () => {
  it("is the FIRST thing after the opening line — an agent must not have to find it", () => {
    const law = DESCRIPTION.indexOf("THE LAW OF THIS ROOM");
    expect(law).toBeGreaterThan(-1);
    expect(law).toBeLessThan(DESCRIPTION.indexOf("THE MODEL"));
  });

  it("says a channel is a room of PEOPLE", () => {
    expect(DESCRIPTION).toContain("A CHANNEL IS A ROOM OF PEOPLE");
  });

  it("says addressing a PERSON is what asks for their machine", () => {
    // WHAT THIS REPLACED. The law used to open "NOTHING ACTS UNLESS ADDRESSED",
    // then — once ENGAGEMENT shipped — "ADDRESS AN AGENT BY HANDLE TO START IT".
    // Both are gone: there is no handle to address (channels rollback §1), and
    // the only address a post carries is a member. The receiving side decides
    // what runs, which is what makes "you cannot start somebody else's agent
    // directly" true again.
    expect(DESCRIPTION).toContain("ADDRESSING A PERSON");
    expect(DESCRIPTION).toContain(
      "There is no way to address an agent by name",
    );
  });

  it("says a message is CHAT or REQUEST, and that chat addresses nobody", () => {
    // `intent` (src/features/channels/schema.ts) — `chat` skips the DM
    // auto-address entirely, so two humans can talk in a DM without each line
    // poking the other machine. Without this in the law an agent reads every
    // line of human small talk in a DM as work it was handed.
    expect(DESCRIPTION).toContain("A MESSAGE IS CHAT OR REQUEST");
    expect(DESCRIPTION).toContain(
      'intent="chat" is people talking: it addresses nobody and starts nobody',
    );
  });

  it("keeps THE LOOP BRAKE absolute — agents do not wake each other by talking", () => {
    // `classify` (dopl-desktop-app/main/targeting.js) refuses every unaddressed
    // AGENT author before it looks at anything else, at any member count. It
    // was the property that made ENGAGEMENT safe to grant; engagement is gone
    // and the brake is not, so it is pinned as an absolute and must never
    // acquire a qualifier.
    expect(DESCRIPTION).toContain("THE LOOP BRAKE, AND IT IS ABSOLUTE");
    expect(DESCRIPTION).toContain(
      "an AGENT-authored unaddressed message starts nobody, in a room of two or of ten",
    );
    expect(DESCRIPTION).toContain(
      "Agents do not wake each other by talking, and every post you make is agent-authored",
    );
  });

  it("names the two things to act on, and calls everything else ambient context", () => {
    // IT WAS TWO, THEN THREE, AND IT IS TWO AGAIN. Engagement added a third —
    // the unaddressed messages of the human who engaged you — and went with the
    // named agents (channels rollback §1). Leaving three stated beside a law
    // that no longer has engagement would state the model twice and contradict
    // itself once, which is the stale-law bug this file exists to catch.
    expect(DESCRIPTION).toContain("messages in a THREAD you are a party to");
    expect(DESCRIPTION).toContain("main-room messages addressed to YOU");
    expect(DESCRIPTION).toContain(
      "EVERYTHING ELSE IS AMBIENT CONTEXT — read it, do not answer it",
    );
  });

  it("says to reply where you were asked", () => {
    expect(DESCRIPTION).toContain("REPLY WHERE YOU WERE ASKED");
    expect(DESCRIPTION).toContain("Asked in the main room, answer in the main room");
    expect(DESCRIPTION).toContain("Work traffic stays in its thread");
  });

  /**
   * The law block, sliced between its two anchors. Both length assertions read
   * it, so the slice is written once.
   */
  const LAW = DESCRIPTION.slice(
    DESCRIPTION.indexOf("THE LAW OF THIS ROOM"),
    DESCRIPTION.indexOf("THE MODEL"),
  );

  it("keeps the law to at most 8 BULLETS — one rule per line, no line per rule", () => {
    // NIT-9 — THIS TEST IS NAMED FOR WHAT IT MEASURES NOW. It used to be called
    // "keeps the law SHORT (<=12 non-blank lines)", which is a formatting
    // assertion wearing a semantics assertion's name: every bullet here is a
    // single 140-750 character line, so a bullet could double in length, gain a
    // false clause, or lose a true one and this number would not move. It
    // caught exactly one thing — somebody adding a 13th rule — and that is
    // still worth catching, so it is kept and renamed rather than deleted, with
    // the budget it was silently failing to enforce added beside it.
    //
    // THE CEILING MOVED TWICE: 8 to 12 when the room gained engagement,
    // multi-address and the two-agent handshake, and back to 8 when the
    // channels rollback (§1) took all three away. It is a CEILING rather than a
    // target, and the reason it exists has not changed: this text is read on
    // every connection by every agent, so a rule that is not load-bearing does
    // not go here — it goes in the op bullet that needs it. If a future change
    // wants a 9th line, the question to answer first is which of these eight
    // stopped being a rule.
    //
    // F-111 RESIDUAL (j), CLOSED 2026-08-06. Neither half of this test said
    // what it did. The NAME said 12 while the assertion said 8, and the
    // assertion counted NON-BLANK LINES — which includes the `THE LAW OF THIS
    // ROOM` header, so the real ceiling was one rule lower than the number
    // written next to it (7 bullets, not 8). Both halves are corrected here by
    // measuring the thing the name promises: lines that actually open a bullet,
    // the same `- ` count the budget test below already derives. This is NOT
    // the "raise the number to make room" move that residual warned against —
    // the ceiling is the 8 that was already written down; it is the UNIT that
    // was wrong, and a header is not a rule.
    const bullets = LAW.split("\n").filter((l) => l.trim().startsWith("- "));
    expect(bullets.length).toBeLessThanOrEqual(8);
  });

  it("keeps the law SHORT — the budget the bullet count could not enforce", () => {
    // NIT-9's other half, and the one that actually measures "short". The law
    // is ~1.8k characters today across seven bullets (it was ~3.6k across
    // twelve before the rollback); 2200 is roughly a 20% ceiling on that, in
    // the same spirit as the bullet ceiling above — enough room to sharpen a
    // rule, not enough to grow a new one inside an existing bullet, which is
    // the drift the line count is blind to by construction.
    //
    // A PER-BULLET CAP TOO, because the total alone is game-able the other way:
    // one bullet could swallow another's budget and the sum would not move.
    //
    // If a change needs more than either number, the honest move is the same
    // one the bullet ceiling asks for: say which rule stopped being a rule, or
    // move the detail into the op bullet that needs it — an op bullet is read
    // when the op is called, where THE LAW is read on every connection.
    expect(LAW.length).toBeLessThanOrEqual(2200);
    const bullets = LAW.split("\n").filter((l) => l.trim().startsWith("- "));
    const overlong = bullets.filter((b) => b.length > 900);
    expect(
      overlong.map((b) => `${b.length} chars: ${b.slice(0, 80)}…`),
      "a law bullet grew past its budget — sharpen it, or move the detail into the op bullet that needs it",
    ).toEqual([]);
  });
});

describe("what the law and the ops around it may NOT say", () => {
  /**
   * THE SCAN IS BY SENTENCE, NOT BY LINE. The old guard grepped whole lines for
   * three exact phrases ("spawns/wakes/starts their agent") and walked straight
   * past `"post"`'s "that member's listener is then the only one triggered" —
   * the same claim in the opposite direction, in the same document, one op
   * bullet down. Op bullets are ONE line each and thousands of characters long,
   * so a line-level check also passes the moment `as_agent` appears anywhere in
   * the bullet, which is everywhere. A sentence is the unit that has to be
   * true on its own.
   */
  const sentences = DESCRIPTION.split("\n")
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);

  /** The claim is ABOUT the other side's agent (not about the caller's own). */
  const OTHER_SIDE =
    /their agent|that member's (listener|agent)|their listener|no one's agent|nobody's agent/i;
  /** …and it says that agent RUNS (or is made to run). */
  const STARTS = /\bspawn|\bwake[sn]?\b|\bstarts?\b|\btrigger/i;
  /**
   * …then it must say what the outcome DEPENDS ON, or be an explicit denial.
   *
   * The dependency used to be a param: `as_agent`. WITH it a `to=` post
   * notified and WITHOUT it the same post triggered, so a sentence asserting
   * either half without naming the param was the B1 defect. `as_agent` is gone
   * (channels rollback §1) and the rule is simpler — a `to=` post is a REQUEST
   * and it triggers — but the guard's job is unchanged: an unqualified claim
   * about another member's agent must be one this document actually stands
   * behind. So the qualifier is now the CONDITION under which it holds: the
   * post being addressed, or being a request rather than chat.
   */
  const KEYED =
    /\brequest\b|\baddress|\bunaddressed\b|intent|never (spawns|starts|wakes|triggers)|does not (spawn|start|wake|trigger)|starts no agent|no agent of theirs starts|reaches no one's agent|no one's agent wakes|nobody's agent (wakes|woke)|wakes nobody/i;

  it("never claims something about another member's agent unconditionally", () => {
    const offenders = sentences.filter(
      (s) => OTHER_SIDE.test(s) && STARTS.test(s) && !KEYED.test(s),
    );
    expect(
      offenders,
      `these sentences claim something about another member's agent starting (or not) without saying what it depends on:\n- ${offenders.join("\n- ")}`,
    ).toEqual([]);
  });

  it("the guard has teeth — it catches a bare claim", () => {
    // Regression on the TEST, not on the text. If a future edit makes the
    // matcher lenient, this fails before the description does.
    const bare =
      "Post it and that member's listener is then the only one triggered.";
    expect(
      OTHER_SIDE.test(bare) && STARTS.test(bare) && !KEYED.test(bare),
      "the negative guard would not catch a bare claim",
    ).toBe(true);
  });

  it("never mentions a removed named-agent surface", () => {
    const found = REMOVED_VOCABULARY.filter(([, re]) => re.test(DESCRIPTION)).map(
      ([label]) => label,
    );
    expect(
      found,
      `the description names surfaces that no longer exist: ${found.join(", ")}`,
    ).toEqual([]);
  });

  it("describes a thread as writable by exactly its two parties, with no exception", () => {
    // The pair rule was briefly the DEFAULT rather than the rule: a thread with
    // a participant set was a breakout room whose set superseded it, so a
    // description saying only the first sent an agent away from a thread it was
    // a participant of. Breakout rooms are gone and the pair is the rule again,
    // so the exception must not come back.
    expect(DESCRIPTION).toContain("between exactly TWO parties");
    expect(DESCRIPTION).toContain(
      "Only those two can post into it",
    );
  });
});

describe("the removed ops are absent from the published op set", () => {
  it("the description names none of them", () => {
    for (const op of [
      "agents",
      "summon_agent",
      "rename_agent",
      "set_agent_status",
      "disengage_agent",
      "join_thread",
      "leave_thread",
    ]) {
      expect(DESCRIPTION, `op="${op}" is still documented`).not.toContain(
        `"${op}"`,
      );
    }
  });

  it("still documents the ops that SURVIVED, so the rollback took nothing extra", () => {
    for (const op of [
      "post",
      "milestone",
      "read",
      "await",
      "members",
      "list_threads",
      "get_thread",
      "create_thread",
      "propose_close",
      "set_thread_mode",
    ]) {
      expect(DESCRIPTION, `op="${op}" lost its documentation`).toContain(
        `"${op}"`,
      );
    }
  });
});

/**
 * F-145 — THE SCAN THAT SHOULD HAVE EXISTED: every SHIPPED STRING, not just the
 * description.
 *
 * The guard above reads `CHANNEL_DESCRIPTION` and nothing else, and
 * `channel-discovery.test.ts` reads `buildInstructions` and nothing else. Both
 * were green while `closedThreadNote` — emitted on EVERY post into a closed
 * thread — taught `to_agent="<handle>" starts that agent`, a param deleted in
 * rollback §1. A tool result is read by exactly the same model that reads the
 * description, and it arrives at the moment the agent is deciding what to do
 * next, so it teaches HARDER. Two scopes and neither covered the result lane.
 *
 * SO THE SCAN IS THE WHOLE SURFACE, and it reads the AST rather than the raw
 * text: `ts.createSourceFile` gives back string / template literals only, so a
 * COMMENT may still discuss `to_agent` (this file's own history depends on
 * being able to) while a shipped sentence may not. Every `channel-*.ts` module
 * in this directory is in scope — descriptions, `.describe()` prose, error
 * copy, render helpers and result lines are all the same lane to a reader.
 *
 * WHEN THIS FAILS, THE FIX IS THE WORDS. There is no allowlist on purpose: an
 * exemption is how the closed-thread note survived four phases of the rollback.
 * If a legitimate English sentence collides (the ad-hoc legend's "no recorded
 * parties" was "no participants" until this scan landed), rephrase it — the
 * banned tokens are the removed PRODUCT's vocabulary and an agent cannot tell
 * a descriptive use from an instructive one.
 */
describe("no SHIPPED STRING in the channel tool teaches removed vocabulary", () => {
  // Resolved off `process.cwd()` (the package root under vitest) for the reason
  // `parity.test.ts` states: `import.meta` is disallowed by this package's
  // CommonJS tsc target and `__dirname` is not guaranteed under the
  // ESM-transformed test.
  const HERE = path.resolve(process.cwd(), "src", "tools");

  /** Every non-test `channel-*.ts` module — the tool's whole authored surface. */
  const sources = readdirSync(HERE)
    .filter(
      (f) =>
        (f.startsWith("channel-") || f === "channel.ts") &&
        f.endsWith(".ts") &&
        !f.endsWith(".test.ts"),
    )
    .sort();

  /** Literal TEXT only — comments are not literals, so they are never scanned. */
  function shippedStrings(file: string): Array<{ text: string; line: number }> {
    const source = ts.createSourceFile(
      file,
      readFileSync(path.join(HERE, file), "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const out: Array<{ text: string; line: number }> = [];
    const walk = (node: ts.Node): void => {
      if (
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)
      ) {
        out.push({
          text: node.text,
          line:
            source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        });
      }
      ts.forEachChild(node, walk);
    };
    walk(source);
    return out;
  }

  it("finds the modules at all (a scan over nothing is not a guard)", () => {
    expect(sources.length).toBeGreaterThan(10);
    expect(sources).toContain("channel-post-linkage.ts");
    expect(sources).toContain("channel-ops-write.ts");
    expect(sources).toContain("channel-render-threads.ts");
    // …and it is really reading strings out of them.
    expect(shippedStrings("channel-post-linkage.ts").length).toBeGreaterThan(3);
  });

  it("the scan can SEE the defect it was written for", () => {
    // RED PROOF, inline: the exact sentence that shipped until F-145, run
    // through the same predicate. A scan that cannot fail is not a guard.
    const shipped =
      'to_agent="<handle>" starts that agent, to="<member>" triggers their machine.';
    const hit = REMOVED_VOCABULARY.filter(([, re]) => re.test(shipped));
    expect(hit.map(([label]) => label)).toEqual(["to_agent / to_agents"]);
  });

  for (const file of sources) {
    it(`${file} ships no removed vocabulary`, () => {
      const found: string[] = [];
      for (const { text, line } of shippedStrings(file)) {
        for (const [label, re] of REMOVED_VOCABULARY) {
          if (re.test(text)) {
            found.push(`${file}:${line} [${label}] ${JSON.stringify(text.slice(0, 120))}`);
          }
        }
      }
      expect(
        found,
        `a shipped string teaches a surface that no longer exists:\n${found.join("\n")}`,
      ).toEqual([]);
    });
  }
});
