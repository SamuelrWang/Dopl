// THE UNREACHABLE-KNOWLEDGE LINES (main/prompt-framing-template.js, 2026-09-05, Samuel's ruling).
//
// WHAT MATTERS HERE, in the order the risk runs:
//   - NO LEAK. The role block may say the agent lacks access; it may NEVER say where the base
//     lives. Only a COUNT crosses the wire (`template-resolve.js › narrow`), so the only way a
//     location could appear in a prompt is if this module invented one.
//   - THE SENTENCE IS THE OPERATOR'S, VERBATIM: "I don't have access to this knowledge base in
//     this channel." Quoted in the prompt so it is repeated rather than paraphrased into a guess.
//   - ABSENT IS ABSENT. No unreachable attachments ⇒ the block is BYTE-IDENTICAL to what it was
//     before this landed. A garbled or missing count reads 0, never "something is missing".
//   - IT IS ADDITIVE. The reachable section is untouched, and a template with both gets both.
//
// Run: `node --test dopl-desktop-app/test/prompt-framing-knowledge-reach.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const M = (f) => require(fileURLToPath(new URL(`../main/${f}`, import.meta.url)));
const { templateRoleFraming } = M("prompt-framing-template.js");

const N = "n1";
const KB = "cccccccc-3333-4ddd-8eee-ffffffffffff";
const SENTENCE = "I don't have access to this knowledge base in this channel.";

const tpl = (over = {}) => ({
  name: "Code Auditor",
  instructions: "Audit the diff.",
  model: null,
  fields: [],
  knowledgeBases: [],
  authoredByCaller: true,
  ...over,
});
const block = (over = {}, ctx = {}) =>
  templateRoleFraming({ template: tpl(over), ...ctx }, N).join("\n");

// ── 1. ABSENT IS ABSENT ──────────────────────────────────────────────────────

test("no unreachable attachments ⇒ the block is unchanged, whatever shape the field arrives in", () => {
  const base = block();
  // ⚠ 0 IS THE FAIL DIRECTION. An older server omits the key; a garbled one must not become a
  // prompt line telling an agent it was denied something nobody attached.
  for (const value of [undefined, null, 0, -1, "2", NaN, {}, [], true]) {
    assert.equal(block({ unreachableKnowledgeBaseCount: value }), base, JSON.stringify(value));
  }
});

// ── 2. THE REFUSAL, WHEN THERE IS ONE ────────────────────────────────────────

test("one unreachable base ⇒ the operator's sentence, verbatim", () => {
  const text = block({ unreachableKnowledgeBaseCount: 1 });
  assert.match(text, /ATTACHED KNOWLEDGE YOU CANNOT REACH:/);
  assert.ok(text.includes(SENTENCE), "the ruled sentence must appear verbatim");
  assert.match(text, /One knowledge base attached to this role is not available/);
});

test("several read as several, and the sentence does not change", () => {
  const text = block({ unreachableKnowledgeBaseCount: 3 });
  assert.match(text, /3 knowledge bases attached to this role are not available/);
  assert.ok(text.includes(SENTENCE));
});

// ── 3. NO LEAK, AND NO GUESSING ──────────────────────────────────────────────

test("says nothing about WHERE — no id, no name, no workspace, no container", () => {
  // 🔒 The count is all the desktop is given, so the only leak possible is an invented one. The
  // block is also told not to go looking: guessing a substitute would be the same disclosure by
  // another route.
  const text = block({ unreachableKnowledgeBaseCount: 1 });
  for (const word of [KB, "workspace", "container", "elsewhere", "another channel"]) {
    assert.ok(!text.includes(word), `must not mention ${word}`);
  }
  assert.match(text, /Do not\s+guess/);
  assert.match(text, /do not say where it might live/);
});

// ── 4. ADDITIVE, NEVER A REPLACEMENT ─────────────────────────────────────────

test("a template with one reachable and one unreachable base gets BOTH sections", () => {
  // ⚠ TWO SECTIONS, NOT ONE. "Here is what to open" and "here is what to say when something is
  // missing" are different instructions, and folding the refusal under the list of live bases
  // would put it beside the very thing it is not about.
  const text = block(
    { knowledgeBases: [{ id: KB, name: "Ops Notes" }], unreachableKnowledgeBaseCount: 1 },
    { profile: "full" }
  );
  assert.match(text, /ATTACHED KNOWLEDGE:/);
  assert.match(text, /- Ops Notes {2}\(mcp__dopl__dopl_kb/);
  assert.match(text, /ATTACHED KNOWLEDGE YOU CANNOT REACH:/);
  assert.ok(text.indexOf("ATTACHED KNOWLEDGE:") < text.indexOf("YOU CANNOT REACH"));
  assert.ok(text.includes(SENTENCE));
});

test("the refusal stands alone when NOTHING resolved — the ruled case", () => {
  // The shared base on a personal template, launched where it does not resolve: the reachable
  // section is empty and would have been the whole story before today.
  const text = block({ knowledgeBases: [], unreachableKnowledgeBaseCount: 1 });
  assert.ok(!text.includes("ATTACHED KNOWLEDGE:"), "no list heading with nothing to list");
  assert.match(text, /ATTACHED KNOWLEDGE YOU CANNOT REACH:/);
  assert.ok(text.includes(SENTENCE));
});
