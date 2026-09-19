/**
 * `dopl_kb` ENTRY + FOLDER write handlers: create/move folders, write/move
 * entries. Every write maps @dopl/client errors — conflict (412),
 * already-exists (409), agent-write-denied (403), and validation (400) —
 * to actionable tool messages. Routed from the registrar in knowledge.ts.
 *
 * ⚠ **THE BASE LANE LEFT ON 2026-09-18** for `knowledge-ops-base-write.ts`
 * (create/update/set_visibility/grant on BASES). What forced the split is §1's
 * 500-line cap — this file sat AT it — and the seam is a reason to change: a
 * base is a CONTAINER with an audience, an entry is a DOCUMENT with a version.
 * `writeOr` and `agentCreateForbidden` went to `knowledge-write-shared.ts`, so
 * neither lane imports the other.
 */

import type { DoplClient } from "@dopl/client";
import { inlineOr, NO_NAME, NO_PATH } from "./narration";
import { ok, err, isConflict, isAlreadyExists, isApiError, apiMessage, type ToolResponse } from "./respond";
import {
  resolveBaseOr,
  writeFileValidationError,
} from "./knowledge-shared";
import { writeOr } from "./knowledge-write-shared";
// ⚠ S33/S47 — the SAME string a read_file header prints, so the two compare.
import { bodyFact } from "./body-digest";
import { isErr } from "./channel-shared";
import {
  KB_SECTION_NUDGE_CHARS,
  outlineFooter,
  unsectionedNudge,
} from "./knowledge-sections";

/*
 * ⚠ Write confirmations read back the STORED value, not the argument (a
 * canonicalised base name, a title derived from a path), spliced into our own
 * narration — and a path can carry a backtick, since `NAME_RE` bans control and
 * zero-width characters, NOT markdown. A name is a VALUE.
 *
 * The fallbacks themselves are `narration.ts › NO_NAME` / `NO_PATH` (2026-09-17).
 */

export async function opCreateFolder(client: DoplClient, ref: string, path: string, description?: string): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  const folder = await writeOr(() =>
    client.createKbFolderByPath(base.id, path, description),
  );
  if (isErr(folder)) return folder;
  const descNote = description !== undefined ? " Description set." : "";
  return ok(`Folder ready at ${inlineOr(path, NO_PATH)} (id: \`${folder.id}\`).${descNote}`);
}

/**
 * `move_folder` and `move_file` — ONE mover (2026-09-17). They were two
 * functions differing only in a noun: `moveKbByPath` is path-addressed and
 * kind-agnostic, so the only per-op logic is checking that the path resolved to
 * the KIND the caller named — which is a refusal, because moving an entry on a
 * `move_folder` would be a write the caller never asked for.
 */
export async function opMove(
  client: DoplClient,
  ref: string,
  from_path: string,
  to_path: string,
  kind: "folder" | "entry",
): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  const result = await writeOr(() =>
    client.moveKbByPath(base.id, from_path, to_path),
  );
  if (isErr(result)) return result;
  if (result.kind !== kind) {
    return err(
      `Path ${inlineOr(from_path, NO_PATH)} resolved to a ${result.kind}, not ${kind === "folder" ? "a folder" : "an entry"}.`
    );
  }
  const noun = kind === "folder" ? "Folder" : "Entry";
  return ok(`${noun} moved: ${inlineOr(from_path, NO_PATH)} → ${inlineOr(to_path, NO_PATH)}.`);
}

/**
 * ⚠ **`section` MAKES THIS A READ-MODIFY-WRITE, AND THE SERVER DOES ALL THREE.**
 * The splice happens against the row `expected_version` was just checked on, so
 * a sectioned write is exactly as safe as a whole-body one — where a caller
 * merging locally would be merging onto a body it fetched in an earlier request.
 *
 * ⚠ **THE RESULT ALWAYS ENDS WITH THE OUTLINE OF WHAT WAS SAVED**, which is the
 * addresses the next read can use, and it LEADS with `reason=UNSECTIONED` when a
 * long body carries no headings at all. **The write lands either way** (Samuel's
 * ruling): refusing would refuse the user's content over our formatting taste.
 */
export async function opWriteFile(client: DoplClient, ref: string, path: string, body: string, title?: string, expected_version?: string, force?: boolean, excerpt?: string, section?: string): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  const res = await writeOr(
    () =>
      client.writeKbFileByPath(
        base.id,
        path,
        { body, title, excerpt, section },
        force ? null : expected_version
      ),
    (e) => {
      // ⚠ THE ONE REFUSAL `section` ADDS, and it is a refusal rather than a
      // first-match because the write it would have made is unrecoverable.
      if (isApiError(e, 409, "KNOWLEDGE_SECTION_AMBIGUOUS")) {
        return err(
          `reason=SECTION_AMBIGUOUS · ${apiMessage(e) ?? "that heading names more than one section."} · retry=none, they have the same name\n\nNOTHING was written. Rename one of them, or drop \`section\` and write the whole body.`,
        );
      }
      if (isConflict(e)) {
        return err(
          `${inlineOr(path, NO_PATH)} changed since you last read it. Call dopl_kb(op="read_file", base, path) to get the current content + version, reconcile your changes, then retry write_file with that expected_version (or pass force=true to overwrite).`
        );
      }
      if (isAlreadyExists(e)) {
        return err(
          `An entry titled ${inlineOr(title ?? path.split("/").filter(Boolean).pop(), NO_NAME)} already exists in that folder. Pick a different title/path, or read+overwrite the existing entry with dopl_kb(op="read_file" → "write_file").`
        );
      }
      // ⚠ Name the failing field + rule, never a raw "VALIDATION_FAILED".
      return writeFileValidationError(e, title);
    },
  );
  if (isErr(res)) return res;
  const { entry, outline, sectionCreated } = res;
  // ⚠ The addressable path's leaf is the entry's TITLE, not the input path's
  // leaf segment — print it, and surface the canonical form when a passed
  // `title` slugs differently from the input leaf.
  const parentSegments = path.split("/").slice(0, -1).filter(Boolean);
  const canonicalPath = [...parentSegments, entry.title].join("/");
  const note =
    canonicalPath !== path
      ? ` Address future reads/moves with path ${inlineOr(canonicalPath, NO_PATH)}.`
      : "";
  // ⚠ THE NUDGE LEADS, because a `reason=` line read after the success sentence
  // is a line an agent has already decided it does not need.
  const unsectioned =
    entry.body.length > KB_SECTION_NUDGE_CHARS &&
    (outline?.sections.length ?? 0) === 0;
  const sectionNote =
    section === undefined
      ? ""
      : sectionCreated
        ? ` Section ${inlineOr(section, "`(unreadable)`")} did not exist and was APPENDED at \`##\` level.`
        : ` Replaced section ${inlineOr(section, "`(unreadable)`")}; the rest of the entry is untouched.`;
  return ok(
    [
      ...(unsectioned ? [unsectionedNudge(), ""] : []),
      `Wrote ${inlineOr(canonicalPath, NO_PATH)} (entry id: \`${entry.id}\`, ${bodyFact(entry.body)}). New version: \`${entry.updatedAt}\`.${note}${sectionNote}`,
      ...[outlineFooter(outline)].filter((l): l is string => l !== null),
    ].join("\n")
  );
}


