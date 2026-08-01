/**
 * THE AGENT ROW — `dopl_channel` agents / summon_agent / rename_agent /
 * set_agent_status / disengage_agent.
 *
 * Two things are pinned here, and the second is a security property:
 *
 *  1. WHAT EACH OP DOES. A handle resolves to a row of THIS channel (so
 *     `rename_agent` sends an agent ID even though the caller typed `@quartz`),
 *     and every refusal says what did NOT happen — an agent that reads "nothing
 *     changed" does not retry blind. The refusals are also not
 *     interchangeable: rename/park is OWNER-ONLY, disengage is
 *     OWNER-OR-ENGAGER, and borrowing one line for the other op talks a caller
 *     out of the one write they are entitled to make.
 *  2. NARRATION. An agent HANDLE is member-typed and an agent's OWNER NAME is
 *     `profiles.display_name`, which nothing in the product validates. Both
 *     land in lines this tool wrote, outside any untrusted-content framing, so
 *     both go through the neutralizer — and NO handle is ever rendered without
 *     its immutable id, because the handle is the owner's claim and the id is
 *     the server's record.
 *
 * THE OTHER HALF: `join_thread` / `leave_thread` are in
 * `channel-ops-participants.test.ts`, split out of here at the §2 500-line cap.
 * The seam is the row being written: everything below mutates the AGENT row
 * (`channel_agents`, via `createChannelAgent` / `updateChannelAgent`) under the
 * owner rule, while join/leave mutate the PARTICIPANT SET
 * (`channel_task_participants`, via `addThreadParticipant` /
 * `removeThreadParticipant`) under the thread-curation rule — a different
 * table, a different authority, and a 403 that means something else. The
 * harness both halves need is `agent-ops-fixtures.ts`.
 *
 * The forgery payload and its assertions are the SHARED ones
 * (`narration-fixtures.ts`) — a private copy is how an assertion drifts into
 * meaning something weaker. The @dopl/client is hand-stubbed; nothing
 * transports.
 */
export {};
