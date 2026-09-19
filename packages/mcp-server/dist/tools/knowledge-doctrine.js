"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.KNOWLEDGE_DOCTRINE = exports.KNOWLEDGE_DOCTRINE_URI = void 0;
exports.KNOWLEDGE_DOCTRINE_URI = "dopl://doctrine/knowledge";
/**
 * ⚠ ≤750 chars, asserted. Both halves: how to read, and what to write.
 *
 * 🔒 **500 → 750 ON 2026-09-18 (+~250), AND THE RISE IS THE ENFORCED HALF OF
 * THE WRITE RULES** (Samuel's ruling, fix-list Q1 option A). Two of the four
 * rules below now REFUSE an agent's save, and a rule that refuses has to be
 * readable BEFORE the refusal — an agent learning a blocking rule from the
 * block is an agent that has already lost the write it was mid-way through.
 *
 * ⚠ **IT IS PULLED, NOT PUSHED, AND THAT IS WHY IT IS AFFORDABLE.** The same
 * ~250 characters in `knowledge.ts › KB_DESCRIPTION` would be paid on EVERY
 * connection and would breach `HARD_DESCRIPTION_CEILING` (2,000; `dopl_kb`
 * measures ~1,888 of it). The refusals themselves are per-call
 * (`write-result-budget.test.ts`) and cost nothing until they fire.
 *
 * ⚠ **WHAT WAS DELIBERATELY LEFT OUT: the ARGUMENT for each rule.** Wave 4's
 * measurements (a 20:1 read-waste ratio on unsectioned entries; the one-word
 * excerpt that produced the trial's only reproducible wrong turn) belong in the
 * knowledge base that measured them, not in a document served to every agent.
 * A doctrine is the rules; the evidence for them is not agent-facing text.
 */
exports.KNOWLEDGE_DOCTRINE = `# Sections

READ: excerpt (get_tree) → section → body; stop at the first that answers.
get_tree and read_file list an entry's headings; op="outline" adds what each
one COSTS. read_file(section=) returns that heading, and an unknown one
answers with the outline.

WRITE — the first two REFUSE an agent's save:
- excerpt= required: what a reader FINDS here (a value, a decision, a heading
  name). One word, or the title again, is refused.
- entries past ~1.5k chars carry ## headings, one topic each; unsectioned
  cannot be read in sections. write_file(section=) replaces one.
- point at a target by base/path; "see the approval ladder" names nothing.
- an entry that replaces another says so in its FIRST line, and in the
  superseded entry's excerpt.
`;
