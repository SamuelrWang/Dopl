/**
 * Skill health lint — pure checks derived from the MCP server's
 * skill-authoring guide (packages/mcp-server/src/prompts/
 * skill-authoring-guide.ts). Runs client-side on the detail page;
 * no network, no state.
 *
 * Philosophy: few, concrete, actionable rules. An `error` means agents
 * will likely mis-trigger or fail on this skill; a `warn` is a quality
 * nudge. Anything fuzzier than that stays out.
 */

import { PRIMARY_SKILL_FILE_NAME } from "./types";
import type { ResolvedSkill } from "./types";

export interface SkillLintIssue {
  level: "error" | "warn";
  message: string;
}

const DESCRIPTION_MIN = 40;
const DESCRIPTION_MAX = 1024;
const WHEN_TO_USE_MIN = 30;
const BODY_MIN = 100;
const BODY_BLOAT = 8_000;

export function lintSkill(resolved: ResolvedSkill): SkillLintIssue[] {
  const { skill, files, references } = resolved;
  const issues: SkillLintIssue[] = [];

  if (!skill.description.trim()) {
    issues.push({ level: "error", message: "Description is empty — agents can't decide when to load this skill." });
  } else if (skill.description.trim().length < DESCRIPTION_MIN) {
    issues.push({ level: "warn", message: `Description under ${DESCRIPTION_MIN} chars — too thin to trigger reliably.` });
  } else if (skill.description.length > DESCRIPTION_MAX) {
    issues.push({ level: "warn", message: `Description over ${DESCRIPTION_MAX} chars — trim it; details belong in SKILL.md.` });
  }

  if (skill.whenToUse.trim().length < WHEN_TO_USE_MIN) {
    issues.push({ level: "warn", message: "“When to use” is short — agents under-trigger skills; name concrete situations and keywords." });
  }
  if (!skill.whenNotToUse?.trim()) {
    issues.push({ level: "warn", message: "No “when NOT to use” — negative triggers prevent false positives." });
  }

  const primary = files.find((f) => f.name === PRIMARY_SKILL_FILE_NAME);
  if (!primary || primary.body.trim().length === 0) {
    issues.push({ level: "error", message: "SKILL.md is empty — there's no procedure for the agent to follow." });
  } else if (primary.body.trim().length < BODY_MIN) {
    issues.push({ level: "warn", message: "SKILL.md is very short — spell out the steps." });
  }

  const totalChars = files.reduce((sum, f) => sum + f.body.length, 0);
  if (totalChars > BODY_BLOAT) {
    issues.push({ level: "warn", message: `Skill files total ${Math.round(totalChars / 1000)}k chars — consider splitting rarely-needed detail into supplementary files agents read on demand.` });
  }

  for (const ref of references) {
    if (!ref.available) {
      issues.push({ level: "error", message: `Broken reference: ${ref.label} — the linked ${ref.kind === "kb" ? "knowledge base" : "connector"} doesn't exist.` });
    }
  }

  return issues;
}
