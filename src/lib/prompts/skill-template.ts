/**
 * Canonical Dopl skill body template + synthesis prompt.
 *
 * This is what the MCP returns to the user's Claude Code via
 * `get_skill_template`. The agent fills the template in its own context
 * and writes the result back via `update_cluster_brain`. Server never
 * runs the LLM — all synthesis happens client-side.
 *
 * The section structure mirrors Claude Code's native skill-creator output
 * so brains read and execute identically to locally-authored skills.
 * Thin-pointer SKILL.md files on disk pull this content at invocation
 * time, so brain quality IS skill quality.
 */

export const SKILL_TEMPLATE_VERSION = "skill-template-v1";

/**
 * Blank scaffold the agent fills in. Every section is optional — omit
 * anything you can't populate honestly from the source material.
 */
export const SKILL_BODY_TEMPLATE = `## When to use this skill
<One paragraph — the trigger scenarios for invoking this skill. Include concrete user-prompt phrasings where possible. Be specific: "when the user asks to build an agent that X" beats "when the user asks about agents".>

## Instructions
<The core guidance. What the agent should know and do when executing this skill. Reference specific tools, entry patterns, and concepts. Keep prose tight; every paragraph earns its place.>

## Step-by-step
<Numbered steps only when a sequential approach applies. Omit this section entirely if the skill isn't step-based.>
1. ...
2. ...

## Examples
<2–3 concrete scenarios showing this skill in action. Each example: user intent → skill's response pattern.>

## Anti-patterns
<What NOT to do. Common mistakes, wrong tools for the job, scale misuse. Honest about boundaries.>

## References
<Each entry in this cluster with a one-line role. Format: "- [Entry title](entry-url) — what role this entry plays in the skill."  This is the provenance trail.>`;

/**
 * The synthesis prompt. Agent loads this, pastes the raw material
 * (entries' agents.md) below it in its own context, and produces the
 * filled-in body. Result goes into `update_cluster_brain`.
 */
export const SKILL_SYNTHESIS_PROMPT = `You are producing a Claude Code skill body from Dopl knowledge-base entries. This body is what a user's Claude Code will fetch and execute against when the skill is invoked — treat the output as the skill itself, not a document about the skill.

CRITICAL RULES:
- Output MUST follow the section structure below. Omit any section you can't fill honestly from the source material — don't pad with generic filler.
- Preserve every actionable step, command, env var, threshold, and code snippet from the source entries verbatim. These are load-bearing; generic paraphrase breaks execution.
- Strip marketing language, anecdotes, repetitive intros, filler prose.
- Do NOT mention the user's current project, task, or workflow. The skill must be task-agnostic — a SKILL-scoped description, not a THIS-user-in-THIS-session description.
- No preamble, no "here's your skill:", no closing remarks. Output ONLY the markdown sections below.

OUTPUT STRUCTURE (use these exact headings):

## When to use this skill
One paragraph. The concrete trigger scenarios for invoking this skill — what user intents map here. Include phrasings a user would actually type.

## Instructions
Core guidance. What the agent needs to know to execute. Prose, not a list. Focus on what's unique to this skill vs. generic AI/automation knowledge.

## Step-by-step
Numbered steps, only when a sequential approach applies. Omit entirely for non-procedural skills.

## Examples
2–3 concrete scenarios. Format each as "User: <intent> → Agent: <response pattern, tools used, key decisions>". Keep each example tight.

## Anti-patterns
Bulleted list of what NOT to do. Common mistakes, wrong tool choices, out-of-scope uses. Be honest about what this skill is not for.

## References
Bulleted list of the entries in this cluster, one line each. Format: "- <entry title> — <its specific role in the skill>". This is the provenance trail.

Now produce the skill body. Raw material follows:`;

/**
 * Composed payload returned by the \`get_skill_template\` MCP tool.
 * Agents paste this directly into a synthesis context; it includes both
 * the prompt (what to do) and the template (what the output should look
 * like), so there's no separate "show me the structure" round-trip.
 */
export function buildSkillTemplatePayload(): string {
  return [
    `# Dopl Skill Synthesis — Agent Instructions (${SKILL_TEMPLATE_VERSION})`,
    "",
    "Use the prompt and template below to generate a cluster brain. The output of this prompt goes straight into `update_cluster_brain(slug, <output>)`. No server-side LLM call runs — you are the synthesizer.",
    "",
    "## Prompt to run",
    "",
    SKILL_SYNTHESIS_PROMPT,
    "",
    "## Expected output shape",
    "",
    "Your output MUST render as the following markdown structure:",
    "",
    "```markdown",
    SKILL_BODY_TEMPLATE,
    "```",
    "",
    "## After generating",
    "",
    "1. Call `update_cluster_brain(slug, <your output>)` to persist.",
    "2. Call `sync_skills` so the thin-pointer SKILL.md on disk reflects the new brain.",
  ].join("\n");
}

/**
 * Advisory structural check — does this brain content have the minimum
 * viable sections? Used by the update_cluster_brain PATCH handler to
 * return a warning in the response when the content looks flat. Not a
 * hard rejection; brains can be partial during iterative development.
 */
export function validateBrainStructure(instructions: string): {
  ok: boolean;
  missingSections: string[];
} {
  const required = ["## When to use this skill", "## Instructions"];
  const missing = required.filter((heading) => !instructions.includes(heading));
  return {
    ok: missing.length === 0,
    missingSections: missing,
  };
}
