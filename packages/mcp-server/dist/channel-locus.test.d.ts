/**
 * THE LOCUS LINE — `_dopl_status: caller: … · as <handle> (<id>)`.
 *
 * The footer rides every successful response and is the line the server
 * instructions tell an agent to read to confirm who and where it is. Once a
 * session can speak for several named agents, "who" has a second half: the
 * agent identity THIS call was attributed to.
 *
 * WHY IT IS THREADED THROUGH THE RESULT, which is what these tests exist to
 * hold: `as_agent` is chosen per CALL, while `CallerIdentity` is resolved once
 * per connection. Stamping the boot identity would make every later response —
 * including reads that named no agent at all — claim the last agent that
 * happened to post. So the handler tags its result, the footer reads the tag,
 * and the tag is STRIPPED before the response leaves the server.
 *
 * The SDK `McpServer` is mocked exactly as in `server.test.ts`, so the real
 * wrapper (workspace resolution + footer) runs over a stubbed @dopl/client.
 */
export {};
