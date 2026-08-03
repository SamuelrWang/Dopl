/**
 * THE CONTACT PATH IS DISCOVERABLE — the routing pins for `dopl_channel`.
 *
 * THE INCIDENT. A fresh external session was told "ask Sam's agent what he did
 * recently" and spent its first ~10 tool calls wandering: `dopl_map`, then
 * `dopl_members` three times, then `dopl_chats`, then `dopl_kb`. It found the
 * CHANNELS feature at all only because one knowledge-base entry happened to
 * mention a past exchange. Every call it made was a reasonable call. Nothing it
 * read said that reaching another MEMBER or their AGENT is a thing this product
 * does, or which tool does it.
 *
 * WHY THE DISCOVERY SURFACE, AND NOT THE CHANNEL TOOL. `dopl_channel` already
 * carries the most detailed description in this server — and it is DEFERRED in
 * some clients, which means that description is not loaded until ToolSearch
 * fetches it, and the tool NAME is the entire pre-discovery signal. An agent
 * deciding where to look reads three things first: the server instructions, the
 * `dopl_map` result the instructions tell it to fetch, and (for anything about
 * people) `dopl_members`. All three described a workspace of knowledge bases,
 * skills, workflows and clusters. This suite pins the sentence into each one.
 *
 * WHAT THESE ARE AND ARE NOT. Every assertion here is a string match on ROUTING
 * prose. None of them touches an op, a gate, or a permission: the additions say
 * WHICH TOOL reaches a person, and `dopl_channel`'s own description remains the
 * single source on what a post costs and who may make one. The last test in the
 * file is the guard on exactly that.
 *
 * Sibling suites: `tool-scope-claims.test.ts` (descriptions may not overclaim)
 * and `tool-scope-footers.test.ts` (results carry their own scope). This one is
 * the third question those two do not ask: is the destination NAMED anywhere an
 * agent will actually look?
 */
export {};
