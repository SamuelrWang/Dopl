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
 * "nothing acts unless addressed" into a suggestion, or that restores an
 * unconditional "addressing a person only notifies them".
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
    (0, vitest_1.it)("states the one rule: NOTHING ACTS UNLESS ADDRESSED", () => {
        (0, vitest_1.expect)(DESCRIPTION).toContain("NOTHING ACTS UNLESS ADDRESSED");
        (0, vitest_1.expect)(DESCRIPTION).toContain("to_agent=");
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
    (0, vitest_1.it)("says `as_agent` is REQUIRED to post into a breakout thread you are in as an agent", () => {
        // `mayWriteThread` (src/features/channels/server/service-writes-metadata.ts):
        // once a thread has participants, an AGENT participant may post only when
        // the call supplied `authorAgentId`. Nothing in the tool said so, and the
        // 403 it produces used to advise opening a second thread.
        (0, vitest_1.expect)(DESCRIPTION).toContain("also REQUIRED to post into a BREAKOUT THREAD you belong to as an agent");
    });
    (0, vitest_1.it)("names the two things to act on, and calls everything else ambient context", () => {
        (0, vitest_1.expect)(DESCRIPTION).toContain("messages in a breakout thread you are a participant of");
        (0, vitest_1.expect)(DESCRIPTION).toContain("main-room messages addressed to you");
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
    (0, vitest_1.it)("keeps the law SHORT — it is read on every connection", () => {
        const law = DESCRIPTION.slice(DESCRIPTION.indexOf("THE LAW OF THIS ROOM"), DESCRIPTION.indexOf("THE MODEL"));
        (0, vitest_1.expect)(law.split("\n").filter((l) => l.trim()).length).toBeLessThanOrEqual(8);
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
