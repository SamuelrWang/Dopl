"use strict";
/**
 * Words no shipped string may say (`channel-law.test.ts`, `law-scan.test.ts` and other suites
 * scan with it). The filename is load-bearing: this rule book contains the
 * banned words, so it stays out of the `channel-*` tool group and `law-scan.test.ts` skips it by name.
 * A plain module, not a `.test.ts`: importing one test file from another registers it twice.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RETIRED_CHANNEL_OPS = exports.VERBATIM_QUOTES = exports.REMOVED_VOCABULARY = void 0;
exports.REMOVED_VOCABULARY = [
    ["engagement", /\bengage/i],
    ["summoning", /\bsummon/i],
    ["to_agent / to_agents", /to_agents?\b/],
    ["as_agent", /as_agent/],
    ["breakout rooms", /breakout|participant set|\bparticipants\b/i],
    ["the thread-open handshake", /thread-open-|handshake/i],
    // `template` was renamed `identity` with no alias; qualified forms only, since the ontology keeps
    // its own `template`.
    ["agent templates (now agent identities)", /\btemplate=|\bagent[ -]templates?\b/i],
    // `rename_agent` is deliberately absent here: it now names a display-label op, never an address
    // (`law-description-pointer.test.ts` guards the label wording).
    ["the agent lifecycle ops", /set_agent_status|disengage_agent|join_thread|leave_thread/],
    ["the agents roster op", /op="agents"/],
    // Threads never close: a surviving sentence sends an agent waiting for a transition that never comes.
    ["the propose_close op", /propose_close/],
    ["the close_thread op", /close_thread/],
    // Verb + thread in either order; deliberately not a bare /clos/ (fail-closed is live English).
    [
        "closing a thread",
        /\bclos(e|es|ed|ing)\s+(the\s+|a\s+|this\s+|that\s+|its\s+)?thread|\bthread('s)?\s+(is\s+|was\s+|been\s+)?clos(e|ed|ing)/i,
    ],
    // Reopen has no other meaning on this surface.
    ["reopening a thread", /\breopen/i],
    ["the close-proposal / reopen markers", /closeProposed|closeOutcome|threadReopened/],
    // Legacy columns: reporting a state teaches an agent to wait on it.
    ["thread status / outcome vocabulary", /\bthread('s)?\s+(status|outcome)\b|\boutcome summar(y|ies)\b/i],
    // A banned word, not a `RETIRED_CHANNEL_OPS` row: fact keys named the lane without an op position.
    // Shipped strings only; the `await` keyword is not a literal.
    ["the await op", /\bawait\b/i],
];
/**
 * Exact-string exemption (matched whole, never `includes`) for `channel-hold-budget.ts ›
 * DESKTOP_HOLD_REFUSAL`, which quotes the desktop's `session-permissions.js › AWAIT_DENY_MESSAGE`
 * verbatim; rewording both halves to say "the hold" is an open decision.
 */
exports.VERBATIM_QUOTES = new Set([
    "await is not available in a desktop-run session: end your turn; you are woken when addressed.",
]);
/**
 * Retired `dopl_channel` op names, refused by schema validation (`channel-vocab.ts › unknownOpRefusal`).
 * Separate from {@link REMOVED_VOCABULARY} because these are ordinary words elsewhere, so
 * `law-scan.test.ts` matches them only in an op position. `read` survived and is absent.
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
