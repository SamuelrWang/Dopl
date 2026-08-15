/**
 * Skill-authoring framework loaded into the MCP server prompt and served by
 * `dopl_skill(op='authoring_guide')`.
 *
 * ⚠ Reconciles two conflicting sources: the Agent Skills spec wants
 * descriptions carrying both *what* + *when*, while empirical work shows a
 * description that SUMMARIZES the workflow makes Claude skip the body. So: lead
 * with concrete *what*, then heavy *when*-triggers, and NEVER summarize the
 * workflow/steps in the description.
 */

export const SKILL_AUTHORING_GUIDE = `# Skill authoring framework

A skill is a SINGLE-FILE procedural prompt: one tight SKILL.md the agent discovers by description alone, then loads on-demand to perform a task. Author for *progressive disclosure*: cheap to discover, useful to load, deep when drilled into. Optimize for triggering accuracy and instruction-following under pressure — not literary completeness.

## Single-file doctrine (read this first)

- **A skill is ONE file.** There are no supplementary files. Everything the agent needs to *act* lives in SKILL.md.
- **Reference material goes in knowledge bases, not the skill.** Long specs, lookup tables, schemas, transcripts, big examples — put them in a KB and link from the body as \`[label](dopl://kb/<slug>)\`. The agent loads the KB with \`dopl_kb(op='read_file')\` only when it needs it. The skill stays short and procedural.
- **Prefer MANY SMALL skills over monoliths.** One skill = one action (draft the email, triage the ticket, write the ADR). Small skills attach cleanly to ontology objects and trigger more reliably. If a skill is trying to do three things, split it into three.
- **Organize with folders.** Set \`folder\` on create/update (a plain-text label) to group related small skills, e.g. "Outreach", "Research".

## Required SKILL.md structure

Every SKILL.md MUST contain, in order:

1. YAML frontmatter (\`---\` fenced) with at minimum \`name\` and \`description\`. Optionally \`when_to_use\`, \`when_not_to_use\`, \`license\`, \`compatibility\`, \`allowed-tools\`.
2. An H1 title matching the skill's display name.
3. A 1–3 sentence **Overview** stating the skill's core principle.
4. A **When to use / When not to use** section (even if these are also in frontmatter — body version covers nuance).
5. **Steps / Procedure** — the actual playbook, as numbered imperative instructions.
6. **Inputs & outputs** — what the agent should ask for, what it should produce.
7. **Examples** — at least one concrete worked example (input → output).
8. **Common mistakes / anti-patterns** — what goes wrong and the fix.
9. *(Optional)* **References** — KB links (\`dopl://kb/<slug>\`) and connectors (\`dopl://connector/<provider>\`).

## Writing the \`description\` (most important field)

The description is loaded into context for *every* session. It's the only thing the agent sees when deciding whether to invoke the skill. Treat it as a search-and-trigger string, not a marketing tagline.

- **Hard cap: 1024 characters.** Combined with \`when_to_use\` it's truncated at ~1,536 chars in Claude Code's listing — front-load the key use case.
- **State both *what it does* and *when to use it*** in the same field.
- **Be "pushy" — Claude under-triggers skills.** Anthropic's own \`skill-creator\` instructs authors to add phrases like *"Make sure to use this skill whenever the user mentions X, Y, or Z, even if they don't explicitly ask for it"*.
- **Front-load concrete trigger keywords**: file extensions (.pdf, .xlsx), tool names, error messages, domain nouns the user would actually type.
- **Write in third person**, present tense ("Extracts...", "Use when..."). Never first person.
- **Include near-miss disambiguation** if a sibling skill is similar.
- **Never summarize the skill's internal workflow** — that creates a shortcut Claude takes instead of reading the body. Empirical failure mode documented in obra/superpowers.

Bad: \`Helps with PDFs.\`
Good: \`Extracts text and tables from PDF files, fills PDF forms, merges and splits PDFs, OCRs scanned PDFs. Use whenever the user mentions a .pdf file, asks to produce or read a PDF, mentions forms, or wants document extraction — even if they don't explicitly say "PDF".\`

## Writing \`when_to_use\` / \`when_not_to_use\`

These fields are appended to the description for triggering and count toward the listing cap, so they must earn their space.

- \`when_to_use\`: list **3–6 concrete trigger situations**, each starting with "When the user…" or "When working with…". Use phrasings the user would actually utter, including casual/abbreviated forms. Cover edge cases that share keywords with adjacent skills but should still trigger.
- \`when_not_to_use\`: list **near-misses** — situations sharing keywords/concepts but better served by a different skill or no skill at all. The most valuable entries are the genuinely tricky negatives, not "obviously irrelevant" ones.
- Both fields describe **the user's situation**, not the skill's process. Never summarize the workflow here.

## Body structure (canonical section order)

\`\`\`
# <Skill Name>

## Overview         — one paragraph + a "core principle" line in bold
## When to use      — bullets of symptoms / triggers (mirror & expand frontmatter)
## When not to use  — near-misses, escalation paths
## Inputs           — what to ask the user for; defaults; required vs optional
## Steps            — numbered imperative instructions, explain WHY for each
## Output format    — exact template with placeholders, fenced as a code block
## Examples         — 1–3 worked input→output examples
## Common mistakes  — table or bullet list: "Mistake | Fix"
## References       — links to KBs (dopl://kb/<slug>) and connectors
\`\`\`

- Keep SKILL.md **short — ideally under ~200 lines, hard ceiling ~500**. If it's growing past that, the fix is almost never "add detail here": it's to move reference material into a KB, or to split the skill into smaller skills.
- Prefer **imperative voice** ("Read the issue", "Run the script") over descriptive ("This skill reads...").
- **Explain the *why*** behind each step. Heavy MUST/NEVER walls without explanation are a yellow flag — reframe and explain reasoning so the model understands why.
- One excellent example beats five mediocre ones. Don't multi-language-dilute.

## Keeping the skill small (reference material → KBs)

A skill has no supplementary files — it is one SKILL.md. When you have material that doesn't fit that, do NOT bloat the body:

- **Long reference docs** (API specs, schemas, lookup tables, big example sets, transcripts) → put them in a **knowledge base** and link from the body: \`For the full field list, see [Product specs](dopl://kb/product-specs).\` The agent loads it with \`dopl_kb(op='read_file')\` only when needed.
- **A second distinct procedure** → make it a **second skill** and cross-reference by name. Many small skills beat one big one.
- **Copy-paste templates** short enough to inline → keep them in an Output-format code block. Large ones → a KB entry.

Link Dopl resources via \`[label](dopl://kb/<slug>)\` and \`[label](dopl://connector/<provider>)\` from anywhere in SKILL.md. Keep references one level deep.

## Common anti-patterns

- **Vague description** ("Helps with X") — fails the trigger test.
- **Description that summarizes the workflow** — Claude follows the description and skips the body.
- **First-person narration** ("I will help you…") — descriptions are injected into a system prompt.
- **Workflow narratives** ("In session 2025-10-03 we discovered…") instead of reusable instructions.
- **Heavy MUST/NEVER walls** without explaining why — the model rationalizes around them.
- **Multi-language example dilution** — pick the most relevant; port on demand.
- **Generic placeholders** (\`step1\`, \`helper2\`) instead of semantic names.
- **Putting "when to use" instructions only in the body** — frontmatter is what the agent sees during selection.
- **Skipping \`when_not_to_use\`** — without it, the skill over-triggers on adjacent intents.

## Quality checklist (run before saving)

- [ ] \`name\` is lowercase, hyphenated, ≤64 chars, matches skill slug.
- [ ] \`description\` is ≤1024 chars, names *what* and *when*, leads with concrete trigger keywords, third-person, present-tense.
- [ ] Description is "pushy" enough to overcome under-triggering.
- [ ] \`when_to_use\` lists ≥3 realistic user phrasings (including casual/abbreviated).
- [ ] \`when_not_to_use\` lists ≥2 genuine near-misses.
- [ ] Body has Overview, When-to-use, Steps, Inputs, Output, Examples, Common Mistakes.
- [ ] Steps are imperative and each non-obvious step explains *why*.
- [ ] At least one concrete worked example, ready to mimic.
- [ ] SKILL.md is short (ideally <200 lines); reference material moved to a KB, not inlined.
- [ ] The skill does ONE thing — if it does several, it's split into several skills.
- [ ] No first-person voice, no narrative storytelling, no workflow-summary in \`description\`.
- [ ] KB and connector references use \`dopl://kb/<slug>\` and \`dopl://connector/<provider>\` form.

## Authoring workflow (recommended)

When the user says "build me a skill for X":

1. **Clarify intent first.** Ask the user what trigger phrases they'd use, what success looks like, and what the skill should NOT do. The first 30 seconds of clarification saves 10x debugging.
2. **Scope to ONE action.** If the request spans several actions, plan several small skills (and a shared \`folder\`), not one big one.
3. **Draft the description and when_to_use FIRST**, before any body. These are 80% of the discoverability win — get them right.
4. **Call \`dopl_skill(op='create')\`** with the metadata (and optional \`folder\`) + an optional initial body. The skill is now real and addressable.
5. **Write SKILL.md procedurally** via \`dopl_skill(op='write')\`. Follow the canonical section order. Keep it short — push reference material into a KB and link it.
6. **Self-grade against the quality checklist above.** If anything is missing, fix it before declaring done.
7. **Verify.** Read the description aloud — would *you* trigger this skill from that description? If not, rewrite.

Skills are precision tools. A great description triggers reliably; a mediocre one wastes the entire skill.
`;
