"use strict";
/**
 * **THE REMOVED-VOCABULARY TABLE** — named-agent surfaces that no longer exist,
 * and the one statement of what a shipped string may not say.
 *
 * ⚠ **SPLIT OUT ON 2026-09-01, AND THE FILENAME IS LOAD-BEARING.**
 * `channel-law.test.ts` reached the 500-line cap when the `rename_agent` revival
 * needed its ruling written down; the table and the source-wide scan moved out
 * together (`law-scan.test.ts`). **This file is deliberately NOT named
 * `channel-*.ts`**, because the scan globs `channel-*.ts` and this module
 * literally CONTAINS the banned words as regexes — a prefixed filename would make
 * the guard fail on its own rule book. It carries no handler, so the parity
 * split-scan (which requires `channel-` on files that DO) does not want it either.
 *
 * ⚠ IT IS A PLAIN MODULE AND NOT A `.test.ts` ON PURPOSE: importing one test file
 * from another registers its `describe` blocks twice.
 *
 * ⚠ A description mentioning one of these does not merely mislead — it names ops
 * an MCP client rejects as invalid enum values, so the pin is total: the words
 * must not appear. Two consumers, and they ask different questions:
 *   `channel-law.test.ts` — is the DESCRIPTION free of them?
 *   `law-scan.test.ts`    — is every SHIPPED STRING in the directory?
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RETIRED_CHANNEL_OPS = exports.REMOVED_VOCABULARY = void 0;
exports.REMOVED_VOCABULARY = [
    ["engagement", /\bengage/i],
    ["summoning", /\bsummon/i],
    ["to_agent / to_agents", /to_agents?\b/],
    ["as_agent", /as_agent/],
    ["breakout rooms", /breakout|participant set|\bparticipants\b/i],
    ["the thread-open handshake", /thread-open-|handshake/i],
    // ── ⚠ `rename_agent` LEFT THIS ENTRY ON 2026-09-01, AND THE REMOVAL IS A
    //    RULING RATHER THAN A RELAXATION (Samuel's external agent-management wave).
    //
    // This entry banned SEVEN lifecycle ops from the retired NAMED-AGENT surface
    // (channels rollback §1, 2026-08-05), where an agent was a first-class named
    // participant in a channel and `rename_agent` changed its ADDRESS — the model
    // in which `@name` routed to an agent. That model is gone and nothing here
    // brings it back: SIX of the seven stay banned, and the addressing guarantees
    // are re-asserted positively below.
    //
    // What the WORD now names is a different thing entirely, and this tree has
    // already been using it for that thing since 2026-08-31: the in-process
    // `mcp__dopl_agents__rename_agent` sets a LOCAL DISPLAY LABEL on a session
    // instance — stored in `main/agent-names.js` on ONE machine, reaching no
    // server, invisible to every other member, and explicitly NOT an address
    // ("nothing resolves an agent by this string, so a rename cannot re-point a
    // running instruction"). The `dopl_channel` op added in this wave is the SAME
    // verb on the SAME subject, reachable by an EXTERNAL session instead of an
    // in-process one, and it ships that sentence in its own result copy.
    //
    // ⚠ **KEEPING THE BAN WOULD HAVE FORCED A SECOND NAME FOR ONE VERB** — an
    // operator's agent renamed one way from inside a session and another way from
    // outside it — which is a worse teaching failure than the one this entry was
    // written to prevent, and it would have made the two surfaces look like two
    // capabilities. ⚠ **THE REAL GUARD IS THE ADDRESSING ONE**, and it is stronger
    // than a banned word: `test("the revived rename_agent teaches a LABEL, never an
    // ADDRESS")` below drives the shipped copy.
    ["the agent lifecycle ops", /set_agent_status|disengage_agent|join_thread|leave_thread/],
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
    // ── THE `await` OP, retired 2026-09-02 (B8) and DELETED at slice B16 ──────
    // The hold is `op="read"` carrying `wait_ms`, and the verb this surface means
    // is HOLD. ⚠ **A BANNED WORD RATHER THAN A ROW IN `RETIRED_CHANNEL_OPS`,
    // BECAUSE THE OP-POSITION SCAN WAS NOT ENOUGH**: the send lane shipped a
    // `await=since:<seq>` FACT KEY on every write, which names the retired lane
    // without ever writing `op="await"`. That key is `hold=` now, and the word is
    // measured absent from every shipped string in this directory — which is what
    // makes the ban enforceable rather than aspirational.
    // ⚠ It is a rule about SHIPPED STRINGS only; the `await` KEYWORD is on nearly
    // every line of this package and is not a literal, so the scan cannot see it.
    ["the await op", /\bawait\b/i],
];
/**
 * **THE TWENTY-TWO OP NAMES THE COLLAPSE RETIRED** (B8, 2026-09-02), and they
 * stopped PARSING at slice B16 one release later.
 *
 * ⚠ **A DIFFERENT QUESTION FROM {@link REMOVED_VOCABULARY}, WHICH IS WHY IT IS A
 * SECOND EXPORT RATHER THAN MORE ROWS.** That table bans WORDS anywhere in a
 * shipped string; these are ordinary words elsewhere — `list`, `update`, `open`,
 * `members` and `help` are live ops on other tools — so the scan that reads this
 * one matches a `dopl_channel` op POSITION, never the bare word
 * (`law-scan.test.ts`).
 *
 * ⚠ **IT LIVES HERE BECAUSE THIS FILE IS THE ONE THE SCAN SKIPS.** The rule book
 * literally contains the strings it forbids; a copy in any `channel-*.ts` would
 * fail the guard on the file that defines it.
 *
 * ⚠ **THE ONE-LINE REDIRECTS ARE GONE WITH `channel-retired-ops.ts`** — these
 * names now fail schema validation with the refusal `channel-schema.ts ›
 * unknownOpRefusal` writes. `read` is deliberately ABSENT: it is the one old
 * name that survived the collapse with its own meaning.
 */
exports.RETIRED_CHANNEL_OPS = [
    "post",
    "milestone",
    "escalate",
    "ping",
    "pings",
    "create_thread",
    "list",
    "open",
    "invite",
    "members",
    "list_threads",
    "set_thread_mode",
    "update",
    "help",
    "await",
    "launch_agent",
    "end_agent",
    "rename_agent",
    "set_agent_mode",
    "direct_agent",
    "read_directions",
    "read_sessions",
];
