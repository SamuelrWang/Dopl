/**
 * `dopl_kb` TREE writes — folders and entries inside a base: create a folder,
 * move a folder or an entry, write an entry. Routed from the registrar in
 * `knowledge.ts`.
 *
 * ⚠ **THE BASE OPS LEFT ON 2026-09-18 (A3)** for
 * `knowledge-ops-write-bases.ts`, which carries the seam's argument: a base is
 * a container with an AUDIENCE, a folder or an entry is a PATH inside one whose
 * audience is already settled. This file was at §1's 500-line hard cap, so the
 * split came before the edit. The base ops are re-exported below, so no
 * importer moved.
 *
 * ⚠ Errors map as they always did — conflict (412), already-exists (409),
 * agent-write-denied (403), validation (400) — and anything unmapped rethrows.
 */

import type { DoplClient } from "@dopl/client";
import { inlineOr, NO_NAME, NO_PATH } from "./narration";
import { ok, err, isConflict, isAlreadyExists, isApiError, apiMessage, type ToolResponse } from "./respond";
import { KB_TARGET_VANISHED, refusal, versionConflict } from "./tool-errors";
import { agentWriteDenied, resolveBaseOr, writeOr } from "./knowledge-shared";
// ⚠ THE `zod` → SENTENCE TRANSLATION LIVES APART (S52, 2026-09-18) — see
// `knowledge-validation.ts`'s header for the seam and for the rule it enforces.
import {
  createFolderValidationError,
  writeFileValidationError,
} from "./knowledge-validation";
import { isErr } from "./channel-shared";
import {
  KB_SECTION_NUDGE_CHARS,
  outlineFooter,
  unsectionedNudge,
} from "./knowledge-sections";

// ⚠ RE-EXPORTED, NOT RE-IMPLEMENTED — `knowledge.ts` and four suites address
// the base ops through this module's name, and a split is not a reason to move
// every call site.
export {
  opCreateBase,
  opGrantBase,
  opSetVisibility,
  opUpdateBase,
} from "./knowledge-ops-write-bases";

/*
 * ⚠ Write confirmations read back the STORED value, not the argument (a title
 * derived from a path), spliced into our own narration — and a path can carry a
 * backtick, since `NAME_RE` bans control and zero-width characters, NOT
 * markdown. A path is a VALUE.
 *
 * The fallbacks themselves are `narration.ts › NO_NAME` / `NO_PATH` (2026-09-17).
 */

export async function opCreateFolder(client: DoplClient, ref: string, path: string, description?: string): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  // ⚠ **THE 400 WAS RETHROWN RAW UNTIL 2026-09-18 (S52).** `description` is
  // capped at 300 like an entry's `excerpt`, and this op had no mapper at all —
  // so the folder half of the pair reached the agent as an unhandled
  // `VALIDATION_FAILED` with no field, no number and no remedy.
  const folder = await writeOr(
    () => client.createKbFolderByPath(base.id, path, description),
    createFolderValidationError,
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
export async function opWriteFile(client: DoplClient, ref: string, path: string, body: string, title?: string, expected_version?: string, force?: boolean, excerpt?: string, section?: string, clientWriteId?: string): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  const res = await writeOr(
    () =>
      client.writeKbFileByPath(
        base.id,
        path,
        { body, title, excerpt, section, clientWriteId },
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
      // 🔒 **THE TARGET VANISHED, AND IT IS NOT A VERSION PROBLEM (S40,
      // 2026-09-18).** Discriminated on the CODE and placed BEFORE both
      // status-only arms below, which would otherwise read this 409 as
      // "an entry with that title already exists" — the opposite fact.
      if (isApiError(e, 409, "KNOWLEDGE_TARGET_VANISHED")) {
        return err(
          refusal(
            KB_TARGET_VANISHED,
            `NOTHING was written at ${inlineOr(path, NO_PATH)}. A path is a POSITION, not an identity: op="move_file" and a retitle both vacate one. ⚠ Do NOT re-issue this call with force=true — write_file is an UPSERT, so a forced write at a vacated path CREATES A SECOND ENTRY that nothing afterwards can tell from the first. Find where it went with op="list_dir" (or op="get_tree"), then write at the path it is at now. An ENTRY ID survives a move; a path does not.`,
          ),
        );
      }
      // ⚠ **THE MOVE AND THE DUPLICATE RISK ARE NAMED HERE TOO (S40).** A
      // conflict says somebody wrote after your read — and the write that
      // "somebody" made may have been a MOVE, in which case the path you are
      // holding is about to stop resolving. An agent told only "reconcile and
      // retry" reaches for `force`, which is the one input that used to walk
      // past the server's own anti-duplicate guard.
      if (isConflict(e)) {
        return err(
          refusal(
            versionConflict('op="read_file"'),
            `NOTHING was written at ${inlineOr(path, NO_PATH)}. Read it again for the current body and Version, reconcile, then re-issue with that expected_version. ⚠ The other write may have MOVED or RENAMED this entry rather than edited it — check op="list_dir" before you retry, because write_file is an UPSERT and a forced write at a vacated path creates a DUPLICATE rather than overwriting anything.`,
          ),
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
  // 🔒 **THE CONVERGED RESULT SAYS SO, FIRST, AND IT IS NOT AN ERROR** (S53).
  // The row came back off `client_write_id`, so THIS call wrote nothing and the
  // body stored is the FIRST call's. An agent told only "Wrote …" over a
  // converged result would believe its second, different body is what is saved
  // — which is worse than the timeout it was recovering from.
  // ⚠ `retry=none` BECAUSE THE WRITE LANDED: the same grammar the PIN_LARGE
  // warning uses for a nudge that rides a SUCCESS, so nothing here reads as a
  // refusal. ⚠ `?? false` (INVARIANTS §8): an older server sends no such key and
  // absent must read as "this call wrote", the behaviour before the field.
  const convergedNote = (res.converged ?? false)
    ? `reason=converged · this call wrote NOTHING — client_write_id matched an earlier write of yours, and what is below is THAT write's entry · retry=none, it landed. If the body you just sent differs from the stored one, read_file it and write again with a NEW key.`
    : null;
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
      ...(convergedNote ? [convergedNote, ""] : []),
      ...(unsectioned ? [unsectionedNudge(), ""] : []),
      // ⚠ **THE VERSION SAYS WHAT IT IS FOR (A3/S34, 2026-09-18).** The returned
      // version ALREADY works as the next call's `expected_version`
      // (`service-paths.ts` compares `updatedAt` string-equal), and only
      // `read_file` said so — so an agent correcting its own write re-read the
      // entry it had just written, or reached for `force=true`, which disarms
      // the server's anti-duplicate guard. The parenthetical is `read_file`'s,
      // word for word, because two wordings read as two facts.
      `Wrote ${inlineOr(canonicalPath, NO_PATH)} (entry id: \`${entry.id}\`, ${entry.body.length} chars). New version: \`${entry.updatedAt}\` (pass as expected_version to write_file).${note}${sectionNote}`,
      ...[outlineFooter(outline)].filter((l): l is string => l !== null),
    ].join("\n")
  );
}
