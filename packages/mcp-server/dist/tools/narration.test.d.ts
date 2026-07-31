/**
 * THE SWEEP INTO THE REST OF THE MCP SURFACE — part 1 of 2.
 *
 * Two earlier passes hardened `dopl_channel`: first its read ops, then (after a
 * reviewer found the enumeration itself was the bug) its write ops, its member
 * resolver, and a class nobody had named. Both passes stopped at the channel
 * files. Every other tool splices the same kind of string into the same kind of
 * line, and this file plus `tool-narration.test.ts` pin what changed.
 *
 * What is pinned HERE:
 *
 *   1. ONE DEFINITION. The neutralizer moved out of `channel-shared.ts` into
 *      `narration.ts` so nine tools could reach it without importing from the
 *      channel module. The mechanical guard is that `channel-shared` re-exports
 *      the SAME function object and that no second declaration exists anywhere
 *      in the tree — a copied neutralizer is the failure mode the helper's own
 *      note warns about, and the copy that drifts is the one that stops
 *      neutralizing.
 *
 *   2. THE WORKSPACE NAME — the widest reach found in this sweep, and it is
 *      wider than the channel's. `workspaces.name` / `.description` are bounded
 *      by LENGTH ONLY (`z.string().min(1).max(120)` / `.max(2000)`,
 *      features/workspaces/schema.ts) — no charset rule, unlike the
 *      `display_name` regex added for profiles. They are set by whoever OWNS
 *      each workspace, and a workspace enters your directory the moment you
 *      accept an invitation or a join link, so the author need share no other
 *      context with you at all.
 *
 *      And they landed in the two most trusted surfaces in the protocol: the
 *      MCP `instructions` block (the server's own briefing, read before every
 *      tool result) and the `_dopl_status` footer appended to EVERY successful
 *      tool response — the line the instructions themselves tell the agent to
 *      read to confirm where a call landed.
 *
 * The SDK `McpServer` is mocked exactly as in `server.test.ts`; nothing
 * transports.
 */
export {};
