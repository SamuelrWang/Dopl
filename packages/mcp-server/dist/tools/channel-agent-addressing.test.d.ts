/**
 * AGENT ADDRESSING ON `op="post"` — `to_agent` / `as_agent`, the `to_agents`
 * multi-address, and `intent`.
 *
 * What these pin, and why each one is worth a test:
 *
 *  - A HANDLE IS RESOLVED TO AN ID before the call. An agent knows the name the
 *    room addresses it by, not a uuid; the route wants the uuid. If that
 *    resolution regresses, every agent-addressed post silently becomes an
 *    ordinary one.
 *  - AN ORDINARY POST PAYS NOTHING. No `to_agent`/`as_agent` means no roster
 *    round-trip at all — this is the hot write path.
 *  - AN AGENT IDENTITY IS NOT ASSUMABLE. The server refuses a foreign
 *    `as_agent` with a 403; the tool must say what was refused and that nothing
 *    was posted, or the caller re-sends the same forbidden claim.
 *  - AN AGENT ADDRESS IS AN ADDRESS. The server stamps the agent's OWNER as
 *    `to_user_id`, so a `to_agent` post wakes a machine and must NOT carry the
 *    "nothing put this in front of an agent" warning.
 *  - AND WHEN BOTH ADDRESSES ARE SET, the agent's owner wins — silently at the
 *    route, so the result has to say it.
 *
 * THE OTHER HALF: the thread PARTICIPANT SET — `create_thread`'s `participants`
 * seed and the set `get_thread` renders — is `channel-thread-participants.test.ts`,
 * split out of here at the §2 500-line cap along the line the ops already draw.
 * Addressing decides who ONE MESSAGE reaches and is resolved per post; a
 * participant set decides who may write in a ROOM at all and is seeded once,
 * server-side, against a different roster. Neither half's refusals are reachable
 * from the other's code path. The harness both need is
 * `agent-addressing-fixtures.ts` — shared, because the channel-vs-workspace
 * roster asymmetry it encodes is the subject of one half's tests.
 *
 * The @dopl/client is hand-stubbed; nothing transports.
 */
export {};
