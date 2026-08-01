"use strict";
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
 * A STALE LAW IS THE SAME BUG AS A FALSE ONE, and this file has now been on both
 * sides of it. It used to pin "NOTHING ACTS UNLESS ADDRESSED" as THE rule; that
 * sentence was true until ENGAGEMENT shipped and then described a product that
 * no longer existed, and a green suite would have kept it there. What is pinned
 * now is the narrower absolute that survived (an AGENT-authored unaddressed
 * message engages and starts nobody, at any size) plus the four rules the room
 * gained: chat vs. request, engagement and its expiry, multi-address, and the
 * one-opener thread handshake. When the behaviour moves again, the pin is the
 * thing to change FIRST — not the thing to work around.
 *
 * Captured through the real registrar with a recording `register` and a stub
 * client (registration is all this needs — no handler ever runs).
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const channel_1 = require("./channel");
function description() {
    let text = "";
    const cap = ((name, d) => {
        if (name === "dopl_channel")
            text = d;
    });
    (0, channel_1.registerChannelTool)(cap, {});
    if (!text)
        throw new Error("dopl_channel was not registered");
    return text;
}
const DESCRIPTION = description();
(0, vitest_1.describe)("THE LAW is stated, in full, in the tool description", () => {
    (0, vitest_1.it)("is the FIRST thing after the opening line — an agent must not have to find it", () => {
        const law = DESCRIPTION.indexOf("THE LAW OF THIS ROOM");
        (0, vitest_1.expect)(law).toBeGreaterThan(-1);
        (0, vitest_1.expect)(law).toBeLessThan(DESCRIPTION.indexOf("THE MODEL"));
    });
    (0, vitest_1.it)("says a channel is a ROOM and a participant thread is a BREAKOUT ROOM", () => {
        (0, vitest_1.expect)(DESCRIPTION).toContain("A CHANNEL is a ROOM");
        (0, vitest_1.expect)(DESCRIPTION).toContain("A THREAD with participants is a BREAKOUT ROOM");
    });
    (0, vitest_1.it)("says addressing an agent by handle is what starts it, singly or several at once", () => {
        // WHAT THIS REPLACED, and why the replacement is not a softening. The law
        // used to open "NOTHING ACTS UNLESS ADDRESSED", and that sentence stopped
        // being the whole truth when ENGAGEMENT landed
        // (`service-writes-agents.ts#recordAgentEngagement` +
        // `dopl-desktop-app/main/channel-engagement.js`): an agent a HUMAN addressed
        // by handle then acts on that human's UNTAGGED messages for a window. Left
        // as an absolute, the law would have taught every agent in the room to
        // ignore the untagged continuation it is now supposed to answer — the stale
        // -law bug class this file exists to catch, in its most expensive form.
        //
        // The absolute that SURVIVED is narrower and is pinned separately below:
        // an AGENT-authored unaddressed message engages and starts nobody.
        (0, vitest_1.expect)(DESCRIPTION).toContain("ADDRESS AN AGENT BY HANDLE TO START IT");
        (0, vitest_1.expect)(DESCRIPTION).toContain("to_agent=");
        (0, vitest_1.expect)(DESCRIPTION).toContain("to_agents=");
    });
    (0, vitest_1.it)("says a message is CHAT or REQUEST, and that chat addresses nobody", () => {
        // `intent` (src/features/channels/schema.ts) — `chat` skips the DM
        // auto-address entirely, so two humans can talk in a DM without each line
        // poking the other machine. Without this in the law an agent reads every
        // line of human small talk in a DM as work it was handed.
        (0, vitest_1.expect)(DESCRIPTION).toContain("A MESSAGE IS CHAT OR REQUEST");
        (0, vitest_1.expect)(DESCRIPTION).toContain('intent="chat" is people talking: it addresses nobody and starts nobody');
    });
    (0, vitest_1.it)("states ENGAGEMENT: a human's tag starts a conversation, not one turn", () => {
        // `recordAgentEngagement` stamps `engaged_at` for a HUMAN-authored addressed
        // post; `channel-engagement.js#isEngaged` reads it through a ~1h window and
        // `mayEngage` restricts the widened acting to HUMAN authors. All three
        // halves are stated, including the one an agent gets wrong by default —
        // that its OWN to_agent post engages nobody.
        (0, vitest_1.expect)(DESCRIPTION).toContain("BEING ADDRESSED BY A HUMAN ENGAGES YOU");
        (0, vitest_1.expect)(DESCRIPTION).toContain("you also act on that person's UNADDRESSED messages in this channel");
        (0, vitest_1.expect)(DESCRIPTION).toContain('You go IDLE again on op="disengage_agent", on park or dismiss, or after about an hour');
        (0, vitest_1.expect)(DESCRIPTION).toContain("it addresses another agent and engages nothing");
    });
    (0, vitest_1.it)("keeps THE LOOP BRAKE absolute — agents do not wake each other by talking", () => {
        // `mayEngage` (channel-engagement.js) refuses every non-`user` author before
        // it looks at anything else, at any member count. This is the property that
        // makes engagement safe to grant at all, so it is pinned as an absolute and
        // must never acquire a qualifier.
        (0, vitest_1.expect)(DESCRIPTION).toContain("THE LOOP BRAKE, AND IT IS ABSOLUTE");
        (0, vitest_1.expect)(DESCRIPTION).toContain("an AGENT-authored unaddressed message engages nobody and starts nobody, in a room of two or of ten");
        (0, vitest_1.expect)(DESCRIPTION).toContain("Agents do not wake each other by talking, and every post you make is agent-authored");
    });
    (0, vitest_1.it)("states the thread handshake: ONE opener, chosen by agent id, with the derived key", () => {
        // Two agents addressed in one message will both reach for `create_thread`.
        // The tie-break has to be computable by each agent ALONE, from something
        // both can see and neither can influence — the ids on op="agents" — and the
        // derived `client_msg_id` is the server-side net under it: a race collapses
        // on the idempotency key instead of opening a second room for one job.
        (0, vitest_1.expect)(DESCRIPTION).toContain("EXACTLY ONE OF YOU OPENS THE THREAD");
        (0, vitest_1.expect)(DESCRIPTION).toContain("the addressed agent whose AGENT ID sorts FIRST, lexicographically");
        (0, vitest_1.expect)(DESCRIPTION).toContain('client_msg_id="thread-open-<channelId>-<seq>"');
        // BLOCKER-1 — `<channelId>` IS AMBIGUOUS AND FAILED SILENTLY. The `channel`
        // param takes a slug OR an id, and `parseHandshakeSeq`
        // (src/features/channels/server/service-thread-handshake.ts) anchors on the
        // UUID: a key built from the slug parses as no handshake, derives no
        // participant set, and the create still returns 200 — the failure lands on
        // the OTHER agent, one turn later, as a `mayWriteThread` 403 on a thread it
        // was told to use. The law has to disambiguate the placeholder, so the
        // disambiguation is pinned rather than left to survive the next rewrite.
        (0, vitest_1.expect)(DESCRIPTION).toContain("the channel's UUID, NEVER its slug");
        // The other side of the same rule: everyone else WAITS rather than creating.
        (0, vitest_1.expect)(DESCRIPTION).toContain('do NOT call "create_thread"');
        (0, vitest_1.expect)(DESCRIPTION).toContain("Inside a thread everyone in it hears everything: no tagging between participants");
    });
    (0, vitest_1.it)("keys addressing a HUMAN on `as_agent` — the param the desktop actually reads", () => {
        // THE PRECONDITION, PINNED. `classify` (dopl-desktop-app/main/targeting.js)
        // returns the notify-only `agent-escalation` verdict for
        //   authorKind === 'agent' && metadata.author_agent_id && !to_agent_id
        // and `author_agent_id` is stamped ONLY from a validated `as_agent`, which
        // is OPTIONAL. So a bare `post(to=<person>)` from an agent with no
        // `as_agent` falls through to the addressed rule and returns 'trigger' — a
        // consent card, and their agent started. The law promised the opposite
        // unconditionally for every caller that had not read the source.
        (0, vitest_1.expect)(DESCRIPTION).toContain('ADDRESSING A HUMAN (to="<email or user id>") DOES ONE OF TWO THINGS AND `as_agent` DECIDES WHICH.');
        (0, vitest_1.expect)(DESCRIPTION).toContain('Post AS YOURSELF — as_agent="<your handle>" together with to= — and that person is NOTIFIED and no agent of theirs starts.');
        (0, vitest_1.expect)(DESCRIPTION).toContain("Post WITHOUT as_agent and the same to= is a REQUEST from your operator: it triggers that member's listener, which is what starts their agent.");
        // The escalation path is the same fact, said where an agent needs it — and
        // it must carry the precondition too, not just the happy half.
        (0, vitest_1.expect)(DESCRIPTION).toContain("BLOCKED AND NEED A PERSON?");
        (0, vitest_1.expect)(DESCRIPTION).toContain('Post with BOTH as_agent="<your handle>" and to=<them>: that notifies the person and starts no agent.');
    });
    (0, vitest_1.it)("states `as_agent` on a breakout post as the CONDITIONAL it is, actionably", () => {
        // NIT-7 — THE LAW USED TO STATE THIS AS AN ABSOLUTE ("REQUIRED to post into
        // a BREAKOUT THREAD you belong to as an agent (without it the server
        // refuses)") and it is not one. `mayWriteThread`
        // (src/features/channels/server/service-writes-metadata.ts) returns true on
        // the USER branch whenever the caller's own id is in the set, so:
        //   - a HANDSHAKE-derived room passes without `as_agent`, because
        //     `deriveHandshakeParticipants` seeds each agent AND its owner;
        //   - a caller-supplied `participants:["agent:x"]` room does NOT, because
        //     `seedThreadParticipants` adds no owners.
        // An agent inside a thread cannot tell which kind it is in, so the law may
        // not be restated as the other absolute either ("you never need it"). What
        // it must say is: ALWAYS pass it, and here is the case that requires it.
        (0, vitest_1.expect)(DESCRIPTION).toContain("ALWAYS pass it on a post into a BREAKOUT THREAD");
        (0, vitest_1.expect)(DESCRIPTION).toContain("it is REQUIRED whenever an AGENT ROW is what admits you there");
        // The conditional's other half — and the reason "always" is the actionable
        // instruction rather than a hedge.
        (0, vitest_1.expect)(DESCRIPTION).toContain("unless the set ALSO holds you as a person — which you cannot tell from inside the thread");
        // …and the absolute must not come back.
        (0, vitest_1.expect)(DESCRIPTION).not.toContain("also REQUIRED to post into a BREAKOUT THREAD you belong to as an agent");
    });
    (0, vitest_1.it)("names the three things to act on, and calls everything else ambient context", () => {
        (0, vitest_1.expect)(DESCRIPTION).toContain("messages in a breakout thread you are a participant of");
        (0, vitest_1.expect)(DESCRIPTION).toContain("main-room messages addressed to you");
        // THE THIRD ONE IS NEW AND IS THE WHOLE POINT OF ENGAGEMENT. It was two
        // things for as long as an agent only ever acted on a tag; leaving it at two
        // beside an engagement bullet would state the model twice and contradict
        // itself once.
        (0, vitest_1.expect)(DESCRIPTION).toContain("while you are engaged — the unaddressed messages of the human who engaged you");
        (0, vitest_1.expect)(DESCRIPTION).toContain("EVERYTHING ELSE IS AMBIENT CONTEXT — read it, do not answer it");
    });
    (0, vitest_1.it)("says to reply where you were asked", () => {
        (0, vitest_1.expect)(DESCRIPTION).toContain("REPLY WHERE YOU WERE ASKED");
        (0, vitest_1.expect)(DESCRIPTION).toContain("Summoned in the main room, answer in the main room");
        (0, vitest_1.expect)(DESCRIPTION).toContain("Work traffic stays in your breakout thread");
    });
    (0, vitest_1.it)("says an agent has a NAME, posts under it, and may never wear another's", () => {
        (0, vitest_1.expect)(DESCRIPTION).toContain("YOU HAVE A NAME");
        (0, vitest_1.expect)(DESCRIPTION).toContain('as_agent="<your handle>"');
        (0, vitest_1.expect)(DESCRIPTION).toContain("Never post as another agent");
        (0, vitest_1.expect)(DESCRIPTION).toContain("the server verifies who owns it and refuses");
    });
    /**
     * The law block, sliced between its two anchors. Both length assertions read
     * it, so the slice is written once.
     */
    const LAW = DESCRIPTION.slice(DESCRIPTION.indexOf("THE LAW OF THIS ROOM"), DESCRIPTION.indexOf("THE MODEL"));
    (0, vitest_1.it)("keeps the law to at most 12 BULLETS — one rule per line, no line per rule", () => {
        // NIT-9 — THIS TEST IS NAMED FOR WHAT IT MEASURES NOW. It used to be called
        // "keeps the law SHORT (<=12 non-blank lines)", which is a formatting
        // assertion wearing a semantics assertion's name: every bullet here is a
        // single 140-750 character line, so a bullet could double in length, gain a
        // false clause, or lose a true one and this number would not move. It
        // caught exactly one thing — somebody adding a 13th rule — and that is
        // still worth catching, so it is kept and renamed rather than deleted, with
        // the budget it was silently failing to enforce added beside it.
        //
        // THE CEILING MOVED ONCE, FROM 8 TO 12, AND IT IS A CEILING RATHER THAN A
        // TARGET. The room genuinely gained rules an agent cannot infer — chat vs.
        // request, engagement and its expiry, the loop brake, and the two-agent
        // thread handshake — and four facts do not fit in a header plus seven lines
        // without one of them becoming a subordinate clause somebody later deletes.
        // What has NOT changed is why the cap exists: this text is read on every
        // connection by every agent, so a rule that is not load-bearing does not go
        // here — it goes in the op bullet that needs it. If a future change wants a
        // 13th line, the question to answer first is which of these twelve stopped
        // being a rule.
        (0, vitest_1.expect)(LAW.split("\n").filter((l) => l.trim()).length).toBeLessThanOrEqual(12);
    });
    (0, vitest_1.it)("keeps the law SHORT — the budget the bullet count could not enforce", () => {
        // NIT-9's other half, and the one that actually measures "short". The law
        // is ~3.6k characters today across twelve bullets; 4000 is roughly a 10%
        // ceiling on that, in the same spirit as the bullet ceiling above — enough
        // room to sharpen a rule, not enough to grow a new one inside an existing
        // bullet, which is the drift the line count is blind to by construction.
        //
        // A PER-BULLET CAP TOO, because the total alone is game-able the other way:
        // one bullet could swallow another's budget and the sum would not move. The
        // longest today is the thread-handshake rule at ~750 characters (it carries
        // the tie-break, the derived key, and what the others do instead), so 900
        // is its headroom and everyone else's ceiling.
        //
        // If a change needs more than either number, the honest move is the same
        // one the bullet ceiling asks for: say which rule stopped being a rule, or
        // move the detail into the op bullet that needs it — an op bullet is read
        // when the op is called, where THE LAW is read on every connection.
        (0, vitest_1.expect)(LAW.length).toBeLessThanOrEqual(4000);
        const bullets = LAW.split("\n").filter((l) => l.trim().startsWith("- "));
        const overlong = bullets.filter((b) => b.length > 900);
        (0, vitest_1.expect)(overlong.map((b) => `${b.length} chars: ${b.slice(0, 80)}…`), "a law bullet grew past its budget — sharpen it, or move the detail into the op bullet that needs it").toEqual([]);
    });
});
(0, vitest_1.describe)("what the law and the ops around it may NOT say", () => {
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
    const OTHER_SIDE = /their agent|that member's (listener|agent)|their listener|no one's agent|nobody's agent/i;
    /** …and it says that agent RUNS (or is made to run). */
    const STARTS = /\bspawn|\bwake[sn]?\b|\bstarts?\b|\btrigger/i;
    /**
     * …then it must name the param the outcome depends on, or be an explicit
     * denial. `as_agent` is the whole point: WITH it a `to=` post notifies, and
     * WITHOUT it the same post triggers. A sentence that asserts either half
     * without naming it is the B1 defect, whichever half it asserts.
     */
    const KEYED = /as_agent|never (spawns|starts|wakes|triggers)|does not (spawn|start|wake|trigger)|starts no agent|no agent of theirs starts|reaches no one's agent|no one's agent wakes|nobody's agent (wakes|woke)|wakes nobody/i;
    (0, vitest_1.it)("never states what addressing a PERSON does to their agent without naming `as_agent`", () => {
        const offenders = sentences.filter((s) => OTHER_SIDE.test(s) && STARTS.test(s) && !KEYED.test(s));
        (0, vitest_1.expect)(offenders, `these sentences claim something about another member's agent starting (or not) without keying it on \`as_agent\` or denying it outright:\n- ${offenders.join("\n- ")}`).toEqual([]);
    });
    (0, vitest_1.it)("the guard has teeth — it catches the exact sentence that shipped", () => {
        // Regression on the TEST, not on the text: the sentence below is the one
        // `post` carried at :56 while the old guard passed. If a future edit makes
        // the matcher lenient again, this fails before the description does.
        const shipped = "Pass `to` (an email or user id of a channel member) when your message is a request aimed at one specific person's agent: that member's listener is then the only one triggered.";
        const caught = OTHER_SIDE.test(shipped) && STARTS.test(shipped) && !KEYED.test(shipped);
        (0, vitest_1.expect)(caught, "the negative guard would not catch the shipped sentence").toBe(true);
    });
    /**
     * THE SECOND GUARD, AND IT IS THE GENERAL FORM OF THE FIRST: a sentence must
     * not promise the READER an effect the reader cannot cause.
     *
     * The first guard is one instance of that rule (what a `to=` post does to
     * another member's agent, which is keyed on `as_agent`). ENGAGEMENT is the
     * second, and it slipped past the first guard entirely because it says nothing
     * about "their agent" and nothing about spawning: `recordAgentEngagement`
     * (`src/features/channels/server/service-writes-agents.ts`) now opens with
     * `if (ctx.source === "agent") return;`, so engagement requires a HUMAN
     * CREDENTIAL — `authorKind` is caller-assertable, `ctx.source` is derived from
     * the token and is not — and EVERY post made through this tool is
     * agent-credentialed. So "address it by handle again — that re-engages it"
     * (`channel-ops-agents.ts`, shipped until 2026-07-31) was an instruction whose
     * outcome the reader could not produce, in a result the reader reads.
     *
     * The rule this pins: any sentence asserting that engagement HAPPENS must name
     * the human it depends on, or deny the effect outright. It deliberately does
     * NOT fire on ENDING an engagement ("you go IDLE again on
     * op=\"disengage_agent\"", "parking or dismissing also ENDS any engagement") —
     * that one the reader genuinely can cause, on its own agents and on any agent
     * its operator engaged.
     */
    const ENGAGES = /\b(re-?engages?|re-?engaging|engages?\s|engaged\s+(you|it|them|by|an agent|that agent)|(is|are|was|were|has|have|been|stays?|keeps?|remains?)\s+engaged)\b/i;
    /**
     * …and the sentence names the HUMAN the effect hangs on, or denies the effect.
     * "person" / "people" count: the law says it both ways, and which noun it uses
     * is not the property under test — whether the sentence tells the reader the
     * cause is somebody else is.
     */
    const HUMAN_KEYED = /\bhumans?\b|\bpeople\b|\bpersons?\b|engages? (nothing|nobody|no one|no agent)|cannot engage|no re-?engage|NO RE-?ENGAGE/i;
    (0, vitest_1.it)("never promises ENGAGEMENT without naming the human credential it requires", () => {
        const offenders = sentences.filter((s) => ENGAGES.test(s) && !HUMAN_KEYED.test(s));
        (0, vitest_1.expect)(offenders, `these sentences say engagement happens without keying it on a HUMAN author (an MCP post is agent-credentialed and can never cause it):\n- ${offenders.join("\n- ")}`).toEqual([]);
    });
    (0, vitest_1.it)("the engagement guard has teeth — it catches the exact sentence that shipped", () => {
        // Regression on the TEST. This is `opDisengageAgent`'s second result line as
        // it shipped, offering the caller a remedy that its own credential makes
        // impossible. If a future edit loosens either matcher, this fails before the
        // description does.
        const shipped = "To pick the exchange back up, address it by handle again — that re-engages it.";
        (0, vitest_1.expect)(ENGAGES.test(shipped) && !HUMAN_KEYED.test(shipped), "the engagement guard would not catch the shipped sentence").toBe(true);
        // …and it must NOT fire on the honest statement of the same fact.
        const honest = "Your OWN to_agent post is not that — it addresses another agent and engages nothing, because engagement is stamped only for a HUMAN author.";
        (0, vitest_1.expect)(ENGAGES.test(honest) && !HUMAN_KEYED.test(honest)).toBe(false);
        // …nor on ENDING an engagement, which the reader really can do.
        const ending = 'Parking or dismissing also ENDS any engagement: a process that is not running cannot be listening for anyone.';
        (0, vitest_1.expect)(ENGAGES.test(ending)).toBe(false);
    });
    (0, vitest_1.it)("does not describe a thread as writable by exactly two members with no exception", () => {
        // The pair rule is still the default and still stated — but a breakout
        // room supersedes it, and a description that says only the first sends an
        // agent away from a thread it is a participant of.
        (0, vitest_1.expect)(DESCRIPTION).toContain("whose participant set (people and agents, see op=\"get_thread\") replaces that pair");
    });
});
(0, vitest_1.describe)("the multiplayer ops are documented where an agent will look", () => {
    (0, vitest_1.it)("every new op is named in the description (the parity contract, asserted here too)", () => {
        for (const op of [
            "agents",
            "summon_agent",
            "rename_agent",
            "set_agent_status",
            "disengage_agent",
            "join_thread",
            "leave_thread",
        ]) {
            (0, vitest_1.expect)(DESCRIPTION, `op="${op}" is undocumented`).toContain(`"${op}"`);
        }
    });
    (0, vitest_1.it)("post teaches that as_agent is REQUIRED for agent attribution and is server-verified", () => {
        (0, vitest_1.expect)(DESCRIPTION).toContain("it is REQUIRED for a post to be attributed to an agent at all");
        (0, vitest_1.expect)(DESCRIPTION).toContain("SERVER-VERIFIED");
    });
    (0, vitest_1.it)("create_thread teaches the participants form", () => {
        (0, vitest_1.expect)(DESCRIPTION).toContain('"agent:<handle>" / "user:<email>"');
    });
    (0, vitest_1.it)("dismissal is described as a status, not a delete", () => {
        (0, vitest_1.expect)(DESCRIPTION).toContain('"dismissed" is a status, NOT a delete');
    });
});
