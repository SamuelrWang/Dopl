// THE LAW's wording in `channelDoctrine()`. A prose pin only: whether it is TRUE is
// `main/targeting.js › classify` and `service-writes-metadata-thread.ts › isThreadParticipant`.
// The description-as-pointer half is `law-description-pointer.test.ts`.

import { describe, it, expect } from "vitest";
// `channelLaw()` is its own export so the caps below measure the law, not a slice between headings.
import { channelDoctrine, channelLaw } from "./channel-doctrine";
import { REMOVED_VOCABULARY } from "./law-removed-vocabulary";
import { ARG_PROSE, SHIPPED_PROSE } from "./law-shipped-prose";

describe("THE LAW is stated, in full, in the doctrine", () => {
  it("is the FIRST thing after the opening line — an agent must not have to find it", () => {
    // First in the doctrine, behind only the title and SECURITY.
    const law = channelDoctrine().indexOf(channelLaw());
    expect(law).toBeGreaterThan(-1);
    expect(law).toBeLessThan(channelDoctrine().indexOf("THE MODEL"));
    expect(law).toBeLessThan(800);
  });

  it("says a channel is a room of PEOPLE", () => {
    expect(channelLaw()).toContain("A CHANNEL IS A ROOM OF PEOPLE");
  });

  it("says addressing a PERSON is what asks for their machine", () => {
    expect(channelLaw()).toContain("ADDRESSING A PERSON");
    // What is absolute is WHOSE agent: `to` may name one of your own, never another member's.
    expect(channelLaw()).toContain(
      "`to` never names another member's agent, and one of your own only by the next bullet",
    );
    // Across every shipped word: the retired sentence anywhere teaches the retired rule.
    expect(SHIPPED_PROSE).not.toContain(
      "There is no way to address an agent by name",
    );
  });

  it("says every message is ADDRESSED or a RECORD, and that a bare send is refused", () => {
    // Every message is addressed or a record; a send that is neither is refused, not interpreted.
    expect(channelLaw()).toContain(
      "EVERY MESSAGE YOU SEND IS ADDRESSED OR IT IS A RECORD, AND THERE IS NO THIRD WAY",
    );
    expect(channelLaw()).toContain(
      "`to` addresses — ONE name or SEVERAL, comma-separated, agents and people mixed",
    );
    expect(channelLaw()).toContain(
      'kind="record" files a post for NOBODY: visible in the room, reaching no agent and no inbox',
    );
    expect(channelLaw()).toContain("A send with neither is REFUSED");
  });

  it("keeps THE LOOP BRAKE absolute — agents do not wake each other by talking", () => {
    // Absolute: an unaddressed agent post starts nobody and is shown to nobody.
    expect(channelLaw()).toContain("THE LOOP BRAKE, AND IT IS ABSOLUTE");
    expect(channelLaw()).toContain(
      "an AGENT-authored UNADDRESSED message starts nobody AND IS SHOWN TO NOBODY, in a room of two or of ten",
    );
    expect(channelLaw()).toContain(
      "Agents do not wake each other by talking, and every post you make is agent-authored",
    );
  });

  it("STATES THE ONE EXCEPTION, AND STATES ITS TWO LIMITS WITH IT", () => {
    // The exception is stated with its two limits, or the brake reads as negotiable.
    expect(channelLaw()).toContain(
      "YOUR OWN AGENTS ARE THE ONE EXCEPTION, AND ONLY IN `to`, BY NAME",
    );
    // An agent handle in a body is prose; `to` is the agent address, and it takes a list.
    expect(channelLaw()).toContain("that tag, in `to`, wakes THAT agent");
    expect(channelLaw()).toContain("`to` takes as many of them as the work needs");
    expect(channelLaw()).toContain(
      "AN AGENT HANDLE IN YOUR BODY IS PROSE AND REACHES NOBODY",
    );
    expect(channelLaw()).toContain("NEVER WRITE AN AGENT ID IN A MESSAGE");
    expect(channelLaw()).toContain(
      "Never another member's agent, and never without naming one",
    );
  });

  it("names the two things to act on, and calls everything else ambient context", () => {
    // Two, not three: a third trigger beside a law with no engagement contradicts it.
    expect(channelLaw()).toContain("messages in a THREAD you are a party to");
    expect(channelLaw()).toContain("main-room messages addressed to YOU");
    expect(channelLaw()).toContain(
      "EVERYTHING ELSE IS AMBIENT CONTEXT — read it, do not answer it",
    );
  });

  it("says to reply where you were asked", () => {
    expect(channelLaw()).toContain("REPLY WHERE YOU WERE ASKED");
    expect(channelLaw()).toContain("Asked in the main room, answer in the main room");
    expect(channelLaw()).toContain("Work traffic stays in its thread");
  });

  it("grants the main-room post as a SPARSE capability, in the same bullet", () => {
    // Capability first, then the limit: "work traffic stays in its thread" alone reads as a ban.
    expect(channelLaw()).toContain(
      "You MAY also post to the main room unprompted, SPARSELY",
    );
    expect(channelLaw()).toContain("that is a capability, not a habit");
  });

  it("names the @-tag as how a HUMAN is reached, and denies that it addresses", () => {
    // Both halves: a tag reaches a human, and it never addresses (`mentionedUserIds` is not
    // `to_user_id`, INVARIANTS §5).
    expect(channelLaw()).toContain("@-TAG A HUMAN YOU DID NOT ADDRESS");
    expect(channelLaw()).toContain("Tags inbox");
    expect(channelLaw()).toContain("Tagging is not addressing and starts no agent");
  });

  it("puts the recipient in `to=` and keeps the envelope OUT of the body", () => {
    // The recipient lives only in `to=` and the room renders it; nothing validates a body's first line,
    // so prose is the only fence against a typed header.
    expect(channelLaw()).toContain("that IS the address and the room RENDERS it");
    expect(channelDoctrine()).toContain(
      "WHERE THE RECIPIENT IS WRITTEN: in `to=`, never in the body",
    );
    expect(channelDoctrine()).toContain("FROM→TO | KIND |");
  });

  it("keeps the law to at most 8 BULLETS — one rule per line, no line per rule", () => {
    // A ceiling, not a target: a ninth line means one of the eight stopped being a rule. Counts lines
    // that open a bullet.
    const bullets = channelLaw().split("\n").filter((l) => l.trim().startsWith("- "));
    expect(bullets.length).toBeLessThanOrEqual(8);
  });

  it("keeps the law SHORT — the budget the bullet count could not enforce", () => {
    // ~20% headroom; the per-bullet cap stops one bullet swallowing another's budget.
    expect(channelLaw().length).toBeLessThanOrEqual(2200);
    const bullets = channelLaw().split("\n").filter((l) => l.trim().startsWith("- "));
    const overlong = bullets.filter((b) => b.length > 900);
    expect(
      overlong.map((b) => `${b.length} chars: ${b.slice(0, 80)}…`),
      "a law bullet grew past its budget — sharpen it, or move the detail into the doctrine section that needs it",
    ).toEqual([]);
  });
});

describe("what the law and the ops around it may NOT say", () => {
  // By sentence, not line: a doctrine section is one long line, so a line check always finds a qualifier.
  const sentences = SHIPPED_PROSE.split("\n")
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);

  /** The claim is ABOUT the other side's agent (not about the caller's own). */
  const OTHER_SIDE =
    /their agent|that member's (listener|agent)|their listener|no one's agent|nobody's agent/i;
  /** …and it says that agent RUNS (or is made to run). */
  const STARTS = /\bspawn|\bwake[sn]?\b|\bstarts?\b|\btrigger/i;
  /** …then it must name what the outcome depends on, or be an explicit denial. */
  const KEYED =
    /\brequest\b|\baddress|\bunaddressed\b|intent|never (spawns|starts|wakes|triggers)|does not (spawn|start|wake|trigger)|starts no agent|no agent of theirs starts|reaches no one's agent|no one's agent wakes|nobody's agent (wakes|woke)|wakes nobody/i;

  it("never claims something about another member's agent unconditionally", () => {
    // Over the description AND the doctrine.
    const offenders = sentences.filter(
      (s) => OTHER_SIDE.test(s) && STARTS.test(s) && !KEYED.test(s),
    );
    expect(
      offenders,
      `these sentences claim something about another member's agent starting (or not) without saying what it depends on:\n- ${offenders.join("\n- ")}`,
    ).toEqual([]);
  });

  it("the guard has teeth — it catches a bare claim", () => {
    // A regression on the test: a lenient matcher fails here first.
    const bare =
      "Post it and that member's listener is then the only one triggered.";
    expect(
      OTHER_SIDE.test(bare) && STARTS.test(bare) && !KEYED.test(bare),
      "the negative guard would not catch a bare claim",
    ).toBe(true);
  });

  it("never mentions a removed named-agent surface", () => {
    // Over both texts: a retired op in the doctrine is read by exactly the agents asking for rules.
    const found = REMOVED_VOCABULARY.filter(([, re]) =>
      re.test(SHIPPED_PROSE),
    ).map(([label]) => label);
    expect(
      found,
      `the shipped prose names surfaces that no longer exist: ${found.join(", ")}`,
    ).toEqual([]);
  });

  // A prose pin, not a vocabulary entry: "inbound" is ordinary English elsewhere in the doctrine,
  // and the retired claim is about approval, not the word.
  it("says a message NOTIFIES the receiving side rather than being held there", () => {
    expect(channelDoctrine()).toContain(
      "WHAT HAPPENS ON THE RECEIVING SIDE IS NOT THAT",
    );
    expect(channelDoctrine()).toContain("simply NOTIFIES them");
    expect(channelDoctrine()).toContain(
      "Nothing you send sits in a queue over there waiting to be approved",
    );
    // An agent that reads silence as "pending review" waits on a decision that never comes.
    expect(channelDoctrine()).toContain("means nobody has picked it up YET");
  });

  it("keeps the OUTBOUND review, and keeps it scoped to the caller's own machine", () => {
    // Untouched by the retirement: "consent was removed" is the over-read that would delete it too.
    expect(channelDoctrine()).toContain("wait for YOUR OWN operator to approve it");
    expect(channelDoctrine()).toContain(
      "Your outgoing call is reviewed on YOUR machine",
    );
  });

  it("no longer claims the other side can AUTO-ACCEPT what you send", () => {
    // Over both texts: an absence is only worth what it covers.
    expect(SHIPPED_PROSE).not.toContain("accept inbound replies");
    expect(SHIPPED_PROSE).not.toMatch(/inbound (consent|request|approval)/i);
  });

  it("teaches that a handle inside CODE tags nobody", () => {
    // The server skips backticked handles (`lib/mentions.ts`), and the surface must say so or a
    // zero-tag report reads as a typo.
    expect(channelDoctrine()).toContain("THE HANDLE WAS IN CODE");
    expect(channelDoctrine()).toContain(
      "a handle inside backticks or a fenced block is quoted text and tags nobody",
    );
  });

  it("says what a THREAD-SCOPED read returns — the card AND the exchange", () => {
    // `get_thread` folded into `read(thread=)`; the op name may never come back (`REMOVED_VOCABULARY`).
    expect(ARG_PROSE).toContain("its metadata header plus only that exchange");
    expect(ARG_PROSE).not.toContain("METADATA ONLY");
    expect(ARG_PROSE).not.toContain("get_thread");
    // A thread has no lifecycle state, so this is not a way to learn whether an exchange is over.
    expect(channelDoctrine()).toContain("A THREAD HAS NO FINISHED STATE");
    expect(channelDoctrine()).toContain(
      "nothing settles one, no op ends one",
    );
  });

  it("describes a thread as writable by exactly its two parties, with no exception", () => {
    expect(channelDoctrine()).toContain("between exactly TWO parties");
    expect(channelDoctrine()).toContain("Only those two can post into it");
  });
});
