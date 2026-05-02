/**
 * Pure helpers for `skill-view.tsx` — kept out of the component file
 * so the page-level orchestration stays under the 500-line cap.
 */

import {
  PRIMARY_SKILL_FILE_NAME,
  type SkillFile,
} from "@/features/skills/types";
import { SkillApiError } from "@/features/skills/client/api";

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function errMessage(err: unknown): string {
  if (err instanceof SkillApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Unknown error";
}

/**
 * Friendlier rename-failure description than the raw server message.
 * Maps the common error codes to actionable copy and falls back to
 * `errMessage` for anything else.
 */
export function renameErrDescription(
  err: unknown,
  oldName: string,
  newName: string
): string {
  if (err instanceof SkillApiError) {
    if (err.code === "SKILL_FILE_CONFLICT") {
      return `A file named "${newName}" already exists in this skill.`;
    }
    if (err.code === "SKILL_PRIMARY_FILE_IMMUTABLE") {
      return "SKILL.md can't be renamed.";
    }
    if (err.code === "SKILL_FILE_NOT_FOUND") {
      return `"${oldName}" no longer exists — refresh the page.`;
    }
    if (err.code === "SKILL_FILE_NAME_INVALID" || err.code === "BAD_REQUEST") {
      return `"${newName}" isn't a valid file name. Use letters/numbers/._- and end in .md.`;
    }
    if (err.code === "SKILL_AGENT_WRITE_DISABLED") {
      return "Agent writes are disabled for this skill.";
    }
  }
  return errMessage(err);
}

/**
 * Order: SKILL.md first (primary), then by position, then by name. The
 * server returns by position; this is a defensive client-side sort so
 * the canonical file always pins to the leftmost tab.
 */
export function sortFiles(files: SkillFile[]): SkillFile[] {
  return [...files].sort((a, b) => {
    if (a.name === PRIMARY_SKILL_FILE_NAME) return -1;
    if (b.name === PRIMARY_SKILL_FILE_NAME) return 1;
    if (a.position !== b.position) return a.position - b.position;
    return a.name.localeCompare(b.name);
  });
}

export function primaryFileId(files: SkillFile[]): string | null {
  return files.find((f) => f.name === PRIMARY_SKILL_FILE_NAME)?.id ?? null;
}
