/** Pure helpers for `skill-view.tsx`, split out to keep it under the
 *  500-line cap. */

import { userFacingMessage } from "@/shared/api/user-facing-message";
import {
  PRIMARY_SKILL_FILE_NAME,
  type SkillFile,
} from "@/features/skills/types";

export function errMessage(err: unknown): string {
  return userFacingMessage(err);
}

/** The single SKILL.md row. The resolved payload still carries a one-element
 *  `files` array, so pick SKILL.md defensively and fall back to files[0]. */
export function primaryFile(files: SkillFile[]): SkillFile {
  return files.find((f) => f.name === PRIMARY_SKILL_FILE_NAME) ?? files[0];
}
