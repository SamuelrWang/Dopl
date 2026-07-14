/**
 * Pure helpers for `skill-view.tsx` — kept out of the component file
 * so the page-level orchestration stays under the 500-line cap.
 */

import {
  PRIMARY_SKILL_FILE_NAME,
  type SkillFile,
} from "@/features/skills/types";
import { SkillApiError } from "@/features/skills/client/api";

export function errMessage(err: unknown): string {
  if (err instanceof SkillApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Unknown error";
}

/**
 * The single SKILL.md row backing a skill. Skills are single-file, but
 * the resolved payload still carries a `files` array (one element) — pick
 * the SKILL.md defensively, falling back to the first file.
 */
export function primaryFile(files: SkillFile[]): SkillFile {
  return files.find((f) => f.name === PRIMARY_SKILL_FILE_NAME) ?? files[0];
}
