/**
 * THE LAW — the multiplayer contract every agent reads on every connection.
 *
 * ⚠ THIS FILE PINS PROSE, NOT BEHAVIOUR. Every assertion is a string match on
 * `CHANNEL_DESCRIPTION`; nothing here runs a handler or observes the desktop
 * listener. It catches only WORD edits. Whether the words are TRUE is owned
 * elsewhere — `classify` in `dopl-desktop-app/main/targeting.js` for what wakes
 * whom, `mayWriteThread` in
 * `src/features/channels/server/service-writes-metadata.ts` for who may post
 * into a thread. A green run here is NOT evidence the promise holds.
 *
 * Removed vocabulary is pinned as an ABSENCE below — that half catches a
 * resurrection, and a stale law is the same bug as a false one.
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
 * Named-agent surfaces that no longer exist. ⚠ A description mentioning one
 * does not merely mislead — it names ops an MCP client rejects as invalid enum
 * values, so the pin is total: the words must not appear. Module-scoped because
 * the description is not the whole shipped surface (see the source-wide scan at
 * the bottom of this file).
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
  // ── THREAD CLOSING, removed 2026-08-18 (wiring plan Phase 4) ──────────────
  // No close, no propose-then-confirm, no reopen. The operator pauses or ends an
  // AGENT. ⚠ These are the sharpest entries in this table: a thread's state is
  // exactly what an agent polls and waits on, so a single surviving sentence
  // sends it looking for a transition that can never arrive — and the two op
  // names left the enum, so a description mentioning one names a call the SDK
  // answers with -32602.
  ["the propose_close op", /propose_close/],
  ["the close_thread op", /close_thread/],
  // Verb + THREAD in either order, so "close the thread", "closing a thread",
  // "the thread is closed" and "thread closed" all land. ⚠ Deliberately NOT a
  // bare /clos/: "fail-closed", "the enum is closed" and "closes the window" are
  // live, correct English about other things.
  [
    "closing a thread",
    /\bclos(e|es|ed|ing)\s+(the\s+|a\s+|this\s+|that\s+|its\s+)?thread|\bthread('s)?\s+(is\s+|was\s+|been\s+)?clos(e|ed|ing)/i,
  ],
  // Reopen has no other meaning on this surface — the tool never had an op for
  // reopening anything else.
  ["reopening a thread", /\breopen/i],
  // The reserved marker keys the close machinery stamped. They left the
  // re-stamp list entirely, so a string naming one is naming nothing.
  ["the close-proposal / reopen markers", /closeProposed|closeOutcome|threadReopened/],
  // The thread lifecycle FIELDS `list_threads` / `get_thread` used to render.
  // The columns survive as legacy storage; the surface must not report them,
  // because reporting a state is how an agent learns to wait on it.
  ["thread status / outcome vocabulary", /\bthread('s)?\s+(status|outcome)\b|\boutcome summar(y|ies)\b/i],
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
    // The only address a post carries is a MEMBER; the receiving side decides
    // what runs. That is what makes "you cannot start somebody else's agent
    // directly" true.
    expect(DESCRIPTION).toContain("ADDRESSING A PERSON");
    expect(DESCRIPTION).toContain(
      "There is no way to address an agent by name",
    );
  });

  it("says a message is CHAT or REQUEST, and that chat addresses nobody", () => {
    // `intent` (src/features/channels/schema.ts): `chat` skips the DM
    // auto-address, so humans can talk in a DM without poking the other machine.
    expect(DESCRIPTION).toContain("A MESSAGE IS CHAT OR REQUEST");
    expect(DESCRIPTION).toContain(
      'intent="chat" is people talking: it addresses nobody and starts nobody',
    );
  });

  it("keeps THE LOOP BRAKE absolute — agents do not wake each other by talking", () => {
    // ⚠ `classify` (dopl-desktop-app/main/targeting.js) refuses every
    // unaddressed AGENT author first, at any member count. Pinned as an
    // absolute — must never acquire a qualifier.
    expect(DESCRIPTION).toContain("THE LOOP BRAKE, AND IT IS ABSOLUTE");
    expect(DESCRIPTION).toContain(
      "an AGENT-authored unaddressed message starts nobody, in a room of two or of ten",
    );
    expect(DESCRIPTION).toContain(
      "Agents do not wake each other by talking, and every post you make is agent-authored",
    );
  });

  it("names the two things to act on, and calls everything else ambient context", () => {
    // ⚠ TWO, not three — a third acting-trigger stated beside a law that has no
    // engagement states the model twice and contradicts itself once.
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

  it("grants the main-room post as a SPARSE capability, in the same bullet", () => {
    // ⚠ It rides on "reply where you were asked" because that bullet is what an
    // agent otherwise reads as a BAN (wiring plan Phase 11): "work traffic stays
    // in its thread" with no qualifier says the room is never yours to post to,
    // which stopped being true. Capability first, then the limit — the reverse
    // order reads as a warning and the capability goes unused.
    expect(DESCRIPTION).toContain("You MAY also post to the main room unprompted, SPARSELY");
    expect(DESCRIPTION).toContain("that is a capability, not a habit");
  });

  it("names the @-tag as how a HUMAN is reached, and denies that it addresses", () => {
    // ⚠ Two halves, both load-bearing and neither safe alone. Without the first,
    // an agent that is blocked posts into a thread nobody is watching; without
    // the second, a tag reads as a second way to ASK FOR A MACHINE, which no
    // part of the product honours (`metadata.mentionedUserIds` is not
    // `to_user_id` — INVARIANTS §5).
    expect(DESCRIPTION).toContain("@-TAG THEM IN THE BODY");
    expect(DESCRIPTION).toContain("Tags inbox");
    expect(DESCRIPTION).toContain("Tagging is not addressing and starts no agent");
  });

  /** Law block sliced between its two anchors; both length assertions read it. */
  const LAW = DESCRIPTION.slice(
    DESCRIPTION.indexOf("THE LAW OF THIS ROOM"),
    DESCRIPTION.indexOf("THE MODEL"),
  );

  it("keeps the law to at most 8 BULLETS — one rule per line, no line per rule", () => {
    // ⚠ CEILING, not a target: this text is read on every connection by every
    // agent, so a non-load-bearing rule goes in the op bullet that needs it. A
    // 9th line means answering which of these eight stopped being a rule —
    // never raise the number to make room. Counts lines that OPEN a bullet, not
    // non-blank lines: the `THE LAW OF THIS ROOM` header is not a rule.
    const bullets = LAW.split("\n").filter((l) => l.trim().startsWith("- "));
    expect(bullets.length).toBeLessThanOrEqual(8);
  });

  it("keeps the law SHORT — the budget the bullet count could not enforce", () => {
    // 2200 ≈ 20% headroom over today's law — enough to sharpen a rule, not to
    // grow a new one inside an existing bullet, the drift a line count is blind
    // to. ⚠ Per-bullet cap too: the total alone is game-able the other way —
    // one bullet can swallow another's budget and the sum does not move.
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
   * ⚠ SCAN BY SENTENCE, NOT BY LINE. Op bullets are ONE line each and thousands
   * of chars long, so any line-level check passes the moment a qualifier
   * appears anywhere in the bullet — which is everywhere. A sentence is the
   * unit that has to be true on its own.
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
   * …then it must name what the outcome DEPENDS ON, or be an explicit denial.
   * Qualifier = the CONDITION under which it holds: the post being addressed,
   * or being a request rather than chat.
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
    // Regression on the TEST, not the text: a lenient matcher fails here first.
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

  /**
   * ⚠ INBOUND CONSENT IS RETIRED (2026-08-22, Samuel: "remove all the stuff
   * about declining and approving of threads"). The tool used to teach a
   * SYMMETRIC model — your call is reviewed on your side, and theirs holds your
   * message for their operator to Allow or Deny. Only the first half survives.
   *
   * ⚠ THIS IS A PROSE PIN, not a vocabulary entry, and deliberately so. The
   * REMOVED_VOCABULARY table above is for surfaces an MCP client REJECTS (op
   * names, argument names); the word "inbound" is ordinary English elsewhere in
   * this description ("check for inbound turns you have not read yet"), so a
   * blanket ban would force a rephrase of a correct sentence to catch a claim
   * that is really about APPROVAL, not about the word.
   */
  it("says a message NOTIFIES the receiving side rather than being held there", () => {
    expect(DESCRIPTION).toContain("WHAT HAPPENS ON THE RECEIVING SIDE IS NOT THAT");
    expect(DESCRIPTION).toContain("simply NOTIFIES them");
    expect(DESCRIPTION).toContain(
      "Nothing you send sits in a queue over there waiting to be approved",
    );
    // ⚠ The actionable half: an agent that reads silence as "pending review"
    // waits on a decision that is never coming.
    expect(DESCRIPTION).toContain("means nobody has picked it up YET");
  });

  it("keeps the OUTBOUND review, and keeps it scoped to the caller's own machine", () => {
    // ⚠ Untouched by the retirement, and the one an agent must still plan for.
    // A pin, because "consent was removed" is exactly the over-read that would
    // delete this too.
    expect(DESCRIPTION).toContain("wait for YOUR OWN operator to approve it");
    expect(DESCRIPTION).toContain("Your outgoing call is reviewed on YOUR machine");
  });

  it("no longer claims the other side can AUTO-ACCEPT what you send", () => {
    // The per-channel setting sends the OPERATOR'S OWN posts automatically; it
    // never accepted a peer's message on their behalf, and the lane that did is
    // gone.
    expect(DESCRIPTION).not.toContain("accept inbound replies");
    expect(DESCRIPTION).not.toMatch(/inbound (consent|request|approval)/i);
  });

  it("teaches that a handle inside CODE tags nobody", () => {
    // ⚠ Joined to `lib/mentions.ts`'s code rule (2026-08-22). An agent writing
    // documentation about @-tagging tagged two real operators off backticked
    // handles; the server now skips them, and the description has to say so or
    // the agent reads a zero-tag report as a spelling mistake.
    expect(DESCRIPTION).toContain("A HANDLE INSIDE CODE TAGS NOBODY");
  });

  it("says what `get_thread` RETURNS, and that it is not a transcript", () => {
    // ⚠ 2026-08-24. The bullet listed the fields it renders and then spent its
    // remaining sentence on the lifecycle state it does NOT report — so an agent
    // scanning for "how do I look at this thread" read an op that names the
    // thread it wants and called it. It answers metadata; the messages are
    // op="read" with `thread`, and the bullet now says both halves outright.
    expect(DESCRIPTION).toContain("IT RETURNS THREAD METADATA ONLY");
    expect(DESCRIPTION).toContain("IT RETURNS NO MESSAGE BODIES");
    expect(DESCRIPTION).toContain('the transcript comes from op="read" with thread=<id>');
    // The older half must survive the addition: a thread has no lifecycle state,
    // so this is not a way to learn whether an exchange is over either.
    expect(DESCRIPTION).toContain("reports no lifecycle state, because a thread has none");
  });

  it("describes a thread as writable by exactly its two parties, with no exception", () => {
    // ⚠ The two-party rule is the RULE, not a default — no exception may come back.
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
      "set_thread_mode",
    ]) {
      expect(DESCRIPTION, `op="${op}" lost its documentation`).toContain(
        `"${op}"`,
      );
    }
  });
});

/**
 * Scan of every SHIPPED STRING, not just the description: a tool RESULT is read
 * by the same model at the moment it decides what to do next, so it teaches
 * HARDER than the description does.
 *
 * Reads the AST, not raw text — `ts.createSourceFile` yields string/template
 * literals only, so a COMMENT may still discuss removed vocabulary while a
 * shipped sentence may not. Every non-test `channel-*.ts` in this directory is
 * in scope; descriptions, `.describe()` prose, error copy, render helpers and
 * result lines are all the same lane to a reader.
 *
 * ⚠ NO ALLOWLIST, on purpose — an exemption is how a removed-vocabulary string
 * survived four phases of the rollback. When a legitimate English sentence
 * collides, rephrase it: an agent cannot tell a descriptive use from an
 * instructive one.
 */
describe("no SHIPPED STRING in the channel tool teaches removed vocabulary", () => {
  // ⚠ Off `process.cwd()` (package root under vitest): `import.meta` is
  // disallowed by this package's CommonJS tsc target and `__dirname` is not
  // guaranteed under the ESM-transformed test. Same as `parity.test.ts`.
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
    expect(shippedStrings("channel-post-linkage.ts").length).toBeGreaterThan(3);
  });

  it("the scan can SEE the defect it was written for", () => {
    // Red proof: a scan that cannot fail is not a guard.
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
