/**
 * **THE FACE AN UNNAMED AGENT WEARS — `New Agent`, and nothing else** (Samuel, 2026-09-15,
 * verbatim: *"if a user launches an agent with no name, just give it the name, New Agent"*).
 *
 * ⚠ **IT REPLACES `#<id>`, AND THAT IS THE WHOLE RULING.** The unnamed face was the raw
 * eight-character instance id with a literal `#` in front of it, which INVARIANTS §11 defended
 * as *"a NAME the operator was shown at launch and accepted, not an id leaking through"*.
 * Samuel withdrew that carve-out in as many words — *"I want to make it so that the user really
 * doesnt see it"* — so the face is a WORD now. `docs/specs/agent-id-visibility.md` carries the
 * trace of every surface that was reading the id through it.
 *
 * ⚠ **ONE CONSTANT, BECAUSE THE OLD STRING WAS WRITTEN OUT TWICE AND THAT WAS THE BUG.**
 * `channels/components/agents-model.ts › agentDisplayName` (every card, header, window title,
 * rail tab and picker row) and `channels/components/attribution-pill.tsx › attributionName`
 * (every transcript row) each carried their own `` `#${agentId}` `` — and the pill was EXEMPTED
 * from the sweep that was supposed to catch exactly that (`agent-id-visibility.test.ts`). A
 * third reader has since appeared on the server (`home/server/overview-tally.ts › mapAgents`,
 * which fell back to `channel_sessions.name`, i.e. the id itself). Three copies, one string.
 *
 * ⚠ **IT IS A FACE, NEVER A STORED NAME, ON EVERY PATH BUT ONE.** `main/agent-names.js` still
 * answers `null` for an agent nobody named, and that ABSENCE is what several modules key on
 * (a rename to `""` CLEARS, `patched` drops an empty row, `MAX_NAMES` bounds the set). The one
 * path that genuinely STORES this string is a human launch submitted with the field blank
 * (`channels/components/use-agent-launch-run.ts`), because Samuel asked for the agent to BE
 * named — and because a stored name is what makes two blank launches CONTEST `@new-agent` and
 * produce a diagnostic, where two nameless ones would silently resolve to nobody.
 *
 * ⚠ **NO `"use client"`.** It is read by the SPA, by a React component and by a SERVER
 * projection; a client directive here would make the third an import error.
 *
 * ⚠ **THE DESKTOP AND THE MCP PACKAGE HAND-COPY IT**, because neither can import `src/`:
 * `dopl-desktop-app/main/launch-directive-spawn.js` (a legacy directive that carries no name)
 * and `packages/mcp-server/src/tools/channel-session-render.ts`. Same arrangement every
 * cross-tree constant in this repo lives under; the copies name this file.
 */

/** The one face. ⚠ Title case and a space — it is a NAME a person reads, not a slug. */
export const NEW_AGENT_NAME = "New Agent";

/**
 * **THE NAME TO SHOW FOR ONE AGENT** — the operator's own, else {@link NEW_AGENT_NAME}.
 *
 * ⚠ **WHITESPACE-ONLY IS ABSENT.** A name of `"   "` is a name nobody typed on purpose and
 * renders as a blank line, which is strictly worse than the word (INVARIANTS §11: UNKNOWN is
 * not EMPTY, and an empty label is not a fact).
 * ⚠ **IT TAKES THE NAME, NOT THE SESSION.** The three callers hold three different session
 * shapes (a desktop summary, a transcript row, a `channel_sessions` row) and none of them
 * should have to be described here for one string to be chosen.
 */
export function agentFaceName(displayName: string | null | undefined): string {
  const own = typeof displayName === "string" ? displayName.trim() : "";
  return own.length > 0 ? own : NEW_AGENT_NAME;
}
