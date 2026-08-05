/**
 * ROLLBACK §3.5 — the three session capabilities that replace summon / to_agent.
 *
 * read-session-state ("read_sessions") and spawn-with-handoff (create_thread
 * handoff=true) are pinned here at the MCP layer: the shape the read returns,
 * the empty answer's honesty about the flagged delivery gap, and that the
 * handoff flag rides the create through to the client AND flips the result from
 * "arm await here" to "the operator's window took it".
 *
 * message-a-session's PEER direction is NOT a new op — it is a plain request
 * into the thread the peer's session is working (§3.1), already covered by the
 * post/create_thread suites — so there is nothing new to pin here for it; the
 * one genuinely new bit (an external agent steering its OWN desktop window) is a
 * flagged desktop gap, not a server op.
 *
 * Fake-client pattern is the channel-ops house one: registration/handlers are
 * pure over the client, so a `vi.fn` per method is all a test needs.
 */
export {};
