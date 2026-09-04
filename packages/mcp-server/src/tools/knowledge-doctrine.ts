/**
 * `dopl://doctrine/knowledge` — the standing rules for reading and writing a
 * knowledge base, PULLED (2026-09-03, headings-as-addresses).
 *
 * ⚠ **IT IS ONE BLOCK, AND THAT IS THE WHOLE DOCUMENT ON PURPOSE.** The
 * channels doctrine is ~9k characters because a channel has a protocol, a
 * lifecycle and an etiquette; a knowledge base has a filesystem, and
 * `dopl_kb`'s own arguments describe it. What was NOT expressible in an
 * argument is the ORDER — cheapest surface first — and the reciprocal duty that
 * makes the order possible: an entry nobody sectioned cannot be read in
 * sections. Both halves are here, and neither is anywhere else in full.
 *
 * ⚠ **THE BUDGET IS 500 CHARACTERS AND IT IS ASSERTED**
 * (`knowledge-doctrine-budget.test.ts`). A pulled document is cheap, not free,
 * and the failure mode of a cheap document is that it becomes where every
 * evicted paragraph lands — which is the argument `tool-budget.test.ts ›
 * DOCTRINE_CEILING` exists to make.
 *
 * ⚠ **THE ROUTING SENTENCE IS ALSO IN THE TOOL DESCRIPTION, AND THE DUPLICATION
 * IS DELIBERATE.** Several MCP clients list tools and read no resources at all;
 * an agent that has not pulled this file is exactly the one still reading whole
 * documents. The description carries the one-line form, this carries the reason.
 */

export const KNOWLEDGE_DOCTRINE_URI = "dopl://doctrine/knowledge";

/** ⚠ ≤500 chars, asserted. Both halves: how to read, and what to write. */
export const KNOWLEDGE_DOCTRINE = `# Sections

READ: excerpt (get_tree) → outline → section → body, in that order, and stop at
the first one that answers. op="outline" lists an entry's #/##/### headings and
what each costs; read_file(section="<heading>") returns that heading and its
content. Unknown heading ⇒ the outline comes back, so no second call.

WRITE: entries over ~1.5k chars carry ## headings, one topic each — an entry
nobody sectioned cannot be read in sections. write_file(section=) replaces one.
`;
