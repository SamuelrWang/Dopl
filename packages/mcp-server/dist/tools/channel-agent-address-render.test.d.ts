/**
 * WHICH AGENTS A MESSAGE NAMED — the fact the read ops did not render, and the
 * wake notice that was false because of it (BLOCKER-3).
 *
 * THE BUG. `formatMessage` rendered `metadata.to_user_id` alone. The server
 * stamps that from the FIRST addressed agent's OWNER, so "@quartz @onyx work on
 * X" came back as `· to <quartz's owner>` and nothing else. Two consequences,
 * both of them about a rule THE LAW states and an agent then cannot follow:
 *
 *  1. A CO-ADDRESSED AGENT COULD NOT SEE IT WAS NAMED. "Addressed alongside
 *     another agent? EXACTLY ONE OF YOU OPENS THE THREAD, the one whose agent id
 *     sorts first" is unusable if the line never says which agents were
 *     addressed — there is nothing to sort, and nothing that says the rule
 *     applies at all.
 *  2. `AWAIT_UNNAMED_NOTICE` WAS ACTIVELY WRONG for the second agent's side.
 *     Its owner is not `to_user_id`, so the wake said "NONE of the messages
 *     above NAMES you as its addressee" about a message that named their agent
 *     by handle — the precise instruction not to act on the work just assigned.
 *
 * What is pinned: the tag renders, it carries the immutable id beside every
 * handle, it does not claim "unaddressed", the roster read is fail-soft and is
 * skipped entirely when nothing names an agent, and the notice counts an agent
 * address as a naming.
 *
 * The @dopl/client is hand-stubbed; nothing transports.
 */
export {};
