/**
 * THE PARTICIPANT SET, MUTATED — `dopl_channel` join_thread / leave_thread.
 *
 * What these pin:
 *
 *  1. THE WIRE. A member goes out as `{kind:"user", id}` and an agent as
 *     `{kind:"agent", id}`, with the handle resolved to a row of THIS channel;
 *     naming BOTH is refused rather than silently preferring one, and naming
 *     NEITHER says which param to pass.
 *  2. WHAT ADMISSION DOES NOT DO. `joinThreadParticipant` inserts ONE row: it
 *     posts no message, and `channel_task_participants` is deliberately NOT in
 *     the realtime publication, so admitting a person reaches them on no
 *     surface at all. This line used to promise the opposite (B3). An admitted
 *     AGENT is likewise only half-admitted until a post CLAIMS it with
 *     `as_agent`, which `mayWriteThread` checks (S1).
 *  3. WHICH RULE A 403 MEANS. Thread curation, channel membership and ejection
 *     are three different refusals; mapping them all to "you are not a member
 *     of that channel" turned an ordinary refusal into an alarming false claim
 *     about the caller's own membership, and must never send the caller off to
 *     manufacture a duplicate room.
 *
 * THE OTHER HALF: the ops that write the AGENT ROW itself (agents /
 * summon_agent / rename_agent / set_agent_status / disengage_agent) stay in
 * `channel-ops-agents.test.ts`, which this was split out of at the §2 500-line
 * cap — see that file's header for why the seam runs between the two tables.
 * SEEDING a set at open time, rather than mutating one that exists, is a third
 * suite: `channel-thread-participants.test.ts`. The harness this shares with
 * the agent-row half is `agent-ops-fixtures.ts`.
 *
 * The @dopl/client is hand-stubbed; nothing transports.
 */
export {};
