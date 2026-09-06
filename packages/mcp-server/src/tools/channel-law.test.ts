/**
 * THE LAW — the multiplayer contract every agent working in a channel reads.
 *
 * ⚠ **THE SUBJECT MOVED, THE ASSERTIONS DID NOT** (T10/T82, 2026-09-02). Every
 * pin below used to read `CHANNEL_DESCRIPTION`, because the law was PUSHED to
 * every client on every connection inside a ~35,000-character tool description.
 * The law did not change; it stopped being re-transmitted. It is `CHANNEL_LAW`
 * in `channel-doctrine.ts` now, shipped through `dopl_channel(op="help")` and
 * the MCP resource `dopl://doctrine/channels` — so the pins here read the
 * doctrine WORD FOR WORD.
 *
 * ⚠ **HOLDING THE DESCRIPTION TO BEING A POINTER IS NOW ITS OWN FILE**,
 * `law-description-pointer.test.ts`, split off on 2026-09-06 at the 500-line cap
 * (review pass 2) along exactly the seam the paragraph above draws. This file
 * asks WHAT THE LAW SAYS; that one asks WHAT THE DESCRIPTION IS — its budget,
 * its two doors, its published op set — and they move on different clocks. The
 * shared harness (the registered description, the shipped-prose join, the
 * argument prose) is `law-shipped-prose.ts`, built once so two suites cannot
 * disagree about what the tool ships.
 *
 * ⚠ THIS FILE PINS PROSE, NOT BEHAVIOUR. Every assertion is a string match on
 * shipped text; nothing runs a handler or observes the desktop listener, so it
 * catches only WORD edits. Whether the words are TRUE is owned elsewhere —
 * `dopl-desktop-app/main/targeting.js › classify` for what wakes whom, and
 * `src/features/channels/server/service-writes-metadata.ts › mayWriteThread`
 * for who may post into a thread. A green run is NOT evidence one holds.
 *
 * Removed vocabulary is pinned as an ABSENCE below — that half catches a
 * resurrection, and a stale law is the same bug as a false one.
 */

import { describe, it, expect } from "vitest";
// ⚠ THE LAW IS EXPORTED AS ITS OWN BLOCK FOR EXACTLY THE BUDGET GATES BELOW.
// Slicing it out of `CHANNEL_DOCTRINE` between two headings would re-derive a
// boundary the source already states, and a renamed neighbouring section would
// silently widen the slice until the caps stopped biting.
import { CHANNEL_DOCTRINE, CHANNEL_LAW } from "./channel-doctrine";
// ⚠ THE BANNED SET AND THE SOURCE-WIDE SCAN THAT WALKS FOR IT LEFT THIS FILE ON
// 2026-09-01 (the 500-line cap; `law-scan.test.ts` and `law-removed-vocabulary.ts`,
// whose headers carry why the seam is real and why NEITHER may take a `channel-`
// prefix). ONE statement of the table, imported rather than copied — two lists of
// what may not be said is how one quietly stops banning something.
import { REMOVED_VOCABULARY } from "./law-removed-vocabulary";
// ⚠ THE SHIPPED PROSE IS BUILT ONCE, NEXT DOOR (2026-09-06). `SHIPPED_PROSE` is
// the description PLUS the doctrine, because the scans below are about what an
// agent can READ, not which file it sits in (T82). `ARG_PROSE` is there for the
// same reason: some op prose landed on the ARGUMENT that carries it — `thread`
// for what a scoped read returns, `name` for a rename — and it is shipped text
// a client reads.
import { ARG_PROSE, SHIPPED_PROSE } from "./law-shipped-prose";

describe("THE LAW is stated, in full, in the doctrine", () => {
  it("is the FIRST thing after the opening line — an agent must not have to find it", () => {
    // ⚠ SAME RULE, NEW DOCUMENT: it was "first in the description", and the
    // description no longer carries it — so it is "first in the text that does",
    // ahead of THE MODEL and behind only the title and SECURITY.
    const law = CHANNEL_DOCTRINE.indexOf(CHANNEL_LAW);
    expect(law).toBeGreaterThan(-1);
    expect(law).toBeLessThan(CHANNEL_DOCTRINE.indexOf("THE MODEL"));
    expect(law).toBeLessThan(800);
  });

  it("says a channel is a room of PEOPLE", () => {
    expect(CHANNEL_LAW).toContain("A CHANNEL IS A ROOM OF PEOPLE");
  });

  it("says addressing a PERSON is what asks for their machine", () => {
    // The only address a post carries is a MEMBER; the receiving side decides
    // what runs. That is what makes "you cannot start somebody else's agent
    // directly" true.
    expect(CHANNEL_LAW).toContain("ADDRESSING A PERSON");
    // ⚠ THIS SAID "There is no way to address an agent by name" UNTIL 2026-08-31,
    // AND THAT STOPPED BEING TRUE ON THE SAME DAY. Samuel's same-account carve
    // made `@agent-<id>` in a BODY a real address for the caller's own agents,
    // and the very next bullet states it — so a flat denial two lines above the
    // exception was a remnant teaching the retired rule.
    // ⚠ **AND THE NARROWED CLAIM — "`to` cannot name an agent" — STOPPED BEING
    // TRUE ON 2026-09-02 (B4's union resolver).** What is absolute is WHOSE agent.
    expect(CHANNEL_LAW).toContain(
      "`to` never names another member's agent, and one of your own only by the next bullet",
    );
    // ⚠ THE DENIAL IS PINNED ACROSS EVERY SHIPPED WORD, not just the law: the
    // retired sentence coming back anywhere teaches the retired rule.
    expect(SHIPPED_PROSE).not.toContain(
      "There is no way to address an agent by name",
    );
  });

  it("says a message is CHAT or REQUEST, and that chat addresses nobody", () => {
    // ⚠ C12 (2026-09-02): `intent` is deleted, so chat is exactly "no `to`" —
    // one field carries the whole of addressing and the two cannot contradict.
    expect(CHANNEL_LAW).toContain("A MESSAGE IS CHAT OR REQUEST");
    expect(CHANNEL_LAW).toContain(
      "No `to` is CHAT: people talking, addressing nobody and starting nobody",
    );
  });

  it("keeps THE LOOP BRAKE absolute — agents do not wake each other by talking", () => {
    // ⚠ WHERE THE BRAKE IS NOW (2026-09-02, B8 × B9): the tier gate this named,
    // `session-wake-tiers.js › wakeEligibility`, is DELETED with triage. It is
    // decided server-side at write time — `service-wake-verdict.ts` resolves an
    // unaddressed AGENT-authored post through RR2 alone, never RR3's responder
    // arm — and `targeting.js › classify` keeps the same refusal desktop-side.
    // Pinned ABSOLUTE: the unaddressed half has no bound and takes no qualifier.
    expect(CHANNEL_LAW).toContain("THE LOOP BRAKE, AND IT IS ABSOLUTE");
    expect(CHANNEL_LAW).toContain(
      "an AGENT-authored UNADDRESSED message starts nobody, in a room of two or of ten",
    );
    expect(CHANNEL_LAW).toContain(
      "Agents do not wake each other by talking, and every post you make is agent-authored",
    );
  });

  it("⚠ STATES THE ONE EXCEPTION, AND STATES ITS TWO LIMITS WITH IT", () => {
    // ⚠ SAMUEL'S SAME-ACCOUNT CARVE, 2026-08-31. An agent-authored message under
    // the OPERATOR'S OWN user id may @-wake that operator's dormant agents. It
    // had to be said here because the brake above, unqualified, is what a reader
    // takes away — which left a live orchestrator unable to spend an id
    // `launch_agent` had just handed it (ENGINEERING).
    //
    // ⚠ THE TWO LIMITS ARE PINNED WITH IT AND MAY NOT BE DROPPED FOR BREVITY.
    // "Only by name" is what keeps tiers 2 and 3 shut to every agent-authored
    // message; "never another member's agent" is the 2026-08-28 fence, which
    // this carve did not touch. An exception stated without its boundary reads
    // as the brake being negotiable.
    expect(CHANNEL_LAW).toContain(
      "YOUR OWN AGENTS ARE THE ONE EXCEPTION, AND ONLY BY NAME",
    );
    expect(CHANNEL_LAW).toContain("`@agent-<id>` in a body wakes THAT agent");
    expect(CHANNEL_LAW).toContain(
      "Never another member's agent, and never without naming one",
    );
  });

  it("names the two things to act on, and calls everything else ambient context", () => {
    // ⚠ TWO, not three — a third acting-trigger stated beside a law that has no
    // engagement states the model twice and contradicts itself once.
    expect(CHANNEL_LAW).toContain("messages in a THREAD you are a party to");
    expect(CHANNEL_LAW).toContain("main-room messages addressed to YOU");
    expect(CHANNEL_LAW).toContain(
      "EVERYTHING ELSE IS AMBIENT CONTEXT — read it, do not answer it",
    );
  });

  it("says to reply where you were asked", () => {
    expect(CHANNEL_LAW).toContain("REPLY WHERE YOU WERE ASKED");
    expect(CHANNEL_LAW).toContain("Asked in the main room, answer in the main room");
    expect(CHANNEL_LAW).toContain("Work traffic stays in its thread");
  });

  it("grants the main-room post as a SPARSE capability, in the same bullet", () => {
    // ⚠ It rides on "reply where you were asked" because that bullet is what an
    // agent otherwise reads as a BAN (wiring plan Phase 11): "work traffic stays
    // in its thread" unqualified says the room is never yours to post to, which
    // stopped being true. Capability first, then the limit — the reverse order
    // reads as a warning and the capability goes unused.
    expect(CHANNEL_LAW).toContain(
      "You MAY also post to the main room unprompted, SPARSELY",
    );
    expect(CHANNEL_LAW).toContain("that is a capability, not a habit");
  });

  it("names the @-tag as how a HUMAN is reached, and denies that it addresses", () => {
    // ⚠ Two halves, both load-bearing and neither safe alone. Without the first,
    // an agent that is blocked posts into a thread nobody is watching; without
    // the second, a tag reads as a second way to ASK FOR A MACHINE, which no
    // part of the product honours (`metadata.mentionedUserIds` is not
    // `to_user_id` — INVARIANTS §5).
    expect(CHANNEL_LAW).toContain("@-TAG THEM IN THE BODY");
    expect(CHANNEL_LAW).toContain("Tags inbox");
    expect(CHANNEL_LAW).toContain("Tagging is not addressing and starts no agent");
  });

  it("keeps the law to at most 8 BULLETS — one rule per line, no line per rule", () => {
    // ⚠ CEILING, not a target, AND IT DID NOT MOVE WHEN THE TEXT DID. The law is
    // the part a reader must hold in their head, so a non-load-bearing rule goes
    // in the doctrine section that needs it. A 9th line means answering which of
    // these eight stopped being a rule — never raise the number to make room.
    // Counts lines that OPEN a bullet: the header is not a rule.
    const bullets = CHANNEL_LAW.split("\n").filter((l) => l.trim().startsWith("- "));
    expect(bullets.length).toBeLessThanOrEqual(8);
  });

  it("keeps the law SHORT — the budget the bullet count could not enforce", () => {
    // 2200 ≈ 20% headroom over today's law — enough to sharpen a rule, not to
    // grow a new one inside an existing bullet, the drift a line count is blind
    // to. ⚠ Per-bullet cap too: the total alone is game-able the other way — one
    // bullet can swallow another's budget and the sum does not move. ⚠ AND IT
    // STILL BITES NOW THE LAW IS PULLED RATHER THAN PUSHED: the doctrine may be
    // thorough, but a reader opens it and reads the law first, as one thing.
    expect(CHANNEL_LAW.length).toBeLessThanOrEqual(2200);
    const bullets = CHANNEL_LAW.split("\n").filter((l) => l.trim().startsWith("- "));
    const overlong = bullets.filter((b) => b.length > 900);
    expect(
      overlong.map((b) => `${b.length} chars: ${b.slice(0, 80)}…`),
      "a law bullet grew past its budget — sharpen it, or move the detail into the doctrine section that needs it",
    ).toEqual([]);
  });
});

describe("what the law and the ops around it may NOT say", () => {
  /**
   * ⚠ SCAN BY SENTENCE, NOT BY LINE. Doctrine sections are ONE line each and
   * thousands of chars long, so any line-level check passes the moment a
   * qualifier appears anywhere in the section — which is everywhere. A sentence
   * is the unit that has to be true on its own.
   */
  const sentences = SHIPPED_PROSE.split("\n")
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
    // ⚠ OVER THE DESCRIPTION **AND** THE DOCTRINE (T82). The claim this catches
    // is the most expensive one the surface can make, and it got 22,000 more
    // characters to hide in the day the prose moved.
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
    // ⚠ ALSO OVER BOTH (T82), and for the same reason: a retired op resurrected
    // in the doctrine is read by exactly the agents that asked for the rules.
    const found = REMOVED_VOCABULARY.filter(([, re]) =>
      re.test(SHIPPED_PROSE),
    ).map(([label]) => label);
    expect(
      found,
      `the shipped prose names surfaces that no longer exist: ${found.join(", ")}`,
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
   * the doctrine ("check for inbound turns you have not read yet"), so a
   * blanket ban would force a rephrase of a correct sentence to catch a claim
   * that is really about APPROVAL, not about the word.
   */
  it("says a message NOTIFIES the receiving side rather than being held there", () => {
    expect(CHANNEL_DOCTRINE).toContain(
      "WHAT HAPPENS ON THE RECEIVING SIDE IS NOT THAT",
    );
    expect(CHANNEL_DOCTRINE).toContain("simply NOTIFIES them");
    expect(CHANNEL_DOCTRINE).toContain(
      "Nothing you send sits in a queue over there waiting to be approved",
    );
    // ⚠ The actionable half: an agent that reads silence as "pending review"
    // waits on a decision that is never coming.
    expect(CHANNEL_DOCTRINE).toContain("means nobody has picked it up YET");
  });

  it("keeps the OUTBOUND review, and keeps it scoped to the caller's own machine", () => {
    // ⚠ Untouched by the retirement, and the one an agent must still plan for.
    // A pin, because "consent was removed" is exactly the over-read that would
    // delete this too.
    expect(CHANNEL_DOCTRINE).toContain("wait for YOUR OWN operator to approve it");
    expect(CHANNEL_DOCTRINE).toContain(
      "Your outgoing call is reviewed on YOUR machine",
    );
  });

  it("no longer claims the other side can AUTO-ACCEPT what you send", () => {
    // The per-channel setting sends the OPERATOR'S OWN posts automatically; it
    // never accepted a peer's message on their behalf, and the lane that did is
    // gone. ⚠ Over BOTH texts — an absence is only worth what it covers.
    expect(SHIPPED_PROSE).not.toContain("accept inbound replies");
    expect(SHIPPED_PROSE).not.toMatch(/inbound (consent|request|approval)/i);
  });

  it("teaches that a handle inside CODE tags nobody", () => {
    // ⚠ Joined to `lib/mentions.ts`'s code rule (2026-08-22). An agent writing
    // documentation about @-tagging tagged two real operators off backticked
    // handles; the server now skips them, and the surface has to say so or the
    // agent reads a zero-tag report as a spelling mistake.
    // ⚠ **THE HEADLINE `A HANDLE INSIDE CODE TAGS NOBODY` IS GONE AND THE RULE
    // IS NOT.** It is cause (1) of the doctrine's five for a tag resolving to
    // nobody, spelled out rather than shouted — so both halves are pinned: the
    // cause is NAMED, and the safe case (writing ABOUT tagging) is still stated.
    expect(CHANNEL_DOCTRINE).toContain("THE HANDLE WAS IN CODE");
    expect(CHANNEL_DOCTRINE).toContain(
      "a handle inside backticks or a fenced block is quoted text and tags nobody",
    );
  });

  it("says what a THREAD-SCOPED read returns — the card AND the exchange", () => {
    // ⚠ C15 (2026-09-02): `get_thread` is FOLDED INTO `read(thread=)`. Two ops
    // answered one noun, and 200 characters of published prose existed only to
    // say the first returned no bodies — the exact sentence an agent scanning
    // for "how do I look at this thread" had to read to avoid the wrong call.
    // One op renders both halves, so the disambiguation is deleted rather than
    // reworded, and the op name may never come back (`REMOVED_VOCABULARY`).
    expect(ARG_PROSE).toContain("its metadata header plus only that exchange");
    expect(ARG_PROSE).not.toContain("METADATA ONLY");
    expect(ARG_PROSE).not.toContain("get_thread");
    // The older half must survive the addition: a thread has no lifecycle state,
    // so this is not a way to learn whether an exchange is over either. ⚠ That
    // half is doctrine now — it is a fact about THREADS, not about one op.
    expect(CHANNEL_DOCTRINE).toContain("A THREAD HAS NO FINISHED STATE");
    expect(CHANNEL_DOCTRINE).toContain(
      "nothing settles one, no op ends one",
    );
  });

  it("describes a thread as writable by exactly its two parties, with no exception", () => {
    // ⚠ The two-party rule is the RULE, not a default — no exception may come back.
    expect(CHANNEL_DOCTRINE).toContain("between exactly TWO parties");
    expect(CHANNEL_DOCTRINE).toContain("Only those two can post into it");
  });
});
